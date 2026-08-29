# Plan (rev.2, stress-tested): fix the "text → Text-Em-All" individual relay

Date: 2026-08-29. Repo `~/tenant-ai`, `main` @ `2199898`. Running server pid 44118, built+restarted 2026-08-28 15:50 — dist DOES contain Option B + owner-check; the bugs below are in the shipped code, not a stale build.

rev.2 = rev.1 stress-tested against live Text-Em-All (read-only probes + two reversible contact edits, everything restored) and against the Zillow path it shares code with. Section "Stress test of rev.1" lists what broke in the plan itself and what changed.

## Symptom (owner)
"When I text the Telnyx number only 7084158984 (my phone / the relay) replies, not Text-Em-All — and I toggled to the Text-Em-All path."

## What actually happened
| time (CDT, 08-28) | from | server | Text-Em-All |
|---|---|---|---|
| 15:34:55 | +17084158984 | fire (ledger) | no broadcast (Zap not live yet; a manual "Individual Messaged" test exists at 11:44) |
| 15:51:07 | +13129752365 | `→ textemall` | broadcast 35949453 "Individual Messaged" **n=1** |
| 16:32–16:35 ×4 | +13129752365 | `skipped (cooldown)` | none — relay AI reply from 7084158984 (link only because the model repeated it from history) |
| 16:48:07 | +13129782766 | `→ textemall` | broadcast 35950007 **n=1** |
| 16:49:45 | +13129782766 | cooldown → relay AI reply **with no link** | none |
| 17:11:47 | +13129782782 | `→ textemall` | broadcast 35950243 **n=1**; group 1273 = caller only |

The toggle routes a number's **first** text to Text-Em-All. Everything after that is broken by the findings below.

## Findings

### 🔴 F1 — TEA rejects a phone that is already a *member of any list*; the script ignores the failure
`textemall-api.ts buildJs()` never checks the `POST /proxy/contacts` status. Live: POST 7084158984 → **422 `Person already exists.`** (it is PersonID 141492347 in Zillow group 1271). Rule pinned down: a list-less duplicate does NOT block (POST 3129752365 → 200 while a list-less person 141447069 existed; 3129782782 was added beside list-less 133062238). So it hits exactly: the owner (always in 1271), every Zillow lead in 1271, and the *last texter* still sitting in 1273.
Consequence: owner copy never sent (every broadcast n=1); a caller who is a Zillow lead → **empty group → broadcast to nobody**, logged as success, ledger row + 60-min cooldown → caller gets nothing.

### 🔴 F2 — No verification that the group == intended set
`runIndividualRelay` accepts `edit.status==="ok"` and never compares `edit.phones` with `phones`. Same in `zillow-auto.ts` (no `count` check).

### 🔴 F3 — "Clear" deletes the **person**, cross-contaminating the other path
`buildJs()` clears with `DELETE /proxy/contacts/<PersonID>` — global. Zillow's 3×/day upload does the same to group 1271, which contains the owner and the leads. Once F1 is fixed (owner in 1273), Zillow's next clear deletes the owner person → owner silently vanishes from 1273 (and vice-versa for a lead who texted in). Verified primitives:
- add existing person to a list: `PUT /proxy/contacts/<pid>` body = person with `Lists ∪ [group]` → 200 (other lists untouched)
- remove from one list: same PUT with the list filtered out (`DELETE /proxy/lists/<id>/contacts/<pid>` → 405)
- lookup by phone: `GET /proxy/contacts?q=<10 digits>` (the `search`/`filter`/`phone` params are ignored → all 778). Two persons can share a phone; list items already carry `Lists` + `Deleted`.

### 🔴 F4 — Cooldown black-holes the link on repeat texts (the owner's actual symptom)
Job: `firedRecently → {via:"skipped", reason:"cooldown"}`, not relay. But `intake-qa.ts:94-102` already dropped the "Apply here:" nudge because the enqueue succeeded. Person gets an answer, no link, no TEA text. Contradicts R1 and the owner rule "anyone who texts re-receives the link". Default cooldown 60 min (`individual_cooldown_min` unset).

### 🟠 F5 — A failed Google Form POST counts as fired; the claim is taken before the POST
`fireIndividualTrigger` returns `fired:true` for any HTTP status (a 400 already happened once on the Zillow form). No relay fallback, ledger row kept, cooldown started.

