import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { withGuiLock } from "../lib/gui-lock.js";
import { probeRecentBroadcasts, type ProbeResult } from "./textemall-broadcast-api.js";
import { notifyOnMac } from "./messages-relay.js";

/**
 * Ambiguous-send resolution (rev.5 M3b / T3). A batch goes `ambiguous` when a
 * send failed AFTER the point where Text-Em-All might have accepted it (osascript
 * timeout, `send N` stage error). Its phones stay quarantined — excluded from
 * every CSV — until this resolver proves what happened:
 *
 *  - a TEA broadcast with the LANE's name, created no earlier than 60 s before
 *    the batch, whose recipient set EXACTLY equals the batch's phones (10-digit;
 *    exact — never ⊇, so an individual-lane broadcast to the same person can't
 *    false-promote a zillow batch, U5) → PROMOTE: batch `sent` + flip leads /
 *    mark applicants. No re-text.
 *  - no such broadcast → DEMOTE: batch `failed`; the phones free up and the next
 *    cycle retries them.
 *  - the probe itself fails (login wall, tab gone) → the quarantine PERSISTS
 *    (never expires into a retry) and the owner is notified once per streak.
 *
 * Runs at cycle start, BEFORE any CSV build, under the GUI lock (top-level —
 * the caller holds no GUI lock, so no nesting).
 */

const tenDigit = (p: string) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

function sameSet(a: string[], b: Set<string>): boolean {
  if (a.length !== b.size) {
    // Duplicate-tolerant: compare as sets.
    const as = new Set(a);
    if (as.size !== b.size) return false;
    for (const x of as) if (!b.has(x)) return false;
    return true;
  }
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

let probeFailStreakNotified = false;

export interface AmbiguityResolution {
  checked: number;
  promoted: number;
  demoted: number;
  unresolved: number;
}

export async function resolveAmbiguousBatches(
  now: Date = new Date(),
  deps: {
    probe?: typeof probeRecentBroadcasts;
    notify?: typeof notifyOnMac;
    /** Test isolation only: restrict resolution to one sandbox's batches.
     *  Production callers omit it — the quarantine is global by design. */
    scope?: { groupName?: string };
  } = {},
): Promise<AmbiguityResolution> {
  const batches = await prisma.textEmAllBatch.findMany({ where: { status: "ambiguous", ...(deps.scope ?? {}) } });
  if (batches.length === 0) return { checked: 0, promoted: 0, demoted: 0, unresolved: 0 };

  const name = (await resolveConfig("textemall", "broadcast_name")) || "Ghem Leads";
  const probe = deps.probe ?? probeRecentBroadcasts;
  const notify = deps.notify ?? notifyOnMac;

  const res: ProbeResult = await withGuiLock("textemall-ambiguity", () => probe({ name }));
  if (res.status !== "ok") {
    if (!probeFailStreakNotified) {
      notify(
        `Text-Em-All has ${batches.length} pending broadcast(s) that can't be verified (${res.status === "needs_login" ? "Safari needs a Text-Em-All login" : "probe failed"}). Their recipients stay on hold until verification succeeds.`,
        "Tenant AI Zillow",
      );
      probeFailStreakNotified = true;
    }
    return { checked: batches.length, promoted: 0, demoted: 0, unresolved: batches.length };
  }
  probeFailStreakNotified = false;

  let promoted = 0;
  let demoted = 0;
  const claimed = new Set<number>(); // one TEA broadcast can prove at most one batch
  for (const b of batches) {
    const want = new Set(((b.phones as string[] | null) ?? []).map(tenDigit).filter((x) => x.length === 10));
    const match = res.broadcasts.find(
      (x) =>
        !claimed.has(x.id) &&
        (x.createdAtMs == null || x.createdAtMs >= b.createdAt.getTime() - 60_000) &&
        want.size > 0 &&
        sameSet(x.phones, want),
    );
    if (match) {
      claimed.add(match.id);
      await prisma.textEmAllBatch.update({ where: { id: b.id }, data: { status: "sent", error: null } });
      const phones = (b.phones as string[] | null) ?? [];
      if ((b.slot ?? "").endsWith(":appl")) {
        await prisma.zillowLead.updateMany({
          where: { phone: { in: phones }, applicationCompleted: true, applicantSentBatchId: null },
          data: { applicantSentBatchId: b.id, applicantInvitedAt: now },
        }).catch((e) => console.error("ambiguity applicant mark failed (batch promoted, safe):", e));
      } else {
        await prisma.zillowLead.updateMany({
          where: { phone: { in: phones }, status: "new" },
          data: { status: "invited", sentVia: "textemall", sentBatchId: b.id },
        }).catch((e) => console.error("ambiguity lead flip failed (batch promoted, safe):", e));
      }
      promoted++;
      console.log(`[textemall-ambiguity] batch ${b.slot ?? b.id} PROMOTED → sent (TEA broadcast ${match.id} matched; no re-text).`);
    } else {
      await prisma.textEmAllBatch.update({
        where: { id: b.id },
        data: { status: "failed", error: `${b.error ?? "ambiguous"} | resolved: no matching broadcast`.slice(0, 500) },
      });
      demoted++;
      console.log(`[textemall-ambiguity] batch ${b.slot ?? b.id} DEMOTED → failed (no matching broadcast; phones freed for retry).`);
    }
  }
  return { checked: batches.length, promoted, demoted, unresolved: 0 };
}

/** Test hook: reset the notification streak. */
export function _resetAmbiguityStreak(): void {
  probeFailStreakNotified = false;
}
