# Plan: automatic caller/text → Text-Em-All relay (group 2), toggleable + tested

## Goal
Turn on the **individual** path so that when someone **calls or texts** the Twilio number,
the app automatically sets the Text-Em-All group **"2. Leads 08/28/2026" (ListID 1273)** to
that caller's number via the deterministic API and fires the **individual** Google-Form
trigger → the individual Zap broadcasts the application link to them. Toggleable; the relay
stays the guaranteed fallback. The owner authorized toggling it on to test.

## What already exists (built earlier + the API rewrite)
- **Individual path code is done**: `caller-link.ts` (calls) and `survey-intake.ts` (texts)
  enqueue the `individual-relay` job when the toggle is on+armed; the job (concurrency=1)
  runs `setGroupViaApi(groupId, [phone])` → fires `fireIndividualTrigger(phone)` → on ANY
  failure falls back to the relay (R1). Opt-out + per-phone cooldown honored.
- **Now uses the deterministic API** (`textemall-api.ts`), not iris — the ~10s reliable path.
- **Individual form** "Leads Individual Call Message Trigger" (fetched): `entry.766759466`
  =phone, `entry.2069978510`="Yes".
- **Group confirmed**: 1273 = "2. Leads 08/28/2026" (separate from Zillow's 1271).
- Config keys exist: `sms_relay.individual_channel`, `textemall.individual_trigger_armed`,
  `individual_group`, `individual_group_url`, `individual_test_numbers`,
  `individual_cooldown_min`, `individual_settle_sec`, shared `monthly_fire_cap`.
- Current state: ALL individual config is **unset** (channel=relay, disarmed) — nothing fires.

## Prerequisites to confirm (owner)
- **The individual Zapier workflow is set up**: individual form "New Response" → Text-Em-All
  broadcast to group **1273 "2. Leads 08/28/2026"** (an *instant* trigger, per earlier
  decision). ⟲ **Confirm this Zap exists** — without it, firing the form does nothing.
- Safari signed in to Text-Em-All (same as the Zillow path).

## Milestones

### M1 — Configure the individual group + verify the API on group 1273
- Set `textemall.individual_group_url = https://app.text-em-all.com/contacts/group/1273`
  and `individual_group = "2. Leads 08/28/2026"` (exact name).
- Verify `setGroupViaApi({groupId:"1273", phones:["+17084158984"]})` → `{status:"ok",count:1}`
  (clears + sets group 2 to the owner's number, in seconds).
- **Gate:** group 2 shows exactly the owner number via the API; no error.

### M2 — Owner-include option (delivery check, decision)
- Decide whether each individual broadcast ALSO includes the owner's number (so the owner
  gets a copy of every caller's link as a live "it fired" check — like the Zillow habit).
  If yes: the job sets the group to `[caller, owner]`; if no: `[caller]` only.
- **Gate:** unit-tested either way; default per owner's choice.

### M3 — Trigger dry-run verify (no send)
- Confirm `fireIndividualTrigger` builds the right body (`entry.766759466=<phone>` +
  `entry.2069978510=Yes` + submit params) and stays dry-run while disarmed.
- **Gate:** dry-run body correct; no network while `individual_trigger_armed` unset.

### M4 — Toggle ON for a canary test (owner number only)
- `individual_channel=textemall`, `individual_trigger_armed=true`,
  `individual_test_numbers=+17084158984` (only the owner fires live; everyone else → relay).
- **Test:** enqueue an `individual-relay` job for +17084158984 (simulates a call/text) — the
  job sets group 1273 to the owner (+ optionally owner-as-check), fires the individual form →
  the individual Zap broadcasts → **owner receives the link**. (Or the owner really
  calls/texts the Twilio number to exercise the full inbound path.)
- **Gate:** owner receives the application link via group 2; a non-whitelisted number still
  goes via relay; the job logs `via: textemall`.

### M5 — Go live (all callers/texters)
- Clear `individual_test_numbers` → every real caller/texter gets the link via Text-Em-All;
  relay remains the guaranteed fallback (disarmed/failed/cap → relay, so no one is dropped).
- Keep opt-out/STOP, per-phone cooldown, and the shared `monthly_fire_cap` (100) — at the
  cap, callers fall back to relay for the rest of the month.
- **Gate:** a real caller/texter gets the link via group 2; SMS-leads tab shows the origin.

### M6 — Monitor + kill-switch
- Monitor: the individual group edits, form fires vs the shared 100/mo cap, opt-out replies.
- **Kill-switch (instant, config):** `individual_channel=relay` (or
  `individual_trigger_armed=false`) → back to the pure relay for callers/texters.

## Notes / risks (carried from the individual-relay stress passes)
- **Per-call, real-time**: each inbound sets group 1273 to that one number, so the group is
  correct at broadcast time (instant Zap). Concurrency=1 + a small settle keep sequential
  callers from clobbering each other (F1).
- **Relay is the universal fallback** — a caller always gets exactly one link.
- **Shared 100/mo cap** with the Zillow path (H3) — heavy call volume spills to relay.
- **Separate group (1273)** — never touches the Zillow group (1271).
- The deterministic API makes each edit ~seconds (no iris flakiness).

## Out of scope
The Zillow batch path (already live); the owner building the individual Zap; relay/Twilio
runtime behavior.
