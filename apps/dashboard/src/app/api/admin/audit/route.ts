import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/audit — list audit log entries (admin only).
 *
 * Query params: resourceType, userId, from, to, skip, limit
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const resourceType = params.get("resourceType");
  const userId = params.get("userId");
  const from = params.get("from");
  const to = params.get("to");
  const skip = parseInt(params.get("skip") || "0", 10);
  const limit = Math.min(parseInt(params.get("limit") || "50", 10), 100);

  const where: Record<string, unknown> = {};
  if (resourceType) where.resourceType = resourceType;
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    entries,
    pagination: { total, skip, limit },
  });
}
