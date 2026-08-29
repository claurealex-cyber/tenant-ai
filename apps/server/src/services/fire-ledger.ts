import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";

/** "YYYY-MM" in server-local time — the monthly cap bucket. */
export function fireMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically claim one Text-Em-All broadcast against the SHARED monthly cap
 * (Zillow + individual paths). Returns { allowed, count, cap }. When not allowed,
 * NO row is written and the caller must fall back (relay for the individual path;
 * skip for Zillow). Serializable-ish via a transaction: count-then-insert so two
 * concurrent claims can't both slip past the cap.
 */
export async function claimFire(
  path: "zillow" | "individual",
  opts: { ref?: string; now?: Date } = {},
): Promise<{ allowed: boolean; count: number; cap: number }> {
  const now = opts.now ?? new Date();
  const month = fireMonth(now);
  const cap = parseInt((await resolveConfig("textemall", "monthly_fire_cap")) || "96", 10);
  return prisma.$transaction(async (tx) => {
    const count = await tx.textEmAllFire.count({ where: { month } });
    if (count >= cap) return { allowed: false, count, cap };
    await tx.textEmAllFire.create({ data: { month, path, ref: opts.ref ?? null } });
    return { allowed: true, count: count + 1, cap };
  });
}

/** Read-only current-month fire count (for status/dashboard). */
export async function fireCount(now = new Date()): Promise<number> {
  return prisma.textEmAllFire.count({ where: { month: fireMonth(now) } });
}

/**
 * Record a fire WITHOUT enforcing the monthly cap. Used by the direct-API
 * broadcast path (no Zapier → no cap) so the per-phone cooldown still works.
 */
export async function recordFire(
  path: "zillow" | "individual",
  opts: { ref?: string; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  await prisma.textEmAllFire.create({ data: { month: fireMonth(now), path, ref: opts.ref ?? null } });
}
