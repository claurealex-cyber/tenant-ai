import { execFile } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Zillow Rental Manager lead extraction through the signed-in Safari session.
 *
 * Spike-proven approach (see zillow-leads-plan.md M0 findings): drive Safari
 * via AppleScript, call Zillow's internal leadManagementTable API with a
 * `fetch` from the page's own context, and read the result back out in chunks.
 * No credentials are ever handled — the session comes from the user signing
 * into Zillow in Safari manually. When the session is gone this module reports
 * `needs-login`; it NEVER attempts to log in.
 *
 * The API caps `limit` and `start` at 100 each, so one run returns at most the
 * 200 newest leads — same ceiling Zillow's own UI has. That comfortably covers
 * the 60-day send window this feature operates in.
 */

const LEADS_URL = "https://www.zillow.com/rental-manager/lead-management";
const TAB_MATCH = "zillow.com/rental-manager";
const CHUNK = 60_000;

export type ExtractErrorKind =
  | "needs-login"
  | "no-tab"
  | "load-timeout"
  | "fetch-timeout"
  | "http"
  | "js-error"
  | "osascript"
  | "busy"
  | "bad-json";

export class ZillowExtractError extends Error {
  readonly kind: ExtractErrorKind;
  constructor(kind: ExtractErrorKind, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
  }
}

export interface ExtractResult {
  leads: unknown[];
  totalLeadCount: number | null;
  rawJsonPath: string;
}

/**
 * Classify where Safari actually landed. Zillow bounces signed-out visits to
 * its login flow; anything not on the rental-manager path means the session is
 * unusable and a human has to sign in.
 */
export function classifyPageState(href: string): "ok" | "needs-login" | "loading" {
  const h = href.toLowerCase();
  // A just-created tab reports about:blank (readyState "complete"!) until
  // navigation actually starts — that is "not there yet", not "signed out".
  if (h === "" || h === "about:blank" || h === "favorites://") return "loading";
  if (/\/user\/acct|login|signin|auth\b|captcha|px-captcha/.test(h)) return "needs-login";
  if (h.includes("zillow.com/rental-manager")) return "ok";
  return "needs-login";
}

/** The in-page extraction job. Single-quoted JS only — it travels via argv. */
export function extractionJs(): string {
  return `
window.__zx = {state:'running', leads:[]};
(async () => { try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  for (let start = 0; start <= 100; start += 100) {
    const r = await fetch('https://www.zillow.com/rental/satellite/api/web/landlord/v1/leadManagement/leadManagementTable', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({clientTimeZone: tz, limit: 100, start})});
    if (r.status === 401 || r.status === 403) { window.__zx.state = 'auth'; return; }
    if (r.status !== 200) { window.__zx.state = 'http-' + r.status; return; }
    const d = await r.json(); const resp = d.response || {};
    window.__zx.leads.push(...(resp.leads || []));
    window.__zx.total = resp.totalLeadCount;
    if (!resp.hasNextPage) break;
  }
  window.__zx.json = JSON.stringify(window.__zx.leads);
  window.__zx.state = 'done';
} catch(e) { window.__zx.state = 'error:' + e; } })();
'started'`.trim();
}

/**
 * Run JavaScript in the first Safari tab whose URL matches the rental-manager
 * app. The JS travels as an osascript argv item, so neither AppleScript nor
 * shell escaping ever touches it.
 */
const FIND_TAB_AND_RUN = `
on run argv
  set theJS to item 1 of argv
  tell application "Safari"
    repeat with w in windows
      repeat with t in tabs of w
        if URL of t contains "${TAB_MATCH}" then
          return do JavaScript theJS in t
        end if
      end repeat
    end repeat
    -- Second pass: an expired session bounces the rental-manager tab to
    -- Zillow's login/auth flow. Match those too so the caller can report
    -- needs-login instead of losing the tab. Never matches general browsing.
    repeat with w in windows
      repeat with t in tabs of w
        set u to URL of t
        if u contains "zillow.com" and (u contains "login" or u contains "auth" or u contains "user/acct" or u contains "captcha") then
          return do JavaScript theJS in t
        end if
      end repeat
    end repeat
  end tell
  return "__NO_TAB__"
end run`;

const OPEN_TAB = `
tell application "Safari"
  if (count of windows) is 0 then
    make new document with properties {URL:"${LEADS_URL}"}
  else
    tell front window to make new tab with properties {URL:"${LEADS_URL}"}
  end if
end tell`;

function osascript(args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", args, { timeout: timeoutMs, maxBuffer: 1_000_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new ZillowExtractError("osascript", (stderr || err.message).slice(0, 300)));
        return;
      }
      resolve(stdout.replace(/\n$/, ""));
    });
  });
}