### 🟠 F6 — The "shared monthly cap" is not shared (NEW in rev.2)
Zillow counts `TextEmAllBatch{status:"sent"}` (7 in Aug); the individual path counts `TextEmAllFire` (4 in Aug, all individual — zero Zillow rows). Each path can spend up to `monthly_fire_cap` (default 96) → up to ~192 Zapier tasks on a 100-task free tier. When Zapier stops the Zaps, the Google Form POST still returns 200 → job logs success → **nobody gets a link and nothing tells us**.

### 🟠 F7 — Nothing confirms a broadcast actually happened (NEW)
Dead Zap, exhausted Zapier budget, renamed form field, TEA login wall on the Zap side — all look identical to success today. Verified read-only TEA endpoints that can close this: `GET /proxy/broadcasts?q=Individual%20Messaged&pageSize=5` (lists the individual broadcasts, newest first for this name) and `GET /proxy/broadcasts/<id>/details` → `Items[].PhoneNumber`, `LastCallTime`. Broadcast name is set by the Zap ("Individual Messaged") → must be config, not a literal.

### 🟡 F8 — Whitelist empty → live for every inbound number, and the UI doesn't say so
`individual_test_numbers=""`, armed, channel=textemall. Intended, but with F1/F6 real prospects are silently dropped today.

### 🟡 F9 — Q&A reply gives no hint the link is coming separately (Option B strips silently).

### ℹ️ F10 — `jobId=ind:<phone>:<minute>` dedupes same-minute texts (16:34:41 → no job). Expected.

## Stress test of rev.1 — what broke in the plan and the fixes
- **S1 rev.1 M1 said "DELETE the person only if created by this run".** We don't track that across runs and the owner's shared account keeps 700+ list-less contacts on purpose. → Rule is now membership-based: after removing this group, `Lists == ∅` → DELETE (nobody can reach them by broadcast anyway), else PUT-remove. No orphan accumulation, no cross-list damage. Applies to BOTH paths because `buildJs` is shared.
- **S2 rev.1 assumed the cap was shared.** It isn't (F6). → M2 makes Zillow claim through `claimFire("zillow")` too and the individual path counts *both* tables until the ledger has a full month; M4 shows the combined number; D1 asks the owner about the Zapier tier.
- **S3 rev.1 "release the claim on non-fire" is wrong on timeout.** A 15 s timeout can mean Google accepted the POST → Zap fires → broadcast goes out; releasing + relaying would double-send *and* under-count Zapier. → Definite non-2xx: release + relay. Timeout/network error: keep the claim, relay anyway (the person must get a link; one possible duplicate is the accepted cost — owner rule), log `fire=timeout`.
- **S4 rev.1 relay-fallback-on-cooldown + enqueue-time gate can double-deliver** when two texts arrive in different minutes before the first job fires: job 1 fires TEA, job 2 hits cooldown → relay link. → Accepted (owner: "anyone who texts re-receives the link"); it's ≤ 1 extra relay text and never an extra Zapier task. Documented in M2 tests.
- **S5 rev.1 had no end-to-end confirmation** — the class of failure that hurt most (Zap down / budget gone) stayed invisible. → M2b adds post-fire verification via F7 endpoints inside the settle window; miss → relay fallback, claim kept (the task may still have been consumed).
- **S6 rev.1 held the GUI lock only for the group edit.** The settle window (30 s) is when the Zap reads the group; Zillow's `setGroupViaApi` at 10:00/16:00/22:00 could clear the owner person mid-window (F3). → With S1 the clear can no longer touch other lists, and M2 keeps the lock through fire + verify anyway (≤ ~2 min, concurrency already 1).
- **S7 rev.1's fake-TEA unit tests can't execute `buildJs()`** — it is a JS string run inside Safari. → M0 adds a tiny harness: `vm.runInNewContext(buildJs(...), { XMLHttpRequest: FakeXHR })` with an in-memory TEA (persons, lists, 422-on-list-member, `q=` lookup, PUT semantics). Same harness covers the Zillow path for free.
- **S8 rev.1 M6(d) "point the endpoint at a 404 URL" in production** — a config write in prod that could be forgotten. → Replaced by the M0 unit test + the M2b verification test; the live gate keeps only real-number checks.
- **S9 DNC / untextable contacts.** A person with `GlobalDoNotCallPrimaryPhone`/`PrimaryPhoneTextable:false` is silently skipped by TEA. → M1 returns those flags; M2 treats a DNC/untextable caller as "group mismatch" → relay (our own STOP list still wins and delivers nothing).
- **S10 Zillow suffers F1 too:** the last texter (member of 1273) who is also a new Zillow lead → 422 → missing from the blast. → M1 (PUT-add on 422) fixes both paths at once; M2 adds the count check to `zillow-auto.ts`.

