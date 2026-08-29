# Broadcast-Toggle Root-Fix Plan

## Question asked
"Does the broadcast_method toggle properly pause the Zapier path AND the Apple
iMessage path?" — stress test + fix at the root.

## Live state (decrypted ground truth, 2026-08-29)
- `textemall.broadcast_method` = **api**   (nothing is turned off)
- `zillow.send_channel`        = **textemall**
- `sms_relay.individual_channel` = **textemall**  (+ trigger_armed = true)
- `zillow.auto_enabled` = true, `textemall.trigger_armed` = true
(My throwaway `resolveConfig` loop earlier misread these as null — a cold-cache
quirk in short-lived `node -e` procs. `decrypt(raw)` and the running server both
read "api". Not a production bug.)

## How routing ACTUALLY works — it is TWO toggles, not one
Path selection is a 2-level decision, made separately for Zillow and Individual:

  Level 1 — TRANSPORT (Text-Em-All vs Apple iMessage relay):
    Zillow:     zillow.send_channel        = "textemall" | else → iMessage relay
    Individual: sms_relay.individual_channel = "textemall" (+armed) | else → iMessage relay

  Level 2 — TEXT-EM-ALL SUB-METHOD (only consulted when Level 1 = textemall):
    Both:       textemall.broadcast_method = "api" (direct REST) | "form" (Google Form → Zapier)

`broadcast_method` is the INNER toggle. It only decides API-vs-Zapier, and ONLY
when the transport is already Text-Em-All.

## Stress-test matrix — exactly ONE path fires (no double-send)
ZILLOW (zillow-auto.ts, nested if/else with early returns — verified in code + tests):
| send_channel | broadcast_method | Fires        | iMessage | Zapier | API |
|--------------|------------------|--------------|----------|--------|-----|
| textemall    | api              | direct API   | no       | no     | YES |
| textemall    | form/null        | Zapier form  | no       | YES    | no  |
| relay/null   | (ignored)        | iMessage     | YES      | no     | no  |

INDIVIDUAL (individual-relay.ts):
- Eligibility gate = individual_channel==textemall AND trigger_armed==true.
  Not eligible → job never enqueued → normal iMessage relay.
- Eligible + api  → API send; success = done (no relay); any failure → iMessage FALLBACK.
- Eligible + form → group-edit + individual Zapier; failure → iMessage FALLBACK.
Exactly one DELIVERY in every case (API xor relay). No double-text.

## Answer
- Pauses Zapier?  **YES, correctly.** broadcast_method=api never reaches the
  Zapier/form branch (early return in Zillow; api-branch in individual).
- Pauses iMessage? **NO — and it was never supposed to.** iMessage is governed by
  send_channel / individual_channel, a SEPARATE toggle. With both currently
  "textemall", iMessage is already off as the primary path (it survives only as
  the individual guaranteed-fallback on API failure).

## Root issues found
1. **Silent no-op / conflation (primary).** The dashboard shows broadcast_method as
   "the toggle" and its route docstring claims it "governs BOTH paths." But if
   send_channel≠textemall, setting broadcast_method=api does NOTHING for Zillow —
   it silently keeps using iMessage. A user can't tell "am I API-only?" from the
   toggle alone. The two levels aren't shown or guarded together.
2. **iMessage-as-fallback isn't surfaced.** Individual api mode still uses iMessage
   when the API send fails. Correct by design (guaranteed delivery) but invisible,
   so "iMessage is paused" is not strictly true.
3. **Asymmetric fallback.** Individual falls back to iMessage on textemall failure;
   Zillow does NOT (marks batch failed, retries next slot). Inconsistent, unstated.
4. **No effective-path readout.** Nothing shows the RESOLVED path (transport +
   sub-method) for Zillow vs Individual — the exact gap that made this question
   hard to answer.

