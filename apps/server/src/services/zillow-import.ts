import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { runZillowExtraction, ZillowExtractError } from "./zillow-extract.js";
import { withGuiLock } from "../lib/gui-lock.js";
import path from "node:path";
import os from "node:os";

/**
 * Zillow lead import: run the Safari extraction, normalize what came back, and
 * upsert ZillowLead rows without ever regressing lifecycle state
 * (invited/applied/opted_out survive re-imports untouched).
 */

// ── Parsing / normalization (pure — unit-tested) ────────────────────────────

export interface ParsedLead {
  name: string;
  nameKey: string;
  phone: string | null;
  email: string | null;
  propertyText: string;
  firstContactAt: Date | null;
  zillowStatus: string | null;
  lastMessage: string | null;
  applicationCompleted: boolean; // renter actually submitted a Zillow application
  applicationSent: boolean;      // landlord invited this renter to apply
  coApplicants: number;
}

/** "(630) 461-1750", "630-461-1750", "+16304611750" → "+16304611750". */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // anything else is not a sendable US number
}

/**
 * One raw lead object from the leadManagementTable API → ParsedLead.
 * NOTE: ~20% of real leads have no renterInfo.leadId, so identity is
 * phone-first, name-second — never the Zillow id.
 */
export function parseZillowLead(item: unknown): ParsedLead | null {
  const o = (item ?? {}) as Record<string, any>;
  const ri = o.renterInfo ?? {};
  const addr = o.listingDetails?.address ?? {};
  const name = String(ri.renterName ?? "").trim();
  const phone = normalizePhoneE164(ri.renterPhoneNumber);
  if (!name && !phone) return null;

  const tsMs = Number(ri.firstContactDateMs ?? 0);
  const propertyText = [addr.streetAddress, addr.cityStateZip]
    .map((s: unknown) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return {
    name: name || "(no name)",
    nameKey: (name || "(no name)").toLowerCase(),
    phone,
    email: String(ri.renterRelayEmailAddress ?? "").trim() || null,
    propertyText,
    firstContactAt: tsMs > 0 ? new Date(tsMs) : null,
    zillowStatus: String(o.statusLabel?.text ?? "").trim() || null,
    lastMessage: String(o.latestContact?.messageText ?? "").trim().slice(0, 500) || null,
    // applicationInfo (discovered 2026-08-29): isApplicationCompleted === true means
    // the renter actually APPLIED. isApplicationsAccepted is a LISTING setting, not
    // an applicant signal, so it is deliberately ignored here.
    applicationCompleted: o.applicationInfo?.isApplicationCompleted === true,
    applicationSent: o.applicationInfo?.isApplicationSent === true,
    coApplicants: Number(o.applicationInfo?.numCoApplicants ?? 0) || 0,
  };
}

const NOISE_TOKENS = new Set(["il", "illinois", "st", "street", "ave", "avenue", "unit", "apt", "the"]);

function significantTokens(address: string): string[] {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !NOISE_TOKENS.has(t));
}

export interface MatchableProperty {
  id: string;
  name: string;
  address: string;
  smsIntakeEnabled: boolean;
}

/**
 * Map a Zillow listing address to a Property. Conservative: needs ≥2
 * significant address tokens present in the listing text (a lone shared city
 * like "chicago" must NOT match). Unmatched leads fall back to the configured
 * default (`zillow.default_property_id`) or, failing that, the single
 * intake-enabled property when exactly one exists.
 */
export function matchProperty(
  propertyText: string,
  properties: MatchableProperty[],
  defaultPropertyId: string | null,
): string | null {
  const text = propertyText.toLowerCase();
  let best: { id: string; hits: number } | null = null;
  for (const p of properties) {
    const tokens = significantTokens(p.address);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => text.includes(t)).length;
    const enough = hits >= Math.min(2, tokens.length) && hits >= 2;
    if (enough && (!best || hits > best.hits)) best = { id: p.id, hits };
  }
  if (best) return best.id;
  if (defaultPropertyId) return defaultPropertyId;
  const intake = properties.filter((p) => p.smsIntakeEnabled);
  return intake.length === 1 ? intake[0].id : null;
}

// ── Import run orchestration ────────────────────────────────────────────────

/** Lifecycle states a re-import must never overwrite. */
const STICKY_STATUSES = new Set(["invited", "applied", "opted_out"]);

export interface ImportSummary {
  runId: string;
  status: "done" | "failed";
  leadsFound: number;
  leadsNew: number;
  error?: string;
}

let importRunning = false;

