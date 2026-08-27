import { resolveConfig } from "@tenant-ai/shared";

/**
 * Text-Em-All broadcast trigger — submits the Google "trigger form" whose
 * "New Response" fires the Send-Broadcast Zap (static group + message).
 *
 * SAFETY: a real POST fires a REAL broadcast to whoever is in the bound group.
 * This function is DRY-RUN by default and only performs the live POST when
 * BOTH: caller passes dryRun:false AND config `textemall.trigger_armed`="true".
 * Every other path just returns the composed body without touching the network,
 * so the pipeline can be exercised end-to-end without sending.
 */

// Resolved 2026-08-27 (overridable via config for when field/form IDs change).
const DEFAULT_ENDPOINT =
  "https://docs.google.com/forms/d/e/1FAIpQLSf_zipLyMeJl0oZp3e1hq7XbTuPv-Zllqto9wKIqCo-XWqCeA/formResponse";
const DEFAULT_ENTRY_READY = "entry.599472758"; // "batch ready?"
const DEFAULT_ENTRY_DATE = "entry.1082952004"; // "date of send" (DATE type → _year/_month/_day)
const DEFAULT_ENTRY_COUNT = "entry.1156702036"; // "numbers messaged"

export interface TriggerConfig {
  endpoint: string;
  entryReady: string;
  entryDate: string;
  entryCount: string;
  /** optional secret token field (entry.<id>) + value → matched by a Filter-by-Zapier step */
  entryToken?: string;
  token?: string;
  dateIsShortAnswer: boolean; // true if the date question was switched to short-answer text
}

export async function loadTriggerConfig(): Promise<TriggerConfig> {
  return {
    endpoint: (await resolveConfig("textemall", "trigger_endpoint")) || DEFAULT_ENDPOINT,
    entryReady: (await resolveConfig("textemall", "entry_ready")) || DEFAULT_ENTRY_READY,
    entryDate: (await resolveConfig("textemall", "entry_date")) || DEFAULT_ENTRY_DATE,
    entryCount: (await resolveConfig("textemall", "entry_count")) || DEFAULT_ENTRY_COUNT,
    entryToken: (await resolveConfig("textemall", "entry_token")) || undefined,
    token: (await resolveConfig("textemall", "trigger_token")) || undefined,
    dateIsShortAnswer: (await resolveConfig("textemall", "date_short_answer")) === "true",
  };
}

/** Build the form-encoded POST body. Pure — no network. */
export function buildTriggerBody(cfg: TriggerConfig, opts: { count: number; now: Date }): URLSearchParams {
  const p = new URLSearchParams();
  p.set(cfg.entryReady, "Yes"); // exact multiple-choice value (Google 400s on case mismatch)
  if (cfg.dateIsShortAnswer) {
    p.set(cfg.entryDate, opts.now.toISOString().slice(0, 10));
  } else {
    // Google Forms DATE field with year → three sub-params.
    p.set(`${cfg.entryDate}_year`, String(opts.now.getFullYear()));
    p.set(`${cfg.entryDate}_month`, String(opts.now.getMonth() + 1));
    p.set(`${cfg.entryDate}_day`, String(opts.now.getDate()));
  }
  p.set(cfg.entryCount, String(opts.count));
  if (cfg.entryToken && cfg.token) p.set(cfg.entryToken, cfg.token);
  // Params Google's endpoint expects for a programmatic submission (rev.2 #5).
  p.set("fvv", "1");
  p.set("pageHistory", "0");
  p.set("submit", "Submit");
  return p;
}

export type TriggerResult =
  | { fired: true; status: number }
  | { fired: false; reason: "dry_run" | "not_armed"; body: string };

/**
 * Fire the trigger. Live POST only when dryRun===false AND trigger_armed==="true".
 * Returns the composed body in every non-firing path so callers/tests can assert
 * the shape without sending.
 */
export async function fireTextEmAllTrigger(opts: {
  count: number;
  now?: Date;
  dryRun?: boolean;
}): Promise<TriggerResult> {
  const now = opts.now ?? new Date();
  const cfg = await loadTriggerConfig();
  const body = buildTriggerBody(cfg, { count: opts.count, now });

  const armed = (await resolveConfig("textemall", "trigger_armed")) === "true";
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
