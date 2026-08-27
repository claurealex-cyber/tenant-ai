# Intake Reply Style + Caller Links — Operating Notes

All controls live on **Admin → SMS Relay** (dashboard), take effect within a click, and revert with a click. The link they send is whatever **Survey Link Mode** (Google Form vs hosted survey) is set to — one switch governs texts, Zillow blasts, and calls.

## Reply style (texts to the property number)
- **Link only** (default): texts the application link, as before.
- **Link + Q&A**: first text → greeting + link + "reply with questions"; later texts → the AI answers about the property (rent, availability, pets, parking, utilities, amenities, tours) from the property's Units/Description, and points to the link to apply. It never collects an application by text.
- Edit the greeting with **Q&A Greeting**. The per-property auto-reply is used only by **Link only**.

## Callers (phone calls to the number)
- **Text callers the link**: Off (default) · When asked (AI texts the link on request / when they'd rather apply online) · Every call (also texts at hang-up if no application was completed).
- **Phone application**: Take it by phone (default) · Link only (AI answers + texts the link instead of collecting details by voice — needs Text Callers ≠ Off).

## Caps & the personal-number caveat
While the **Messages relay** is on, Q&A answers and caller links go out from the personal number (708) 415-8984. Guardrails:
- Q&A has its OWN budget, separate from link/forward sends: `qa_hourly_cap` (10), `qa_daily_cap` (40), `qa_daily_cap_per_phone` (8). It never starves the link/forward budget.
- Caller links are normal `link` sends (link cooldown + budget + new-recipient cap).
- Watch **Q&A replies today** on the panel. Sustained volume from a personal number risks carrier spam-flagging — raise caps only after watching the ledger, or wait for 10DLC so sends move to the Telnyx number (no caps, no personal-number exposure).

## Requirements
- **Property data**: price answers need `Unit` rows (Dashboard → Properties → Units) or a price paragraph in the property Description. Without either, the AI says "the team will follow up".
- **OpenAI key**: set in Dashboard → Integrations → OpenAI (already configured). If the API is down, texters get one "the team will get back to you" reply.

## Revert
- Reply style → click **Link only**. Callers → click **Off**. Nothing else changes; in-flight conversations just get the link again on their next text.