async function runJs(js: string): Promise<string> {
  const out = await osascript(["-e", FIND_TAB_AND_RUN, js]);
  if (out === "__NO_TAB__") throw new ZillowExtractError("no-tab", "no Safari tab on rental-manager");
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Module-level lock: Safari is a shared, stateful surface — one run at a time. */
let running = false;

export interface ExtractOptions {
  /** Directory the raw JSON audit copy is written into. */
  outDir: string;
  loadTimeoutMs?: number;
  fetchTimeoutMs?: number;
}

export async function runZillowExtraction(opts: ExtractOptions): Promise<ExtractResult> {
  if (running) throw new ZillowExtractError("busy", "an extraction is already running");
  running = true;
  try {
    return await extract(opts);
  } finally {
    running = false;
  }
}

async function extract(opts: ExtractOptions): Promise<ExtractResult> {
  const loadTimeout = opts.loadTimeoutMs ?? 30_000;
  const fetchTimeout = opts.fetchTimeoutMs ?? 120_000;

  // 1. Ensure a rental-manager tab exists (reuse one when present so we never
  //    multiply tabs across runs; otherwise open our own).
  let opened = false;
  try {
    await runJs("'ping'");
  } catch (err) {
    if (err instanceof ZillowExtractError && err.kind === "no-tab") {
      await osascript(["-e", OPEN_TAB]);
      opened = true;
    } else {
      throw err;
    }
  }

  // 2. Wait for the page, then classify where we actually are. A signed-out
  //    session redirects away from rental-manager → needs-login, full stop.
  const loadDeadline = Date.now() + loadTimeout;
  let href = "";
  for (;;) {
    if (Date.now() > loadDeadline) throw new ZillowExtractError("load-timeout", `page never loaded (${href || "no page state"})`);
    try {
      const out = await runJs("document.readyState + '|' + location.href");
      const [state, url] = out.split("|");
      href = url ?? "";
      // about:blank reports readyState "complete" before navigation starts —
      // only accept "complete" once we're on a real page.
      if (state === "complete" && classifyPageState(href) !== "loading") break;
    } catch (err) {
      // Tab may briefly not match while Safari is mid-navigation to login.
      if (!(err instanceof ZillowExtractError && err.kind === "no-tab" && opened)) throw err;
    }
    await sleep(1000);
  }
  if (classifyPageState(href) === "needs-login") {
    throw new ZillowExtractError("needs-login", `Safari is at ${href.slice(0, 120)} — sign into Zillow Rental Manager manually and retry`);
  }

  // 3. Kick off the in-page fetch job and poll it.
  await runJs(extractionJs());
  const fetchDeadline = Date.now() + fetchTimeout;
  for (;;) {
    if (Date.now() > fetchDeadline) throw new ZillowExtractError("fetch-timeout", "lead fetch did not finish in time");
    await sleep(2000);
    const state = await runJs("window.__zx ? window.__zx.state : 'gone'");
    if (state === "done") break;
    if (state === "auth") throw new ZillowExtractError("needs-login", "Zillow API rejected the session mid-run — sign in again");
    if (state === "gone") throw new ZillowExtractError("js-error", "extraction state lost (page reloaded?)");
    if (state.startsWith("http-")) throw new ZillowExtractError("http", state);
    if (state.startsWith("error:")) throw new ZillowExtractError("js-error", state.slice(6, 300));
  }

  // 4. Chunk the JSON out of the page.
  const bytes = parseInt(await runJs("String(window.__zx.json.length)"), 10);
  let json = "";
  for (let off = 0; off < bytes; off += CHUNK) {
    json += await runJs(`window.__zx.json.slice(${off}, ${off + CHUNK})`);
  }
  if (json.length !== bytes) {
    throw new ZillowExtractError("bad-json", `chunk reassembly mismatch: got ${json.length}, expected ${bytes}`);
  }

  let leads: unknown[];
  try {
    leads = JSON.parse(json);
    if (!Array.isArray(leads)) throw new Error("not an array");
  } catch (err) {
    throw new ZillowExtractError("bad-json", `raw payload did not parse: ${err}`);
  }

  const total = parseInt(await runJs("String(window.__zx.total ?? '')"), 10);

  // 5. Audit copy on disk, then release page memory.
  await mkdir(opts.outDir, { recursive: true });
  const rawJsonPath = path.join(opts.outDir, `leads-raw-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(rawJsonPath, json, "utf8");
  await runJs("delete window.__zx; 'cleaned'").catch(() => undefined);

  return { leads, totalLeadCount: Number.isFinite(total) ? total : null, rawJsonPath };
}
