import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { runZillowImport } from "./zillow-import.js";
import { sendSurveyBatch } from "./zillow-send.js";

/**
 * Daily Zillow automation: import new leads, text status-`new` leads the
 * survey link, record one mutable ZillowAutoRun row per local day.
 *
 * Claim semantics (see zillow-auto-plan.md §1):
 *  - `done` consumes the day; `needs_login`/`failed` do NOT — the hourly tick
 *    retries, so a Safari re-login heals the day automatically.
 *  - Claims are atomic: first attempt races on the unique `day` insert;
 *    retries race on an updateMany over reclaimable statuses.
 *  - Domain failures are RETURN VALUES, never throws — the BullMQ handler must
 *    never trip queue-level retry/backoff against a logged-out Safari.
 */

/** A `running` row older than this is a crashed run and is reclaimable. */
export const STALE_RUNNING_MS = 15 * 60_000;

/** Local calendar day, e.g. "2026-08-27" (server TZ — same clock the user reads). */
export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface AutoRunResult {
  outcome:
    | "ran" // import + batch completed (status done)
    | "needs_login"
    | "failed"
    | "disabled" // auto_enabled is off (and not forced)
    | "already_done" // day consumed (and not forced)
    | "claim_lost" // another trigger holds the claim
    | "not_in_window"; // before auto_hour (scheduled path only)
  run?: {
    day: string;
    status: string;
    attempts: number;
    leadsFound: number;
    leadsNew: number;
    queuedSends: number;
    sentImmediate: number;
    error: string | null;
  };
}

async function autoConfig() {
  const enabled = (await resolveConfig("zillow", "auto_enabled")) === "true";
  const hourRaw = await resolveConfig("zillow", "auto_hour");
  const hour = Math.min(23, Math.max(0, parseInt(hourRaw ?? "9", 10) || 9));
  const baselineRaw = (await resolveConfig("zillow", "auto_baseline"))?.trim();
  const baseline = baselineRaw ? new Date(baselineRaw) : null;
  return { enabled, hour, baseline: baseline && !isNaN(baseline.getTime()) ? baseline : null };
}

/**
 * Claim today's row. Returns the claimed row id, or null when another trigger
 * owns it / the day is consumed.
 */
async function claimDay(day: string, force: boolean, now: Date): Promise<string | "already_done" | null> {
  // Fast path: fresh day → create is the claim (unique-violation loser exits).
  try {
    const row = await prisma.zillowAutoRun.create({ data: { day, status: "running", attempts: 1 } });
    return row.id;
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== "P2002") throw err;
  }

  const existing = await prisma.zillowAutoRun.findUnique({ where: { day } });
  if (!existing) return null; // deleted between create and read — next tick gets it

  const reclaimable = ["needs_login", "failed"];
  const staleRunning =
    existing.status === "running" && now.getTime() - existing.startedAt.getTime() > STALE_RUNNING_MS;

  if (existing.status === "done" && !force) return "already_done";

  const claimStatuses = [
    ...reclaimable,
    ...(staleRunning ? ["running"] : []),
    ...(force ? ["done"] : []),
  ];
  const claimed = await prisma.zillowAutoRun.updateMany({
    where: {
      day,
      status: { in: claimStatuses },
      // guard the stale-running claim against a *live* running row
      ...(existing.status === "running" ? { startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } } : {}),
    },
    data: { status: "running", attempts: { increment: 1 }, error: null },
  });
  return claimed.count === 1 ? existing.id : null;
}

async function finishRow(
  id: string,
  status: "done" | "needs_login" | "failed",
  patch: {
    error?: string | null;
    importRunId?: string;
    leadsFound?: number;
    leadsNewDelta?: number;
    queuedDelta?: number;
    sentDelta?: number;
  },
) {
  return prisma.zillowAutoRun.update({
    where: { id },
    data: {
      status,
      error: patch.error ?? null,
      finishedAt: new Date(),
      ...(patch.importRunId ? { importRunId: patch.importRunId } : {}),
      ...(patch.leadsFound !== undefined ? { leadsFound: patch.leadsFound } : {}),
      ...(patch.leadsNewDelta ? { leadsNew: { increment: patch.leadsNewDelta } } : {}),
      ...(patch.queuedDelta ? { queuedSends: { increment: patch.queuedDelta } } : {}),
      ...(patch.sentDelta ? { sentImmediate: { increment: patch.sentDelta } } : {}),
    },
  });
}

function toRunSummary(row: {
  day: string;
  status: string;
  attempts: number;
  leadsFound: number;
  leadsNew: number;
  queuedSends: number;
  sentImmediate: number;
  error: string | null;
}): AutoRunResult["run"] {
  const { day, status, attempts, leadsFound, leadsNew, queuedSends, sentImmediate, error } = row;
  return { day, status, attempts, leadsFound, leadsNew, queuedSends, sentImmediate, error };
}

