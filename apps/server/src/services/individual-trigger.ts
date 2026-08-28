import { resolveConfig } from "@tenant-ai/shared";

/**
 * Individual caller/text → Text-Em-All trigger. Submits the "Leads Individual Call
 * Message Trigger" Google Form whose "New Response" fires the (instant) Zap that
 * broadcasts to the individual group "2. leads 08-28-2026".
 *
 * SAFETY (mirrors the Zillow trigger): a real POST fires a REAL broadcast. Live
 * POST only when BOTH dryRun===false AND config `textemall.individual_trigger_armed`
 * ==="true". Every other path returns the composed body without touching the net.
 */

// Resolved 2026-08-28 from the form (overridable via config).
const DEFAULT_ENDPOINT =
  "https://docs.google.com/forms/d/e/1FAIpQLSeTYGdVluEia7E9-nc9O8NxC3xI2q49WpF4_cbZm9EwaSmyyA/formResponse";
const DEFAULT_ENTRY_READY = "entry.2069978510"; // "is the new individual number message ready?" (Yes/No)
const DEFAULT_ENTRY_PHONE = "entry.766759466"; // "What is the phone number?"

export interface IndividualTriggerConfig {
  endpoint: string;
  entryReady: string;
  entryPhone: string;
}

export async function loadIndividualTriggerConfig(): Promise<IndividualTriggerConfig> {
  return {
    endpoint: (await resolveConfig("textemall", "individual_trigger_endpoint")) || DEFAULT_ENDPOINT,
    entryReady: (await resolveConfig("textemall", "individual_entry_ready")) || DEFAULT_ENTRY_READY,
    entryPhone: (await resolveConfig("textemall", "individual_entry_phone")) || DEFAULT_ENTRY_PHONE,
  };
}

/** Build the form-encoded POST body. Pure — no network. */
export function buildIndividualBody(cfg: IndividualTriggerConfig, opts: { phone: string }): URLSearchParams {
  const p = new URLSearchParams();
  p.set(cfg.entryReady, "Yes"); // exact multiple-choice value (Google 400s on case mismatch)
  p.set(cfg.entryPhone, opts.phone);
  p.set("fvv", "1");
  p.set("pageHistory", "0");
  p.set("submit", "Submit");
  return p;
}

export type IndividualTriggerResult =
  | { fired: true; status: number }
  | { fired: false; reason: "dry_run" | "not_armed" | "no_phone"; body: string };

/**
 * Fire the individual trigger. Live POST only when dryRun===false AND
 * individual_trigger_armed==="true". Returns the body on every non-firing path.
 */
export async function fireIndividualTrigger(opts: {
  phone: string;
  dryRun?: boolean;
}): Promise<IndividualTriggerResult> {
  const cfg = await loadIndividualTriggerConfig();
  const phone = (opts.phone || "").trim();
  if (!phone) return { fired: false, reason: "no_phone", body: "" };
  const body = buildIndividualBody(cfg, { phone });

  const armed = (await resolveConfig("textemall", "individual_trigger_armed")) === "true";
  if (opts.dryRun !== false) return { fired: false, reason: "dry_run", body: body.toString() };
  if (!armed) return { fired: false, reason: "not_armed", body: body.toString() };

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  return { fired: true, status: res.status };
}
