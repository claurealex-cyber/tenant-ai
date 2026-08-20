import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initConfigResolver,
  resolveConfig,
  resolveIntegration,
  clearConfigCache,
} from "../config-resolver";
import type { ConfigStore } from "../config-resolver";
import { encrypt } from "../encryption";

// PII_ENCRYPTION_KEY must be set for encrypt/decrypt
const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Config Resolver", () => {
  let mockStore: ConfigStore;
  let mockGet: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;

  beforeEach(() => {
    process.env.PII_ENCRYPTION_KEY = TEST_KEY;
    clearConfigCache();
    mockGet = vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null);
    mockStore = { get: mockGet };
    initConfigResolver(mockStore);
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    // Clean up any env vars we set
    delete process.env.OPENAI_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    clearConfigCache();
    initConfigResolver(null as any);
  });

  it("returns DB value when set (decrypted)", async () => {
    const encrypted = encrypt("sk-test-key-123");
    mockGet.mockResolvedValue(encrypted);

    const result = await resolveConfig("openai", "api_key");
    expect(result).toBe("sk-test-key-123");
    expect(mockGet).toHaveBeenCalledWith("openai.api_key");
  });

  it("falls back to env var when no DB value", async () => {
    mockGet.mockResolvedValue(null);
    process.env.OPENAI_API_KEY = "env-key-456";

    const result = await resolveConfig("openai", "api_key");
    expect(result).toBe("env-key-456");
  });

  it("falls back to default when neither DB nor env", async () => {
    mockGet.mockResolvedValue(null);

    const result = await resolveConfig("openai", "sms_model", "gpt-4o-mini");
    expect(result).toBe("gpt-4o-mini");
  });

  it("returns null when nothing is set", async () => {
    mockGet.mockResolvedValue(null);

    const result = await resolveConfig("openai", "api_key");
    expect(result).toBeNull();
  });

  it("DB value takes priority over env var", async () => {
    const encrypted = encrypt("db-value");
    mockGet.mockResolvedValue(encrypted);
    process.env.OPENAI_API_KEY = "env-value";

    const result = await resolveConfig("openai", "api_key");
    expect(result).toBe("db-value");
  });

  it("cache hit avoids DB query on second call", async () => {
    const encrypted = encrypt("cached-val");
    mockGet.mockResolvedValue(encrypted);

    await resolveConfig("openai", "api_key");
    await resolveConfig("openai", "api_key");

    // Should only hit DB once due to cache
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("clearConfigCache forces fresh DB read", async () => {
    const encrypted = encrypt("val1");
    mockGet.mockResolvedValue(encrypted);

    await resolveConfig("openai", "api_key");
    clearConfigCache();

    const encrypted2 = encrypt("val2");
    mockGet.mockResolvedValue(encrypted2);
    const result = await resolveConfig("openai", "api_key");

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result).toBe("val2");
  });

  it("handles decrypt failure gracefully (falls back to env)", async () => {
    mockGet.mockResolvedValue("invalid-not-encrypted");
    process.env.OPENAI_API_KEY = "env-fallback";

    const result = await resolveConfig("openai", "api_key");
    expect(result).toBe("env-fallback");
  });

  it("resolveIntegration returns all fields for a service", async () => {
    mockGet.mockResolvedValue(null);
    process.env.TWILIO_ACCOUNT_SID = "AC123";

    const result = await resolveIntegration("twilio");
    expect(result.account_sid).toBe("AC123");
    expect(result.auth_token).toBeNull();
    expect(result.public_url).toBeNull();
  });

  it("resolveIntegration returns empty for unknown integration", async () => {
    const result = await resolveIntegration("unknown_service");
    expect(result).toEqual({});
  });

  it("works without a store (env-only mode)", async () => {
    initConfigResolver(null as any);
    process.env.OPENAI_API_KEY = "env-only";

    const result = await resolveConfig("openai", "api_key");
    expect(result).toBe("env-only");
  });
});
