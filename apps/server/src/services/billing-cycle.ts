/**
 * Monthly billing cycle service.
 *
 * Aggregates AI usage for each active subscription, calculates overage,
 * and creates Invoice records. Runs on the 1st of each month via BullMQ.
 */

import { prisma } from "../lib/prisma.js";

/**
 * Run the billing cycle for a given billing month.
 *
 * For each active subscription:
 * 1. Sum UsageRecords for the previous month
 * 2. Calculate AI overage (usage above tier's included amount)
 * 3. Apply admin overrides if present
 * 4. Create Invoice record
 *
 * @param billingMonth First day of the month being billed (e.g., 2026-01-01 for January)
 * @returns Number of invoices created
 */
export async function runBillingCycle(billingMonth: Date): Promise<number> {
  // Find all active subscriptions (not trialing, canceled, or suspended)
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ["active"] },
    },
    include: {
      tier: true,
    },
  });

  let created = 0;

  for (const sub of subscriptions) {
    // Sum AI usage for this user in the billing month
    const usageAgg = await prisma.usageRecord.aggregate({
      where: {
        userId: sub.userId,
        billingMonth,
        type: { in: ["voice_call", "sms"] },
      },
      _sum: { costCents: true },
    });

    const totalAiCost = usageAgg._sum.costCents ?? 0;

    // Determine effective pricing (admin overrides or tier defaults)
    const basePriceCents =
      sub.overrideBasePriceCents ?? sub.tier.basePriceCents;
    const includedAiCents = sub.tier.includedAiCents;
    const aiMarkupPercent =
      sub.overrideAiMarkupPercent ?? sub.tier.aiMarkupPercent;

    // Calculate overage
    let aiMarkupCents = 0;
    if (totalAiCost > includedAiCents) {
      const overageCost = totalAiCost - includedAiCents;
      aiMarkupCents = Math.round(overageCost * (aiMarkupPercent / 100));
    }

    const totalCents = basePriceCents + aiMarkupCents;

    // Create invoice (idempotent via @@unique(subscriptionId, billingMonth))
    try {
      await prisma.invoice.create({
        data: {
          subscriptionId: sub.id,
          billingMonth,
          basePriceCents,
          aiUsageCostCents: totalAiCost,
          aiMarkupCents,
          totalCents,
          status: "finalized",
        },
      });
      created++;
    } catch (err: any) {
      // P2002 = unique constraint → invoice already exists for this month
      if (err?.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  return created;
}
