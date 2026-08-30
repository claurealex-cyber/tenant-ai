# Zillow Applicants → API Relay — Plan (discovery COMPLETE)

## Investigation result: no new scrape needed — applicants are already in our data
Live-probed the logged-in Safari session (2026-08-29). The people who APPLIED are
already present in the `leadManagementTable` payload we scrape today — the current
parser just discards the field.

### The applicant signal (confirmed)
Every lead row carries `applicationInfo`:
  { numCoApplicants, isApplicationsAccepted, isApplicationSent, isApplicationCompleted }
- `isApplicationCompleted === true`  → **the renter actually applied** ← THE FILTER.
  (32 of the first 100 rows; totalLeadCount = 335, so ~100+ applicants likely.)
- `isApplicationSent`  → landlord invited them to apply (0 in sample).
- `isApplicationsAccepted` → the LISTING accepts applications (all true — a listing
  setting, NOT an applicant signal; do not use it to identify applicants).
- Secondary signals on `status`: applicationMarkedSent, isOffPlatformApproved,
  isActiveTenant, isArchived, isSpam.
Applicants carry the same contact fields as leads: renterInfo.renterName,
renterPhoneNumber, renterRelayEmailAddress → already textable via the existing path.

### What I ruled out
- No `applicationsTable` endpoint (all guesses 404).
- `landlord/v1/application/applicationsAccepted` exists but returns 400 to the
  paging body — it needs a listing/application id; it is NOT a bulk list. Not needed.
- A cold top-level navigation to /rental-manager/applications bounces to login, so a
  separate applications scrape would be fragile anyway. The field-on-existing-leads
  route avoids all of that.

### The only code gap
parseZillowLead (zillow-import.ts) reads renterInfo/listingDetails/statusLabel/
latestContact but NOT `applicationInfo`. Add it → applicants become queryable, and
the existing scrape/schedule already fetches them.

## Milestones

### M1 — Parser + schema (capture the applicant signal)
- Extend ParsedLead + parseZillowLead to read applicationInfo:
  `applicationCompleted` (isApplicationCompleted), `applicationSent`, `coApplicants`.
- Add ZillowLead columns: `applicationCompleted Boolean @default(false)`,
  `applicationSent Boolean @default(false)`, `coApplicants Int @default(0)`
  (+ index on applicationCompleted). Prisma migrate deploy on boot (keep clean).

### M2 — Ingest wiring + backfill
- ingestLeads writes the new fields on BOTH create and update, so the next scrape
  backfills the flag onto all existing 335 rows (no separate backfill job).
- Verify counts: after one scrape, `count(applicationCompleted=true)` matches the
  live sample ratio.

### M3 — Applicant segment in the API relay (toggleable)
- buildTextEmAllCsv gains a `segment: "leads" | "applicants"` filter:
  applicants = applicationCompleted=true, baseline-fresh, opt-out-filtered,
  not-already-sent (per-segment sent tracking). Reuse the realtime-plan lessons:
  broadcast ONLY when there are genuine new applicants (no owner-only sends),
  flip only sentPhones, sent-batch dedup.
- Distinct `applicant_broadcast_message` (they ALREADY applied — a follow-up / next-
  steps message, NOT the apply link). Route via sendBroadcastViaApi (api mode).
- Segment dedup: a person who applied is also a lead — decide the rule (default:
  applicants are EXCLUDED from the lead broadcast and messaged only on the applicant
  segment, so no one gets both). Separate sent-batch namespaces per segment.

### M4 — Dashboard surface
- Applicants filter/tab on /admin/zillow (status = applied) with count; a toggle to
  relay to applicants (delivery-method model) + the applicant message field. Routing-
  status readout gains an applicants line.

### M5 — Schedule (rides the existing scrape)
- No new scrape/cron: applicants come from the same leadManagementTable pull. The
  applicant broadcast is just another segment evaluated in the same run (scheduled or
  realtime), under the same GUI lock + whole-cycle mutex.

### M6 — Stress tests
- applicationCompleted parsed correctly (fixture from the real sample shape).
- Applicant filter selects only isApplicationCompleted=true.
- No double-message: someone who is a lead AND applicant gets exactly one (per the M3
  rule); opt-out respected; owner-only no-send gate; per-segment sent-batch dedup.
- Live toggle on/off; message content correct for applicants.

## Decisions for the user
1. **Message to applicants** — they already applied. Follow-up/next-steps text?
   (Not the "apply here" link.) What should it say?
2. **Segment rule** — message applicants ONLY on the applicant segment (exclude from
   lead broadcast) [recommended], or allow both?
3. Include `isApplicationSent` (invited-but-not-applied) as a separate segment later?

## Non-goals / risks
- Relies on Zillow keeping `applicationInfo` in leadManagementTable (stable so far).
- No separate applications scrape (ruled out as fragile + unnecessary).
- Applicant phone is the Zillow relay number (same as leads) — deliverability is
  identical to the current lead relay.
