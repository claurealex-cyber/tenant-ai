# Plan: reveal + copy (and export/import) integration API keys

> **BUILD STATUS — COMPLETE (2026-08-28).** All milestones built + green (65 tests).
> Decisions: admin session is enough (no re-auth); export is **plain JSON**.
> New routes: `reveal`, `export`, `import` under `/api/admin/integrations/` (admin-gated,
> audited, no-store). UI: per-field Reveal+Copy + header Export/Import buttons with a
> plain-text warning. Needs a dashboard rebuild+restart to go live.

## Goal
Let an admin **see and copy** the actual API-key values stored in the Integrations tab,
so the same credentials can be re-entered on another instance of the app (the Windows
box). Today the keys are write-only by design; this adds a controlled reveal path plus
an optional whole-config export/import that is the fastest way to clone credentials to
the second machine.

## Current state (investigated)
- Keys are stored **encrypted** in `SystemConfig` (`encrypt`/`decrypt`, key
  `PII_ENCRYPTION_KEY`), read via `resolveConfig(ns, key)`.
- `packages/shared/src/integrations.ts` — `INTEGRATION_REGISTRY`; each field has
  `{ key, label, envVar, sensitive, required, placeholder, helpText }`.
- `apps/dashboard/src/app/api/admin/integrations/route.ts`
  - `GET` returns per-field `{ key, label, sensitive, required, hasValue, source,
    updatedAt }` and **never the value** (explicit "NEVER return actual key values").
  - `PUT` encrypts + upserts, admin-gated (`session.user.role === "admin"`), writes an
    `auditLog` (`action: "integration_config_update"`), then `clearConfigCache()`.
- `apps/dashboard/src/app/admin/integrations/page.tsx` (407 lines) — renders each field
  as an `<input type=password>` (sensitive) with a show/hide eye that only unmasks what
  the admin *types*; existing stored value shows as a `••••` placeholder in an empty box.
- The dashboard Next process has both `PII_ENCRYPTION_KEY` (so `decrypt` works there) and
  `process.env[field.envVar]` (so env-sourced values are readable there too).
- Access path: dashboard is reachable over the public ngrok/Caddy tunnel, so any new
  reveal endpoint is potentially internet-facing behind the admin session.

## Design principles
- **On-demand, per-field reveal** — never fold secret values into the bulk `GET` (keeps
  them out of every page load, browser cache, and logs).
- **Admin-gated + audited** — every reveal and every export writes an `auditLog` row
  naming which field/integration was revealed and by whom.
- **`Cache-Control: no-store`** on every response that carries a secret.
- **Additive & reversible** — the existing write-only behavior is untouched unless the
  new reveal is explicitly invoked.
- **Cross-machine export is passphrase-encrypted** — a leaked export file is useless
  without the passphrase, and it is independent of each instance's `PII_ENCRYPTION_KEY`.

## Milestones (each ends with a green gate)

### M0 — Confirm scope & decisions (no code)
- Confirm: reveal covers **both** DB-sourced and env-sourced values (admin needs both to
  replicate). Confirm the export/import (M3) is wanted (it is, for the Windows clone).
- **DECIDED:** (a) admin session is enough — NO re-auth. (b) export is **plain JSON** (no passphrase) — user chose zero-friction; UI must warn the file is secrets in the clear + delete-after-import.

### M1 — Reveal API (backend)
- New route `POST /api/admin/integrations/reveal` (POST, not GET, so the field isn't in
  URLs/logs). Body `{ integrationId, fieldKey }`. Admin-gated.
- Resolves the value: DB row → `decrypt(value)`; else `process.env[field.envVar]`; returns
  `{ value, source }` or `{ value: null, source: "none" }`. `Cache-Control: no-store`.
- Writes `auditLog` `action: "integration_secret_revealed"`, metadata `{ integrationId,
  fieldKey }`.
- **Gate (tests):** non-admin → 403; DB-sourced returns exact decrypted value; env-sourced
  returns env value; unknown integration/field → 400; audit row written; no-store header.

