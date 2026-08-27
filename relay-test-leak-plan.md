# Relay Test-Send Leak — Investigation & Fix Plan

## What happened (root cause)
My stress-test **gate scripts** (ad-hoc `tsx` scripts, e.g. `_gate.mts`) called `relaySendWithGuards(...)` / `textLinkToCaller(...)` **directly against the LIVE, enabled Messages relay**. The relay delivers via `attemptSend → sendViaMessagesRelay → osascript → Messages.app`, so those calls **actually texted the messages** — with test-string bodies, to **dynamically generated (real-looking) phone numbers** — from the Mac's Messages account.

Unlike the unit tests (which `vi.mock` the messages-relay so nothing is delivered), the gate scripts had NO such guard. There is currently **no switch that prevents a script/gate from sending real texts** when the relay is on.

## Confirmed impact (from the relay ledger)
Delivered (kind/body → recipient), all via Messages.app:
- `link 1` → **+13123335805** (312-333-5805)  [SENT]
- `intro + link` → **+13123335728** (312-333-5728)  [SENT]
- earlier gate: `intro + link text 1` / `…text 2 already received` / `zillow #1` → **+13125550777** (312-555-0777)  [SENT]
- many test strings → **+13129752365** (your test number)  [some SENT, several failed on cooldown]
- `here is your link` → **+13124659780**  [was DEFERRED — **canceled**, never delivered]

The generated numbers came from `+1312${Date.now().slice(-7)}`-style code — i.e. essentially random Chicago numbers. **Some may be real people**, who received a short junk text ("link 1", "intro + link"). Delivered texts cannot be unsent. Nothing is still queued (pending+deferred = 0).

## Fix plan

### M1 — Immediate containment (DONE)
- Canceled the one still-queued junk row; verified **0 pending/deferred**. No further test texts will go out.

### M2 — Relay dry-run / kill-switch (the structural root fix)
- `sms_relay.dry_run` config **and** `RELAY_DRY_RUN=1` env, honored inside `attemptSend`/`sendViaMessagesRelay`: when on, **record the ledger row but SKIP the osascript call** — full code path, zero real delivery.
- **Every** gate/script from now on runs with dry-run on (a `scripts/_gate-env.ts` that sets it). Production stays off.
- **Stress:** dry-run on → ledger row `status:"sent"` (or a new `dry_run` status) but `sendViaMessagesRelay` NEVER called (spy asserts 0 osascript); dry-run off → normal delivery; the config flip is picked up within the cache TTL.

### M3 — Known-recipient guard (defense in depth)
- `sendViaMessagesRelay` (or `relaySendWithGuards`) refuses a recipient that is NOT a real contact — i.e. the number must appear in `SurveyInvite` / `SmsConversation` / `ZillowLead` / `CallLog` / `smsOptOut` / configured owner numbers. A random generated number is blocked (`skipped: unknown recipient`).
- Plus a hard block on the reserved fiction range only-if-desired; the known-recipient check is the strong guard.
- **Stress:** a real inbound texter/caller/Zillow lead → allowed; a never-seen random number → blocked with no delivery; the owner forward number → allowed.

### M4 — Gate/test discipline (prevent recurrence)
- A single `runGate()` helper that (a) sets dry-run, (b) refuses to run unless dry-run is confirmed on. All live gates use it.
- A repo check/grep in CI: no `relaySendWithGuards`/`sendViaMessagesRelay`/`textLinkToCaller` call inside `scripts/**` without the dry-run guard.
- Document in CLAUDE.md / plan: "Never exercise the live relay from a script; use dry-run + reserved 555-01xx numbers."

### M5 — Ledger cleanup + audit
- Tag every leaked test-content row (`lastError='test-leak'` / a `source` marker) so the SMS Leads and Zillow dashboards do NOT show these fake numbers as real leads (they currently could, via SurveyInvite/ledger joins).
- Delete the synthetic `SurveyInvite`/`ZillowLead`/`SmsConversation` rows created by gates for those numbers so the tabs are clean.
- Produce the final list of numbers that received a junk text, for you to decide on any follow-up (likely none — the messages were short and benign).
- **Stress:** after cleanup, the SMS Leads / Zillow tabs show zero gate/test numbers; counts match real activity only.

### M6 — Verify end-to-end
- Run a representative gate with dry-run → full path exercised, `sendViaMessagesRelay` spy = 0 calls, no Messages delivery, ledger shows the dry-run rows.
- Attempt a send to a random number → blocked by M3.
- Confirm real inbound (a genuine text/call) still delivers normally.

## Notes
- The relay being ON is intended (temporary Messages-app outbound until 10DLC); the bug is that nothing stopped *non-inbound, script-originated* sends. M2+M3 close that structurally.
- This was my error in how I ran the live gates. Future gates will never touch the live relay.