## Root fix — milestones
- **M1 Effective-Path status (observability first).**
  Add GET /internal/routing-status → { zillow:{transport, method, effective},
  individual:{transport, armed, method, effective, fallback:"imessage"} } computed
  from the same resolveConfig calls the runtime uses. Surface as a read-only
  "Effective delivery path" panel at the top of /admin/sms-relay. Makes the true
  state answerable at a glance. (No behavior change.)
- **M2 Unify the toggle UI.** Replace the lone broadcast_method switch with a single
  3-way "Delivery method" control per lane (Zillow, Individual):
  Apple iMessage relay | Text-Em-All (Zapier) | Text-Em-All (direct API).
  Writing "iMessage" sets send_channel/individual_channel=relay; the two Text-Em-All
  options set channel=textemall + broadcast_method=api|form atomically. One write =
  one intended state; eliminates the silent no-op.
- **M3 Guard the no-op at the root.** In the route(s), reject/auto-correct an
  inconsistent write (broadcast_method=api while transport=relay) and log it; the
  runtime already ignores it, but the write should never create a misleading state.
- **M4 Surface the fallback + asymmetry.** Panel copy states "iMessage is the
  guaranteed fallback if a Text-Em-All send fails (individual only; Zillow retries
  next slot)." Optional: add a zillow.textemall_fallback_relay flag (default off) to
  make Zillow symmetric if desired.
- **M5 Tests.** routing-status resolver truth table; route atomic-write + guard;
  keep the existing zillow-auto api/form/needs_login + individual xor-delivery tests
  green. Live-gate M2 with one owner-only send per lane.

## Non-goals
- No change to the proven send mechanics (sendBroadcastViaApi, the relay).
- Do not weaken the individual iMessage fallback (guaranteed delivery).

---

## Addendum — page-level toggles + call-path guarantee (requested 2026-08-29)

### What the user asked
1. A NEW toggle on the **Zillow leads page** (/admin/zillow) and on the **SMS
   leads page** (/admin/sms-leads) — not only buried in /admin/sms-relay.
2. When the SMS toggle is ON, **calls** to the Twilio number must ALSO get the
   API-driven Text-Em-All broadcast relay (not just inbound texts).

### Finding on #2 — already wired; must be preserved + locked
Calls and texts already share ONE delivery chokepoint:
- call-handler.ts sends the caller's link ONLY via `textLinkToCaller()` at all
  three moments — voice tool (`source:"voice_tool"`), call start
  (`"call_start"`), call end (`"call_end"`). No other caller-text path exists.
- `textLinkToCaller()` → if `individualTextEmAllEligible(phone)` (i.e.
  individual_channel=textemall AND individual_trigger_armed=true, whitelist ok) →
  enqueues the `individual-relay` job → `runIndividualRelay` → with
  broadcast_method=api → `sendBroadcastViaApi` (the API broadcast), iMessage only
  as guaranteed fallback.
=> With the individual toggle ON + armed + broadcast_method=api, CALLS already
   receive the API-driven Text-Em-All broadcast, identically to texts.
The work is therefore: (a) make the new SMS toggle set ALL the enabling keys
atomically, and (b) add a regression test that a call-sourced delivery
(source=call_start/voice_tool/call_end) with broadcast_method=api goes out via
sendBroadcastViaApi — so this never silently regresses.

### New milestones
- **M6 — Zillow-leads-page toggle.** Add the M2 "Delivery method" control (3-way:
  iMessage relay | Text-Em-All Zapier | Text-Em-All direct API) to the top of
  /admin/zillow, bound to the ZILLOW lane (zillow.send_channel +
  textemall.broadcast_method). Reuse one shared <DeliveryMethodToggle> component +
  the M1 effective-path readout so both pages show the same source of truth.
- **M7 — SMS-leads-page toggle (covers calls AND texts).** Add the same control to
  the top of /admin/sms-leads, bound to the INDIVIDUAL lane. "ON = Text-Em-All
  (direct API)" writes, atomically in one route call:
    sms_relay.individual_channel   = "textemall"
    textemall.individual_trigger_armed = "true"
    textemall.broadcast_method     = "api"
  "OFF / iMessage" clears individual_channel to relay (leaving broadcast_method
  untouched so the Zillow lane is unaffected). Because caller links flow through
  textLinkToCaller, flipping this single control switches BOTH inbound-text and
  inbound-CALL link delivery to the API broadcast at once. Panel copy states
  exactly that ("applies to texts AND calls to your number").
