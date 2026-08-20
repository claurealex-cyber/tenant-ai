# Voice Answer Patience — Implementation Plan

**Goal:** On an application call, the AI must **listen until the caller has actually finished answering** the question it asked — no more cutting in after a half-second pause while someone reads an SSN off a card, spells an email, or thinks about a move-in date. A **parallel judge API call** reviews the answer-so-far against *what the AI actually just said* and returns *satisfactory* vs *keep waiting*; the AI only speaks when the answer is judged complete (or a safety net fires).

**Scope:** voice answers only. **Texted answers bypass the judge entirely and move on immediately** — an SMS answer is exact text, there is nothing to wait for.

**Two non-negotiable invariants.** Everything in this plan is subordinate to these:

1. **The AI must never go mute.** Once `create_response: false` ships, *our code is the only source of AI speech*. There is no VAD auto-create to rescue a dropped, discarded, or timed-out trigger. Therefore: **no code path may terminate without either firing a response or arming a timer that will.** Every `return` in the turn machine is audited against this rule (§3.8).
2. **Silence is more expensive than an early interruption.** On a phone call, >2 s of unfilled silence reads as a dropped call. A false `MORE` that costs the caller 8 s of dead air is *worse* than the half-second cut-in this feature exists to fix. All hold budgets are sized from that asymmetry.

**Hard budget:** ≤1.5 s p95 from caller-stops-speaking → first AI audio byte on turns that are *not* application answers. On gated answer turns the target is **derived, not wished** — see the term-by-term budget in §3.9, which M0 fills in and which can veto the judge entirely.

---

## 1. Architecture decision

### The layered answer

Turn-taking has **three separate questions** that today are conflated into one 500 ms silence timer:

| Question | Who should answer it | Mechanism |
|---|---|---|
| "Has the caller stopped making sound?" | OpenAI's VAD | `semantic_vad`, per-question `eagerness` |
| "Has the caller finished *the thing the AI just asked for*?" | Us | prefilters + a `gpt-4o-mini` judge, scoped to gated turns |
| "Should the AI speak now?" | Us | server-owned `response.create` (`create_response: false`) |

**Decision: layered A + scoped B.**

