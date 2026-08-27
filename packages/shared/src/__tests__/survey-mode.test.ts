import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeSurveyMode,
  isValidGoogleFormUrl,
  fillSurveyFormUrl,
  resolveSurveyModeConfig,
  decideSurveyMode,
} from "../survey-mode";
import { clearConfigCache, initConfigResolver } from "../config-resolver";
import { configDbKey } from "../integrations";

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSf4jZ7jYk14CDnRZjZCZPhV6NEhD53sDqfdZp7omfBUe3Vbug/viewform";

describe("normalizeSurveyMode", () => {
  it("treats only google_form (any case/spacing) as the form mode", () => {
    expect(normalizeSurveyMode("google_form")).toBe("google_form");
    expect(normalizeSurveyMode(" Google Form ")).toBe("google_form");
    expect(normalizeSurveyMode("GOOGLE-FORM")).toBe("google_form");
    expect(normalizeSurveyMode("hosted")).toBe("hosted");
    expect(normalizeSurveyMode("")).toBe("hosted");
    expect(normalizeSurveyMode(null)).toBe("hosted");
    expect(normalizeSurveyMode("googleform")).toBe("hosted");
    expect(normalizeSurveyMode("true")).toBe("hosted");
  });
});

describe("isValidGoogleFormUrl", () => {
  it("accepts docs.google.com/forms and forms.gle over https only", () => {
    expect(isValidGoogleFormUrl(FORM)).toBe(true);
    expect(isValidGoogleFormUrl("https://forms.gle/abc123")).toBe(true);
    expect(isValidGoogleFormUrl(`  ${FORM}  `)).toBe(true);
    expect(isValidGoogleFormUrl("http://docs.google.com/forms/d/x/viewform")).toBe(false);
    expect(isValidGoogleFormUrl("https://docs.google.com/document/d/x")).toBe(false);
    expect(isValidGoogleFormUrl("https://evil.com/docs.google.com/forms/")).toBe(false);
    expect(isValidGoogleFormUrl("https://docs.google.com.evil.com/forms/x")).toBe(false);
    expect(isValidGoogleFormUrl("")).toBe(false);
    expect(isValidGoogleFormUrl(null)).toBe(false);
  });
  it("rejects the Gmail redirect wrapper the link was pasted from", () => {
    expect(
      isValidGoogleFormUrl(
        "https://www.google.com/url?q=https%3A%2F%2Fdocs.google.com%2Fforms%2Fd%2Fe%2Fx%2Fviewform&source=gmail",
      ),
    ).toBe(false);
  });
});

describe("fillSurveyFormUrl", () => {
  it("substitutes and encodes placeholders, leaves unknown ones alone", () => {
    const out = fillSurveyFormUrl(`${FORM}?usp=pp_url&entry.1={phone}&entry.2={property}&entry.3={other}`, {
      phone: "+13125550100",
      property: "Ghem LLC 1",
    });
    expect(out).toBe(`${FORM}?usp=pp_url&entry.1=%2B13125550100&entry.2=Ghem%20LLC%201&entry.3={other}`);
  });
  it("is a no-op for a plain URL", () => {
    expect(fillSurveyFormUrl(FORM, { phone: "+1" })).toBe(FORM);
  });
});

describe("resolveSurveyModeConfig", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.mode = process.env.SMS_RELAY_SURVEY_MODE;
    saved.url = process.env.SMS_RELAY_GOOGLE_FORM_URL;
    initConfigResolver({ get: async () => null }); // no DB values → env fallback
    clearConfigCache();
  });
  afterEach(() => {
    if (saved.mode === undefined) delete process.env.SMS_RELAY_SURVEY_MODE;
    else process.env.SMS_RELAY_SURVEY_MODE = saved.mode;
    if (saved.url === undefined) delete process.env.SMS_RELAY_GOOGLE_FORM_URL;
    else process.env.SMS_RELAY_GOOGLE_FORM_URL = saved.url;
    clearConfigCache();
  });

  it("defaults to hosted with no config", async () => {
    delete process.env.SMS_RELAY_SURVEY_MODE;
    delete process.env.SMS_RELAY_GOOGLE_FORM_URL;
    const cfg = await resolveSurveyModeConfig();
    expect(cfg).toEqual({ requestedMode: "hosted", mode: "hosted", formUrl: null, warning: null });
  });

  it("google_form + valid URL → google_form", async () => {
    process.env.SMS_RELAY_SURVEY_MODE = "google_form";
    process.env.SMS_RELAY_GOOGLE_FORM_URL = FORM;
    const cfg = await resolveSurveyModeConfig();
    expect(cfg.mode).toBe("google_form");
    expect(cfg.formUrl).toBe(FORM);
    expect(cfg.warning).toBeNull();
  });

  it("google_form with empty URL degrades to hosted with a warning", async () => {
    process.env.SMS_RELAY_SURVEY_MODE = "google_form";
    delete process.env.SMS_RELAY_GOOGLE_FORM_URL;
    const cfg = await resolveSurveyModeConfig();
    expect(cfg.requestedMode).toBe("google_form");
    expect(cfg.mode).toBe("hosted");
    expect(cfg.warning).toMatch(/empty/);
  });

  it("google_form with a non-Google URL degrades to hosted with a warning", async () => {
    process.env.SMS_RELAY_SURVEY_MODE = "google_form";
    process.env.SMS_RELAY_GOOGLE_FORM_URL = "https://example.com/apply";
    const cfg = await resolveSurveyModeConfig();
    expect(cfg.mode).toBe("hosted");
    expect(cfg.warning).toMatch(/not a Google Forms link/);
  });

  it("DB value wins over env (dashboard setting beats .env)", async () => {
    process.env.SMS_RELAY_SURVEY_MODE = "google_form";
    process.env.SMS_RELAY_GOOGLE_FORM_URL = FORM;
    const savedKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = "a".repeat(64);
    try {
      const { encrypt } = await import("../encryption");
      const dbKey = configDbKey("sms_relay", "survey_mode");
      initConfigResolver({ get: async (key: string) => (key === dbKey ? encrypt("hosted") : null) });
      clearConfigCache();
      const cfg = await resolveSurveyModeConfig();
      expect(cfg.mode).toBe("hosted");
    } finally {
      if (savedKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
      else process.env.PII_ENCRYPTION_KEY = savedKey;
    }
  });
});

describe("decideSurveyMode (pure)", () => {
  it("is the same decision the resolver makes, without any config source", () => {
    expect(decideSurveyMode("google_form", FORM).mode).toBe("google_form");
    expect(decideSurveyMode("google_form", " ").mode).toBe("hosted");
    expect(decideSurveyMode("hosted", FORM)).toEqual({ requestedMode: "hosted", mode: "hosted", formUrl: FORM, warning: null });
  });
  it("resolver uses the injected reader, not the module-internal one", async () => {
    const calls: string[] = [];
    const cfg = await resolveSurveyModeConfig(async (ns, key) => {
      calls.push(`${ns}.${key}`);
      return key === "survey_mode" ? "google_form" : FORM;
    });
    expect(cfg.mode).toBe("google_form");
    expect(calls).toEqual(["sms_relay.survey_mode", "sms_relay.google_form_url"]);
  });
});