## Milestones (each ends with a gate; NO live send before M6)

### M0 — Harness + failing tests that pin every finding (no fixes)
- `src/__tests__/textemall-api.test.ts` (new): `vm` harness running the real `buildJs()` output against `FakeTea` (persons/lists; POST → 422 when the phone is a member of any list; `GET /proxy/contacts?q=`; `PUT /proxy/contacts/<id>` replaces `Lists`; `DELETE` removes the person; list items expose `Lists`/`Deleted`/DNC flags).
- Red tests: owner-in-other-list → group missing owner (F1); clear deletes a person who is also in 1271 (F3); `runIndividualRelay` with `edit.phones ≠ expected` → `textemall` (F2); cooldown → `skipped` (F4); fire status 400 → `textemall` (F5); intake-qa eligible+cooldown → no link, job enqueued (F4).
- **Gate:** new tests red for the stated reason; existing suite (76 relay + all) green.

### M1 — `setGroupViaApi` that survives existing contacts (F1, F3, S1, S9, S10)
- Per phone: POST; on 422 → `q=` lookup → pick `Deleted:false` (prefer one already in the group, then one in any list) → PUT with `Lists ∪ [group]`.
- Clear: for each member, `Lists \ [group]` empty → DELETE, else PUT-remove.
- Result: `{status:"ok"|"partial"|"needs_login"|"failed", count, phones, members:[{phone, personId, textable, dnc}], failed:[{phone, status, message}]}`.
- **Gate:** harness tests green for: new phone; phone in 1271 only; list-less duplicate; two persons sharing a phone; login wall; partial (one phone fails); clear never removes anybody from another list; Zillow call site unchanged in behavior for the all-new-phones case. Live read-only probe of 1273 + 1271 after a dry `setGroup` against the harness only (no TEA write in this milestone).

### M2 — Job truth table hardened (F2, F4, F5, F6, S3, S4, S6)
- Require `status==="ok"` AND `set(members.phone)==set(expected)` AND every member `textable && !dnc` → else `doRelay("group mismatch: …")`.
- `fireIndividualTrigger`: `fired` only for 2xx; non-2xx → `{fired:false, reason:"http_<status>"}`; timeout/network → `{fired:false, reason:"timeout"}`.
- Ledger: `releaseFire(id)` on definite non-2xx; keep on timeout. Zillow: `claimFire("zillow", {ref: slot})` before its POST (replaces the batch count); until the ledger has a full month, `claimFire` counts `max(ledger, batches-sent)` for the month.
- Cooldown in the job → `doRelay("cooldown")`.
- Hold `withGuiLock` through edit → fire → verify (M2b).
- Log: `[individual-relay] <phone> → <via> group=[…] expected=[…] fire=<status> verify=<result> claim=<n>/<cap>`.
- **Gate:** truth table (12 rows) green; fuzz 300 random combos (edit outcome × member flags × fire status × cooldown × opt-out) → invariant *delivered ≥1 and ≤2 times, via TEA at most once, unless opted out (then 0)*.

### M2b — Post-fire verification (F7, S5)
- After a 2xx fire, poll every 10 s up to `individual_verify_sec` (default 90): `GET /proxy/broadcasts?q=<individual_broadcast_name>&pageSize=5` → newest with `CreatedDate ≥ fireAt-60s` → `/details` contains the caller's 10 digits → `via:"textemall"`. Timeout → `doRelay("broadcast not observed")`, claim kept, warn-level log (this is the "Zap is dead / Zapier budget gone" alarm).
- Config: `textemall.individual_broadcast_name` (default "Individual Messaged"), `individual_verify_sec`.
- **Gate:** harness broadcast fixtures: observed / observed-but-wrong-phone / never-observed / TEA login wall during verify → correct outcome each; no double fire.

