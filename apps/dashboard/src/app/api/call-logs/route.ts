import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/call-logs — list call logs for the authenticated user's properties.
 *
 * Query params:
 *   propertyId — filter by property
 *   channel    — filter by channel (voice, sms)
 *   from       — start date (ISO string)
 *   to         — end date (ISO string)
 *   page       — page number (default 1)
 *   limit      — items per page (default 25)
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");
  const channel = searchParams.get("channel");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {
    property: { userId: session.user.id },
  };

  if (propertyId) where.propertyId = propertyId;
  if (channel) where.channel = channel;

  if (from || to) {
    const startedAt: Record<string, Date> = {};
    if (from) startedAt.gte = new Date(from);
    if (to) startedAt.lte = new Date(to);
    where.startedAt = startedAt;
  }

  const [callLogs, total] = await Promise.all([
    prisma.callLog.findMany({
      where: where as any,
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
      include: {
        property: { select: { id: true, name: true } },
        application: { select: { id: true } },
      },
    }),
    prisma.callLog.count({ where: where as any }),
  ]);

  // Calculate summary stats
  const summary = await prisma.callLog.aggregate({
    where: where as any,
    _sum: {
      duration: true,
      estimatedCostCents: true,
    },
    _count: true,
  });

  return NextResponse.json({
    callLogs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      totalCalls: summary._count,
      totalDurationSeconds: summary._sum.duration ?? 0,
      totalEstimatedCostCents: summary._sum.estimatedCostCents ?? 0,
    },
  });
}
