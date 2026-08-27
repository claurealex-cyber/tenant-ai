# Every-Call Greeting + Text-at-Start — Implementation Plan (BUILT & LIVE 2026-08-27)

**STATUS: BUILT & LIVE.** VC1 (text at call start), VC2 (greeting script + no phone application), VC3 (live gate) done. Live config: `caller_link=every_call`, `voice_intake=link`, `voice_greeting`=the owner's script. Verified against the running server: the built voice prompt opens with the exact script verbatim, collects no application, offers Q&A, and the text tool is present; suite green except 4 pre-existing zillow-litter tests. Root fix during build: the greeting-wording change initially broke an existing property-greeting test → strict "say EXACTLY" wording is now applied ONLY to the voice-link script; property.greetingMessage keeps its original wording. Not directly provable without a real inbound call: the SMS actually firing on the WS `start` event (fire-and-forget call to the unit-tested textLinkToCaller; guarded by linkSentAt so the end-of-call path can't double-send).



**Goal:** On EVERY call, the AI immediately texts the application link and opens with a fixed script, then answers property questions — no application taken by voice. Toggleable/revertible from the dashboard.

Target greeting (exact words, editable in the panel):
> "Hello, thank you for calling Ghem Properties. We are texting you a link to our Google Forms application. Please fill it out at your earliest convenience and we will get back to you as soon as we review your application. Thank you. Do you have any questions about the property I can answer for you?"

Config that drives it (all in the `sms_relay` integration, one-click/edit on Admin → SMS Relay, ≤60s live via the refresh route):
- `caller_link = every_call` (DONE — text the link)
- `voice_intake = link` (AI answers questions, does NOT collect an application by voice)
- `voice_greeting = <script>` (NEW field — the opening line; used only when voice_intake=link)

Design notes / couplings:
- The text is sent at call **start** (not end) so the greeting can truthfully say "we are texting you a link". The existing end-of-call every_call send stays as a fallback, guarded by `linkSentAt` so it never double-sends.
- The link is whatever the survey toggle selects (Google Form vs hosted). The greeting hard-codes "Google Forms" per the owner's words — if Survey Link Mode is ever set back to hosted, edit `voice_greeting` too. (Flagged, not auto-managed.)
- Anonymous/blocked callers and known tenants get NO text (can't/shouldn't); the greeting still plays. Opted-out numbers get no text.

## Milestones

### VC1 — Text the link at call start
- In the `start` event (`call-handler.ts`, after `addCall`): if `caller_link === "every_call"`, fire `textLinkToCaller({ source: "call_start" })` fire-and-forget; on sent/already_sent set `callEntry.linkSentAt`. Never block call setup on the send.
- End-of-call every_call path already checks `linkSentAt` → no double send.
**Stress:** fires once per call; anonymous caller → no text, call proceeds; send failure → call proceeds, logged; a completed-by-voice app is impossible here (voice_intake=link), but the end path's guards still hold; tenant caller → no text.

### VC2 — Greeting script + no phone application
- New `sms_relay.voice_greeting` field (integrations.ts). `PromptBuilderInput.voiceGreeting`; when `channel=voice` and `voiceIntake="link"`, the AI's greeting instruction uses `voice_greeting` (falling back to `property.greetingMessage`, then the generic greet). The voiceIntake=link rules (no SSN/DOB/income, don't call start_application, offer Q&A + the texted link) already exist from the caller-link work.
- Set live config: `voice_intake=link`, `voice_greeting=<script>`.
**Stress:** prompt contains the exact greeting + "Do NOT collect application details"; `start_application` absent from the voice tool set when voice_intake=link; default (voice_intake=phone) prompt unchanged; empty voice_greeting → falls back to property/generic greeting.

### VC3 — Live gate + revert
- Live: replay a `start` event path (script) against the running server — link texted immediately (relay ledger row / already_sent), greeting string present in the built instructions, Q&A answers a property question, no application is created.
- Revert drill: set `caller_link=off` / `voice_intake=phone` → prompt/tools back to today's application flow; no call-start text.

## Files
`packages/shared/src/{integrations.ts,prompts.ts,types.ts}`, `apps/server/src/handlers/call-handler.ts` (+ tests), config rows (`caller_link`, `voice_intake`, `voice_greeting`).
