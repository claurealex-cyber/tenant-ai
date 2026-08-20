import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @tenant-ai/shared for resolveConfig
vi.mock("@tenant-ai/shared", async () => {
  const actual = await vi.importActual("@tenant-ai/shared");
  return {
    ...actual,
    resolveConfig: vi.fn().mockImplementation(async (ns: string, key: string, defaultVal?: string) => {
      // Default: ai_validation has no config, falls back to openai
      if (ns === "ai_validation") return defaultVal || null;
      if (ns === "openai") {
        if (key === "api_key") return "test-api-key";
        return defaultVal || null;
      }
      return defaultVal || null;
    }),
  };
});

import { shouldAIValidate, validateFieldWithAI } from "../services/ai-field-validator.js";
import { resolveConfig } from "@tenant-ai/shared";

// Save original fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── shouldAIValidate ──

describe("shouldAIValidate", () => {
  it("returns false for programmatically validated fields", () => {
    expect(shouldAIValidate("ssn", "text")).toBe(false);
    expect(shouldAIValidate("email", "text")).toBe(false);
    expect(shouldAIValidate("employerPhone", "text")).toBe(false);
    expect(shouldAIValidate("dateOfBirth", "date")).toBe(false);
    expect(shouldAIValidate("moveInDate", "date")).toBe(false);
    expect(shouldAIValidate("monthlyIncome", "number")).toBe(false);
  });

  it("returns false for yes_no type", () => {
    expect(shouldAIValidate("hasPets", "yes_no")).toBe(false);
    expect(shouldAIValidate("customYesNo", "yes_no")).toBe(false);
  });

  it("returns true for text fields like fullName, currentAddress, employer", () => {
    expect(shouldAIValidate("fullName", "text")).toBe(true);
    expect(shouldAIValidate("currentAddress", "text")).toBe(true);
    expect(shouldAIValidate("employer", "text")).toBe(true);
    expect(shouldAIValidate("petDetails", "text")).toBe(true);
    expect(shouldAIValidate("vehicles", "text")).toBe(true);
    expect(shouldAIValidate("rentalHistory", "text")).toBe(true);
    expect(shouldAIValidate("references", "text")).toBe(true);
  });

  it("returns true for custom text fields", () => {
    expect(shouldAIValidate("customQuestion1", "text")).toBe(true);
    expect(shouldAIValidate("myField", "text")).toBe(true);
  });
});

// ── validateFieldWithAI ──

