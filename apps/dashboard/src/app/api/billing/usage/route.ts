import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/billing/usage — get current period AI usage breakdown.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Current billing month
  const now = new Date();
  const billingMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Aggregate by type
  const usageByType = await prisma.usageRecord.groupBy({
    by: ["type"],
    where: {
      userId: session.user.id,
      billingMonth,
    },
    _sum: {
      costCents: true,
      quantity: true,
      durationSeconds: true,
    },
    _count: true,
  });

  // Total AI cost (voice + sms)
  const totalAiCostCents = usageByType
    .filter((u) => u.type === "voice_call" || u.type === "sms")
    .reduce((sum, u) => sum + (u._sum.costCents ?? 0), 0);

  // Get subscription to show included amount
  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    include: { tier: true },
  });

  const includedAiCents = subscription?.tier.includedAiCents ?? 0;
  const aiMarkupPercent =
    subscription?.overrideAiMarkupPercent ??
    subscription?.tier.aiMarkupPercent ??
    0;

  let estimatedOverageCents = 0;
  if (totalAiCostCents > includedAiCents) {
    const overage = totalAiCostCents - includedAiCents;
    estimatedOverageCents = Math.round(overage * (aiMarkupPercent / 100));
  }

  return NextResponse.json({
    billingMonth: billingMonth.toISOString(),
    usageByType: usageByType.map((u) => ({
      type: u.type,
      count: u._count,
      costCents: u._sum.costCents ?? 0,
      totalQuantity: u._sum.quantity ?? 0,
      totalDurationSeconds: u._sum.durationSeconds ?? 0,
    })),
    totalAiCostCents,
    includedAiCents,
    estimatedOverageCents,
  });
}