### M3 — Enqueue-time gate + honest reply copy (F4, F9)
- `individualTextEmAllEligible` also returns false when `firedRecently(phone)` or opted out → relay reply keeps its link byte-identically, no job.
- When eligible, the Q&A reply gets "We're texting you the application link separately." (inside the existing `reserved` SMS budget).
- **Gate:** intake-qa + survey-intake + caller-link tests: ineligible → link present / no job; eligible → suffix + job; call path unchanged.

### M4 — Dashboard truthfulness (F6, F8)
- `/admin/sms-relay` individual panel: channel, armed, **"Whitelist empty → LIVE for all numbers"** banner, combined fires this month `n/cap` (Zillow + individual), last 10 individual outcomes (`textemall` / `relay-fallback` + reason / verify result), cooldown minutes.
- **Gate:** route test; screenshot; no behavior change.

### M5 — Stress pass (mocked, no live send)
One test each: two texters in different minutes (serialized, both broadcast); same texter within cooldown (one relay link, no fire); caller already in 1271 (group = caller + owner, 1271 unchanged); owner texting in (group = owner only, n=1); TEA login wall mid-run; Google 400; Google timeout (relay + claim kept); broadcast never observed (relay + claim kept); cap hit (relay); STOP between enqueue and run (nothing); Zillow `setGroupViaApi` queued behind an individual run (lock; neither group cross-contaminated; owner still in both); month rollover; whitelist set → non-listed number → relay.
- **Gate:** `npx vitest run apps/server` green; `npx turbo build --force` green.

### M6 — Deploy + live gate (owner present, owned numbers only)
1. Build; `find apps/server/src -newer apps/server/dist/index.js -type f` must be empty (no foreign uncommitted work — the 08-28 hazard).
2. Restart via launchd only: `kill -TERM $(cat ~/tenant-ai/.launcher.pid)` → wait for :3000/:3002/:3005 to free → `launchctl kickstart gui/$(id -u)/com.tenantai.launcher`. Avoid 09:30–09:40 and the first 5 min of 10:00/16:00/22:00.
3. Interim safety for the window between now and this step: set `textemall.individual_test_numbers` to the owned numbers (`node --import tsx src/scripts/set-config.ts textemall individual_test_numbers "+13129752365,+13129782766,+13129782782"`) so real prospects take the relay until M6 passes; clear it at step 5.
4. Live checks: (a) fresh owned number → TEA "Individual Messaged" **n=2** (caller + 7084158984), owner receives the copy, log shows `verify=observed`, group 1271 unchanged; (b) same number within 60 min → link via relay from 7084158984 (`kind: caller`), no fire; (c) text from 7084158984 → n=1, no duplicate person; (d) wait for the next Zillow slot → 1271 rebuilt, owner still a member of 1273's last set (or absent only because the last individual run re-pointed it).
5. Clear the whitelist (`""`). Rollback at any point: dashboard toggle `channel=relay`.

### M7 (optional) — Remove the per-call group re-pointing entirely
If the Zap can read the phone from the form response and message it directly (instead of "message the group"), F1/F3/S6 disappear structurally and the throughput ceiling goes away. Owner decision; not required for M0–M6.

## Decisions needed from the owner
- **D1 Zapier budget.** Zillow alone runs ~3–4 broadcasts/day (≈100/month); adding every texter/caller exceeds the free tier within days. Options: paid Zapier tier; or reserve (e.g. Zillow ≤ 60, individual ≤ 36) enforced by `claimFire` per path. Until decided, M2's combined cap simply falls back to relay when reached — visible in M4.
- **D2 Duplicate tolerance.** rev.2 accepts ≤ 1 extra *relay* text on timeout/race in exchange for never black-holing a link. Confirm.
- **D3 Interim whitelist** (M6 step 3) now vs. leaving it live for all numbers while M0–M5 are built. Recommended: whitelist now.

## Not changing
Relay guards/caps (`relay-guards.ts`), Q&A model behavior, survey-mode toggle, Google Forms, Zapier (the instant Zap works — three real broadcasts prove it), Zillow scheduling.
