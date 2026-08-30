import { prisma } from "../lib/prisma.js";
import { resolveConfig, scheduleSummary, DEFAULT_MONTHLY_FIRE_CAP, type ScheduleSummary } from "@tenant-ai/shared";
import { getJobState, jobStateAlive } from "../jobs/scheduler.js";
import { runZillowImport } from "./zillow-import.js";
import { sendSurveyBatch } from "./zillow-send.js";
import { buildTextEmAllCsv } from "./textemall-csv.js";
import { setGroupViaApi, groupIdFromUrl } from "./textemall-api.js";
import { sendBroadcastViaApi } from "./textemall-broadcast-api.js";
import { resolveBroadcastMethod } from "./delivery-method.js";
import { fireTextEmAllTrigger } from "./textemall-trigger.js";
import { withGuiLock } from "../lib/gui-lock.js";

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

/** Per-hour idempotence slot, e.g. "2026-08-27T14" (server-local). */
export function localSlot(now = new Date()): string {
  return `${localDay(now)}T${String(now.getHours()).padStart(2, "0")}`;
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
    /** Hour slot "YYYY-MM-DDTHH" (server-local); null only for pre-slot legacy rows. */
    slot: string | null;
    status: string;
    attempts: number;
    leadsFound: number;
    leadsNew: number;
    queuedSends: number;
    sentImmediate: number;
    error: string | null;
  };
}

function clampHour(raw: string | null | undefined, def: number): number {
  return Math.min(23, Math.max(0, parseInt(raw ?? String(def), 10) || def));
}

/** Non-negative integer config with a default (e.g. the monthly fire cap). */
function clampCount(raw: string | null | undefined, def: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/**
 * Parse the `auto_run_hours` CSV (e.g. "10,16,22") into a sorted, de-duped set of
 * valid 0–23 hours. Returns null when unset/empty/all-invalid, which signals the
 * caller to fall back to the legacy [startHour,endHour] hourly window.
 */
export function parseRunHours(raw: string | null | undefined): number[] | null {
  if (!raw || !raw.trim()) return null;
  const hours = [
    ...new Set(
      raw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23),
    ),
  ].sort((a, b) => a - b);
  return hours.length ? hours : null;
}

/** The effective automation config (exported for the watchdog; same reads the engine uses). */
export async function autoConfig() {
  const enabled = (await resolveConfig("zillow", "auto_enabled")) === "true";
  // Window [startHour, endHour] inclusive. auto_hour is the legacy single-hour
  // start; auto_start_hour/auto_end_hour define the hourly window (default 8–22).
  const legacyStart = await resolveConfig("zillow", "auto_hour");
  const startHour = clampHour(await resolveConfig("zillow", "auto_start_hour"), clampHour(legacyStart, 8));
  const endHour = clampHour(await resolveConfig("zillow", "auto_end_hour"), 22);
  // When set, `auto_run_hours` (e.g. "10,16,22") REPLACES the hourly window with a
  // fixed set of run hours — the free-tier 3×/day cadence. Unset → legacy window.
  const runHours = parseRunHours(await resolveConfig("zillow", "auto_run_hours"));
  const baselineRaw = (await resolveConfig("zillow", "auto_baseline"))?.trim();
  const baseline = baselineRaw ? new Date(baselineRaw) : null;
  return { enabled, startHour, endHour, runHours, baseline: baseline && !isNaN(baseline.getTime()) ? baseline : null };
}

/**
 * Claim today's row. Returns the claimed row id, or null when another trigger
 * owns it / the day is consumed.
 */
