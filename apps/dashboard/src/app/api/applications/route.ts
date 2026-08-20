import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/applications — list applications for the authenticated user's properties.
 *
 * Query params:
 *   propertyId — filter by property
 *   status     — filter by status (comma-separated)
 *   channel    — filter by channel (voice, sms, web)
 *   search     — search by applicant name or phone
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
  const status = searchParams.get("status");
  const channel = searchParams.get("channel");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "25", 10), 100);
  const skip = (page - 1) * limit;

  // Build where clause — always scoped to user's properties
  const where: Record<string, unknown> = {
    property: { userId: session.user.id },
  };

  if (propertyId) {
    where.propertyId = propertyId;
  }

  if (status) {
    const statuses = status.split(",").map((s) => s.trim());
    where.status = { in: statuses };
  }

  if (channel) {
    where.channel = channel;
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { callerPhone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [applications, total] = await Promise.all([
    prisma.application.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        property: { select: { id: true, name: true } },
      },
    }),
    prisma.application.count({ where: where as any }),
  ]);

  return NextResponse.json({
    applications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