- **Layer 0 — config (free, ships alone, fixes ~90% of the complaint).**
  `turn_detection: { type: "semantic_vad", eagerness: <per-question>, create_response: false, interrupt_response: true }`.
  `semantic_vad` is a model-based end-of-turn detector: it already knows "my monthly income is…" is unfinished and "Yes, that's right" is done, at **zero added hops** (it runs inside OpenAI's own pipeline). Untuned `server_vad` — what we ship today — ends the turn on a fixed 500 ms of silence, which *is* the root cause.
  **`eagerness` is per-question, not per-property** (§3.7). A single global knob cannot be both patient for an SSN recitation and snappy for "two bedrooms"; shipping one would guarantee the tuning oscillation described in §3.9.
  **Fallback rung** if the configured realtime model rejects `semantic_vad`: `server_vad` with `silence_duration_ms: 1200`. One line, preserves the rest of the design unchanged.

- **Layer 1 — we own the trigger.** `create_response: false` means OpenAI still segments turns and commits the caller's audio (`input_audio_buffer.speech_stopped` / `.committed` still fire) but **never speaks on its own**. This is the linchpin: it turns the judge from a *retraction* into a *gate*. Without it, the judge can only cancel a response the caller has already started hearing — the AI stutters and takes back a half-spoken sentence, which is perceptually worse than the problem being solved. It also fixes a pre-existing race: five call sites fire `response.create` today with nothing coordinating them.
  **The cost of layer 1 is invariant 1.** Turning off the server's auto-create removes the only safety net the system has today. §3.8 (response-liveness) is therefore a *prerequisite deliverable of the same milestone*, not a later hardening pass.

- **Layer 2 — the judge, scoped to gated turns.** On `input_audio_buffer.committed`:
  - **Turn is not gated** (no application in progress, no pending question, or the AI's last utterance was not a question — see §3.4 turn-intent classification) → `response.create` immediately, **no judge, no transcript wait, zero added latency**. Chit-chat, confirmations, and property Q&A stay snappy.
  - **Turn is gated** → prefilters first (free), then the LLM judge on the answer-so-far. `COMPLETE` → speak. `MORE` → **send nothing now**, but a live watchdog guarantees speech within ~2.5 s regardless; the caller's continued speech appends into the accumulator so the next judge sees the concatenated fragments as one growing answer.

- **Layer 3 — deterministic prefilters (free, 0 ms, 0¢) — *positive evidence only*.** This is the single most important correction to the original design. `FIELD_VALIDATORS` in `handlers/application-builder.ts` and the parsers in `packages/shared/src/validators.ts` encode **domain plausibility, not utterance completeness**. `parseIncome` rejects any value < 100 ("that seems low for monthly income"); `parseMoveInDate` rejects any past date; `validateEmail` is an anchored `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` that a spoken email ("john dot smith at gmail dot com") can *never* satisfy. Treating "validator said invalid" as "the caller is mid-sentence" is a category error that produces guaranteed dead air on ordinary answers.
  **Therefore: a validator may only ever return `COMPLETE` (clean parse) or `null` (defer). It may never return `MORE`.** `MORE` is emitted only from *explicit truncation signals on the utterance tail* (§3.3).

### Explicitly rejected

- **Judge-with-cancel on `server_vad`** (the naive reading of the requirement): with `whisper-1`, `...transcription.completed` lands 300–800 ms *after* `response.created`, so the verdict always arrives mid-utterance. Cancelling then requires `response.cancel` + `conversation.item.truncate` + a carrier `clear` frame, and it is unverified whether Telnyx TeXML `bidirectionalMode="rtp"` honours `clear` at all. Retraction-based patience is user-hostile.
- **Full manual turn control** (`turn_detection: null`, our own RMS silence gate): strictly worse latency, and its failure mode is a permanently silent call. Note that `create_response: false` *inherits a weakened form of that same failure mode*, which is why §3.8 exists.
- **A single global patience knob.** Superseded by per-question `eagerness` (§3.7).

---

## 2. Current state (verified in code)

**What exists**
- `apps/server/src/services/openai-realtime.ts` — single `session.update` at socket open (line ~43), `turn_detection: { type: "server_vad" }` with **no parameters** (line 54), `transcription: { model: "whisper-1" }` (line 55). Senders: `sendFunctionResult`, `sendSystemEvent`, `sendUserText`, `sendAudioToOpenAI`. Lines 91–97 push a `role:"user"` `TranscriptEntry` via `callbacks.onTranscript` on every `conversation.item.input_audio_transcription.completed`.
- `apps/server/src/handlers/call-handler.ts` — `handleMediaStream` bridges the carrier WS ↔ OpenAI WS; `setupOpenAI()` (~314) and `reconnectOpenAI()` (~569) each contain a **near-verbatim duplicate** of the callbacks object. `redactTranscriptPII` (lines 55–64) matches only `/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/` and `/\b\d{9}\b/`.
- `apps/server/src/handlers/application-builder.ts:38` — `FIELD_VALIDATORS` keyed by **fieldKey only** (`ssn`, `email`, `employerPhone`, `dateOfBirth`, `moveInDate`, `monthlyIncome`); dispatched at line 63.
- `packages/shared/src/constants.ts` — the 11 default questions. Note `bedrooms_needed` (`type:"number"`, sortOrder 5), `household_size` (`type:"number"`, sortOrder 6) and `employment_start_date` (`type:"date"`, sortOrder 8) live in `customResponses` and have **no** `FIELD_VALIDATORS` entry.
- `packages/shared/src/prompts.ts:233–266` — the **mandatory spell-back-and-confirm loop**: "you MUST spell it out completely to confirm before saving" and "Do NOT call `save_application_field` until the caller confirms the value is correct." This makes the real per-field turn sequence **answer → AI reads back → caller confirms → save**, i.e. *at least two* caller turns per field. The original plan did not account for it; see §3.4.
- `apps/server/src/lib/call-registry.ts` — `ActiveCall` carries `questions: QuestionDefinition[]` (sorted, in memory) and `answerValidation`.
- `apps/server/src/services/ai-field-validator.ts` — SMS-era save-time validator: `resolveConfig("ai_validation","api_key") || resolveConfig("openai","api_key")`, model default `gpt-4o-mini`, JSON mode, `temperature: 0`, `AbortSignal.timeout(3_000)`, fail-open on every error path.
- `apps/server/src/handlers/sms-handler.ts:163-186` — mid-call text → `sendUserText(ws, "[The applicant texted this answer instead of speaking]: …")` + `(texted)` transcript entry.

**What is consumed from the realtime stream — the entire switch is 5 cases**
`response.output_audio.delta` (+legacy alias), `response.output_audio_transcript.done` (+legacy), `conversation.item.input_audio_transcription.completed`, `response.function_call_arguments.done`, `error`. **No `default:` branch, no logging of unmatched events.**

**What is missing**
- No `input_audio_buffer.speech_started/stopped/committed` → **zero turn-boundary awareness**, and no `item_id` correlation for anything.
- No `conversation.item.input_audio_transcription.delta` → **no "answer so far" exists today**; and `whisper-1` is a batch model that never emits deltas regardless.
- No `conversation.item.input_audio_transcription.failed` → a failed transcription is invisible.
- No `response.created` / `response.done` → **no in-flight-response tracking**; five uncoordinated `response.create` sites (open/greeting, `sendFunctionResult`, `sendSystemEvent`, `sendUserText`, VAD's own auto-create).
- No `session.updated` echo consumed → a rejected `turn_detection` block would surface only as a generic `error` that is `console.error`'d, and every call would silently run on defaults.
- No `response.cancel`, no `conversation.item.truncate`, no carrier `clear`/`mark` handling → **barge-in is broken today**: OpenAI stops generating when the caller interrupts, but audio already pushed to the carrier keeps playing at the caller's ear.
- No current-question pointer, no filled-key set on `ActiveCall`.
- `ActiveCall` does not know the carrier vendor (`clear` frame shape differs: Telnyx `{"event":"clear"}`, Twilio `{"event":"clear","streamSid":…}`).

**Latency debt already on this path**
- When `Property.answerValidation` is on, `saveApplicationField` **awaits** `validateFieldWithAI` with a 3 s timeout *inside the tool round trip* — up to 3 s of dead air after every saved field, already 2× the stated budget before any judge exists.
- `resolveConfig` has a 60 s cache; on a 15-minute call that is ~15 DB reads + decrypts, and a naive judge would put them on the critical path.
- `reconnectOpenAI` `await`s `getFilledFields` + `resolveConfig` **before** the new socket opens; during that window every inbound media frame is silently dropped by `sendAudioToOpenAI`'s `readyState` guard.

**Prompt rules that currently lie**
`prompts.ts:227` ("Wait up to 10 seconds for the caller to respond…") and `:263` ("Wait up to 10 seconds for their confirmation…"). The model has no timer and does not control response creation — the VAD does, 500 ms after speech stops. These lines are inert fiction today; M6 makes the waiting real *in the transport* and rewrites the prompt to describe behaviour the model actually controls.

**Reusability of `ai-field-validator`: plumbing yes, semantics no.** Reuse the key/model resolution chain, the `fetch` skeleton (JSON mode, `temperature: 0`, `AbortSignal.timeout`), and the fail-open discipline. Do **not** reuse: its binary `{valid, reason}` shape (wrong axis); its 3 s timeout; its "be LENIENT" prompt (written for an already-extracted final value, not raw mid-sentence ASR); its `PROGRAMMATIC_FIELDS` skip list; or its fail-open polarity. **Verdict: sibling service, shared transport helper.**

---

## 3. Detailed design

### 3.1 Session config and the response chokepoint

```ts
// openai-realtime.ts — OpenAISessionConfig gains turnDetection + transcriptionModel
audio: {
  input: {
    format: { type: "audio/pcmu" },
    turn_detection: config.turnDetection,
    transcription: { model: config.transcriptionModel },  // "gpt-4o-mini-transcribe"
  },
  ...
}
```

```ts
// default (Property.voicePatience default is "auto", NOT "low" — see §3.7)
{ type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: true }
// fallback if semantic_vad is rejected by the configured model (M0 spike decides)
{ type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 1200,
  create_response: false, interrupt_response: true }
```

**`requestResponse(call, opts)` — the single `response.create` chokepoint. It QUEUES, it never drops.**

```ts
type ResponsePriority = "turn" | "system";
interface ResponseRequest { priority: ResponsePriority; reason: string; }

function requestResponse(call: ActiveCall, opts: ResponseRequest) {
  call.awaitingCallerTimer = clearAndNull(call.awaitingCallerTimer);   // invariant 1
  if (call.responseInFlight) {
    // last-write-wins for "turn"; "system" always survives a "turn" already queued
    if (opts.priority === "system" || call.pendingResponseRequest?.priority !== "system") {
      call.pendingResponseRequest = opts;
    }
    return;                       // flushed in the response.done handler
  }
  call.responseInFlight = true;
  send(call.openaiWs, { type: "response.create" });   // NO per-response `instructions` — see below
}
```

**Why queueing, not dropping.** Two of the five existing `response.create` sites are not turn triggers and must never be lost:
- `sendFunctionResult` (openai-realtime.ts ~158) fires after every save. `onFunctionCall` is async and awaits Prisma writes (plus up to 3 s of `validateFieldWithAI`), so whether the tool-call response's `response.done` has landed is a pure race. Dropping the create leaves a `function_call_output` sitting in the conversation with nothing to generate a reply — **the AI never speaks again after saving a field.**
- `sendSystemEvent` from the 30 s monitor's `shouldWrapUp` branch fires on a wall clock with no regard for whether the AI is mid-utterance. Dropping it loses the wrap-up warning and the call gets hard-closed at `maxCallMinutes` with no notice to the caller.

**Flag hygiene (all three are mandatory, all are invariant-1 failures if missed):** `responseInFlight = false` and `pendingResponseRequest = null` are reset (a) in the `response.done` handler, then the queued request is flushed; (b) at the **top of `reconnectOpenAI`** and in the socket `close` handler — a reconnect mid-response otherwise leaves the flag `true` on a brand-new socket that will never emit `response.done`, and the 45-minute proactive reconnect *guarantees* this path runs; (c) on any `error` event whose code is `conversation_already_has_active_response` or `response_cancel_not_active`.

**No per-response `instructions`, ever.** In the Realtime API `response.instructions` **overrides** the session instructions rather than appending to them, so a nudge fired as `requestResponse(call, { instructions: "..." })` would run that turn with a two-sentence prompt: no persona, no property context, no AI disclosure, and none of the "you MUST call `save_application_field`" / "spell answers back" / "ask ONE question at a time" rules. The nudge turn would sound like a different assistant and might not save. **Single mechanism, chosen once here and used everywhere: nudges and probes are injected as a quiet system conversation item via `sendSystemEventQuiet`, followed by a plain `requestResponse(call)` with no override.** A unit assertion enforces it: **no `response.create` frame emitted anywhere in the codebase may carry an `instructions` field.**

Other new exported helpers in `openai-realtime.ts`:
- `sendSystemEventQuiet(ws, text)` — injects a system conversation item **without** firing `response.create` (the existing `sendSystemEvent` always auto-creates, which would make the AI talk on a *hold* verdict).
- `updateSessionAudioInput(ws, patch)` — partial mid-call `session.update`, used for per-question `eagerness` (§3.7).
- `clearInputAudioBuffer(ws)` — `{ type: "input_audio_buffer.clear" }`, used by the texted-answer path (§3.6).
- `connectToOpenAI(..., { greetOnOpen })` — see §3.5.

### 3.2 Judge service — `apps/server/src/services/voice-answer-judge.ts`

Shared transport extracted from `ai-field-validator` into `services/judge-transport.ts`:
`callJudgeModel({ apiKey, model, system, user, maxTokens, timeoutMs, signal }) → string | null`.

| Aspect | Value | Why |
|---|---|---|
| Model | `resolveConfig("ai_validation","model","gpt-4o-mini")` | integration already exists |
| Key | `resolveConfig("ai_validation","api_key") \|\| resolveConfig("openai","api_key")` | same chain as the SMS validator |
| **Resolution timing** | **resolved ONCE at call setup**, stashed on `ActiveCall.judgeApiKey` / `.judgeModel`; re-resolved on reconnect | keeps `resolveConfig`'s DB-read-on-cache-miss off the per-turn critical path |
| Output format | **plain text single token**, `max_tokens: 6`, `temperature: 0` | output tokens are the latency term |
| Verdict | `COMPLETE` / `MORE` / `PROBE` | `MORE` = stay silent (watchdog still armed); `PROBE` = speak, ask for the missing piece |
| **Timeout** | **`AbortSignal.timeout(400)`** (env-overridable `VOICE_JUDGE_TIMEOUT_MS`) | **cut from 700 ms.** The judge is *additive* to the critical path (§3.9), and `gpt-4o-mini` chat-completions TTFT p95 under load routinely exceeds 700 ms. Every abort costs its full timeout **and** fails open — maximum latency, zero patience. 400 ms keeps a stalled judge cheaper than a human turn gap |
| **Fail-open** | **every** error path → `COMPLETE` | inverted polarity vs the SMS validator. A judge that fails closed produces a **mute AI** |
| **Degradation** | after **3 consecutive** timeouts/errors, set `call.judgeDisabled = true`, log `[turn-gate] judge-degraded`, and run the rest of the call at M3 behaviour | a silently failing-open judge is a no-op that still costs 400 ms/turn; auto-disable makes it free |

**Verdict type**
```ts
export type AnswerVerdict = "COMPLETE" | "MORE" | "PROBE";
export interface JudgeResult {
  verdict: AnswerVerdict;
  source: "intent" | "affirmation" | "backchannel" | "prefilter" | "validator"
        | "llm" | "cap" | "failopen" | "disabled";
  latencyMs: number;
  itemId: string;
  answerEpoch: number;
  questionId: string | null;
}
```

**Prompt (system)**
```
You decide ONE thing: has the caller FINISHED SPEAKING, or are they mid-sentence?
You are NOT judging whether the answer is correct, valid, or good. Only whether it is FINISHED.

Reply with exactly one word:
COMPLETE - the caller finished a whole thought responsive to what the agent just said.
MORE     - the utterance is cut off, trails off, or is obviously partial
           ("my email is john dot", "I make about", "it's four two three fi").
PROBE    - the caller clearly stopped and is waiting, but said nothing usable.

Bias: when the utterance ends mid-word, mid-number, or on a filler
("uh", "let me see", "hold on", "it's..."), answer MORE.
When in doubt, answer COMPLETE — silence is worse than answering early.
```
**User payload** (~150–200 input tokens). Note the ordering: **what the AI actually just said is the primary context**; the pending question is secondary (§3.4).
```
AGENT JUST SAID: "{lastAiUtterance}"
(context) CURRENT APPLICATION QUESTION: {pendingQuestion.text} [type {type}]
CALLER SO FAR: "{concatenated held fragments + this fragment}"
PREVIOUS HOLDS: {holdCount}
```

### 3.3 Prefilter chain — `services/answer-prefilter.ts` (positive evidence only)

Evaluated in order; the first rung that returns a verdict wins. **A rung may return `COMPLETE`, `MORE`, or `null` (defer to the LLM judge). Only rungs 6 and 8 may return `MORE`.**

1. **`call.judgeDisabled` or `turnJudgeEnabled === false`** → `COMPLETE` (`source:"disabled"`).
2. **Turn intent is not `ASKING`** (§3.4) → `COMPLETE` (`source:"intent"`). This is the rung that rescues every confirmation turn.
3. **Affirmation / negation set** — trimmed fragment matches `yes|yeah|yep|yup|correct|that's right|right|sure|ok|okay|no|nope|nah|wrong` (± trailing "that's right") → `COMPLETE` (`source:"affirmation"`), **zero validator calls, zero LLM calls**.
4. **Backchannel** — normalized fragment ≤ 4 characters, or in `{mm, mhm, mm-hm, uh-huh, huh, hm, sorry, what}` → `COMPLETE` (`source:"backchannel"`). Removes a large slice of the coughs and acknowledgements that `create_response:false` turns into gated turns (§3.10).
5. **Empty / whitespace transcript, or `transcription.failed`** → `COMPLETE` (`source:"failopen"`) — let the AI re-prompt naturally.
6. **Truncation signals on the utterance tail** (the *only* deterministic `MORE`):
   - ends mid-word (final token is not a dictionary-plausible word *and* the audio segment ended at the VAD boundary without a pause token) — implemented conservatively as: final token length ≥ 2 and the fragment does not end in sentence-final punctuation and the final token is a prefix of no complete token seen earlier;
   - ends on a **dangling connector**: `dot | at | dash | slash | and | of | the | to | my | is | it's | number`;
   - ends on a **filler**: `uh | um | er | hold on | let me see | one sec | hang on | about`;
   - ends on a **digit run shorter than the field's known length** for a *known* fieldKey only: 1–8 of 9 for `ssn`, 1–9 of 10 for `employerPhone`.
   Otherwise → continue.
7. **Positive validator parse** — *only* when `pendingQuestion.fieldKey` is a key of `FIELD_VALIDATORS` (**exact fieldKey membership; the `type → validator` mapping is deleted outright**). Run the normalizers (below), then the validator on the **longest matching substring** rather than the whole fragment. Clean parse → `COMPLETE` (`source:"validator"`). **Failure → `null`, never `MORE`.**
   - *Deleted:* `date → parseMoveInDate` (rejects every past date; would hold `dateOfBirth` and `employment_start_date` forever) and `number → parseIncome` (rejects any value < 100; would hold `bedrooms_needed` "two" and `household_size` "just me and my wife" forever, and would fail M8 scenario 4 by construction).
8. **Hard PII rung — `ssn` and `dateOfBirth` never reach the LLM.** For these two fieldKeys the chain **must terminate here with a verdict** and may not return `null`: clean parse → `COMPLETE`; rung-6 truncation signal → `MORE`; anything else → `COMPLETE`. See §5 (PII). Enforced by a test that stubs `fetch` and asserts it is never called for these keys at any `holdCount`.
9. **Cap reached** (§3.5) → `COMPLETE` (`source:"cap"`).
10. Otherwise → `null`, dispatch the LLM judge.

**Normalizers** (run before rungs 6–8, on a copy; the raw fragment is what gets stored):
- **Spoken digits** — "four two three" → "423". Without it `validateSSN` strips word-digits to nothing.
- **Spoken email** — ` at ` → `@`, ` dot ` → `.`, collapse spaces around them, strip inter-letter hyphens from spell-outs. Without it a spoken email *can never validate*, so rung 7 would never fire and (under the old design) the caller would eat two holds plus the floor on a perfectly good answer.
- **Substring extraction** — run validators against the longest candidate span, not the whole utterance, so "sure, it's 312-555-1234" and "I'm 34, my social is 123456789" work. (`validateSSN` strips all non-digits from the *whole* string and demands exactly 9; `isValidPhoneNumber` fails on word-wrapped numbers.)

**Test data rule:** the M4 table is built from **real ASR strings captured on the M0 loopback call**, not hand-written canonical values. The original gate asserted `"john.smith@gmail.com" → COMPLETE` (a form no caller ever produces over voice) and `"March fif" → MORE` (false — `chrono.parse` matches the bare month "March" and returns a hit).

### 3.4 Turn intent — judging against what the AI actually said

**This is the correction the whole feature turns on.** The prompt mandates spell-back-then-confirm, and `pendingQuestion` only advances on a successful save. So on the confirmation turn the pointer still names the *same* question, and the old design handed the judge `QUESTION: "What is your Social Security number?"` / `ANSWER: "yeah that's right"`. Deterministically: `validateSSN("yeah that's right")` fails → `MORE` → silence → an 8 s nudge at someone who already answered twice. That is 6 of the 11 standard questions dead-airing on *every* application, and the LLM judge would return `PROBE` and re-ask a just-answered question. The fix is to stop treating `pendingQuestion` as the thing being answered.

```ts
type TurnIntent = "ASKING" | "READBACK" | "OTHER";

function classifyTurn(call: ActiveCall): TurnIntent {
  const lastAi = lastEntry(call.transcript, "ai")?.content ?? "";
  if (!call.applicationId || !call.pendingQuestion) return "OTHER";
  if (READBACK_MARKERS.test(lastAi)) return "READBACK";
  if (containsQuestionTokens(lastAi, call.pendingQuestion.text)) return "ASKING";
  return "OTHER";
}
```
- `READBACK_MARKERS` = hyphen-spelled runs `/\b[a-z](?:-[a-z]){2,}\b/i`, or a confirm phrase (`is that right | is that correct | did i get that | did i hear that | does that sound right | correct\?`).
- `containsQuestionTokens` = token overlap between the last AI utterance and the pending question's text above a small threshold.

**Only `ASKING` turns are gated.** `READBACK` and `OTHER` return `COMPLETE` at prefilter rung 2 with zero validator and zero LLM calls. This also removes the original §3.3 "cross-check against the last AI utterance" *pointer* heuristic, which actively made things worse — on a confirmation turn the last AI utterance is a read-back of the current question, so token overlap reinforced the wrong pointer instead of detecting that the AI was no longer asking. The overlap check survives only in its narrowed role above (is the AI asking *this* question at all), plus a corrective use: if the last AI utterance overlaps a *different remaining* question more strongly than the pending one, move the pointer to that question (this is what handles a skipped optional question and a correction to an earlier field).

### 3.5 State on `ActiveCall`

```ts
// call-registry.ts — new fields
filledKeys: Set<string>;                 // seeded at start_application, re-seeded at reconnect
pendingQuestion: QuestionDefinition | null;
lastSavedFieldKey: string | null;

// answer accumulator — correlated by item_id, NEVER gated by an epoch check
pendingItems: string[];                  // item_ids in committed (true conversation) order
transcriptsByItem: Map<string, string>;  // item_id → fragment
heldFragments: string[];                 // materialized answer-so-far, in pendingItems order

// two counters, two jobs
answerEpoch: number;                     // discard guard: bumped ONLY on save success,
                                         // sendUserText, and pointer change
utteranceSeq: number;                    // bumped on speech_started; does NOT gate discard

// hold state (per question)
holdCount: number;                       // total MORE verdicts for pendingQuestion; hard ceiling 4
unproductiveHolds: number;               // consecutive MOREs that added <3 chars of new content; cap 2
nudgeFired: boolean;                     // nudge at most once per question
ungated: boolean;                        // set when the cap fires; remaining turns for this question skip the judge

// liveness (invariant 1)
responseInFlight: boolean;
pendingResponseRequest: ResponseRequest | null;
awaitingCallerTimer: NodeJS.Timeout | null;   // the ONE floor; see §3.8
lastOutboundAudioAt: number;
lastInboundMediaAt: number;
deadlockWatchdog: NodeJS.Timeout | null;

// misc
suppressUserTranscriptPush: boolean;     // gate owns user transcript entries
vendor: "telnyx" | "twilio";
judgeApiKey: string | undefined;
judgeModel: string;
judgeDisabled: boolean;
consecutiveJudgeFailures: number;
patience: { enabled: boolean; baseEagerness: string };
```

**Pointer maintenance (all in-memory, no per-turn DB hit):**
- Seed `filledKeys` from `getFilledFields(applicationId)` **once** at `start_application` (the resume path matters — `findOrCreateApplication` can return a partially-filled application) and re-seed in `reconnectOpenAI`, which **already fetches `filledFields`** at ~line 602 — reuse that result.
- Advance in the `save_application_field` branch of `dispatchFunctionCall` (call-handler ~93–112) on a successful save: add the key, set `lastSavedFieldKey`, recompute `pendingQuestion` = first `questions[]` entry (sortOrder) not in `filledKeys`, apply the §3.4 corrective overlap check, reset **all** hold state (`holdCount`, `unproductiveHolds`, `nudgeFired`, `ungated`, `heldFragments`, `pendingItems`, `transcriptsByItem`), bump `answerEpoch`, and push the next question's `eagerness` (§3.7).
- **Hard gate: the judge only runs when `applicationId !== null` AND `pendingQuestion !== null` AND `classifyTurn() === "ASKING"`.**

**Hold state machine, pinned explicitly** (the original left this ambiguous, which yields either a nudge loop or silently-disabled patience):
- `holdCount` and `unproductiveHolds` are **per question**. They increment on `MORE`. They reset **only** on a successful `save_application_field` or a pointer change — **never** on the nudge path.
- A hold is **productive** if the newly appended fragment adds ≥ 3 characters of new content: `unproductiveHolds` resets to 0. This is what preserves the motivating case — a long SSN or address read with three or four real pauses keeps its patience, because the caller is demonstrably still adding content.
- The cap fires on `unproductiveHolds >= 2` **or** `holdCount >= 4` (hard ceiling). When it fires: set `ungated = true`, so every subsequent turn for that question returns `COMPLETE` at rung 9 with no judge.
- The nudge fires **at most once per question** (`nudgeFired`).

### 3.6 Event flow

New callbacks (added to the **shared factory**, §M1): `onSpeechStarted`, `onSpeechStopped`, `onBufferCommitted`, `onInputTranscriptDelta`, `onInputTranscriptComplete`, `onInputTranscriptFailed`, `onResponseCreated`, `onResponseDone`, `onOutputItemAdded`, `onSessionUpdated`, plus a `default:` branch logging unmatched event types at debug level.

```
input_audio_buffer.speech_started
  → utteranceSeq++;  refresh awaitingCallerTimer (do NOT clear it — §3.8)
  → (M7) barge-in flush if responseInFlight

input_audio_buffer.committed { item_id }
  → pendingItems.push(item_id)                 // arrival here IS true conversation order
  → if (turn is not gated)  requestResponse(call, {priority:"turn", reason:"ungated"})
    else                    dispatch/await the judge for this item

conversation.item.input_audio_transcription.delta   (only if M0 proves deltas exist)
  → update the running partial for item_id

conversation.item.input_audio_transcription.completed { item_id, transcript }
  → transcriptsByItem.set(item_id, transcript)     // UNCONDITIONAL, before any guard
  → rebuild heldFragments from the contiguous filled prefix of pendingItems
  → verdict = await judge(...)   // prefilters → LLM
  → apply verdict (below)

conversation.item.input_audio_transcription.failed { item_id }
  → transcriptsByItem.set(item_id, "")           // do not block the prefix
  → verdict = COMPLETE, source "failopen"        // immediate; no 350 ms wait

response.created / response.output_item.added → responseInFlight = true; record item_id
response.done → responseInFlight = false; flush pendingResponseRequest; arm awaitingCallerTimer
session.updated → log effective session.audio.input.turn_detection (config assert)
```

**Ordering correlation is mandatory, not optional.** Transcription is a separate async job per item and nothing guarantees completions arrive in item order — a short first fragment and a long second one can invert, producing "six seven eight nine one two three" for a spoken SSN. That scrambled string is what the judge scores, what lands in the stored transcript, and what the model may read back and save. So the answer-so-far is always **materialized from `pendingItems` order**, judging once the contiguous prefix is filled (or the §3.9 bound expires, in which case judge what exists and log the gap).

**Applying a verdict:**
```
epochAtDispatch, questionAtDispatch captured at dispatch time

if (call.answerEpoch !== epochAtDispatch):
    // STALE — but NEVER terminate silently. Invariant 1.
    if (questionAtDispatch !== call.pendingQuestion?.id)
        // pointer moved on: the caller finished talking either way; only the
        // hold decision was invalidated
        requestResponse(call, {priority:"turn", reason:"stale-pointer"})
    else if (!call.responseInFlight && !call.pendingResponseRequest)
        requestResponse(call, {priority:"turn", reason:"stale-guard"})
    return   // the ONLY silent path: a texted answer already produced its own response

COMPLETE → flush merged user transcript entry; reset hold state;
           requestResponse(call, {priority:"turn", reason:"complete"})
PROBE    → flush merged entry; sendSystemEventQuiet(ws,
             "The caller stopped but did not give a usable answer. Briefly re-ask
              the current question in your own voice.");
           requestResponse(call, {priority:"turn", reason:"probe"})
MORE     → holdCount++; update unproductiveHolds; (awaitingCallerTimer is already armed)
           send nothing now
```

**Why the stale path can never just `return`.** The original design bumped the epoch on `save_application_field` success. Real sequence: the model emits one response containing both the audio ("Got it — and what's your email?") *and* the tool call at the end; `onFunctionCall` awaits Prisma (plus up to 3 s of validation); meanwhile the caller has already answered the next question and a judge is in flight with epoch E; the save resolves and bumps to E+1; the verdict returns, mismatches, and returns silently — **with no timer armed, because the discard happened before the `MORE` branch.** Dead call. Splitting `answerEpoch` from `utteranceSeq` (so continued speech no longer invalidates anything) plus the "stale ⇒ still speak" rule closes it.

**The accumulator is a record of what was said, not a product of a verdict.** `transcriptsByItem.set(...)` happens *before* every guard. Under the original design `heldFragments.push()` lived inside the `MORE` branch after the epoch check, so any resumption of speech before the judge's RTT — the common case for exactly the reciting-a-number scenario this feature targets — dropped the first half of the answer from both the judge's context and the stored transcript.

### 3.7 Patience is per-question

`Property.voicePatience` defaults to **`"auto"`**, not `"low"`. Low eagerness slows end-of-turn detection on *every* turn including "two" and "yes"; shipping it as the M3 default would be a global latency regression for every existing property, before the judge even exists, with no opt-out short of a per-property DB edit. `"low"` is the documented remedy for the elderly-applicant case, matching `turnJudgeEnabled`'s opt-in posture.

Real patience is applied **per question**, in the `save_application_field` success branch, via `updateSessionAudioInput(ws, { turn_detection: { ...base, eagerness } })` for the *next* question:

| Next question | `eagerness` | Rationale |
|---|---|---|
| `ssn`, `email`, `dateOfBirth`, `employerPhone`, address, any `text` field | `low` | spelled out, read off a card, full of pauses |
| `number`, `yes_no` | `high` | "two", "yes" — patience here is pure lag |
| everything else | `auto` | |

`Property.voicePatience` acts as a **global offset**: `"low"` shifts every tier one step more patient, `"high"` one step less. This is the mechanism that lets M8 scenario 1 (SSN with pauses) and M8 scenario 4 ("two bedrooms") both pass; a single static knob cannot, and the tuning loop the original plan prescribed would oscillate between them forever.

### 3.8 Response liveness — the one floor and the deadlock watchdog

The original design had the 8 s floor armed only inside the `MORE` branch and **cleared on `speech_started`**. A cough, a handset shift, or background noise crossing the VAD threshold clears it; if no `committed` follows (sub-threshold audio, or the VAD retracting the segment), there is no transcript, no judge, no verdict, no timer, and — under `create_response:false` — no server-side auto-create. Total silence until the caller hangs up. Both "independent backstops" were defeated by one event, and M8 scenario 6 (caller says nothing at all → no commit ever occurs) could not fire either backstop by construction.

**Replaced by one call-level mechanism plus one watchdog.**

- **`awaitingCallerTimer` (2.5 s).** Armed/refreshed on `response.done` (the AI finished speaking, so the caller now owes a turn) and on `speech_started` (refresh, not clear). Cleared **only** inside `requestResponse`. On expiry: if `heldFragments` are usable, `sendSystemEventQuiet("The caller paused. Briefly acknowledge what you have and continue.")`; if they are not, use the PROBE text. Then `requestResponse(call, {priority:"turn", reason:"floor"})`, and set `nudgeFired`.
  - **2.5 s, not 8 s.** Invariant 2: on any false `MORE` — and several classes of false `MORE` were guaranteed in the original design — the caller ate 8 s of dead line, far worse than the half-second interruption being fixed. 2.5 s is at the edge of what reads as thinking rather than as a dropped call. It also covers a genuinely silent caller, replacing M8 scenario 6's unreachable "hold cap + 8 s floor" path. (The 10 s figure in M8 scenario 6 and the 8 s constant are both retired; one number, 2.5 s, everywhere.)
  - **The nudge text is a neutral continuer, not "take your time."** "Take your time" is exactly wrong for the false-`MORE` case — the caller already finished — and produces the classic "why isn't it listening" loop. The instruction is: briefly acknowledge and proceed as if the answer were complete ("Got it —" then continue), re-asking only when the fragments are genuinely unusable. That reading is correct under both hypotheses.
- **`deadlockWatchdog` (6 s), independent of the turn machine.** Reset on every outbound audio delta and every inbound carrier `media` frame. If the call has been silent in **both** directions for 6 s while the carrier WS is open and no response is in flight or queued: log `[turn-gate] deadlock-recovery` and force `requestResponse(call, {priority:"system", reason:"deadlock"})`. This is the net under every bug not yet found, including ones in this plan.
- **Both timers are cleared in `handleCallEnd` and at the top of `reconnectOpenAI`** (timers armed against a dead socket), alongside the existing `callMonitors` interval.

**Silent-path audit (part of the M1 and M6 reviews).** Every `return` in the turn machine must be annotated with which mechanism guarantees subsequent speech. Today there is exactly one permitted silent return: a stale verdict whose corresponding text answer already produced its own response, and even that asserts `responseInFlight || pendingResponseRequest`.

### 3.9 Latency budget — derived, with a veto

The gated-turn chain is **serial and the judge is additive**. The original claim that speculative dispatch makes the judge parallel does not survive scrutiny: an ASR partial "stops growing" only when the caller stops speaking (in fact a few hundred ms *after*, since deltas lag audio), so the achievable overlap is ~100–200 ms, not the judge's full RTT.

| Term | Source | Today | Target after |
|---|---|---|---|
| `T_vad` end-of-turn detection | M0 measurement (per `eagerness`) | 500 ms (`server_vad` default) | **M0 fills in** — the largest and least known term |
| `T_asr` commit → transcript | M0 measurement | 300–800 ms (`whisper-1`) | `gpt-4o-mini-transcribe`, M0 measures |
| `T_judge` | judge RTT, hard abort | — | ≤ 400 ms, p95 measured |
| `T_ttft` `response.create` → first audio | existing | 400–800 ms | unchanged |

**Gated p95 ≈ `T_vad + max(0, T_asr − overlap) + T_judge + T_ttft`.**

**Veto rules, applied at the M0 gate before any judge code is written:**
- If `T_vad + T_asr` p95 > 900 ms, the **transcript wait is dropped**: the judge runs on the newest partial at `speech_stopped` only, and re-dispatches only if the final transcript differs materially.
- If streaming deltas are unavailable (i.e. `whisper-1` fallback), **the judge ships disabled by default** — layers 0–1 only. A design whose happy path adds ~1.6 s of dead air is not shippable, and layers 0–1 alone are the ~90% fix.
- If the computed p95 still exceeds 2.0 s, either `T_judge` shrinks or the judge ships opt-in-only for properties that explicitly want maximum patience. **The target is set from the sum, not from a wish.**

**Transcript-wait bound: 350 ms, not 900 ms** (and 0 ms when the veto drops it). On expiry, fire `requestResponse` immediately — do **not** route an empty string through the judge to reach the same place 350 ms later. `transcription.failed` short-circuits to `COMPLETE` instantly; that event is common on exactly the short, mumbled, noisy utterances that trigger the gate, and under the old design each one cost the full bound in dead air.

**Speculative dispatch is a conditional optimisation, not the baseline.** If M0 proves deltas: **one in-flight judge per `item_id`**, tagged `{itemId, partialLength}`, with an `AbortController` cancelling the outstanding fetch before dispatching a replacement; on `transcription.completed`, accept the outstanding verdict only if its `partialLength` is within a small delta of the final transcript, else re-judge. Without this, "dispatch when the partial stops growing" needs a debounce timer — functionally the same silence heuristic §1 blames for the whole bug — and fires 3–5 times per utterance, with an early `MORE` ("my email is john dot") able to land *after* a late `COMPLETE` ("…at gmail dot com") and hold a finished answer. **The non-speculative path is the shipped default until deltas are proven.**

### 3.10 Texted-answer bypass

The bypass is architectural: `sendUserText` creates a `conversation.item.create` with `input_text` and a texted answer **produces no input-audio events at all**, so a judge triggered exclusively by the audio path cannot see it. That is the decisive argument for gating on the *turn* path rather than as a pre-save hook on `save_application_field`, where spoken and texted answers produce byte-identical tool calls.

**But the caller's voice is still streaming.** While `sms-handler` injects the text, `sendAudioToOpenAI` is still appending the caller's half-spoken email to `input_audio_buffer`; OpenAI's VAD will commit and transcribe it regardless of anything our judge does. Our epoch guard suppresses only our own trigger — it cannot un-commit a conversation item. The model then holds both `[texted]: john.smith@gmail.com` and a user audio item "my email is john dot", **in an order determined by VAD timing, not by us**, and the prompt's "most recent one wins" rule resolves it wrongly whenever the caller trails off a beat late. So:

**In the mid-call-text branch of `sms-handler.ts`, in this order:**
1. `clearInputAudioBuffer(liveCall.openaiWs)` — drop the uncommitted partial.
2. Record `call.suppressItemsBefore = Date.now()`; any `transcription.completed` for an item committed before that is not pushed to the transcript, and we issue `conversation.item.delete` for it (or, if delete is unsupported for audio items — M0 verifies — follow the text with `sendSystemEventQuiet("Ignore the incomplete spoken fragment that preceded the texted answer.")`).
3. Clear `awaitingCallerTimer`, `heldFragments`, `pendingItems`, `transcriptsByItem`, `holdCount`, `unproductiveHolds`.
4. Bump `answerEpoch`.
5. `sendUserText(...)`, which routes its response through `requestResponse` like everything else.

M0 also verifies `input_audio_buffer.clear`'s behaviour under `create_response:false`.

### 3.11 Transcript ownership

`openai-realtime.ts:91-97` already pushes a `role:"user"` entry on every `transcription.completed`. Adding a merged push at `COMPLETE` without removing it stores every held answer N+1 times — inflating `exchangeCount` in the auto-summary, making transcripts read as stutters, and **nullifying the claimed split-SSN redaction fix**, since the raw split fragments are still present when `redactTranscriptPII` runs its per-entry regex.

**The turn gate is the sole writer of `role:"user"` entries.** Set `suppressUserTranscriptPush` while `pendingItems` is non-empty and check it in the `onTranscript` callback for `role:"user"`; the `role:"ai"` push is untouched. The merged entry is flushed on `COMPLETE`, on `PROBE`, on the cap/nudge path, and in `handleCallEnd` (so a call ending mid-hold does not silently drop the caller's last words).

### 3.12 Config knobs

| Knob | Where | Default | Purpose |
|---|---|---|---|
| `Property.voicePatience` | new column, `String @default("auto")` | **`auto`** | global offset on the per-question `eagerness` tiers (§3.7) |
| `Property.turnJudgeEnabled` | new column, `Boolean @default(false)` | `false` | layer-2 kill switch; layers 0–1 ship to everyone, judge opt-in |
| `ai_validation.model` / `.api_key` | existing SystemConfig integration | `gpt-4o-mini` | judge model + key; **no new integration needed** |
| `VOICE_JUDGE_TIMEOUT_MS` | env | `400` | ops escape hatch |
| `VOICE_TURN_TIMING_LOG` | env | off | per-turn structured timing (§M0) |

**`Property.answerValidation` keeps its current meaning and stays blocking.** It is documented in the dashboard as *save-time strictness* ("a secondary AI will verify each answer for completeness before saving"), which is orthogonal to call pacing — the judge explicitly decides "did the caller stop talking", *not* "is 'John' a complete full name" (its own system prompt says so). It is not a superset, so it is neither skipped nor fired-and-forgotten:

- **On voice, `validateFieldWithAI` stays blocking but its timeout drops from 3000 ms to 700 ms.** It already fails open, so a timeout costs nothing, and the `{valid:false} → {success:false, error}` path (application-builder.ts:82-84) that makes the model re-ask — the entire value of the checkbox — survives.
- The original plan contained two contradictory statements about this path (§3.6 "skip it when the judge is on" vs M7 "make it fire-and-forget on voice unconditionally"), and fire-and-forget had no "correct later" mechanism anywhere in the codebase, so it would have silently written bad values while the dashboard still promised verification. **Both statements are deleted; the sentence above is the single specification.**

### 3.13 Cost and added call time

**Judged-turn volume is 2–4× the original estimate.** The mandated spell-back loop makes every field ≥ 2 caller turns; corrections add more; and with `create_response:false` every VAD-committed buffer while a question is pending is a candidate turn, including backchannels, coughs and background speech. Realistic range on a 10-minute application call: **40–80 candidate gated turns**, not 20.

- **Dollars: unchanged conclusion.** ~250 input / ~2 output tokens on `gpt-4o-mini` ($0.15 / $0.60 per 1M) ≈ **$0.000039 per verdict**. Even at 80 verdicts that is **≈$0.003 per application**. Cost is not the constraint.
- **The number that matters is added call seconds** = (LLM-judged turns) × (mean added latency). Prefilter rungs 2–5 (turn intent, affirmations, backchannels, empty/failed) are expected to remove **more than half** of the 40–80 candidates for free; rungs 6–8 remove more. At an assumed 25 LLM verdicts × ~300 ms that is ~7.5 s added to a 10-minute call. **This figure is computed from the M0/M8 `[turn-timing]` logs, not assumed, and it is an M8 exit criterion** — billable realtime audio, and the thing a caller experiences as a call that "drags".
- **Transcription model swap** (`whisper-1` → `gpt-4o-mini-transcribe`): roughly a wash on price, materially better on latency, and it unlocks deltas. Confirm per-minute pricing in the M0 spike.

---

## 4. Milestones

Each milestone is independently shippable and independently revertable. M0–M2 change **no** call behaviour.

### M0 — Spike + instrumentation (settles the facts the design hangs on)
**Deliverables**
- A throwaway script (`apps/server/scripts/realtime-spike.ts`) that opens one realtime session against the property's **DB-default** model and prints the `session.updated` echo. Answers:
  1. Does the configured model accept `semantic_vad`? (DB default is `gpt-4o-mini-realtime-preview`; the code speaks the GA protocol targeting `gpt-realtime*` — the dashboard dropdown may need updating in the same change, or the feature works in testing and silently no-ops on every default property.)
  2. Does `create_response: false` work with `semantic_vad` — does `input_audio_buffer.committed` still fire with no auto-response? **Linchpin; if it fails there is no gate.**
  3. Does `gpt-4o-mini-transcribe` emit `conversation.item.input_audio_transcription.delta` **for `audio/pcmu`**, and how much faster is its `.completed` than `whisper-1`'s? Does `...transcription.failed` fire, and with what shape?
  4. Is `idle_timeout_ms` available on `semantic_vad`? If so it may replace the self-managed floor.
  5. **`T_vad` per `eagerness` tier** (`high`/`auto`/`low`), measured as `speech_stopped → committed`, and `T_asr` as `committed → transcription.completed`. These populate §3.9 and fire its veto rules.
  6. Does `input_audio_buffer.clear` behave as expected under `create_response:false`? Is `conversation.item.delete` accepted for audio items?
  7. Does Telnyx TeXML under `bidirectionalMode="rtp"` honour an outbound `{"event":"clear"}`, and does it **ack `mark` frames**? (M7 depends on both.)
- Per-turn structured timing log behind `VOICE_TURN_TIMING_LOG`:
  `[turn-timing] streamSid=… itemId=… intent=… verdict=… source=… held=N t_speech_stopped t_committed t_transcript t_judge_out t_judge_in t_response_created t_first_audio`
- Raise the `MEDIA_STREAM_DEBUG_LOG` 5-frame cap temporarily and confirm inbound `media.track` values — with `bidirectionalMode="rtp"`, if any outbound/mixed track echoes back, the VAD is listening to the AI's own voice and **every** turn-detection tuning below is invalid.
- **Capture a corpus of real ASR strings** from the loopback call for the M4 table: a spoken email, a spoken SSN with pauses, a spoken DOB, "two bedrooms", "just me and my wife", "June 2019", and several confirmations.

**Stress gate M0:** all seven questions answered in writing in this file; §3.9's table filled in with measured numbers and its veto rules **applied** (the outcome — full judge / no-transcript-wait / judge-disabled — recorded here before M4 starts); a real loopback call produces ≥20 `[turn-timing]` lines; p50/p95 of `speech_stopped → first audio delta` recorded as the **pre-change baseline**; the ASR corpus committed as a test fixture. Every latency number in §3 is an estimate until this gate runs.

### M1 — Prerequisite refactor: one callbacks factory, one response chokepoint, liveness net
**Deliverables**
- Extract `buildRealtimeCallbacks(streamSid, ctx)` used by **both** `setupOpenAI` (~314) and `reconnectOpenAI` (~631). Today these are two near-identical copies that already differ subtly. **Every** later milestone adds callbacks; without this the feature silently dies after the first reconnect — which is *guaranteed*, since the monitor proactively closes the OpenAI socket at 45 minutes.
- Broaden the event switch: `speech_started`, `speech_stopped`, `committed`, `input_audio_transcription.delta`, `input_audio_transcription.failed`, `response.created`, `response.output_item.added`, `response.done`, `session.updated`, `input_audio_buffer.timeout_triggered`, plus a `default:` debug log.
- **`requestResponse(call, opts)` as a single-slot queue** (§3.1), with `priority: "turn" | "system"`, and the three flag-reset sites (`response.done` + flush, top of `reconnectOpenAI`, socket `close`, plus the two error codes). **Route all five existing `response.create` sites through it.**
- **`deadlockWatchdog` and `awaitingCallerTimer`** (§3.8) wired now, while `create_response` is still `true` — so the net exists *before* the milestone that removes the server's own net.
- **Fix the reconnect-greeting bug:** `connectToOpenAI` unconditionally sends `response.create` on open to trigger the greeting, and `reconnectOpenAI` calls the same function, so **every reconnect makes the AI spontaneously greet mid-conversation**. Add `greetOnOpen: boolean`. **`greetOnOpen: false` means "no *greeting*", not "no response"** — see M3 for the replacement resume trigger, without which the reconnect path goes permanently silent once `create_response:false` lands.
- `sendSystemEventQuiet`, `updateSessionAudioInput`, `clearInputAudioBuffer` helpers.
- Add the new `ActiveCall` fields (§3.5) and update the **four** existing fixture factories: `call-text-answers.test.ts:35`, `reconnection.test.ts:32`, `monitoring-shutdown.test.ts:33`, `voice-call.test.ts:115/140/189`.

**Stress gate M1:** full suite green with **zero behaviour change** (assert the `session.update` payload byte-for-byte against a snapshot). New unit tests:
- `sendFunctionResult` while `responseInFlight` → **exactly one** `response.create` emitted after `response.done` arrives (not zero).
- Wrap-up `sendSystemEvent` while `responseInFlight` → the frame still lands, and a queued `"system"` request is not displaced by a later `"turn"` request.
- Two concurrent creates produce exactly one frame *now* and one *after* `response.done`.
- `responseInFlight` is reset by `reconnectOpenAI` and by socket `close`; a reconnect while `responseInFlight` → the next committed produces a `response.create`.
- **No `response.create` frame anywhere carries an `instructions` field.**
- `greetOnOpen:false` emits no open-time greeting.
- The reconnect path registers the identical callback set as the primary path (assert on the factory's key list, so a future divergence fails the test).

### M2 — Current-question tracking + turn-intent classification
**Deliverables**
- `filledKeys` seeded at `start_application` from `getFilledFields`, re-seeded in `reconnectOpenAI` from its **existing** fetch; `pendingQuestion` / `lastSavedFieldKey` advanced in the `save_application_field` branch; `answerEpoch` bumped at its three sites (save success, `sendUserText`, pointer change); `utteranceSeq` on `speech_started`.
- **`classifyTurn()`** (§3.4) with `READBACK_MARKERS` and `containsQuestionTokens`, plus the corrective pointer move when the last AI utterance overlaps a *different* remaining question more strongly.
- Timers cleared in `handleCallEnd` (which today clears only the `callMonitors` interval) **and** at the top of `reconnectOpenAI`.

**Stress gate M2 (pure unit, no network):** pointer correct after — a skipped optional question; a correction re-saving an already-filled key; a resumed partially-filled application; a reconnect mid-question; `applicationId === null` (pointer stays null). Turn-intent matrix: AI asked the question → `ASKING`; AI spelled a value back ("J-O-H-N S-M-I-T-H, is that right?") → `READBACK`; AI answered a property question → `OTHER`. Assert `getFilledFields` is called **at most twice per call** (start + reconnect), never per turn.

### M3 — Layers 0 + 1: semantic_vad, server-owned trigger, per-question eagerness, judge stubbed to always-COMPLETE
**Deliverables**
- `OpenAISessionConfig` gains `turnDetection` + `transcriptionModel`, threaded from **both** connect sites (note `reconnectOpenAI` takes a hand-written structural `property` type at ~571-582 that needs the new fields).
- `Property.voicePatience` column (**default `"auto"`**) + dashboard control; per-question `eagerness` tiers pushed via `updateSessionAudioInput` on save success (§3.7); the `server_vad silence_duration_ms: 1200` fallback selected by the M0 result.
- `create_response: false`; `requestResponse` fired on `committed`; judge stub returns `COMPLETE` always.
- **Reconnect resume trigger** (this is the milestone where its absence becomes fatal): after `session.updated` lands on the new socket, `sendSystemEventQuiet("Connection was re-established. You were asking: {pendingQuestion.text}. The caller had said so far: {heldFragments.join(' ')}. Continue naturally without re-greeting.")` then an explicit `requestResponse(call, {priority:"system", reason:"resume"})`. Also fold `heldFragments` into `resumeInstructions`. Without this, a socket drop mid-utterance leaves the caller listening to a dead line indefinitely, since no commit will occur until they speak — strictly worse than the greeting bug M1 fixed.
- **Buffer inbound media during the reconnect window** (a small ring buffer flushed once `readyState === OPEN`) instead of silently dropping frames in `sendAudioToOpenAI`.
- **Behaviour is otherwise intentionally identical to today.** Pure-plumbing rung.

**Stress gate M3:**
- Unit (`turn-gate.test.ts`, using the existing `mockWs()` frame-capture harness from `call-text-answers.test.ts:26-53`): `committed` → exactly one `response.create`; none before `committed`; frames identical across primary and reconnect paths.
- `voice-call.test.ts` extended to assert the emitted `session.update` `turn_detection` block, and that `eagerness` changes after a save to a `number`-type next question.
- Reconnect path: **exactly one** `response.create` and **zero** greeting-shaped output.
- **Live loopback call:** completes normally; `session.updated` echo logs the effective block; `[turn-timing]` p95 of `speech_stopped → first audio` is **no worse than the M0 baseline**; the AI does not greet again after a forced reconnect; a reconnect forced **while the AI is mid-sentence** resumes speaking without the caller having to prompt it.

### M4 — Layer 3: deterministic prefilters
**Deliverables**
- `services/answer-prefilter.ts`: turn-intent rung, affirmation set, backchannel set, empty/failed rung, **tail truncation signals**, spoken-digit + spoken-email normalizers, substring extraction, exact-fieldKey validator dispatch (**no type→validator mapping**), the absolute `ssn`/`dateOfBirth` rung, and the cap rung.
- Wired ahead of the (still stubbed) judge.

**Stress gate M4 (pure unit, table-driven, built from the M0 ASR corpus):**
- **Never `MORE` for complete answers:** `"two bedrooms"`, `"2"`, `"one"`, `"just me and my wife"`, `"about 4200 a month"`, `"June 2019"` (`employment_start_date`), `"March 15th 1985"` (`dateOfBirth`), and a real spoken email `"it's john dot smith at gmail dot com"` → normalizer → `COMPLETE`.
- **`MORE` only from tail signals:** `"my email is john dot"`, `"I make about"`, `"it's four two three fi"`, `"uh"`, `"hold on"` → `MORE`.
- **Substring robustness:** `"sure, it's 312-555-1234"` and `"I'm 34, my social is 123456789"` → `COMPLETE`, not `MORE`.
- **Confirmation turn:** `pendingQuestion = ssn`, last AI utterance = read-back, fragment `"yes that's right"` → `COMPLETE`, **zero validator calls**.
- **Backchannel:** `"mm-hm"` → `COMPLETE`, zero calls.
- **Chrono reality:** assert the *actual* `parseMoveInDate("March fif")` behaviour (it returns a hit) and that the prefilter's verdict does not depend on it.
- **Cap:** a mis-transcribed field that can never parse → `MORE`, `MORE`, then `COMPLETE` at the cap (`unproductiveHolds`), and thereafter `ungated`. **A mis-transcription must never trap the call in silence.**
- **Productive holds preserve patience:** four fragments each adding real content → four `MORE`s allowed up to the `holdCount >= 4` ceiling, `unproductiveHolds` never reaching 2.

### M5 — The judge service
**Deliverables**
- `services/judge-transport.ts` (shared with `ai-field-validator`, which keeps its own prompt untouched but drops to a 700 ms timeout on voice per §3.12) and `services/voice-answer-judge.ts` per §3.2.
- Pre-warmed `judgeApiKey`/`judgeModel` on `ActiveCall` at call setup and reconnect; `consecutiveJudgeFailures` / `judgeDisabled` auto-degradation.

**Stress gate M5:** mirror `ai-field-validator.test.ts` (17 tests) 1:1 — mocked `resolveConfig` per namespace, stubbed global `fetch`, both key-resolution branches, model resolution, request-structure assertions — **plus**:
- three-way verdict parsing; unknown/garbage output → `COMPLETE`; timeout → `COMPLETE`; non-OK status → `COMPLETE`; missing key → `COMPLETE`;
- **an explicit test asserting fail-open is `COMPLETE`, never `MORE`** (the polarity inversion vs the SMS validator is the single most dangerous thing in this plan);
- `max_tokens ≤ 6` and `AbortSignal.timeout(400)` asserted on the outgoing request;
- **`fetch` is never called for `fieldKey ∈ {ssn, dateOfBirth}` at any `holdCount`**;
- 3 consecutive failures → `judgeDisabled`, and no further `fetch` calls for the rest of the call;
- speculative mode (if M0 enabled it): a second delta aborts the first fetch; a verdict whose `partialLength` diverges from the final transcript is re-judged; `{valid:false}` from `validateFieldWithAI` still yields `{success:false}` to the tool result on voice.

### M6 — Wire the judge: holds, caps, nudges, ordering, epoch guard, prompt rewrite
**Deliverables**
- Judge replaces the stub, gated by `Property.turnJudgeEnabled` and by the M0 veto outcome.
- **`item_id` correlation:** `pendingItems` / `transcriptsByItem`, contiguous-prefix materialization, `transcription.failed` handling (§3.6).
- **Accumulator writes are unconditional and precede every guard**; `answerEpoch` vs `utteranceSeq` split; **stale verdicts still fire a response** (§3.6).
- Hold mechanics per §3.5: `holdCount` ceiling 4, `unproductiveHolds` cap 2, `nudgeFired` once, `ungated` after the cap.
- `awaitingCallerTimer` (2.5 s) as the single floor; nudge is a **neutral continuer** injected via `sendSystemEventQuiet`, then a plain `requestResponse` — **no per-response `instructions`**.
- **Transcript ownership** (§3.11): `suppressUserTranscriptPush`, merged flush on `COMPLETE`/`PROBE`/cap/`handleCallEnd`.
- Texted-answer hardening (§3.10): `input_audio_buffer.clear` before `sendUserText`, `suppressItemsBefore`, hold-state clear, `answerEpoch` bump.
- Prompt rewrite in `packages/shared/src/prompts.ts`: delete the two inert "wait up to 10 seconds" claims (`:227`, `:263`) and replace with behaviour the model controls (what to say when handed a nudged turn; that the read-back loop is unchanged). The voice block at `:294-301` is already correct — leave it.

**Stress gate M6 — `turn-gate.test.ts` full matrix (no network, no phone):**
- `committed` with **no** pending question → `response.create` immediately, `fetch` **never called**.
- **Confirmation turn:** `pendingQuestion = email`, last AI utterance = spell-back, fragment `"yes that's right"` → **exactly one** `response.create`, `fetch` never called. (Same for `ssn`.)
- Pending question, verdict `MORE` → no `response.create` *now*, **and** `awaitingCallerTimer` is armed.
- Two consecutive unproductive `MORE`s → third turn forces `response.create`; the nudge fires **exactly once**; post-cap turns are **ungated** (no `fetch`).
- Judge times out → `response.create` still appears (fail-open), within the 400 ms bound.
- **Stale-epoch cases:** dispatch judge → bump epoch via a save → **exactly one** `response.create` is still emitted (never zero). Pointer moved to a different question → response fires with `reason:"stale-pointer"`.
- **Fragment retention:** caller resumes speaking before the verdict returns → the first fragment is still present in `heldFragments` and in the merged transcript entry.
- **Ordering:** two committed items whose transcripts arrive inverted → the answer-so-far is assembled in `pendingItems` order, not arrival order.
- `transcription.failed` → immediate `response.create`, no 350 ms wait.
- **`speech_started` during a hold, then no further events** → a `response.create` still appears (the floor was refreshed, not cleared).
- **No commit ever** (caller silent from the start) → the floor fires and the AI re-prompts once.
- **Transcript count:** two `MORE`s then `COMPLETE` → **exactly one** `role:"user"` entry containing all three fragments.
- Texted answer during a hold → the `input_audio_buffer.clear` frame **precedes** the `conversation.item.create`; hold state cleared; **exactly one** `response.create` results; no later nudge about the abandoned fragment.
- Reconnect mid-hold → timers cleared, no orphan `response.create` on the dead socket, `responseInFlight` reset.
- `turnJudgeEnabled: false` → behaviour is exactly M3.
- Repo gotchas: `process.env.PII_ENCRYPTION_KEY` at the top of any file touching applications; `TEST_PREFIX = test_turngate_${Date.now()}`.
- **Live loopback gate:** a scripted `sendUserText` sequence answering all 11 questions still completes an application end-to-end (text-path regression), and `[turn-timing]` p95 on non-gated turns is unchanged from M3.

### M6a — PII redaction (its own commit, no dependency on the merge)
**Deliverables**
- Extend `redactTranscriptPII` with a **spoken-digit pass**: run the same word-digit normalizer the prefilter uses over each entry and redact any resulting 9-digit run, replacing the whole matched word span. Today a spoken SSN transcribes as "one two three, four five, six seven eight nine", which matches neither existing regex — **merging fragments does not change that**, and the original plan claimed a security fix it did not deliver.
- Same treatment for spoken 10-digit phone runs and spoken DOBs where feasible.

**Stress gate M6a:** table-driven — "one two three four five six seven eight nine", "123-45-6789", "my social is one two three, four five, six seven eight nine, got it?" all redact; "I have two dogs and three cats" does not; the merged and unmerged forms redact identically (proving the fix is independent of M6).

### M7 — Barge-in flush + latency debt
**Deliverables**
- `<Parameter name="vendor" value="telnyx|twilio" />` in `voice-twiml.ts` (mirroring the existing `record=telnyx` trick) → read in the `start` handler → stored on `ActiveCall`.
- `flushCarrierAudio(call)`: Telnyx `{"event":"clear"}`, Twilio `{"event":"clear","streamSid":…}`. **Gated on the M0 verification** that Telnyx honours `clear` under `bidirectionalMode="rtp"`. If it does not, document that barge-in latency is bounded by RTP playout depth and ship the rest.
- **`conversation.item.truncate { item_id, content_index: 0, audio_end_ms }` driven by playout acknowledgement, not by bytes forwarded.** OpenAI's realtime output arrives far faster than real time, so at a barge-in we may have forwarded 4 s of μ-law while the caller's playout is at 1.2 s; truncating at 4000 ms tells the model the caller heard the whole utterance, so it will not repeat the discarded part and the transcript asserts content that was never received — **precisely the defect M8 scenario 7 forbids**, and it is *worst* exactly when the `clear` frame succeeds. Implementation: emit a `mark` after each forwarded media chunk carrying a cumulative-ms name, track the last acked mark, and use `min(lastAckedMarkMs, bytesForwarded / 8)`. If M0 shows Telnyx does not ack marks under `rtp`, fall back to wall clock: `Date.now() - firstAudioByteSentAt`, capped by `bytesForwarded / 8`.
- `mark` / `dtmf` cases added to the carrier switch (currently dropped on the floor).
- **Cut the pre-existing save-path dead air by lowering `validateFieldWithAI`'s timeout to 700 ms on voice** (§3.12) — **not** by making it fire-and-forget, which would silently discard the `answerValidation` feature.

**Stress gate M7:** unit — `flushCarrierAudio` emits the vendor-correct frame for both vendors; **`audio_end_ms` matches elapsed playout time (mark-acked or wall-clock), not the forwarded-byte count** (the original assertion certified the bug); counters reset on `response.created`; a `{valid:false}` validation still yields `{success:false}` to the tool result on voice. **Live loopback:** talk over the AI mid-sentence → its audio stops at the caller's ear within ~300 ms (against the M0 baseline where it does not stop at all), and the stored transcript reflects only what was heard.

### M8 — Human call gate (the only milestone needing a phone)
Call the property number and run **every** scenario; each has an explicit pass condition.

1. **Slow multi-part answer.** "I work at… Northwestern Memorial… uh… the hospital downtown, I've been there since about 2019." → AI waits through both pauses, responds once, saves the whole thing. **Fail:** AI cuts in after "Northwestern Memorial", **or** any pause exceeds 2.5 s of unfilled silence.
2. **Mid-answer pause reciting DOB.** "March… fifteenth… nineteen… eighty-five." → no interruption; DOB saved correctly and encrypted; **`ssn`/`dateOfBirth` show zero LLM judge calls in the log** (§3.3 rung 8).
3. **Mid-answer pause reciting email.** "j-o-h-n dot… hold on… s-m-i-t-h at gmail dot com." → no interruption; full address captured; the spoken-email normalizer fires (`source:"validator"` in the log, not two holds).
4. **Fast simple answer.** "Two bedrooms." → responds within the **gated-turn budget from §3.9** (this is question 5, an application answer, so it is a *gated* turn — the original plan wrongly held it to the 1.5 s non-gated bar). **Fail:** the prefilter returns `MORE` at all, or any dead air > 2.5 s.
5. **Household size in words.** "Just me and my wife." → immediate response; no hold. (Covers the deleted `number → parseIncome` mapping.)
6. **Employment start date in the past.** "June 2019." → immediate response; no hold. (Covers the deleted `date → parseMoveInDate` mapping.)
7. **Yes/no confirmation and read-back confirmation.** "Yes, that's right." after a spell-back → immediate response, **zero judge calls** (`source:"intent"` or `"affirmation"`).
8. **Genuine silence.** Answer nothing at all for 5 s → the AI re-prompts once at ~2.5 s, does not sit mute and does not spin. **This must pass with no commit ever occurring.**
9. **Cough during a hold.** Trail off mid-SSN, then cough (no words) and stay quiet → the AI still speaks within ~2.5 s. **Fail:** any indefinite silence.
10. **Interrupting the AI.** Talk over a long AI utterance → its audio stops at your ear promptly; the conversation continues coherently; the transcript does not claim it said what you never heard.
11. **Texting an answer mid-question.** Start speaking your email, stop, then text it from the calling phone → AI acknowledges the text within ~2 s, moves on, **does not** later nudge about the abandoned spoken fragment, the truncated spoken fragment does **not** appear in the conversation or get saved, and the transcript marks it `(texted)`.
12. **Judge-service outage.** Set `ai_validation.api_key` to a bogus value (or `VOICE_JUDGE_TIMEOUT_MS=1`) mid-run → the call degrades to M3 behaviour and stays fully conversational; `[turn-gate] judge-degraded` appears and no further judge calls are made. **Fail: any dead air > 3 s or a mute AI.** Most important scenario in the list.
13. **Reconnect mid-question.** Force an OpenAI socket drop while a question is pending → session resumes with `pendingQuestion` intact, no spontaneous re-greeting, gating still active.
14. **Reconnect mid-AI-utterance.** Force a drop while the AI is *speaking* → the AI resumes on its own without the caller having to say "hello?". (The original scenario 10 only covered a drop while a question was pending, which hides the worst case.)
15. **Tool-result race.** Answer a question and immediately keep talking ("…actually make that 4200") while the save is in flight → the AI responds to the correction; nothing is dropped.
16. **Full 11-question application end-to-end** → Application row complete with every field, DOB encrypted, exactly one owner forward, transcript coherent with **exactly one merged entry per answer**.

**Exit criteria:**
- Scenarios 1–3, 5–9, 11–15 pass outright; scenario 4 within the §3.9 gated budget; scenario 10 within ~300 ms; scenario 16 clean.
- `[turn-timing]` p95 ≤ **the §3.9-derived gated budget** on gated turns and ≤ 1.5 s on non-gated turns.
- **`source === "failopen"` is < 5 % of gated verdicts** and judge p95 is under the 400 ms timeout. (Without this gate the feature can ship, be a complete no-op under load, and still pass everything else.)
- **Added call seconds** (§3.13) computed from the logs and recorded here; > 15 s on a 10-minute call sends the prefilters back for another rung.
- **Zero occurrences** of `[turn-gate] deadlock-recovery` across all scenarios. Any occurrence is a shipped invariant-1 bug and blocks release regardless of everything else.

---

## 5. Risks & fail-safes

| Risk | Fail-safe |
|---|---|
| **The AI goes mute (invariant 1)** | Four independent layers: `requestResponse` **queues** rather than drops (with `system` priority for tool results and wrap-ups); stale verdicts still fire a response; `awaitingCallerTimer` (2.5 s) armed on `response.done` and refreshed — never cleared — by `speech_started`; `deadlockWatchdog` (6 s, bidirectional-silence) independent of the turn machine. Every `return` in the turn machine is annotated with which layer covers it. **Zero deadlock-recovery events is a release gate** |
| **Silence is worse than an early cut-in (invariant 2)** | Floor cut from 8 s to 2.5 s; nudge is a neutral continuer ("Got it —"), never "take your time"; every false-`MORE` class from the original design (confirmation turns, `number` questions, past dates, spoken emails) is removed at the prefilter rather than absorbed by the floor |
| **Judge scores a confirmation turn against the pending question** | `classifyTurn()` gates on the *last AI utterance*, not the pointer: `READBACK`/`OTHER` → `COMPLETE` with zero calls; affirmation set as a redundant second rung; validators run only on `ASKING` turns. Tested at M4 and M6 with `ssn` + read-back + "yes that's right" |
| **Domain validators mistaken for completeness detectors** | Validators may return only `COMPLETE` or `null`. `type → validator` mapping deleted. `MORE` comes only from tail truncation signals. M4 asserts "two", "one", "just me and my wife", "June 2019", "about 4200 a month" never yield `MORE` |
| **Judge holds forever on a mis-transcribed field** | `unproductiveHolds` cap of 2 **and** a `holdCount` ceiling of 4, then `ungated` for the rest of that question; plus the 2.5 s floor; plus the 6 s watchdog. Productive holds (fragment adds real content) do not consume the cap, so a genuinely long recitation keeps its patience |
| **Latency creep** | Gate is scoped to `ASKING` turns only; intent/affirmation/backchannel/empty rungs kill >half the candidates for free; judge timeout 400 ms with auto-disable after 3 failures; the §3.9 veto can drop the transcript wait or disable the judge entirely based on M0 measurements; `[turn-timing]` p50/p95 at every live gate; **failopen rate and added-call-seconds are exit criteria** |
| **Judge silently degrades to a no-op under load** | `[turn-gate] judge-degraded` warn + auto-disable after 3 consecutive timeouts; M8 exit gate on `source==="failopen"` < 5 % |
| **Speculative dispatch fires repeatedly / stale verdict wins** | One in-flight judge per `item_id` with `AbortController`; verdicts tagged `{itemId, partialLength}` and re-judged if the final transcript diverges; the whole speculative path is conditional on M0 and the non-speculative path is the shipped default |
| **`semantic_vad` unsupported on the configured model** | M0 decides before code is written; fallback `server_vad` + `silence_duration_ms: 1200` preserves layers 1–3. `session.updated` echo is logged **and asserted**, so a silently-rejected config cannot ship |
| **`create_response: false` unsupported with `semantic_vad`** | Linchpin. If M0 disproves it, fall back to `server_vad` + `create_response: false` and accept worse layer-0 segmentation. **Do not** fall back to cancel-after-start |
| **Nudge/probe turn loses the persona and tool rules** | Per-response `instructions` **overrides** session instructions, so it is banned outright; all injections go through `sendSystemEventQuiet` + a plain `requestResponse`. Enforced by a test asserting no `response.create` frame carries `instructions` |
| **Out-of-order transcriptions scramble the answer** | `pendingItems` (committed order) + `transcriptsByItem`, contiguous-prefix materialization, `transcription.failed` handled explicitly |
| **Held fragments lost to a discard** | Accumulator writes precede every guard; `answerEpoch` (discard) and `utteranceSeq` (continuation) are separate counters |
| **Reconnect goes permanently silent** | `greetOnOpen:false` means no *greeting*, not no response: quiet resume system item + explicit `requestResponse` after `session.updated`, `heldFragments` folded into `resumeInstructions`, inbound media ring-buffered across the reconnect window, `responseInFlight` reset. M8 scenario 14 forces a drop mid-AI-utterance |
| **Texted answer races a half-spoken one** | `input_audio_buffer.clear` before `sendUserText`, `suppressItemsBefore` + `conversation.item.delete` (or a quiet ignore note), hold-state clear, `answerEpoch` bump. Ordering asserted in M6 |
| **Transcript double-push / inflated summary** | The turn gate is the sole writer of `role:"user"` entries (`suppressUserTranscriptPush`); merged flush on COMPLETE/PROBE/cap/call-end |
| **PII egress to a second model** | `ssn` and `dateOfBirth` terminate in the prefilter with a verdict and **never** reach the LLM — enforced by a test that stubs `fetch` and asserts zero calls at any `holdCount`. The original claim was false: rung 4's `null` fallthrough at `holdCount >= 1` shipped partial SSNs to a second model on exactly the headline scenario. If an LLM verdict is ever needed, send a masked digest ("5 of 9 digits spoken") |
| **Spoken SSNs escape transcript redaction** | Merging fragments does **not** fix this — `redactTranscriptPII`'s two regexes never match word-digits. Real fix is the M6a spoken-digit redaction pass, landed as its own commit so the merge cannot be mistaken for a security fix |
| **`answerValidation` silently lost on voice** | It stays blocking; only its timeout drops (3000 → 700 ms). Fire-and-forget is deleted, and the contradictory §3.6 sentence with it. Tested: `{valid:false}` still yields `{success:false}` on voice |
| **Barge-in truncate claims unheard audio** | `audio_end_ms` from mark-ack playout (or wall clock), capped by bytes/8 — never the raw forwarded-byte count. M7 gate asserts against elapsed playout, not the byte counter |
| **Global patience regresses fast answers** | `Property.voicePatience` defaults to `"auto"`; real patience is per-question `eagerness` pushed on each save; the property knob is only a global offset |
| **Double / overlapping responses** | Single `requestResponse` chokepoint + `responseInFlight`, all five pre-existing sites routed through it, plus the two error codes resetting the flag |
| **Self-echo poisoning the VAD** | `bidirectionalMode="rtp"` + unchecked `media.track` — measured at M0 before any VAD tuning is trusted |
| **Prompt and transport give contradictory orders** | The two "wait up to 10 seconds" rules are deleted in the same commit that makes waiting real (M6) |
| **Feature works in testing, no-ops in production** | The realtime model dropdown offers only preview models while the code speaks the GA protocol. M0 verifies against the **DB default** model; if they diverge, the model list is updated in the same change |

---

## 6. User actions required

Nothing in M0–M7 can be gated on these except where noted, but the plan cannot complete without them.

1. **Confirm the realtime model to target.** M0 tests the **DB default** (`gpt-4o-mini-realtime-preview`). If it rejects `semantic_vad` or `create_response:false`, decide whether to (a) update the dashboard model dropdown to a `gpt-realtime*` GA model for all properties, or (b) ship the `server_vad` fallback. **Blocks M3.**
2. **Provide / confirm the `ai_validation` API key** in SystemConfig (or confirm the fallback to `openai.api_key` is acceptable for judge traffic). **Blocks M5.**
3. **Approve the `answerValidation` timeout change** on voice (3000 ms → 700 ms). It preserves the re-ask behaviour but slightly increases the chance of a fail-open save on a slow API. **Blocks M7.**
4. **Approve two new `Property` columns** (`voicePatience`, `turnJudgeEnabled`) and run the migration on production. **Blocks M3.**
5. **Be available for the M8 human call gate** — 16 scenarios, roughly 45 minutes on the phone, ideally with a second phone for the texting scenario. Scenario 12 requires temporarily setting a bogus `ai_validation.api_key`, so run it on a test property.
6. **Decide the rollout posture for `turnJudgeEnabled`.** Recommended: layers 0–1 (M3) to everyone, judge enabled on one pilot property for a week before wider rollout.
7. **Telnyx `clear` / `mark` behaviour under `bidirectionalMode="rtp"`** may need a support ticket if the M0 spike is inconclusive. **Blocks the barge-in half of M7 only**; the rest of M7 ships without it.
