import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveConfig } from "@tenant-ai/shared";

const pExecFile = promisify(execFile);

/**
 * DETERMINISTIC Text-Em-All broadcast via its internal REST API (authenticated
 * XHR in the logged-in Safari tab). Sends directly to a list of phone NUMBERS —
 * no group membership, no Google Form, no Zapier, no 100/mo cap. Reverse-engineered
 * 2026-08-29 by capturing the app's own Create-Broadcast calls:
 *   1. POST /proxy/draft-broadcasts {}                         → DraftBroadcastID
 *   2. PUT  /proxy/draft-broadcasts/<id>/type {SMS}
 *   3. POST /proxy/draft-broadcasts/<id>/contacts {PrimaryPhone}  (per recipient)
 *   4. POST /proxy/broadcasts {DraftBroadcastID, TextMessage, TextNumberID, …} → SEND
 * Requires a logged-in Safari tab (same prereq as the scrape). A real POST at step
 * 4 sends real texts — callers gate this behind the broadcast_method toggle + arming.
 */

export type BroadcastResult =
  | { status: "ok"; broadcastId: number; recipients: number; sentPhones: string[] }
  | { status: "needs_login" }
  | { status: "failed"; detail: string };

const tenDigit = (p: string) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export function buildBroadcastJs(
  phones: string[],
  message: string,
  textNumberId: number,
  callerId: string,
  name: string,
): string {
  const list = JSON.stringify([...new Set(phones.map(tenDigit).filter((p) => p.length === 10))]);
  return `(function(){
    function req(m,u,b){var x=new XMLHttpRequest();x.open(m,u,false);x.withCredentials=true;x.setRequestHeader('Accept','application/json');if(b!==undefined)x.setRequestHeader('Content-Type','application/json');x.send(b!==undefined?JSON.stringify(b):null);return x;}
    try{
      var phones=${list};
      if(!phones.length) return JSON.stringify({r:'failed',d:'no valid phones'});
      var dr=req('POST','/proxy/draft-broadcasts',{});
      if(dr.status===401||dr.status===403) return JSON.stringify({r:'needs_login'});
      if(dr.status>=400) return JSON.stringify({r:'failed',d:'draft '+dr.status});
      var id=JSON.parse(dr.responseText).DraftBroadcastID;
      var tp=req('PUT','/proxy/draft-broadcasts/'+id+'/type',{BroadcastTypeDesc:'SMS',IsTextSurvey:false});
      if(tp.status>=400) return JSON.stringify({r:'failed',d:'type '+tp.status});
      var added=[];
      phones.forEach(function(p){ var c=req('POST','/proxy/draft-broadcasts/'+id+'/contacts',{FirstName:'',LastName:'',PrimaryPhone:p,Notes:'',CustomData:{},PrimaryPhoneError:'',FirstNameError:'',LastNameError:''}); if(c.status<400)added.push(p); });
      if(added.length===0) return JSON.stringify({r:'failed',d:'no recipients added'});
      var fin=req('POST','/proxy/broadcasts',{DraftBroadcastID:id,BroadcastName:${JSON.stringify(name)},BroadcastType:'SMS',CallerID:${JSON.stringify(callerId)},CallThrottle:0,CheckCallingWindow:false,ContinueOnNextDay:true,IncludeSignature:false,IsTextSurvey:false,RepeatingBroadcastSchedule:null,StartDate:null,templateData:{TemplateMerge:null},TextMessage:${JSON.stringify(message)},TextNumberID:${textNumberId},IsNearEndOfCallingWindow:false});
      if(fin.status>=400) return JSON.stringify({r:'failed',d:'send '+fin.status+' '+String(fin.responseText).slice(0,120)});
      var bid=0; try{bid=JSON.parse(fin.responseText).BroadcastID||0;}catch(e){}
      return JSON.stringify({r:'ok',broadcastId:bid,added:added});
    }catch(e){ return JSON.stringify({r:'failed',d:String(e).slice(0,160)}); }
  })();`;
}

