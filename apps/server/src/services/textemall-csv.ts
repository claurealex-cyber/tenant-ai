import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";

/**
 * Text-Em-All batch CSV builder.
 *
 * Selects the leads eligible for a Text-Em-All broadcast — using the SAME
 * eligibility boundary as the relay path so the two channels never diverge:
 *   - status "new", has a phone, matched to a property
 *   - createdAt >= go-live baseline (import-time; excludes the pre-go-live backlog)
 *   - NOT opted out (SmsOptOut)
 *   - NOT already texted via Text-Em-All (phone not in any prior `sent` batch)
 *
 * Writes a CSV (single `Name` column — Zillow leads have one name field, not
 * first/last) to a gitignored path and returns the batch shape. Zero eligible
 * leads → { count: 0 } and NO file/side effect (empty-batch skip).
 *
 * This builds the CSV only. It does NOT upload to Text-Em-All (that is the Iris
 * GUI step) and does NOT broadcast (that is the form-trigger step).
 */
export interface TextEmAllCsv {
  count: number;       // total rows incl. the owner-check row
  leadCount: number;   // genuine recipients EXCLUDING the always-include owner (the send gate)
  phones: string[];
  csv: string;
  csvPath: string | null;
}

export function textemallDir(): string {
  return path.join(process.env.HOME || ".", "tenant-ai", "textemall-uploads");
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function buildTextEmAllCsv(opts: {
  baseline?: Date;
  propertyId?: string;
  write?: boolean;
  now?: Date;
  segment?: "leads" | "applicants";
  /** Leads segment: exclude applicants (route them to the applicant follow-up).
   *  Only set when the applicant relay is ON — otherwise applicants must still
   *  receive the lead broadcast, or they fall through the cracks. */
  excludeApplicants?: boolean;
}): Promise<TextEmAllCsv> {
  const now = opts.now ?? new Date();
  const segment = opts.segment ?? "leads";

  // Segment selection:
  //  - "leads": new, not-yet-applied leads (applicants are EXCLUDED so they only
  //    ever get the applicant follow-up, never the lead link).
  //  - "applicants": people who submitted a Zillow application and have NOT yet
  //    been messaged on the applicant segment (dedup via applicantSentBatchId — a
  //    per-segment marker, so someone messaged earlier as a lead is still eligible
  //    for the applicant follow-up).
  const leads = await prisma.zillowLead.findMany({
    where: segment === "applicants"
      ? {
          applicationCompleted: true,
          applicantSentBatchId: null,
          phone: { not: null },
          propertyId: opts.propertyId ? opts.propertyId : { not: null },
          ...(opts.baseline ? { createdAt: { gte: opts.baseline } } : {}),
        }
      : {
          status: "new",
          ...(opts.excludeApplicants ? { applicationCompleted: false } : {}),
          phone: { not: null },
          propertyId: opts.propertyId ? opts.propertyId : { not: null },
          ...(opts.baseline ? { createdAt: { gte: opts.baseline } } : {}),
        },
    select: { id: true, name: true, phone: true },
    orderBy: { createdAt: "desc" },
  });

  // Opt-out filter (relay STOPs).
  const optedOut = new Set(
    (await prisma.smsOptOut.findMany({ select: { phone: true } })).map((o) => o.phone),
  );

  // Dedupe vs any phone already pushed in a SENT Text-Em-All batch (rev.3 C).
  // LEADS segment only — the applicants segment dedups via applicantSentBatchId, so
  // an applicant already texted as a lead is still eligible for the follow-up.
  const alreadySent = new Set<string>();
  if (segment === "leads") {
    const sentBatches = await prisma.textEmAllBatch.findMany({ where: { status: "sent" }, select: { phones: true } });
    for (const b of sentBatches) {
      for (const p of (b.phones as string[] | null) ?? []) alreadySent.add(p);
    }
  }

  const seen = new Set<string>();
  const rows: { name: string; phone: string }[] = [];
  for (const l of leads) {
    const phone = l.phone!;
    if (optedOut.has(phone) || alreadySent.has(phone) || seen.has(phone)) continue;
    seen.add(phone);
    rows.push({ name: l.name ?? "", phone });
  }

  const leadCount = rows.length; // genuine recipients EXCLUDING the owner-check row (the send gate)

  // ALWAYS append the owner's verification number (owner: "make it a habit") so
  // every broadcast is also delivered to the owner as a live "it sent" check —
  // and so a run with 0 new leads still fires a heartbeat to just the owner
  // (clear the group, add the owner's number, broadcast). Configurable; not
  // deduped against opt-out (it's the owner's own opt-in check number).
  const alwaysInclude = ((await resolveConfig("textemall", "always_include_phone")) ?? "+17084158984").trim();
  if (alwaysInclude && !seen.has(alwaysInclude)) {
    seen.add(alwaysInclude);
    rows.push({ name: "Owner Check", phone: alwaysInclude });
  }

  if (rows.length === 0) {
    return { count: 0, leadCount: 0, phones: [], csv: "", csvPath: null }; // (only if no owner number configured)
  }

  const header = "Name,Phone";
  const body = rows.map((r) => `${csvCell(r.name)},${csvCell(r.phone)}`).join("\n");
  const csv = `${header}\n${body}\n`;

  let csvPath: string | null = null;
  if (opts.write !== false) {
    const dir = textemallDir();
    await mkdir(dir, { recursive: true });
    const stamp = now.toISOString().slice(0, 10);
    csvPath = path.join(dir, `leads-${stamp}.csv`);
    await writeFile(csvPath, csv, "utf8");
  }

  return { count: rows.length, leadCount, phones: rows.map((r) => r.phone), csv, csvPath };
}