describe("validateFieldWithAI", () => {
  it("skips API call for programmatically validated fields", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await validateFieldWithAI({
      fieldKey: "ssn",
      value: "123-45-6789",
      questionText: "What is your SSN?",
      questionType: "text",
    });

    expect(result).toEqual({ valid: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns valid: true when AI approves", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ valid: true }) } }],
      }),
    });

    const result = await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John Smith",
      questionText: "What is your full name?",
      questionType: "text",
    });

    expect(result).toEqual({ valid: true });
  });

  it("returns valid: false with reason when AI rejects", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              valid: false,
              reason: "Please provide your last name as well.",
            }),
          },
        }],
      }),
    });

    const result = await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John",
      questionText: "What is your full name?",
      questionType: "text",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Please provide your last name as well.");
  });

  it("returns valid: true on API timeout (fail-open)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout"));

    const result = await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John",
      questionText: "What is your full name?",
      questionType: "text",
    });

    expect(result).toEqual({ valid: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns valid: true on API error (fail-open)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await validateFieldWithAI({
      fieldKey: "currentAddress",
      value: "123 Main St",
      questionText: "What is your current address?",
      questionType: "text",
    });

    expect(result).toEqual({ valid: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns valid: true on malformed JSON response (fail-open)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not valid json {{{" } }],
      }),
    });

    const result = await validateFieldWithAI({
      fieldKey: "employer",
      value: "Acme Corp",
      questionText: "Who is your employer?",
      questionType: "text",
    });

    expect(result).toEqual({ valid: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns valid: true when no API key configured (fail-open)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(resolveConfig).mockImplementation(async (_ns: string, key: string) => {
      if (key === "api_key") return null;
      return "gpt-4o-mini";
    });

    const result = await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John",
      questionText: "What is your full name?",
      questionType: "text",
    });

    expect(result).toEqual({ valid: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    // Restore resolveConfig mock
    vi.mocked(resolveConfig).mockImplementation(async (ns: string, key: string, defaultVal?: string) => {
      if (ns === "ai_validation") return defaultVal || null;
      if (ns === "openai") {
        if (key === "api_key") return "test-api-key";
        return defaultVal || null;
      }
      return defaultVal || null;
    });
  });

  it("sends correct request structure", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ valid: true }) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    await validateFieldWithAI({
      fieldKey: "currentAddress",
      value: "123 Main St, Chicago IL",
      questionText: "What is your current address?",
      questionType: "text",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");

    const body = JSON.parse(options.body);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(150);
    expect(body.response_format).toEqual({ type: "json_object" });

    // System prompt must contain "JSON" for OpenAI json_object mode
    const systemMsg = body.messages.find((m: any) => m.role === "system");
    expect(systemMsg.content).toContain("JSON");

    // User message contains question, field, and answer
    const userMsg = body.messages.find((m: any) => m.role === "user");
    expect(userMsg.content).toContain("What is your current address?");
    expect(userMsg.content).toContain("currentAddress");
    expect(userMsg.content).toContain("123 Main St, Chicago IL");
  });

  it("uses console.warn on failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John",
      questionText: "What is your full name?",
      questionType: "text",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ai-field-validator]"),
      expect.stringContaining("network error"),
    );
    warnSpy.mockRestore();
  });

  it("uses dedicated ai_validation API key when configured", async () => {
    vi.mocked(resolveConfig).mockImplementation(async (ns: string, key: string, defaultVal?: string) => {
      if (ns === "ai_validation" && key === "api_key") return "val-dedicated-key";
      if (ns === "ai_validation") return defaultVal || null;
      if (ns === "openai" && key === "api_key") return "openai-key";
      return defaultVal || null;
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ valid: true }) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John Smith",
      questionText: "What is your full name?",
      questionType: "text",
    });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer val-dedicated-key");

    // Restore
    vi.mocked(resolveConfig).mockImplementation(async (ns: string, key: string, defaultVal?: string) => {
      if (ns === "ai_validation") return defaultVal || null;
      if (ns === "openai") {
        if (key === "api_key") return "test-api-key";
        return defaultVal || null;
      }
      return defaultVal || null;
    });
  });

  it("falls back to openai API key when ai_validation key is null", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ valid: true }) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    await validateFieldWithAI({
      fieldKey: "fullName",
      value: "John Smith",
      questionText: "What is your full name?",
      questionType: "text",
    });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer test-api-key");
  });

  it("uses ai_validation model when configured", async () => {
    vi.mocked(resolveConfig).mockImplementation(async (ns: string, key: string, defaultVal?: string) => {
      if (ns === "ai_validation" && key === "model") return "gpt-4.1-nano";
      if (ns === "ai_validation") return defaultVal || null;
      if (ns === "openai" && key === "api_key") return "test-api-key";
      return defaultVal || null;
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ valid: true }) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    await validateFieldWithAI({
      fieldKey: "employer",
      value: "Acme Corp",
      questionText: "Who is your employer?",
      questionType: "text",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4.1-nano");

    // Restore
    vi.mocked(resolveConfig).mockImplementation(async (ns: string, key: string, defaultVal?: string) => {
      if (ns === "ai_validation") return defaultVal || null;
      if (ns === "openai") {
        if (key === "api_key") return "test-api-key";
        return defaultVal || null;
      }
      return defaultVal || null;
    });
  });

  it("falls back to gpt-4o-mini default when no model configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ valid: true }) } }],
      }),
    });
    globalThis.fetch = mockFetch;

    await validateFieldWithAI({
      fieldKey: "employer",
      value: "Acme Corp",
      questionText: "Who is your employer?",
      questionType: "text",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4o-mini");
  });
});
