# Mid-Call Text Answers — Implementation Plan

**Goal:** During an AI application call, the applicant may answer any question either **verbally** or by **texting the Telnyx number in real time**. Both paths land in the same application record, and completion triggers the same owner forwarding (summary SMS + owner-page link to Mr. Joe) as the web survey.

**Why this works within current constraints:** mid-call texting is *inbound-only* SMS — the AI acknowledges texted answers *on the call*, never by SMS reply — so the 10DLC outbound block is irrelevant to this feature.

---

## Investigation findings (verified in code)

1. **Active-call registry** — `apps/server/src/lib/call-registry.ts` keeps `activeCalls: Map<streamSid, ActiveCall>`; each entry already carries `callerPhone`, `openaiWs`, `applicationId`, `propertyId`. Has `getCallByCallSid`; needs a `getCallByPhone(phone)` (linear scan is fine at ≤10 concurrent calls).
2. **Realtime injection** — `sendSystemEvent(ws, text)` in `openai-realtime.ts` already injects a conversation item + `response.create`. A sibling `sendUserText(ws, text)` (role `user`, `input_text`) is the natural carrier for a texted answer; the AI then processes it exactly like a spoken answer — including calling `save_application_field` itself, so **no parallel answer-saving path is needed** (single writer, no double-save races).
3. **Inbound SMS pipeline** — `telnyx-sms.ts` → `handleIncomingSms` → intake branch. The active-call branch must be checked **before** the intake branch (and before cooldown-relevant link logic), else a mid-call text mints a survey link.
4. **Completion path** — `call-handler.ts` `complete_application` → `completeApplication(applicationId, summary)`; nothing forwards to the owner today (only the web-survey POST calls `forwardSurveySummary`). Voice questions/keys already match the survey (same fieldKeys → same columns/customResponses), so `forwardSurveySummary` works unmodified for voice applications.
5. **Prompt** — `buildPrompt({ channel: "voice", ... })` builds the instructions; it needs a per-question note that the applicant can text answers to the same number they dialed.

---

## Milestones

### M1 — Registry lookup + user-text injection primitive
- `getCallByPhone(phone: string): ActiveCall | undefined` in call-registry (most recent call wins if somehow duplicated).
- `sendUserText(ws, text)` in openai-realtime: `conversation.item.create` `{type:"message", role:"user", content:[{type:"input_text", text}]}` + `response.create`.
- Unit tests: registry add/get/remove by phone; injection message shape (mock ws).

**Stress gate M1:** registry lookup after `removeCall` returns undefined (no stale injection into closed calls); two active calls from different phones resolve independently; `sendUserText` on a CLOSED ws is a silent no-op (readyState guard) — never throws into the SMS pipeline.

### M2 — SMS pipeline branch: texted answers reach the live call
In `handleIncomingSms`, immediately after the STOP/START/HELP handling and opt-out check, **before** the intake branch:
```
const liveCall = getCallByPhone(callerPhone);
if (liveCall && liveCall.propertyId === property.id && liveCall.openaiWs) {
  sendUserText(liveCall.openaiWs, `[The applicant texted this answer instead of speaking]: ${body}`);
  appendToCallTranscript(liveCall, { role: "user", content: `(texted) ${body}` });
  return { replies: [], shouldRespond: false };   // AI acknowledges on the call, no SMS reply
}
```
- Transcript entry marked `(texted)` so the call log shows which answers came via SMS.
- STOP still processed *before* this branch (compliance wins over convenience).
- **PII note:** mid-call answer texts are deliberately NOT persisted to `SmsConversation` (they may contain DOB); the call transcript field is their record, same as spoken answers — and `dateOfBirth` still ends up encrypted via `save_application_field` because the AI, not the SMS layer, does the saving.

