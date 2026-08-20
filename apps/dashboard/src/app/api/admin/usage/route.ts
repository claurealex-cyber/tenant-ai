import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/usage — platform-wide usage dashboard (admin only).
 *
 * Query params: ?month=YYYY-MM (defaults to current month)
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthParam = request.nextUrl.searchParams.get("month");
  let billingMonth: Date;
  if (monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    billingMonth = new Date(y, m - 1, 1);
  } else {
    const now = new Date();
    billingMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // Total AI cost for the month
  const usageAgg = await prisma.usageRecord.aggregate({
    where: { billingMonth },
    _sum: { costCents: true, quantity: true },
  });

  // Breakdown by type
  const usageByType = await prisma.usageRecord.groupBy({
    by: ["type"],
    where: { billingMonth },
    _sum: { costCents: true, quantity: true },
  });

  // Total revenue (invoices for the billing month)
  const revenueAgg = await prisma.invoice.aggregate({
    where: { billingMonth, status: { in: ["paid", "finalized"] } },
    _sum: { totalCents: true, basePriceCents: true, aiMarkupCents: true },
  });

  // Top 20 users by AI usage
  const topUsers = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: {
      billingMonth,
      type: { in: ["voice_call", "sms"] },
    },
    _sum: { costCents: true },
    orderBy: { _sum: { costCents: "desc" } },
    take: 20,
  });

  // Enrich top users with names and subscription info
  const userIds = topUsers.map((u) => u.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      companyName: true,
      subscription: {
        select: {
          tier: { select: { name: true, displayName: true, includedAiCents: true } },
        },
      },
    },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));
  const enrichedTopUsers = topUsers.map((u) => {
    const user = userMap.get(u.userId);
    return {
      userId: u.userId,
      name: user?.name ?? "Unknown",
      companyName: user?.companyName ?? null,
      tierName: user?.subscription?.tier?.displayName ?? "None",
      includedAiCents: user?.subscription?.tier?.includedAiCents ?? 0,
      aiCostCents: u._sum.costCents ?? 0,
    };
  });

  return NextResponse.json({
    billingMonth: billingMonth.toISOString(),
    totalAiCostCents: usageAgg._sum.costCents ?? 0,
    totalQuantity: usageAgg._sum.quantity ?? 0,
    totalRevenueCents: revenueAgg._sum.totalCents ?? 0,
    totalBaseCents: revenueAgg._sum.basePriceCents ?? 0,
    totalMarkupCents: revenueAgg._sum.aiMarkupCents ?? 0,
    margin:
      (revenueAgg._sum.totalCents ?? 0) - (usageAgg._sum.costCents ?? 0),
    usageByType: usageByType.map((u) => ({
      type: u.type,
      costCents: u._sum.costCents ?? 0,
      quantity: u._sum.quantity ?? 0,
    })),
    topUsers: enrichedTopUsers,
  });
}
