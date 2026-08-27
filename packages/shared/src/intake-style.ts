import { resolveConfig } from "./config-resolver.js";
import type { ConfigReader } from "./survey-mode.js";

/**
 * Intake reply style — how a NON-tenant prospect texting a property number is
 * answered. One global switch, reversible with one click.
 *
 *   link_only    → today's behavior: greeting/auto-reply + application link;
 *                  repeat texts get the link again (or the completed-app ack).
 *   link_and_qa  → first contact gets a short greeting + link + an invitation
 *                  to ask questions; subsequent texts are answered by the AI
 *                  from the property's own data (never collects an application
 *                  by text — points back to the link).
 *
 * Same pattern as survey-mode.ts: a PURE decision plus a resolver that takes
 * the config reader as a parameter, so callers (and their test doubles) fully
 * control the config source.
 */
export type IntakeStyle = "link_only" | "link_and_qa";

export const INTAKE_STYLES: readonly IntakeStyle[] = ["link_only", "link_and_qa"];

/** Anything not exactly (case/space-insensitively) `link_and_qa` is link_only. */
export function normalizeIntakeStyle(raw: string | null | undefined): IntakeStyle {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "link_and_qa" ? "link_and_qa" : "link_only";
}

/** Default first-contact greeting for link_and_qa (used when intake_greeting is empty). */
export const DEFAULT_INTAKE_GREETING =
  "Hi! We're sending you an application link — please fill it out and we'll get back to you.";

/** Fixed offer line appended after the link in link_and_qa. */
export const INTAKE_QA_OFFER_LINE =
  "Have questions about the property, pricing or availability? Just reply here.";

export interface IntakeStyleConfig {
  style: IntakeStyle;
  /** The configured greeting, or the default when unset. */
  greeting: string;
}

export function decideIntakeStyle(
  rawStyle: string | null | undefined,
  rawGreeting: string | null | undefined,
): IntakeStyleConfig {
  return {
    style: normalizeIntakeStyle(rawStyle),
    greeting: (rawGreeting ?? "").trim() || DEFAULT_INTAKE_GREETING,
  };
}

export async function resolveIntakeStyle(read: ConfigReader = resolveConfig): Promise<IntakeStyleConfig> {
  return decideIntakeStyle(
    await read("sms_relay", "intake_style"),
    await read("sms_relay", "intake_greeting"),
  );
}

/**
 * Build the link_and_qa first-contact greeting: intro + link + offer + STOP.
 * The intro is the global greeting (per-property intakeAutoReply is a link_only
 * concept and is deliberately NOT used here).
 */
export function buildIntakeGreeting(opts: { greeting: string; link: string }): string {
  return `${opts.greeting}\n${opts.link}\n\n${INTAKE_QA_OFFER_LINE}\n\nReply STOP to opt out.`;
}

/**
 * Does this inbound text READ as "send me the application link" rather than a
 * question? Used in Link + Q&A to route repeat texts: a link request resends
 * the link; anything else is answered by the AI. A message containing "?" is
 * always treated as a question (so "application fee?" → Q&A, not a resend).
 */
export function isIntakeLinkRequest(body: string | null | undefined): boolean {
  const b = (body ?? "").trim().toLowerCase();
  if (!b) return false;
  if (b.includes("?")) return false; // a question → Q&A
  if (/^(link|apply|application|form|apply again|resend)\.?$/.test(b)) return true;
  if (/\b(send|resend|text|share|give|shoot)\b[^?]{0,24}\blink\b/.test(b)) return true;
  if (/\bapply (online|now|here|link|again)\b/.test(b)) return true;
  if (/\b(want|need|like|ready) to apply\b/.test(b)) return true;
  if (/\b(the )?(application |apply )?link\b/.test(b) && b.length < 40) return true;
  return false;
}

/** Whether/when a CALLER (voice) is texted the application link. */
export type CallerLinkMode = "off" | "when_asked" | "every_call";
export function normalizeCallerLink(raw: string | null | undefined): CallerLinkMode {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "when_asked" || v === "every_call" ? (v as CallerLinkMode) : "off";
}

/** Whether the voice AI collects the application by phone, or just texts the link. */
export type VoiceIntakeMode = "phone" | "link";
export function normalizeVoiceIntake(raw: string | null | undefined): VoiceIntakeMode {
  return (raw ?? "").trim().toLowerCase() === "link" ? "link" : "phone";
}