export function zillowOutDir(): string {
  return process.env.ZILLOW_OUT_DIR || path.join(os.homedir(), "tenant-ai", ".zillow");
}

/**
 * Full import: extract from Safari → parse → upsert. One at a time; the run
 * row is created first so a crash still leaves an inspectable "running" row
 * (marked failed on the next run's stale check).
 */
export async function runZillowImport(opts: { persistRaw?: boolean } = {}): Promise<ImportSummary> {
  if (importRunning) {
    throw new Error("an import is already running");
  }
  importRunning = true;
  try {
    // Mark any run stuck "running" >10 min as failed (crashed process).
    await prisma.zillowImportRun.updateMany({
      where: { status: "running", startedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: "failed", error: "stale — process died mid-run", finishedAt: new Date() },
    });

    const run = await prisma.zillowImportRun.create({ data: { status: "running" } });
    try {
      const extraction = await withGuiLock("zillow-safari-import", () => runZillowExtraction({ outDir: zillowOutDir(), persistRaw: opts.persistRaw }));
      const summary = await ingestLeads(run.id, extraction.leads);
      await prisma.zillowImportRun.update({
        where: { id: run.id },
        data: {
          status: "done",
          leadsFound: summary.leadsFound,
          leadsNew: summary.leadsNew,
          rawJsonPath: extraction.rawJsonPath || null,
          finishedAt: new Date(),
        },
      });
      return { runId: run.id, status: "done", ...summary };
    } catch (err) {
      const message =
        err instanceof ZillowExtractError
          ? err.message
          : `import failed: ${err instanceof Error ? err.message : String(err)}`;
      await prisma.zillowImportRun.update({
        where: { id: run.id },
        data: { status: "failed", error: message.slice(0, 500), finishedAt: new Date() },
      });
      return { runId: run.id, status: "failed", leadsFound: 0, leadsNew: 0, error: message };
    }
  } finally {
    importRunning = false;
  }
}