**Stress gate M2 (automated, mocked ws + real DB):**
- Text with active call → injected, **no SurveyInvite minted, no relay link sent, no SmsConversation row**.
- Same text with NO active call → normal intake (link) — the branch cleanly disables itself post-call.
- Text arriving in the teardown race (call removed between webhook and handler) → falls through to intake, no crash.
- STOP texted mid-call → opt-out recorded + confirmation reply still returned (branch does not swallow compliance keywords).
- 1,600-char text → passes the length guard or is truncated before injection; injection content is single-line-sanitized (`sanitizeForSms`-style collapse) so a malicious text can't fake a system prompt inside the realtime conversation.
- Two texts in quick succession → both injected in order (per-phone serialization already guarantees ordering).

### M3 — The AI offers the texting option
- `buildPrompt` (voice channel): add instruction — after asking each question, briefly offer: "you can also text your answer to this number right now if that's easier — especially for spellings, emails, or numbers." Instruct the AI to acknowledge texted answers naturally ("Got your text — thanks!") and continue to the next question, and to prefer the texted version when a texted and spoken answer conflict (most recent wins).
- Guidance that the applicant must text **from the phone they're calling from** (that's the only correlation key).

**Stress gate M3:** loopback call (the number dials itself via the TeXML API — the reusable smoke test from the voice debugging session) → transcript shows the greeting now mentions the text option; existing prompt snapshot tests updated; full suite green.

### M4 — Completion forwards to Mr. Joe (same as survey)
- In `call-handler` `complete_application` (and in `handleCallEnd` if an application is completed-but-unforwarded): after `completeApplication` succeeds, fire-and-forget `forwardSurveySummary(applicationId)` — ledger-backed, so failures retry via the sweep; `forwardedAt` stamps only on confirmed send. Summary format and owner-page link are shared code — zero divergence from the web-survey flow, and voice applications appear on Joe's page automatically (same `channel`-agnostic query? — verify: owner page filters `channel='sms_link'`; **widen to `channel IN ('sms_link','voice')`** and same for the dashboard Survey Responses tab filter, else voice apps are invisible there — this is the one true schema-level divergence found).
- Guard: `forwardedAt` null-check before sending so double `complete_application` tool calls can't double-text Joe.

**Stress gate M4:** unit: completion triggers exactly one forward per application (double-call test); forward failure leaves `forwardedAt` null and a retryable ledger row. Integration: loopback call where the "caller" is silent — manually drive the OpenAI session via a scripted `sendUserText` sequence answering all 11 questions, assert: Application row completed with all 11 fields (DOB encrypted), exactly one `forward` ledger row to +17735621795, owner page shows the voice application.

### M5 — Live human gate (the only one needing a phone)
1. Call (708) 907-0695, answer a few questions verbally.
2. Mid-call, text an answer (e.g., email — the classic hard-to-dictate field) to the same number; the AI should acknowledge it on the call within ~2s and move on.
3. Finish the application; hang up.
4. Verify: Joe's phone gets the standard summary + link; the owner page and Survey Responses tab show the application with mixed-channel answers; call transcript marks the texted answers `(texted)`.

**Stress additions at M5:** text an answer *after* hanging up (should get the survey link via normal intake, not a ghost injection); call while a second phone texts the number simultaneously (unrelated texter still gets the intake link — no cross-talk).

---

## Risks / edge cases carried into the design
- **Different-phone texting:** unsolvable without a pairing code; the AI's script explicitly says "from the phone you're calling from." Out of scope otherwise.
- **Opt-out interplay:** a caller who texted STOP earlier is opted out of *relay sends*, but inbound mid-call texts still inject (inbound processing isn't opt-out-gated; only outbound sends are). Correct per TCPA — opt-out governs what we send.
- **Realtime session reconnects:** `reconnectOpenAI` swaps `openaiWs` on the registry entry; the injection path reads `liveCall.openaiWs` at send time, so it always targets the current socket. Covered by an M2 test.
- **Injected-text prompt injection:** the bracket-prefixed, whitespace-collapsed injection format plus the AI's existing tool-only write path bounds the blast radius of a malicious text to "weird answer values" — same exposure as speech.