async function runInTeaTab(js: string, timeoutMs: number): Promise<string> {
  const appleScript = `on run {jsArg}
    tell application "Safari"
      set tt to missing value
      repeat with w in windows
        repeat with t in tabs of w
          if URL of t contains "text-em-all" then set tt to t
        end repeat
      end repeat
      if tt is missing value then return "{\\"r\\":\\"failed\\",\\"d\\":\\"no text-em-all tab open\\"}"
      return do JavaScript jsArg in tt
    end tell
  end run`;
  const { stdout } = await pExecFile("osascript", ["-e", appleScript, js], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Send an SMS broadcast to exactly `phones` with `message`, deterministically via
 * the API. Never throws — returns a status. `deps.run` injectable for tests.
 */
export async function sendBroadcastViaApi(
  opts: { phones: string[]; message: string; timeoutMs?: number; name?: string },
  deps: { run?: (js: string) => Promise<string> } = {},
): Promise<BroadcastResult> {
  const textNumberId = parseInt((await resolveConfig("textemall", "broadcast_text_number_id")) || "84582", 10);
  const callerId = (await resolveConfig("textemall", "broadcast_caller_id")) || "(773) 376-0486";
  // Per-lane broadcast name (rev.5 U5): the individual lane passes its own name
  // so ambiguity resolution can never cross-match broadcasts between lanes.
  const name = opts.name ?? ((await resolveConfig("textemall", "broadcast_name")) || "Ghem Leads");
  const run = deps.run ?? ((js: string) => runInTeaTab(js, opts.timeoutMs ?? 180_000));
  try {
    const out = await run(buildBroadcastJs(opts.phones, opts.message, textNumberId, callerId, name));
    const p = JSON.parse(out) as { r: string; broadcastId?: number; added?: string[]; d?: string };
    if (p.r === "ok") {
      // `added` are the 10-digit numbers that actually made it into the broadcast.
      // Map back to E.164 so callers flip/verify only who was really sent to.
      const sentPhones = (p.added ?? []).map((d) => (d.length === 10 ? `+1${d}` : d));
      return { status: "ok", broadcastId: p.broadcastId ?? 0, recipients: sentPhones.length, sentPhones };
    }
    if (p.r === "needs_login") return { status: "needs_login" };
    return { status: "failed", detail: p.d ?? "unknown" };
  } catch (err) {
    return { status: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

/**
 * Classify a FAILED send (rev.5 S4/M3b). Stage markers emitted by buildBroadcastJs
 * BEFORE the final send POST are definitely-unsent → safe to retry. Everything
 * else — the `send N` stage, an osascript timeout, a killed process — is
 * AMBIGUOUS: the final POST may have landed, so the batch must quarantine until
 * resolution proves whether a broadcast exists (never blind-retry → double-text).
 */
export function classifyBroadcastFailure(detail: string): "unsent" | "ambiguous" {
  const d = (detail || "").trim();
  if (
    d.startsWith("draft ") ||
    d.startsWith("type ") ||
    d === "no valid phones" ||
    d === "no recipients added" ||
    d === "no text-em-all tab open"
  ) {
    return "unsent";
  }
  return "ambiguous";
}

export interface BroadcastProbe {
  id: number;
  /** ms epoch of CreatedDate, or null when unparseable (treated as a candidate). */
  createdAtMs: number | null;
  /** Recipient phones, 10-digit. */
  phones: string[];
}

/** One JS run: list recent broadcasts with this exact name + their recipients. */
export function buildProbeJs(name: string, max = 10): string {
  return `(function(){
    function J(u){var x=new XMLHttpRequest();x.open('GET',u,false);x.withCredentials=true;x.setRequestHeader('Accept','application/json');x.send(null);return x;}
    try{
      var lr=J('/proxy/broadcasts?page=1&pageSize=30');
      if(lr.status===401||lr.status===403) return JSON.stringify({r:'needs_login'});
      if(lr.status!==200) return JSON.stringify({r:'failed',d:'list '+lr.status});
      var items=(JSON.parse(lr.responseText).Items||[]).filter(function(b){return b.BroadcastName===${JSON.stringify(name)};}).slice(0,${max});
      var out=[];
      items.forEach(function(b){
        var dr=J('/proxy/broadcasts/'+b.BroadcastID+'/details');
        var phones=[];
        if(dr.status===200){ try{ phones=(JSON.parse(dr.responseText).Items||[]).map(function(i){return String(i.PhoneNumber||'');}); }catch(e){} }
        out.push({id:b.BroadcastID,created:b.CreatedDate||null,phones:phones});
      });
      return JSON.stringify({r:'ok',broadcasts:out});
    }catch(e){ return JSON.stringify({r:'failed',d:String(e).slice(0,160)}); }
  })();`;
}

/** "2026-08-28 17:12:12-0500" → ms epoch, or null. */
export function parseTeaDate(raw: string | null): number | null {
  if (!raw) return null;
  const t = Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

export type ProbeResult =
  | { status: "ok"; broadcasts: BroadcastProbe[] }
  | { status: "needs_login" }
  | { status: "failed"; detail: string };

/** Read-only: recent broadcasts named `name` + their recipient phone sets. */
export async function probeRecentBroadcasts(
  opts: { name: string; timeoutMs?: number },
  deps: { run?: (js: string) => Promise<string> } = {},
): Promise<ProbeResult> {
  const run = deps.run ?? ((js: string) => runInTeaTab(js, opts.timeoutMs ?? 60_000));
  try {
    const out = await run(buildProbeJs(opts.name));
    const p = JSON.parse(out) as { r: string; broadcasts?: Array<{ id: number; created: string | null; phones: string[] }>; d?: string };
    if (p.r === "ok") {
      return {
        status: "ok",
        broadcasts: (p.broadcasts ?? []).map((b) => ({
          id: b.id,
          createdAtMs: parseTeaDate(b.created),
          phones: (b.phones ?? []).map(tenDigit).filter((x) => x.length === 10),
        })),
      };
    }
    if (p.r === "needs_login") return { status: "needs_login" };
    return { status: "failed", detail: p.d ?? "unknown" };
  } catch (err) {
    return { status: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}
