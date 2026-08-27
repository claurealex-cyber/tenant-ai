import { resolveConfig } from "./config-resolver.js";

/**
 * Survey-link mode — which link intake texts send to prospective tenants.
 *
 *   hosted       → the self-hosted tokenized survey (<base>/survey/<token>)
 *   google_form  → an external Google Form (responses land in Google, not in
 *                  the Application table)
 *
 * This module is the single source of truth for mode parsing, URL validation
 * and the effective-mode decision; the server (link minting) and the dashboard
 * (status display) both go through it so they can never disagree.
 */
export type SurveyMode = "hosted" | "google_form";

export const SURVEY_MODES: readonly SurveyMode[] = ["hosted", "google_form"];

/** Only Google-owned form hosts are accepted — never text an arbitrary URL. */
export const GOOGLE_FORM_URL_PATTERN =
  /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)[^\s]+$/i;

/** Anything that is not exactly (case/space-insensitively) `google_form` is hosted. */
export function normalizeSurveyMode(raw: string | null | undefined): SurveyMode {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "google_form" ? "google_form" : "hosted";
}

export function isValidGoogleFormUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && GOOGLE_FORM_URL_PATTERN.test(url.trim());
}

/**
 * Substitute optional `{phone}` / `{property}` placeholders (for pre-filled
 * form URLs, e.g. `...viewform?usp=pp_url&entry.123={phone}`). Values are
 * URL-encoded; unknown placeholders are left untouched.
 */
export function fillSurveyFormUrl(
  url: string,
  values: { phone?: string; property?: string },
): string {
  return url
    .trim()
    .replace(/\{phone\}/g, encodeURIComponent(values.phone ?? ""))
    .replace(/\{property\}/g, encodeURIComponent(values.property ?? ""));
}

export interface SurveyModeConfig {
  /** What the operator asked for. */
  requestedMode: SurveyMode;
  /** What will actually be sent (google_form only when the URL is valid). */
  mode: SurveyMode;
  /** The configured form URL (raw, before placeholder substitution) or null. */
  formUrl: string | null;
  /** Human-readable reason when `mode` differs from `requestedMode`. */
  warning: string | null;
}

/** Pure decision: effective mode from the two raw config values. */
export function decideSurveyMode(
  rawMode: string | null | undefined,
  rawUrl: string | null | undefined,
): SurveyModeConfig {
  const requestedMode = normalizeSurveyMode(rawMode);
  const formUrl = rawUrl?.trim() || null;

  if (requestedMode === "hosted") {
    return { requestedMode, mode: "hosted", formUrl, warning: null };
  }
  if (!isValidGoogleFormUrl(formUrl)) {
    return {
      requestedMode,
      mode: "hosted",
      formUrl,
      warning: formUrl
        ? "google_form_url is not a Google Forms link (https://docs.google.com/forms/… or https://forms.gle/…) — sending the hosted survey instead."
        : "survey_mode is google_form but google_form_url is empty — sending the hosted survey instead.",
    };
  }
  return { requestedMode, mode: "google_form", formUrl, warning: null };
}

/** Signature of `resolveConfig` — injected so callers control the config source. */
export type ConfigReader = (
  integrationId: string,
  fieldKey: string,
  defaultValue?: string,
) => Promise<string | null>;

/**
 * Resolve the effective survey mode from runtime config
 * (`sms_relay.survey_mode` / `sms_relay.google_form_url`, DB first, then
 * `SMS_RELAY_SURVEY_MODE` / `SMS_RELAY_GOOGLE_FORM_URL` env). Falls back to
 * hosted — with a warning — whenever google_form is requested without a valid
 * URL, so a misconfiguration can never text a broken link.
 *
 * `read` is explicit (not the module-internal `resolveConfig`) so a caller's
 * own — possibly mocked or differently-sourced — reader is what gets used.
 */
export async function resolveSurveyModeConfig(read: ConfigReader = resolveConfig): Promise<SurveyModeConfig> {
  return decideSurveyMode(
    await read("sms_relay", "survey_mode"),
    await read("sms_relay", "google_form_url"),
  );
}
