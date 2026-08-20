import { randomBytes } from "crypto";

/** Days a survey invite link remains valid after being sent. */
export const SURVEY_INVITE_EXPIRY_DAYS = 7;

/**
 * Generate a URL-safe, single-use token for an SMS → web survey invite.
 * 24 random bytes → 32 base64url chars (~144 bits of entropy).
 */
export function generateSurveyToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Expiry timestamp for a freshly-created survey invite. */
export function surveyInviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SURVEY_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Build the public survey URL for a given host and token.
 * `baseUrl` may include a scheme; a trailing slash is normalized away.
 */
export function buildSurveyUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/survey/${token}`;
}
