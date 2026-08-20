import { describe, it, expect } from "vitest";
import {
  generateSurveyToken,
  surveyInviteExpiry,
  buildSurveyUrl,
  SURVEY_INVITE_EXPIRY_DAYS,
} from "../survey-token.js";

describe("survey-token", () => {
  it("generates unique, URL-safe tokens", () => {
    const a = generateSurveyToken();
    const b = generateSurveyToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(20);
  });

  it("computes expiry SURVEY_INVITE_EXPIRY_DAYS in the future", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const exp = surveyInviteExpiry(from);
    const expectedMs =
      from.getTime() + SURVEY_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    expect(exp.getTime()).toBe(expectedMs);
  });

  it("builds a survey URL, normalizing trailing slashes", () => {
    expect(buildSurveyUrl("https://acme.com", "abc")).toBe(
      "https://acme.com/survey/abc"
    );
    expect(buildSurveyUrl("https://acme.com/", "abc")).toBe(
      "https://acme.com/survey/abc"
    );
    expect(buildSurveyUrl("https://acme.com///", "abc")).toBe(
      "https://acme.com/survey/abc"
    );
  });
});