export interface RunOptions {
  force?: boolean;
  /** scheduled ticks pass true so the auto_hour window applies; force/manual skip it */
  scheduled?: boolean;
  now?: Date;
}

export async function runDailyAutomation(opts: RunOptions = {}): Promise<AutoRunResult> {
  const now = opts.now ?? new Date();
  const force = opts.force === true;
  const { enabled, hour, baseline } = await autoConfig();

  if (!enabled && !force) return { outcome: "disabled" };
  if (opts.scheduled && now.getHours() < hour) return { outcome: "not_in_window" };

  const day = localDay(now);
  const claim = await claimDay(day, force, now);
  if (claim === "already_done") {
    const row = await prisma.zillowAutoRun.findUnique({ where: { day } });
    return { outcome: "already_done", run: row ? toRunSummary(row) : undefined };
  }
  if (claim === null) return { outcome: "claim_lost" };

  // ── Import ──
  const importSummary = await runZillowImport();
  if (importSummary.status === "failed") {
    const isLogin = (importSummary.error ?? "").includes("needs-login");
    const row = await finishRow(claim, isLogin ? "needs_login" : "failed", {
      error: importSummary.error?.slice(0, 500) ?? "import failed",
    });
    return { outcome: isLogin ? "needs_login" : "failed", run: toRunSummary(row) };
  }

  // ── Batch send (baseline-scoped) ──
  try {
    const batch = await sendSurveyBatch({ sinceDate: baseline ?? undefined });
    const row = await finishRow(claim, "done", {
      importRunId: importSummary.runId,
      leadsFound: importSummary.leadsFound,
      leadsNewDelta: importSummary.leadsNew,
      queuedDelta: batch.sent + batch.deferred,
      sentDelta: batch.sent,
    });
    return { outcome: "ran", run: toRunSummary(row) };
  } catch (err) {
    const row = await finishRow(claim, "failed", {
      error: `batch failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      importRunId: importSummary.runId,
      leadsFound: importSummary.leadsFound,
      leadsNewDelta: importSummary.leadsNew,
    });
    return { outcome: "failed", run: toRunSummary(row) };
  }
}

// ── Status for the dashboard panel and the Iris supervisor ─────────────────

export interface AutoStatus {
  enabled: boolean;
  autoHour: number;
  baseline: string | null;
  /** true when survey_mode=google_form — "applied" can't be observed there */
  googleFormMode: boolean;
  today: AutoRunResult["run"] | null;
  last30Days: NonNullable<AutoRunResult["run"]>[];
  deferredQueue: { depth: number; oldestAgeDays: number | null };
  totals: { leads: number; numbersMessaged: number; applied: number };
}

export async function getAutoStatus(now = new Date()): Promise<AutoStatus> {
  const { enabled, hour, baseline } = await autoConfig();
  const day = localDay(now);

  const [todayRow, recent, leadsTotal, appliedTotal] = await Promise.all([
    prisma.zillowAutoRun.findUnique({ where: { day } }),
    prisma.zillowAutoRun.findMany({ orderBy: { day: "desc" }, take: 30 }),
    prisma.zillowLead.count(),
    prisma.zillowLead.count({ where: { status: "applied" } }),
  ]);

  // Numbers successfully messaged: distinct lead phones with ≥1 sent link row
  // (ledger truth, joined through the lead's invite).
  const invitedLeads = await prisma.zillowLead.findMany({
    where: { inviteId: { not: null }, phone: { not: null } },
    select: { phone: true, inviteId: true },
  });
  const inviteIds = invitedLeads.map((l) => l.inviteId!) ;
  const sentRows = inviteIds.length
    ? await prisma.outboundRelayMessage.findMany({
        where: { inviteId: { in: inviteIds }, kind: "link", status: "sent" },
        select: { inviteId: true },
      })
    : [];
  const sentInviteIds = new Set(sentRows.map((r) => r.inviteId));
  const numbersMessaged = new Set(
    invitedLeads.filter((l) => sentInviteIds.has(l.inviteId)).map((l) => l.phone),
  ).size;

  const [deferredDepth, oldestDeferred] = await Promise.all([
    prisma.outboundRelayMessage.count({ where: { kind: "link", status: "deferred" } }),
    prisma.outboundRelayMessage.findFirst({
      where: { kind: "link", status: "deferred" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const googleFormMode = (await resolveConfig("sms_relay", "survey_mode")) === "google_form";

  return {
    enabled,
    autoHour: hour,
    baseline: baseline ? baseline.toISOString() : null,
    googleFormMode,
    today: todayRow ? toRunSummary(todayRow) : null,
    last30Days: recent.map((r) => toRunSummary(r)!),
    deferredQueue: {
      depth: deferredDepth,
      oldestAgeDays: oldestDeferred
        ? Math.floor((now.getTime() - oldestDeferred.createdAt.getTime()) / 86_400_000)
        : null,
    },
    totals: { leads: leadsTotal, numbersMessaged, applied: appliedTotal },
  };
}