/** Parse + upsert a raw lead array under an existing run id. */
export async function ingestLeads(
  runId: string,
  rawLeads: unknown[],
): Promise<{ leadsFound: number; leadsNew: number }> {
  const properties: MatchableProperty[] = await prisma.property.findMany({
    where: { isActive: true },
    select: { id: true, name: true, address: true, smsIntakeEnabled: true },
  });
  const defaultPropertyId = (await resolveConfig("zillow", "default_property_id"))?.trim() || null;

  let leadsFound = 0;
  let leadsNew = 0;
  const seenKeys = new Set<string>();

  for (const raw of rawLeads) {
    const lead = parseZillowLead(raw);
    if (!lead) continue;
    leadsFound++;

    const propertyId = matchProperty(lead.propertyText, properties, defaultPropertyId);
    // In-batch dedupe (Zillow occasionally repeats a lead across pages).
    const key = lead.phone ? `p:${lead.phone}:${propertyId}` : `n:${lead.nameKey}:${propertyId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let existing = lead.phone
      ? await prisma.zillowLead.findFirst({ where: { phone: lead.phone, propertyId } })
      : await prisma.zillowLead.findFirst({ where: { phone: null, nameKey: lead.nameKey, propertyId } });

    // Census-flap guard: if property matching resolved differently than when
    // this lead was first imported (a property was added/removed/renamed, or
    // matching returned null), the same person must NOT become a second row —
    // adopt their existing row wherever it lives. A real same-person inquiry
    // about a second property still matches its own property directly.
    if (!existing) {
      existing = lead.phone
        ? await prisma.zillowLead.findFirst({ where: { phone: lead.phone } })
        : await prisma.zillowLead.findFirst({ where: { phone: null, nameKey: lead.nameKey } });
      if (existing && propertyId && existing.propertyId && existing.propertyId !== propertyId) {
        // Different REAL property → genuinely a second inquiry; keep separate.
        existing = null;
      }
    }

    if (existing) {
      await prisma.zillowLead.update({
        where: { id: existing.id },
        data: {
          name: lead.name,
          nameKey: lead.nameKey,
          email: lead.email,
          propertyText: lead.propertyText,
          firstContactAt: lead.firstContactAt,
          zillowStatus: lead.zillowStatus,
          lastMessage: lead.lastMessage,
          applicationCompleted: lead.applicationCompleted,
          applicationSent: lead.applicationSent,
          coApplicants: lead.coApplicants,
          importRunId: runId,
          // Heal an orphaned row (null property from a past census flap) once
          // matching resolves a real property again.
          ...(existing.propertyId === null && propertyId ? { propertyId } : {}),
          // Lifecycle state is sticky; only new/no_phone can flip between
          // themselves (a lead whose phone appeared later becomes sendable).
          ...(STICKY_STATUSES.has(existing.status)
            ? {}
            : { status: lead.phone ? "new" : "no_phone" }),
        },
      });
    } else {
      await prisma.zillowLead.create({
        data: {
          name: lead.name,
          nameKey: lead.nameKey,
          phone: lead.phone,
          email: lead.email,
          propertyText: lead.propertyText,
          propertyId,
          firstContactAt: lead.firstContactAt,
          zillowStatus: lead.zillowStatus,
          lastMessage: lead.lastMessage,
          applicationCompleted: lead.applicationCompleted,
          applicationSent: lead.applicationSent,
          coApplicants: lead.coApplicants,
          status: lead.phone ? "new" : "no_phone",
          importRunId: runId,
        },
      });
      leadsNew++;
    }
  }

  return { leadsFound, leadsNew };
}

/** CSV of the current lead table (same columns as the original exporter). */
export function leadsToCsv(
  leads: Array<{
    name: string;
    phone: string | null;
    email: string | null;
    propertyText: string;
    firstContactAt: Date | null;
    zillowStatus: string | null;
    status: string;
    lastMessage: string | null;
  }>,
): string {
  const esc = (v: string | null) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "nombre,telefono,email,propiedad,fecha,estado,estado_app,mensaje";
  const rows = leads.map((l) =>
    [
      esc(l.name),
      esc(l.phone),
      esc(l.email),
      esc(l.propertyText),
      esc(l.firstContactAt ? l.firstContactAt.toISOString().slice(0, 16).replace("T", " ") : ""),
      esc(l.zillowStatus),
      esc(l.status),
      esc(l.lastMessage?.slice(0, 250) ?? ""),
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

// ── Retention prune (rev.5 M6) ──────────────────────────────────────────────

let lastPruneDay = "";

/** Test hook: allow re-running the daily prune within one process. */
export function _resetPruneDay(): void {
  lastPruneDay = "";
}

/**
 * Once-per-day retention prune (called from the watchdog interval):
 *  - ZillowImportRun rows older than `zillow.import_retention_days` (default 14)
 *    are deleted ONLY when no ZillowLead still references them (FK safety —
 *    a lead keeps its origin run forever).
 *  - leads-raw-*.json files older than the same window are unlinked.
 *  - SENT TextEmAllBatch rows older than `zillow.batch_retention_days`
 *    (default 90) are deleted — matching the CSV dedupe window, so pruning can
 *    never remove a batch the dedupe still relies on. `ambiguous` batches are
 *    NEVER pruned (their quarantine must outlive any window).
 */
export async function pruneZillowArtifacts(
  now: Date = new Date(),
): Promise<{ runs: number; files: number; batches: number } | null> {
  const day = now.toISOString().slice(0, 10);
  if (day === lastPruneDay) return null;
  lastPruneDay = day;

  const intDays = (raw: string | null, def: number) => {
    const n = parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  const importDays = intDays(await resolveConfig("zillow", "import_retention_days"), 14);
  const batchDays = intDays(await resolveConfig("zillow", "batch_retention_days"), 90);
  const importCutoff = new Date(now.getTime() - importDays * 86_400_000);
  const batchCutoff = new Date(now.getTime() - batchDays * 86_400_000);

  // Import runs: only lead-less rows (leads keep their FK forever).
  const oldRuns = await prisma.zillowImportRun.findMany({
    where: { startedAt: { lt: importCutoff }, leads: { none: {} } },
    select: { id: true },
  });
  const runs = oldRuns.length
    ? (await prisma.zillowImportRun.deleteMany({ where: { id: { in: oldRuns.map((r) => r.id) } } })).count
    : 0;

  // Raw JSON snapshots by file mtime.
  let files = 0;
  try {
    const { readdir, stat, unlink } = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = zillowOutDir();
    for (const f of await readdir(dir)) {
      if (!f.startsWith("leads-raw-") || !f.endsWith(".json")) continue;
      const p = path.join(dir, f);
      try {
        const st = await stat(p);
        if (st.mtimeMs < importCutoff.getTime()) {
          await unlink(p);
          files++;
        }
      } catch {
        /* file vanished mid-scan — fine */
      }
    }
  } catch {
    /* no out dir yet — nothing to prune */
  }

  const batches = (
    await prisma.textEmAllBatch.deleteMany({ where: { status: "sent", createdAt: { lt: batchCutoff } } })
  ).count;

  return { runs, files, batches };
}