- **M8 — Lock the call path.** Test: source ∈ {call_start, voice_tool, call_end}
  with broadcast_method=api and the individual gate on → runIndividualRelay calls
  sendBroadcastViaApi (not the group-edit form, not a bare relay), and iMessage is
  used only when the API send fails. Guards the "calls also get the API broadcast"
  guarantee against regressions. Keep existing individual-relay + caller-link
  suites green.
- **M9 — One atomic per-lane route.** POST /api/admin/delivery-method
  { lane: "zillow"|"individual", method: "imessage"|"zapier"|"api" } performs the
  multi-key write + audit + clearConfigCache in one transaction, replacing the
  single-key broadcast-method route (kept as a thin alias for back-comp). Reject
  inconsistent combinations (M3 guard) here.

### Non-goals (unchanged)
- Don't split calls and texts onto different channels — they intentionally share
  textLinkToCaller so one toggle governs both.
- Don't remove the iMessage guaranteed-fallback on the individual/call lane.

---

## STRESS TEST (2026-08-29) — findings + plan revisions

Verified every assumption against the code. Six issues; two are plan-breaking.

### S1 — CRITICAL: `broadcast_method` is ONE global key, so per-lane api/Zapier is impossible as written
Both lanes read the SAME key: zillow-auto.ts:266,303 and individual-relay.ts:105
all call `resolveConfig("textemall","broadcast_method")`. M2/M6/M7/M9 present a
per-lane 3-way toggle where each lane independently chooses API vs Zapier — but a
single global key CANNOT hold two independent values. Setting the SMS lane to
"direct API" flips `broadcast_method=api` globally → the Zillow lane silently
switches Zapier→API too (and vice-versa). The plan's own line "leaving
broadcast_method untouched so the Zillow lane is unaffected" is wrong: the ON path
writes the shared key.
FIX: split the key per lane — `zillow.broadcast_method` + `individual.broadcast_method`.
Read the legacy `textemall.broadcast_method` as the fallback/default for BOTH when a
lane-specific key is absent (zero-downtime migration; current "api" keeps applying
to both until a lane is explicitly changed). Update the two services, the 3 new
API-mode tests, and the routes to the per-lane keys. Without this split, M2/M6/M7/M9
are not implementable.

