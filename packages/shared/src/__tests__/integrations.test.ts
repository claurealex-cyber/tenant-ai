import { describe, it, expect } from "vitest";
import { INTEGRATION_REGISTRY, configDbKey } from "../integrations";

describe("Integration Registry", () => {
  it("has unique integration IDs", () => {
    const ids = INTEGRATION_REGISTRY.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique field keys within each integration", () => {
    for (const integration of INTEGRATION_REGISTRY) {
      const keys = integration.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("configDbKey produces correct format", () => {
    expect(configDbKey("twilio", "account_sid")).toBe("twilio.account_sid");
    expect(configDbKey("openai", "api_key")).toBe("openai.api_key");
    expect(configDbKey("s3", "bucket")).toBe("s3.bucket");
  });

  it("all integrations have at least one required field (except fallback integrations)", () => {
    const FALLBACK_INTEGRATIONS = new Set(["ai_validation"]);
    for (const integration of INTEGRATION_REGISTRY) {
      if (FALLBACK_INTEGRATIONS.has(integration.id)) continue;
      const hasRequired = integration.fields.some((f) => f.required);
      expect(hasRequired).toBe(true);
    }
  });

  it("all sensitive fields have no placeholder that reveals key format", () => {
    for (const integration of INTEGRATION_REGISTRY) {
      for (const field of integration.fields) {
        if (field.sensitive && field.placeholder) {
          // Placeholders for sensitive fields should be short hints, not full keys
          expect(field.placeholder.length).toBeLessThan(20);
        }
      }
    }
  });

  it("contains expected integrations", () => {
    const ids = INTEGRATION_REGISTRY.map((i) => i.id);
    expect(ids).toContain("twilio");
    expect(ids).toContain("telnyx");
    expect(ids).toContain("sms_relay");
    expect(ids).toContain("openai");
    expect(ids).toContain("stripe");
    expect(ids).toContain("sendgrid");
    expect(ids).toContain("s3");
    expect(ids).toContain("plaid");
    expect(ids).toContain("ai_validation");
  });
});
