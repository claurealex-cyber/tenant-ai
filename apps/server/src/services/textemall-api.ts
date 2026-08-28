import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/**
 * DETERMINISTIC Text-Em-All group management via its internal REST API, driven
 * through authenticated XHR in the logged-in Safari tab (osascript `do JavaScript`).
 * Replaces the fragile iris GUI drive entirely — runs in seconds, no clicking.
 *
 * Endpoints (reverse-engineered 2026-08-28, same-origin `/proxy/…` → the
 * logged-in session):
 *   GET    /proxy/lists/<id>            → group object (with InternalListID, Uri…)
 *   GET    /proxy/lists/<id>/contacts   → { Size, Items:[{PersonID, PrimaryPhone}] }
 *   POST   /proxy/contacts             → add contact { PrimaryPhone, Lists:[group] }
 *   DELETE /proxy/contacts/<PersonID>  → remove contact
 *
 * Requires: a Safari tab open + logged in to app.text-em-all.com (same prerequisite
 * the scrape/iris path had). On a login wall the XHRs return non-2xx → we report it.
 */

export type ApiResult =
  | { status: "ok"; count: number; phones: string[] }
  | { status: "needs_login" }
  | { status: "failed"; detail: string };

/** The self-contained JS run inside the Text-Em-All tab. Clears the group then
 *  adds exactly `phones`, returns the resulting {count, phones}. */
function buildJs(groupId: string, phones: string[]): string {
  const list = JSON.stringify(phones);
  return `(function(){
    function J(m,u,b){var x=new XMLHttpRequest();x.open(m,u,false);x.withCredentials=true;x.setRequestHeader('Accept','application/json');if(b)x.setRequestHeader('Content-Type','application/json');x.send(b||null);return x;}
    try{
      var gr=J('GET','/proxy/lists/${groupId}');
      if(gr.status===401||gr.status===403||/login|signin/i.test(gr.responseURL||'')) return JSON.stringify({r:'needs_login'});
      if(gr.status!==200) return JSON.stringify({r:'failed',d:'group GET '+gr.status});
      var grp=JSON.parse(gr.responseText);
      var cur=JSON.parse(J('GET','/proxy/lists/${groupId}/contacts').responseText);
      cur.Items.forEach(function(i){ J('DELETE','/proxy/contacts/'+i.PersonID); });
      ${list}.forEach(function(p){
        var digits=String(p).replace(/[^0-9]/g,'').replace(/^1(?=\\d{10}$)/,'');
        J('POST','/proxy/contacts',JSON.stringify({DoNotCallPrimaryPhone:false,DoNotCallSecondaryPhone:false,DoNotCallTertiaryPhone:false,FirstName:'',LastName:'',PrimaryPhone:digits,Lists:[grp]}));
      });
      var after=JSON.parse(J('GET','/proxy/lists/${groupId}/contacts').responseText);
      return JSON.stringify({r:'ok',count:after.Size,phones:after.Items.map(function(i){return i.PrimaryPhone;})});
    }catch(e){ return JSON.stringify({r:'failed',d:String(e).slice(0,160)}); }
  })();`;
}

async function runInTeaTab(js: string, timeoutMs = 60_000): Promise<string> {
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
 * Set `groupId` to exactly `phones` (clear + add), deterministically via the API.
 * Never throws — returns a status. `deps.run` injectable for tests.
 */
export async function setGroupViaApi(
  opts: { groupId: string; phones: string[]; timeoutMs?: number },
  deps: { run?: (js: string) => Promise<string> } = {},
): Promise<ApiResult> {
  const run = deps.run ?? ((js: string) => runInTeaTab(js, opts.timeoutMs));
  try {
    const out = await run(buildJs(opts.groupId, opts.phones));
    const parsed = JSON.parse(out) as { r: string; count?: number; phones?: string[]; d?: string };
    if (parsed.r === "ok") return { status: "ok", count: parsed.count ?? 0, phones: parsed.phones ?? [] };
    if (parsed.r === "needs_login") return { status: "needs_login" };
    return { status: "failed", detail: parsed.d ?? "unknown" };
  } catch (err) {
    return { status: "failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

/** Extract the numeric group id from a Text-Em-All group URL (…/group/1271). */
export function groupIdFromUrl(url: string | null | undefined): string | null {
  const m = (url ?? "").match(/\/group\/(\d+)/);
  return m ? m[1] : null;
}