### S2 — HIGH (also a pre-existing bug): toggle writes don't refresh the SERVER cache
resolveConfig caches per-process for 60s (config-resolver.ts CACHE_TTL_MS=60_000).
The dashboard broadcast-method route calls only in-process `clearConfigCache()`
(clears the Next.js process, NOT the running Fastify server). The server exposes
`POST /internal/config/refresh` for exactly this, and the established routes
(zillow/schedule, zillow/auto-toggle, sms-relay/refresh-config) already call it —
but broadcast-method and the individual-channel toggle do NOT. Effect: flip the
toggle, place a test call, and the server keeps using the OLD path for up to 60s —
looks broken/racey during precisely the live test the user will run.
FIX: every delivery-method write (M9) must POST /internal/config/refresh with the
x-relay-secret after the DB write. Backfill the SAME fix into the existing
broadcast-method route now (it's live and laggy today).

### S3 — MEDIUM: M1 readout under-specified → would itself be misleading
The real runtime decision depends on ~9 keys, not 2: send_channel,
individual_channel, individual_trigger_armed, {zillow,individual}.broadcast_method,
individual_test_numbers (whitelist), sms_relay.enabled, zillow.auto_enabled,
textemall.trigger_armed, sms_relay.caller_link. A panel showing only
transport+method reproduces the exact confusion we're fixing.
FIX: M1 computes the full EFFECTIVE path per lane and renders the caveats:
"iMessage = fallback only", "restricted to whitelist (N numbers)",
"relay disabled → Telnyx SMS", "auto-run OFF (Zillow lane idle)",
"trigger not armed". The readout, not the toggle, is the source of truth.

### S4 — MEDIUM: a non-empty whitelist silently restricts "ON"
individualTextEmAllEligible also gates on `textemall.individual_test_numbers`. If
non-empty, "SMS toggle ON" delivers via Text-Em-All ONLY to whitelisted numbers;
every other caller/text silently falls to iMessage — a partial no-op.
(Currently "" = not gating, so safe today.)
FIX: M7 "ON (direct API)" must CLEAR individual_test_numbers as part of its atomic
write (or the UI must show "restricted to N numbers" loudly). M3 guard rejects
ON+non-empty-whitelist unless explicitly "test mode".

### S5 — LOW: "iMessage" label is only true when sms_relay.enabled=true
When the relay is disabled, the non-Text-Em-All path uses Telnyx SMS, not iMessage
(caller-link.ts:57-72). (Currently enabled → label accurate.)
FIX: readout label derives from sms_relay.enabled ("Apple iMessage relay" vs
"Telnyx SMS"). Cosmetic, fold into M1.

### S6 — LOW: API broadcast_message is static vs survey_mode
The API path sends `textemall.broadcast_message` verbatim; the embedded link is
hand-set (currently a Google Form URL, matching survey_mode=google_form). If
survey_mode changes to a hosted link, the broadcast text won't follow.
FIX: M1 readout warns when survey_mode ≠ the link kind in broadcast_message.
Not blocking; note only.

### S7 — VERIFIED SOUND: no double-send on calls
call_start → call_end on one call can enqueue twice, but firedRecently (default
60-min cooldown, individual-relay.ts:83) + per-minute jobId dedupe collapse it to
exactly ONE delivery per call. M8 stands as written.

### Net revisions
- M0 (NEW, do FIRST): split broadcast_method into zillow./individual. keys with the
  legacy global as fallback; migrate services + the 3 API-mode tests. Everything
  else depends on this.
- M1: expand to the full 9-key effective-path resolver + caveat rendering (S3/S5/S6).
- M3: guard now also rejects api-while-transport=relay AND ON+non-empty-whitelist (S4).
- M7: atomic write also CLEARS individual_test_numbers, and posts /internal/config/refresh (S2/S4).
- M9: every write posts /internal/config/refresh; backfill that into today's live
  broadcast-method route immediately (S2).
- Live state confirmed safe to build against: whitelist empty, relay enabled,
  caller_link=every_call, survey_mode=google_form, all lanes currently api/textemall.

---

## STRESS TEST — PASS 2 (2026-08-29) — hammering the revised milestones

Focused on the NEW parts (M0 split, M1 resolver, M9 route). Six more issues.

### P1 — HIGH: split-brain between the existing sms-relay toggles and the new per-lane keys
The existing /admin/sms-relay page already has TWO live writers:
- broadcast-method route → writes the (soon-legacy) global `textemall.broadcast_method`.
- individual-channel route → writes `sms_relay.individual_channel`,
  `textemall.individual_trigger_armed`, `textemall.individual_test_numbers`.
After M0 splits broadcast_method into per-lane keys, the OLD broadcast-method
toggle keeps writing the legacy global while the NEW leads-page toggles write the
per-lane keys → two UIs, different keys, contradictory displays (old toggle shows
"form" while a lane is explicitly "api"). And the individual-channel route is a
SECOND writer of the individual lane the M7 toggle also owns.
FIX: M9 makes exactly ONE writer per lane. Convert BOTH existing routes into thin
wrappers over the new atomic /api/admin/delivery-method (individual lane maps
channel+armed+testNumbers; the legacy broadcast-method route writes BOTH lane keys,
not the global — or returns 410). Repoint the /admin/sms-relay page to the shared
<DeliveryMethodToggle> so all three pages read/write identical state. No dual
writers survive the change.

### P2 — HIGH: M1 resolver will DRIFT from the runtime (two sources of truth)
The runtime decision lives in THREE places: zillow-auto.ts (send_channel +
broadcast_method), individual-relay.ts `individualTextEmAllEligible`, and
caller-link.ts. A hand-written status resolver that re-encodes this WILL diverge as
the code evolves — and a wrong "effective path" readout is worse than none.
FIX: M1 REUSES the runtime predicates, never reimplements them. Export a single
pure `resolveZillowDelivery(cfg)` extracted from zillow-auto's decision, and reuse
the existing `individualTextEmAllEligible` (channel-level, phone omitted) for the
individual lane. The status endpoint and the runtime import the SAME functions.
This makes M0 also refactor zillow-auto to CALL the extracted helper (so the split
key has one decision site, not three).

### P3 — MEDIUM: arming asymmetry between the lanes
- Zillow API path returns BEFORE fireTextEmAllTrigger (zillow-auto.ts:303 vs 344),
  so `textemall.trigger_armed` gates ONLY the Zillow *form/Zapier* path. M6 "ON
  (direct API)" must NOT set or require trigger_armed.
- Individual API path REQUIRES `textemall.individual_trigger_armed` via the
  eligibility gate (individual-relay.ts:32) REGARDLESS of api/form. M7 "ON" MUST
  set it (already planned).
FIX: readout shows "not armed" as a blocker ONLY where it bites — the Zillow
form path and the entire individual lane — never for Zillow-api. Document that
individual arming is the individual-channel master-arm, not a Zapier concept.

### P4 — MEDIUM (REVISES S4): do NOT auto-clear the whitelist on "ON"
S4's fix (auto-clear individual_test_numbers when flipping ON) is itself a silent
surprise and defeats a live-gating SAFETY feature. Replace it: M7 does NOT touch
the whitelist. Instead M1's readout shows "restricted to N numbers" LOUDLY, and
the toggle offers a separate explicit "apply to ALL callers (clear test list)"
action. M3 guard WARNS on ON+non-empty-whitelist; it does not reject or auto-clear.

### P5 — LOW: the readout is channel-level; per-caller guards can't be shown
Even with the lane on API, a given caller may still get iMessage or nothing due to
per-phone guards (existing tenant, opt-out, cooldown, outstanding invite). These
are per-call and can't appear in a channel-level panel.
FIX: panel footnote — "per-caller: existing tenants, opt-outs, and the N-min
cooldown still apply."

### P6 — LOW: legacy key naming after the split
`individual_trigger_armed` (Zapier-era) now doubles as the individual-channel arm.
Optional post-M0 rename to `individual_channel_armed` with legacy fallback; skip if
it adds churn. Note only.

### Net revisions (supersede the pass-1 list where they conflict)
- M0: split broadcast_method into `zillow.`/`individual.` keys AND extract the
  Zillow decision into a pure helper (P2) with the legacy global as fallback;
  migrate the 3 API-mode tests to the per-lane keys + a legacy-fallback test.
- M1: reuse runtime predicates (P2); render per-lane caveats incl. arming-where-it-
  applies (P3), whitelist-restricted (P4), relay-disabled→Telnyx (S5),
  auto-off/Zillow-only, survey_mode/message mismatch (S6), and the per-caller
  footnote (P5).
- M3: WARN (not reject/clear) on ON+non-empty-whitelist (P4); still reject
  api-while-transport=relay at the write layer.
- M7: sets individual_channel=textemall + individual_trigger_armed=true +
  individual.broadcast_method=api atomically; does NOT touch the whitelist (P4);
  posts /internal/config/refresh (S2).
- M9: ONE writer per lane — convert the existing broadcast-method AND
  individual-channel routes into wrappers/410 over /api/admin/delivery-method (P1);
  every write posts /internal/config/refresh; backfill refresh into whatever
  remains live in the interim (S2).
- Order: M0 → M1 → M9 (unify writers + refresh) → M3 (guards) → M6/M7 (page
  toggles) → M8 (call-path lock).
