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
  | { status: "ok"; broadcastId: number; recipients: number }
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
      var added=0;
      phones.forEach(function(p){ var c=req('POST','/proxy/draft-broadcasts/'+id+'/contacts',{FirstName:'',LastName:'',PrimaryPhone:p,Notes:'',CustomData:{},PrimaryPhoneError:'',FirstNameError:'',LastNameError:''}); if(c.status<400)added++; });
      if(added===0) return JSON.stringify({r:'failed',d:'no recipients added'});
      var fin=req('POST','/proxy/broadcasts',{DraftBroadcastID:id,BroadcastName:${JSON.stringify(name)},BroadcastType:'SMS',CallerID:${JSON.stringify(callerId)},CallThrottle:0,CheckCallingWindow:false,ContinueOnNextDay:true,IncludeSignature:false,IsTextSurvey:false,RepeatingBroadcastSchedule:null,StartDate:null,templateData:{TemplateMerge:null},TextMessage:${JSON.stringify(message)},TextNumberID:${textNumberId},IsNearEndOfCallingWindow:false});
      if(fin.status>=400) return JSON.stringify({r:'failed',d:'send '+fin.status+' '+String(fin.responseText).slice(0,120)});
      var bid=0; try{bid=JSON.parse(fin.responseText).BroadcastID||0;}catch(e){}
      return JSON.stringify({r:'ok',broadcastId:bid,recipients:added});
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
  opts: { phones: string[]; message: string; timeoutMs?: number },
  deps: { run?: (js: string) => Promise<string> } = {},
): Promise<BroadcastResult> {
  const textNumberId = parseInt((await resolveConfig("textemall", "broadcast_text_number_id")) || "84582", 10);
  const callerId = (await resolveConfig("textemall", "broadcast_caller_id")) || "(773) 376-0486";
  const name = (await resolveConfig("textemall", "broadcast_name")) || "Ghem Leads";
  const run = deps.run ?? ((js: string) => runInTeaTab(js, opts.timeoutMs ?? 60_000));
  try {
    const out = await run(buildBroadcastJs(opts.phones, opts.message, textNumberId, callerId, name));
    const p = JSON.parse(out) as { r: string; broadcastId?: number; recipients?: number; d?: string };
    if (p.r === "ok") return { status: "ok", broadcastId: p.broadcastId ?? 0, recipients: p.recipients ?? 0 };
    if (p.r === "needs_login") return { status: "needs_login" };
    return { status: "failed", detail: p.d ?? "unknown" };
  } catch (err) {
    return { status: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}