### M2 — Reveal + Copy in the Integrations UI
- For each field with `hasValue`, add a **Reveal** (eye) button that calls M1 on demand,
  shows the value in a read-only box, and a **Copy** button (`navigator.clipboard`, with a
  textarea `execCommand('copy')` fallback for non-secure contexts). Show the source
  (database/environment) next to it.
- Auto-hide the revealed value after ~20s or on blur; reveal is per-field (not all at once).
- **Gate:** manual pass on a real field + a component/interaction test; the existing
  save/clear flow still works unchanged.

### M3 — Whole-config export / import (the cross-machine path)
- **Export:** `POST /api/admin/integrations/export` → collects every configured field
  (DB decrypted + env) across the registry into `{ "<integrationId>.<fieldKey>": value }`,
  wraps it in a **passphrase-encrypted** blob (AES-GCM from a user-supplied passphrase via
  PBKDF2/scrypt), returns it as a download `tenant-ai-integrations-<date>.enc.json`.
  Admin-gated, audited (`integration_config_exported`, with the list of keys, never
  values), `no-store`.
- **Import (run on the Windows instance):** `POST /api/admin/integrations/import` accepts
  the blob + passphrase, decrypts, validates each key against `INTEGRATION_REGISTRY`
  (skips unknown), `encrypt`+upserts into that instance's `SystemConfig`, `clearConfigCache()`,
  audited (`integration_config_imported`). Skips + reports any keys not in the registry.
- UI: an "Export credentials" button (with a passphrase prompt + a bold warning) and an
  "Import credentials" upload (passphrase prompt) in the Integrations tab.
- **Gate:** round-trip test — export on A, import into a fresh DB, every value matches;
  wrong passphrase → clean failure; unknown keys skipped; audit rows on both ends.

### M4 — Security hardening
- Optional re-auth (per M0 decision) before reveal/export.
- Rate-limit the reveal/export endpoints; ensure no decrypted value is ever `console.log`'d
  or cached; confirm `no-store` everywhere.
- Optional: surface "secret revealed/exported" events in the existing admin audit view so
  the owner can see when credentials were pulled.
- **Gate:** grep the server logs during a reveal/export — zero secret material; audit
  entries present; non-admin blocked on all three new endpoints.

### M5 — Stress test + docs
- Values with special chars / newlines / very long keys round-trip through reveal + export.
- Env-only field, DB-only field, unset field each behave correctly.
- Clipboard fallback works over plain http (if ever accessed non-HTTPS).
- Reversibility: feature is additive; disabling is just not calling it.
- Doc: "Clone credentials to another instance" — export on Mac → carry the `.enc.json` →
  import on Windows with the passphrase.

## Risks / stress points (fold into M4–M5)
1. **Bigger exposure surface.** Copyable secrets can land in screenshots, clipboard
   managers, browser history. Mitigated by on-demand reveal, no-store, auto-hide, and full
   audit. Accept the residual risk (admin-only, intentional action).
2. **Internet-facing via ngrok/Caddy.** A compromised admin session could pull all keys.
   Mitigate with admin-gate (existing) + optional re-auth + rate-limit; consider
   restricting the reveal/export routes to the tailnet/local origin if remote reveal isn't
   needed.
3. **Export file = all secrets in one place.** Highest-risk artifact → passphrase-encrypt
   it (M3) so the file alone is useless; warn the user to delete it after import.
4. **`PII_ENCRYPTION_KEY` differs per instance.** Fine — export/import moves *plaintext*
   values (inside the passphrase blob), each instance re-encrypts with its own key. No
   dependency on matching PII keys.
5. **Env-sourced values on the other machine.** If a key is only in the Mac's `.env` (not
   DB), export still captures it (dashboard reads `process.env`); import writes it to the
   Windows DB. Note this so nothing is missed.

## Out of scope
- Changing how services *use* keys (`resolveConfig` unchanged).
- The Twilio/relay runtime behavior.
- Rotating any exposed keys (separate task; recommended if the public repo ever carried one).
