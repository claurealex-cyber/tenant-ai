import { execFile } from "node:child_process";

/**
 * Send an SMS through the macOS Messages app (iPhone Text Message Forwarding).
 *
 * Temporary outbound path while the Telnyx number awaits 10DLC registration:
 * carriers block API-originated SMS from the unregistered number, but a text
 * relayed through the user's personal iPhone delivers like any person-to-person
 * message. All sends MUST go through relaySendWithGuards() — never call this
 * module directly from feature code (caps, opt-out, and the ledger live there).
 */

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
export function aplEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build an AppleScript string expression for arbitrary text.
 * Literal newlines break `osascript -e` arguments, so each line becomes its own
 * quoted literal joined with `& linefeed &`.
 */
export function aplString(s: string): string {
  return s
    .split("\n")
    .map((l) => `"${aplEscape(l)}"`)
    .join(" & linefeed & ");
}

const E164 = /^\+1\d{10}$/;

/** AppleEvents/TCC denial shows up as error -1743 or "not authorized". */
export function isTccError(message: string): boolean {
  return /-1743|not authori[sz]ed/i.test(message);
}

export class RelaySendError extends Error {
  readonly isTcc: boolean;
  constructor(message: string) {
    super(message);
    this.isTcc = isTccError(message);
  }
}

/**
 * Fire one message via Messages.app, pinned to the SMS service (never iMessage:
 * iMessage fails for Android recipients and would send from the Apple ID
 * identity instead of the personal phone number).
 *
 * AppleScript success does NOT prove delivery — the iPhone relays silently.
 * Delivery confirmation is the sweep's job (chat.db), not this function's.
 */
export function sendViaMessagesRelay(to: string, text: string): Promise<void> {
  if (!E164.test(to)) {
    return Promise.reject(new RelaySendError(`recipient not E.164: ${to}`));
  }
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      [
        "-e", 'tell application "Messages"',
        "-e", "set targetService to 1st service whose service type = SMS",
        "-e", `set targetBuddy to buddy "${aplEscape(to)}" of targetService`,
        "-e", `send ${aplString(text)} to targetBuddy`,
        "-e", "end tell",
      ],
      { timeout: 25_000 },
      (err, _stdout, stderr) => {
        if (err) reject(new RelaySendError(stderr?.trim() || err.message));
        else resolve();
      },
    );
  });
}

/** Best-effort local notification so a TCC revocation is visible on the Mac. */
export function notifyOnMac(text: string): void {
  execFile(
    "/usr/bin/osascript",
    ["-e", `display notification ${aplString(text)} with title "Tenant AI relay"`],
    { timeout: 5_000 },
    () => {},
  );
}