async function claimSlot(slot: string, day: string, force: boolean, now: Date): Promise<string | "already_done" | null> {
  // Fast path: fresh hour → create is the claim (unique-violation loser exits).
  try {
    const row = await prisma.zillowAutoRun.create({ data: { day, slot, status: "running", attempts: 1 } });
    return row.id;
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== "P2002") throw err;
  }

  const existing = await prisma.zillowAutoRun.findUnique({ where: { slot } });
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
      slot,
      status: { in: claimStatuses },
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
  slot?: string | null;
  status: string;
  attempts: number;
  leadsFound: number;
  leadsNew: number;
  queuedSends: number;
  sentImmediate: number;
  error: string | null;
}): AutoRunResult["run"] {
  const { day, status, attempts, leadsFound, leadsNew, queuedSends, sentImmediate, error } = row;
  return { day, slot: row.slot ?? null, status, attempts, leadsFound, leadsNew, queuedSends, sentImmediate, error };
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
  const { enabled, startHour, endHour, runHours, baseline } = await autoConfig();

  if (!enabled && !force) return { outcome: "disabled" };
  // Scheduled ticks: when `auto_run_hours` is set, run ONLY at those exact hours
  // (free-tier 3×/day). Otherwise fall back to the inclusive [startHour,endHour]
  // hourly window. Manual/forced runs skip the gate entirely.
  if (opts.scheduled) {
    const inWindow = runHours
      ? runHours.includes(now.getHours())
      : now.getHours() >= startHour && now.getHours() <= endHour;
    if (!inWindow) return { outcome: "not_in_window" };
  }

  const day = localDay(now);
  const slot = localSlot(now);
  const claim = await claimSlot(slot, day, force, now);
  if (claim === "already_done") {
    const row = await prisma.zillowAutoRun.findUnique({ where: { slot } });
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

  // ── SEND — branches on the channel; the IMPORT above is unchanged on both
  // channels (rev.3 B). Reversibility: relay is the default and its path is
  // byte-identical; textemall is a separate branch.
  const channel = (await resolveConfig("zillow", "send_channel")) === "textemall" ? "textemall" : "relay";
  try {
    if (channel === "textemall") {
      // Broadcast idempotence key:
      //  • runHours mode (free-tier 3×/day) → per run-hour slot ("YYYY-MM-DDTHH"),
      //    so 10/16/22 each broadcast once when there are new leads.
      //  • legacy hourly mode → a once/day key pinned to broadcast_hour, so the
      //    contract stays "one broadcast per day at/after that hour".
      let broadcastSlot: string;
      if (runHours) {
        broadcastSlot = slot;
      } else {
        const bh = clampHour(await resolveConfig("zillow", "textemall_broadcast_hour"), 12);
        if (!force && now.getHours() < bh) {
          const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
          return { outcome: "ran", run: toRunSummary(row) };
        }
        broadcastSlot = `${day}T${String(bh).padStart(2, "0")}`;
      }
      // A broadcast already claimed for THIS key → skip (idempotent).
      // A broadcast already SENT (or uploaded, awaiting an armed trigger) for THIS
      // key → skip (idempotent). A `built` (crashed mid-run) or `failed` (upload
      // error) batch does NOT block the key: it is rebuilt so the next in-window
      // tick (hourly mode) or same-slot reclaim (fixed mode) retries it.
      const already = await prisma.textEmAllBatch.findUnique({ where: { slot: broadcastSlot } });
      if (already && !force && (already.status === "sent" || already.status === "uploaded")) {
        const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
        return { outcome: "ran", run: toRunSummary(row) };
      }
      // Free-tier soft cap (risk 1): count broadcasts already SENT this calendar
      // month; refuse to fire beyond the cap so a stray month can't blow past 100
      // Zapier tasks. Checked BEFORE the Iris GUI work so we don't delete/upload
      // for a fire we won't make.
      // The monthly cap protects the Zapier FREE-TIER 100-task budget — it applies
      // ONLY to the Google-Form → Zapier path. The direct-API broadcast uses no
      // Zapier, so it is exempt (Text-Em-All credits are the only cost there).
      const apiMode = (await resolveBroadcastMethod("zillow")) === "api";
      if (!apiMode) {
        const monthCap = clampCount(await resolveConfig("textemall", "monthly_fire_cap"), DEFAULT_MONTHLY_FIRE_CAP);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const sentThisMonth = await prisma.textEmAllBatch.count({
          where: { status: "sent", createdAt: { gte: monthStart, lt: nextMonth } },
        });
        if (sentThisMonth >= monthCap && !force) {
          console.warn(`[zillow-auto] textemall: monthly fire cap reached (${sentThisMonth}/${monthCap}) — NOT broadcasting. Raise textemall.monthly_fire_cap to override.`);
          const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
          return { outcome: "ran", run: toRunSummary(row) };
        }
      }
      const applicantRelayEnabled = (await resolveConfig("textemall", "applicant_relay_enabled")) === "true";
      // Exclude applicants from the LEAD broadcast ONLY when the applicant relay is
      // on (else an applicant who is a new lead would get neither message).
      const csv = await buildTextEmAllCsv({ baseline: baseline ?? undefined, excludeApplicants: applicantRelayEnabled });
      if (csv.count === 0 || !csv.csvPath) {
        // Empty-batch skip (§2d #11): no delete, no upload, no broadcast.
        const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
        return { outcome: "ran", run: toRunSummary(row) };
      }
      const group = (await resolveConfig("zillow", "textemall_group")) ?? "Ghem leads";
      const groupUrl = (await resolveConfig("zillow", "textemall_group_url")) ?? undefined;
      const batchRow = await prisma.textEmAllBatch.upsert({
        where: { slot: broadcastSlot },
        create: { slot: broadcastSlot, day, groupName: group, phones: csv.phones, count: csv.count, status: "built", csvPath: csv.csvPath },
        update: { phones: csv.phones, count: csv.count, status: "built", csvPath: csv.csvPath, error: null },
      });

      // Strict order (§2d #5, rev.3 C): GUI-locked group-set → verify → fire
      // trigger → stamp batch SENT before flipping leads. DETERMINISTIC path —
      // sets the group via the Text-Em-All REST API (authenticated XHR in the
      // logged-in Safari tab), NOT the fragile iris GUI drive. Seconds, not minutes.

      // broadcast_method toggle: "api" sends the broadcast DIRECTLY via the
      // Text-Em-All REST API (recipients by phone; no group, no Google Form, no
      // Zapier, no 100/mo cap, and no existing-contact 422 bug). "form" (default)
      // preserves the group-edit + Google-Form → Zap path.
      if (apiMode) {
        const message = (await resolveConfig("textemall", "broadcast_message")) ??
          "Hello, thank you for reaching out to Ghem Properties. Please fill out our application and we will get back to you shortly.";
        const bc = await withGuiLock("textemall-api", () => sendBroadcastViaApi({ phones: csv.phones, message }));
        if (bc.status !== "ok") {
          const detail = bc.status === "needs_login" ? "needs-login" : (bc as { detail?: string }).detail ?? "failed";
          await prisma.textEmAllBatch.update({ where: { id: batchRow.id }, data: { status: "failed", error: `broadcast ${bc.status}: ${detail}`.slice(0, 500) } });
          const row = await finishRow(claim, bc.status === "needs_login" ? "needs_login" : "failed", { error: `textemall broadcast ${bc.status}`, importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
          return { outcome: bc.status === "needs_login" ? "needs_login" : "failed", run: toRunSummary(row) };
        }
        await prisma.textEmAllBatch.update({ where: { id: batchRow.id }, data: { status: "sent", phones: bc.sentPhones } });
        // Flip ONLY the leads that ACTUALLY made it into the broadcast (bc.sentPhones),
        // not the whole intended batch — a lead whose add failed must NOT be marked
        // sent (it'll be re-attempted next run). Match on E.164 or 10-digit.
        const sentDigits = new Set(bc.sentPhones.map((p) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")));
        const toFlip = await prisma.zillowLead.findMany({
          where: { phone: { in: csv.phones }, status: "new" }, select: { id: true, phone: true },
        });
        const flipIds = toFlip.filter((l) => sentDigits.has((l.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))).map((l) => l.id);
        if (flipIds.length) {
          await prisma.zillowLead.updateMany({
            where: { id: { in: flipIds } },
            data: { status: "invited", sentVia: "textemall", sentBatchId: batchRow.id },
          }).catch((e) => console.error("textemall lead flip failed (broadcast already sent, safe):", e));
        }
        console.log(`[zillow-auto] textemall API broadcast ${bc.broadcastId} → ${bc.recipients} recipient(s); flipped ${flipIds.length} lead(s).`);

        // ── Applicant segment (toggleable, api-mode only): message people who
        // ACTUALLY APPLIED with a distinct follow-up. Gated on applicant_relay_enabled
        // and on there being GENUINE new applicants (never an owner-only send —
        // realtime-plan lesson). Dedup via applicantSentBatchId, independent of the
        // lead segment, so someone texted earlier as a lead still gets the follow-up.
        let applicantsSent = 0;
        if (applicantRelayEnabled) {
          const applCsv = await buildTextEmAllCsv({ baseline: baseline ?? undefined, segment: "applicants", write: false });
          if (applCsv.leadCount > 0) { // API path sends by phone; no CSV file needed
            const applMsg = (await resolveConfig("textemall", "applicant_broadcast_message")) ??
              "Hi! Thanks for submitting your application with Ghem Properties — we've received it and will follow up with next steps shortly. Reply here with any questions.";
            const applBatch = await prisma.textEmAllBatch.upsert({
              where: { slot: `${broadcastSlot}:appl` },
              create: { slot: `${broadcastSlot}:appl`, day, groupName: "applicants", phones: applCsv.phones, count: applCsv.count, status: "built", csvPath: applCsv.csvPath },
              update: { phones: applCsv.phones, count: applCsv.count, status: "built", csvPath: applCsv.csvPath, error: null },
            });
            const abc = await withGuiLock("textemall-api", () => sendBroadcastViaApi({ phones: applCsv.phones, message: applMsg }));
            if (abc.status === "ok") {
              await prisma.textEmAllBatch.update({ where: { id: applBatch.id }, data: { status: "sent", phones: abc.sentPhones } });
              const aDigits = new Set(abc.sentPhones.map((x) => x.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")));
              const applicants = await prisma.zillowLead.findMany({
                where: { phone: { in: applCsv.phones }, applicationCompleted: true, applicantSentBatchId: null }, select: { id: true, phone: true },
              });
              const aIds = applicants.filter((l) => aDigits.has((l.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))).map((l) => l.id);
              if (aIds.length) {
                await prisma.zillowLead.updateMany({ where: { id: { in: aIds } }, data: { applicantSentBatchId: applBatch.id, applicantInvitedAt: now } })
                  .catch((e) => console.error("applicant mark failed (broadcast already sent, safe):", e));
              }
              applicantsSent = aIds.length;
              console.log(`[zillow-auto] applicant follow-up broadcast ${abc.broadcastId} → ${abc.recipients} recipient(s); marked ${applicantsSent} applicant(s).`);
            } else {
              await prisma.textEmAllBatch.update({ where: { id: applBatch.id }, data: { status: "failed", error: `applicant broadcast ${abc.status}`.slice(0, 500) } });
              console.warn(`[zillow-auto] applicant broadcast failed: ${abc.status} — leads segment unaffected.`);
            }
          }
        }

        const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew, queuedDelta: bc.recipients + applicantsSent, sentDelta: flipIds.length + applicantsSent });
        return { outcome: "ran", run: toRunSummary(row) };
      }

      const groupId = groupIdFromUrl(groupUrl);
      const upload = groupId
        ? await withGuiLock("textemall-api", () => setGroupViaApi({ groupId, phones: csv.phones }))
        : ({ status: "failed", detail: "no textemall_group_url configured" } as const);
      if (upload.status !== "ok") {
        const detail = upload.status === "needs_login" ? "needs-login" : (upload as { detail?: string }).detail ?? "failed";
        await prisma.textEmAllBatch.update({ where: { id: batchRow.id }, data: { status: "failed", error: `group-set ${upload.status}: ${detail}`.slice(0, 500) } });
        const row = await finishRow(claim, upload.status === "needs_login" ? "needs_login" : "failed", { error: `textemall ${upload.status}`, importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
        return { outcome: upload.status === "needs_login" ? "needs_login" : "failed", run: toRunSummary(row) };
      }

      const trig = await fireTextEmAllTrigger({ count: csv.count, dryRun: false });
      if (!trig.fired) {
        // Not armed / dry-run: contacts are uploaded but no broadcast — leave as
        // "uploaded" (operator can fire manually); do NOT flip leads.
        await prisma.textEmAllBatch.update({ where: { id: batchRow.id }, data: { status: "uploaded" } });
        console.log(`[zillow-auto] textemall: uploaded ${csv.count} contacts; broadcast NOT fired (${(trig as any).reason}). Arm textemall.trigger_armed=true to broadcast.`);
        const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew });
        return { outcome: "ran", run: toRunSummary(row) };
      }

      // Broadcast fired → stamp SENT (rev.3 C: before flipping leads, so a flip
      // failure never re-broadcasts) then flip the batch's leads.
      await prisma.textEmAllBatch.update({ where: { id: batchRow.id }, data: { status: "sent" } });
      await prisma.zillowLead.updateMany({
        where: { phone: { in: csv.phones }, status: "new" },
        data: { status: "invited", sentVia: "textemall", sentBatchId: batchRow.id },
      }).catch((e) => console.error("textemall lead flip failed (batch already sent, safe):", e));
      const row = await finishRow(claim, "done", { importRunId: importSummary.runId, leadsFound: importSummary.leadsFound, leadsNewDelta: importSummary.leadsNew, queuedDelta: csv.count, sentDelta: csv.count });
      return { outcome: "ran", run: toRunSummary(row) };
    }

    // ── relay (default, unchanged) ──
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
  autoHour: number; // startHour (kept for back-compat)
  startHour: number;
  endHour: number;
  /** Fixed run hours (e.g. [10,16,22]) when the 3×/day cadence is configured; null → legacy hourly window. */
  runHours: number[] | null;
  /** Next scheduled run hour "HH:00" (within the window), or null if disabled/out-of-window past end. */
  nextRunLabel: string | null;
  baseline: string | null;
  /** true when survey_mode=google_form — "applied" can't be observed there */
  googleFormMode: boolean;
  today: AutoRunResult["run"] | null;
  last30Days: NonNullable<AutoRunResult["run"]>[];
  deferredQueue: { depth: number; oldestAgeDays: number | null };
  totals: { leads: number; numbersMessaged: number; applied: number };
  /** Editable schedule + derived labels/estimates (shared helper — same math as the dashboard). */
  schedule: ScheduleSummary;
  /** false = the hourly tick is not alive (Redis down / job never registered): NO scheduled run will fire. */
  schedulerOnline: boolean;
}

export async function getAutoStatus(now = new Date()): Promise<AutoStatus> {
  const { enabled, startHour, endHour, runHours, baseline } = await autoConfig();
  const day = localDay(now);

  const [todayRow, recent, leadsTotal, appliedTotal] = await Promise.all([
    // day is no longer unique (hourly slots) → latest run for today.
    prisma.zillowAutoRun.findFirst({ where: { day }, orderBy: { startedAt: "desc" } }),
    prisma.zillowAutoRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    prisma.zillowLead.count(),
    prisma.zillowLead.count({ where: { status: "applied" } }),
  ]);

  const channel = (await resolveConfig("zillow", "send_channel")) === "textemall" ? "textemall" : "relay";
  const monthlyCap = clampCount(await resolveConfig("textemall", "monthly_fire_cap"), DEFAULT_MONTHLY_FIRE_CAP);
  const schedule = scheduleSummary({
    enabled, runHours, startHour, endHour, channel, monthlyCap, nowHour: now.getHours(),
  });
  const nextRunLabel = schedule.nextRunLabel;
  const schedulerOnline = jobStateAlive(getJobState("zillow-daily"), now);

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
    // "The day's first scheduled hour" — first fixed run hour, else the window start.
    autoHour: runHours ? runHours[0] : startHour,
    startHour,
    endHour,
    runHours,
    nextRunLabel,
    baseline: baseline ? baseline.toISOString() : null,
    googleFormMode,
    today: todayRow ? toRunSummary(todayRow) : null,
    last30Days: recent.map((r) => toRunSummary(r)!),
    schedule,
    schedulerOnline,
    deferredQueue: {
      depth: deferredDepth,
      oldestAgeDays: oldestDeferred
        ? Math.floor((now.getTime() - oldestDeferred.createdAt.getTime()) / 86_400_000)
        : null,
    },
    totals: { leads: leadsTotal, numbersMessaged, applied: appliedTotal },
  };
}
