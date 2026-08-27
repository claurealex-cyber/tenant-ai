# Tenant-AI — Text-Em-All Sending via Zapier (Option A: Sheet → Contact Group → manual broadcast)

**Goal:** Program the *population* of a Text-Em-All contact group from Tenant AI, over **free**
Zapier, then send survey-link broadcasts to that group by hand. Chosen after live testing proved
the constraints below.

> **Live-proven 2026-08-27.** Full pipe works end-to-end: Google Sheet row → Zapier →
> Text-Em-All broadcast → **real text delivered** (from caller ID **(312) 702-1085**). The first
> broadcast sat at Text-Em-All's `AwaitingAutomaticApproval` gate (new-account compliance review)
> then cleared. Two hard constraints discovered and now designed around:
> 1. **Send Broadcast targets a Contacts GROUP, not per-row phone numbers.** Recipients come from
>    a saved Text-Em-All group; the action also needs Broadcast Name, Start Date (**set to `now`**
>    or it schedules for later — this bit us), Caller ID (the 312 number), and Message.
> 2. **Free Zapier = one action per Zap**, so a single Zap cannot both add a contact AND send.

## The Option A model (decided)

- Tenant AI **appends one row per new lead** to a Google Sheet.
- A free Zap turns each new row into a **Text-Em-All contact in a standing group** ("Tenant AI
  Leads") via the **Create or Update Contact** action.
- The human **sends the broadcast** to that group in Text-Em-All when a batch is ready, then
  **rotates/clears** the group so nobody is re-texted.
- This keeps sending compliant + human-gated, and needs no paid Zapier and no Text-Em-All API tier.

## Guards (unchanged from the app's existing discipline)

Before any lead reaches the sheet: filter out `SmsOptOut` numbers, dedupe against a new
`TextEmAllContact` ledger (idempotency key = the sheet `sendId`), and log every push. A 2xx from
the Sheets API means "row written", not "texted" — delivery is the human broadcast + Text-Em-All.

---

## Milestones

### M0 — Zaps + account  (mostly done / in progress)
- [x] Text-Em-All account onboarded + first-broadcast approval cleared (delivery proven).
- [x] Send Broadcast Zap built and tested (Sheet → broadcast → real text). *(kept for reference;
      Option A sends the broadcast manually, so this Zap can be paused to avoid double-sends.)*
- [ ] **Create/Update Contact Zap** (the app-facing one): Google Sheets *New Spreadsheet Row* →
      Text-Em-All **Create or Update Contact**, assigning the contact to group **"Tenant AI
      Leads."** ⟲ VERIFY the Create Contact action exposes a **Group** field — if it can't assign
      a group, Option A needs a rethink (fallback: pre-create the group and import, or a group per
      batch). Test: a manual sheet row creates a contact in the group.
- [ ] Confirm free-plan limits are acceptable: ~15-min polling, 100 tasks/month, Zap count cap.
- **Gate:** a manual row lands a contact in the "Tenant AI Leads" group, visible in Text-Em-All.

### M1 — App side: Sheet writer + ledger + guards (buildable now vs a mock Sheets client)
- [ ] `TextEmAllContact` ledger model (migration): phone, name, status (pending|written|skipped),
      sendId, sheetRow?, error?, createdBy, createdAt.
- [ ] `services/textemall-sheets.ts`: `pushLeadsToGroup(leads)` → filter `SmsOptOut`, dedupe vs
      ledger, write rows to the Google Sheet via the Sheets API, record ledger rows. Sheet id +
      Google service-account creds from encrypted config (`textemall.sheet_id`,
      `textemall.google_sa`).
- [ ] Tests (mock the Sheets client): opt-out filter drops STOP numbers, dedupe, ledger lifecycle,
      empty-after-filter no-op, creds-missing error.
- **Gate:** unit tests + full suite green (Sheets client mocked; no live write yet).

### M2 — Google service account + live wire
- [ ] Create a Google Cloud **service account** (free), enable the Sheets API, download the JSON
      key, **share the sheet** with the service-account email (Editor). Store the key in encrypted
      config. *(4-click guide provided at build time.)*
- [ ] Live gate: `pushLeadsToGroup([operator number])` writes a row → the Create-Contact Zap adds
      it to the group → a manual broadcast delivers to the operator's phone.

### M3 — Dashboard control
- [ ] A **Text-Em-All** panel / action: "Add N new leads to the Text-Em-All group" button
      (drawn from Zillow/SMS leads), a per-push history from the ledger, and a link to the
      Text-Em-All Broadcasts page to send. Encrypted-config toggle `textemall.enabled`.
- [ ] Reminder copy in the UI: after sending, rotate/clear the group; set broadcast Start Date to
      `now`; the 312 caller ID is the sending identity.
- [ ] Route/panel tests.
- **Gate:** tests + build green; from the dashboard, pushing the operator's number populates the
      group and a manual broadcast reaches the phone.

### M4 — Stress + handoff
- [ ] Full suite + build; feature ships OFF; docs on the manual-broadcast + group-rotation step.

## Risks
| Risk | Mitigation |
|---|---|
| Create Contact action can't assign a group | verify in M0; fallback to a per-batch group or manual import |
| Re-texting the same people (group persists) | rotate/clear the group after each broadcast; ledger tracks who was pushed |
| Free Zapier polling delay / 100-task cap | acceptable at ~10 new/day; batch pushes; documented |
| Sending to an opted-out number | `SmsOptOut` filter before the row is ever written |
| Service-account key leak | encrypted config only, 0600, never logged; rotate if leaked |
| Broadcast stuck on Text-Em-All approval (new account) | first-send cleared; support can release future holds |
| Duplicate rows → duplicate contacts | dedupe vs ledger + `sendId` idempotency; Create/Update upserts by phone |
