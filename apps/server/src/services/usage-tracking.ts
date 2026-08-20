import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";

export type UsageType = "voice_call" | "sms" | "web_app" | "website_visit";

interface RecordUsageInput {
  userId: string;
  propertyId?: string;
  type: UsageType;
  costCents?: number;
  quantity?: number;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Get the billing month (first day of the current month) for usage records.
 */
export function getBillingMonth(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Estimate the cost of an OpenAI Realtime voice call in cents.
 *
 * Based on gpt-4o-mini-realtime pricing:
 *   - Audio input:  $0.06 / min → ~$0.001/sec
 *   - Audio output: $0.24 / min → ~$0.004/sec
 *   - Text input:   $0.60 / 1M tokens
 *   - Text output:  $2.40 / 1M tokens
 *
 * For a rough estimate, we use ~$0.33/min total.
 */
export function estimateVoiceCallCostCents(
  durationSeconds: number,
): number {
  const minutes = durationSeconds / 60;
  // ~$0.33/min = 33 cents/min
  return Math.round(minutes * 33);
}

/**
 * Estimate the cost of an OpenAI Chat API call for SMS in cents.
 *
 * Based on gpt-4o-mini pricing:
 *   - Input:  $0.15 / 1M tokens
 *   - Output: $0.60 / 1M tokens
 *
 * Average SMS exchange: ~500 input tokens, ~100 output tokens
 * Cost: ~$0.0001 per exchange ≈ 0.01 cents, rounds to 1 cent minimum
 */
export function estimateSmsCostCents(
  inputTokens?: number,
  outputTokens?: number,
): number {
  const input = inputTokens ?? 500;
  const output = outputTokens ?? 100;

  // $0.15 / 1M input = $0.00000015/token → cents: 0.000015/token
  // $0.60 / 1M output = $0.0000006/token → cents: 0.00006/token
  const costCents =
    input * 0.000015 + output * 0.00006;

  // Minimum 1 cent
  return Math.max(1, Math.round(costCents));
}

/**
 * Record a usage event for billing purposes.
 */
export async function recordUsage(
  input: RecordUsageInput,
): Promise<string> {
  const record = await prisma.usageRecord.create({
    data: {
      userId: input.userId,
      propertyId: input.propertyId ?? null,
      type: input.type,
      costCents: input.costCents ?? 0,
      quantity: input.quantity ?? 1,
      durationSeconds: input.durationSeconds ?? null,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
      billingMonth: getBillingMonth(),
    },
  });

  return record.id;
}

/**
 * Get total usage cost for a user in a given billing month.
 */
export async function getUserMonthlyUsage(
  userId: string,
  billingMonth?: Date,
): Promise<{ totalCostCents: number; byType: Record<string, number> }> {
  const month = billingMonth ?? getBillingMonth();

  const records = await prisma.usageRecord.findMany({
    where: {
      userId,
      billingMonth: month,
    },
  });

  const byType: Record<string, number> = {};
  let totalCostCents = 0;

  for (const record of records) {
    totalCostCents += record.costCents;
    byType[record.type] = (byType[record.type] ?? 0) + record.costCents;
  }

  return { totalCostCents, byType };
}
