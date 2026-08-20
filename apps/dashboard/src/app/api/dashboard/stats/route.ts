import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/dashboard/stats — dashboard stats for the authenticated user.
 *
 * Returns:
 *   applicationsToday  — count of today's applications
 *   inProgress         — count of in_progress applications
 *   completedThisMonth — count of completed apps this month
 *   estimatedCostCents — sum of estimated cost this month
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Date boundaries
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const propertyFilter = { property: { userId } };

  const [applicationsToday, inProgress, completedThisMonth, costSummary] =
    await Promise.all([
      // Applications created today
      prisma.application.count({
        where: {
          ...propertyFilter,
          createdAt: { gte: startOfToday },
        } as any,
      }),

      // In-progress applications
      prisma.application.count({
        where: {
          ...propertyFilter,
          status: "in_progress",
        } as any,
      }),

      // Completed this month
      prisma.application.count({
        where: {
          ...propertyFilter,
          status: { in: ["completed", "reviewed"] },
          completedAt: { gte: startOfMonth },
        } as any,
      }),

      // Estimated cost this month (from call logs)
      prisma.callLog.aggregate({
        where: {
          ...propertyFilter,
          startedAt: { gte: startOfMonth },
        } as any,
        _sum: { estimatedCostCents: true },
      }),
    ]);

  return NextResponse.json({
    stats: {
      applicationsToday,
      inProgress,
      completedThisMonth,
      estimatedCostCents: costSummary._sum.estimatedCostCents ?? 0,
    },
  });
}
