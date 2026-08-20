import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendSms } from "../sms.js";

vi.mock("../config-resolver.js", () => ({
  resolveConfig: vi.fn(),
}));

import { resolveConfig } from "../config-resolver.js";

const mockResolveConfig = vi.mocked(resolveConfig);

describe("sendSms", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockResolveConfig.mockReset();
  });

  describe("dev mode (no credentials)", () => {
    it("logs to console and returns success with sid dev-mode", async () => {
      mockResolveConfig.mockResolvedValue("");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await sendSms({
        to: "+13125551234",
        from: "+13125559999",
        body: "Hello from dev mode",
      });

      expect(result).toEqual({ success: true, sid: "dev-mode" });
      expect(consoleSpy).toHaveBeenCalledWith("=== SMS (dev mode) ===");
      expect(consoleSpy).toHaveBeenCalledWith("To: +13125551234");
      expect(consoleSpy).toHaveBeenCalledWith("From: +13125559999");
      expect(consoleSpy).toHaveBeenCalledWith("Body: Hello from dev mode");
      expect(consoleSpy).toHaveBeenCalledWith("======================");
    });

    it("logs media URLs in dev mode when provided", async () => {
      mockResolveConfig.mockResolvedValue("");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendSms({
        to: "+13125551234",
        from: "+13125559999",
        body: "Check this out",
        mediaUrls: ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Media: https://example.com/img1.jpg, https://example.com/img2.jpg"
      );
    });
  });

  describe("with credentials", () => {
    const ACCOUNT_SID = "AC_test_account_sid";
    const AUTH_TOKEN = "test_auth_token";

    beforeEach(() => {
      mockResolveConfig.mockImplementation(async (_provider: string, key: string) => {
        if (key === "account_sid") return ACCOUNT_SID;
        if (key === "auth_token") return AUTH_TOKEN;
        return "";
      });
    });

    it("calls Twilio API with correct URL, auth header, and form body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({ sid: "SM_test_sid_123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await sendSms({
        to: "+13125551234",
        from: "+13125559999",
        body: "Test message",
      });

      expect(result).toEqual({ success: true, sid: "SM_test_sid_123" });

      // Verify fetch was called once
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];

      // Verify Twilio API URL
      expect(url).toBe(
        `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`
      );

      // Verify HTTP method
      expect(options.method).toBe("POST");

      // Verify Basic auth header
      const expectedCredentials = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString(
        "base64"
      );
      expect(options.headers.Authorization).toBe(`Basic ${expectedCredentials}`);

      // Verify Content-Type
      expect(options.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded"
      );

      // Verify form body params
      const bodyParams = new URLSearchParams(options.body);
      expect(bodyParams.get("To")).toBe("+13125551234");
      expect(bodyParams.get("From")).toBe("+13125559999");
      expect(bodyParams.get("Body")).toBe("Test message");
      expect(bodyParams.getAll("MediaUrl")).toEqual([]);
    });

    it("appends MediaUrl params for each media URL (MMS)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({ sid: "SM_mms_sid_456" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const mediaUrls = [
        "https://example.com/photo1.jpg",
        "https://example.com/photo2.png",
      ];

      const result = await sendSms({
        to: "+13125551234",
        from: "+13125559999",
        body: "Check these photos",
        mediaUrls,
      });

      expect(result).toEqual({ success: true, sid: "SM_mms_sid_456" });

      const [, options] = mockFetch.mock.calls[0];
      const bodyParams = new URLSearchParams(options.body);

      // Verify MediaUrl params are appended for each URL
      const sentMediaUrls = bodyParams.getAll("MediaUrl");
      expect(sentMediaUrls).toEqual([
        "https://example.com/photo1.jpg",
        "https://example.com/photo2.png",
      ]);
    });

    it("returns error on non-201 response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 400,
        text: async () => '{"message":"Invalid To number"}',
      });
      vi.stubGlobal("fetch", mockFetch);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await sendSms({
        to: "invalid",
        from: "+13125559999",
        body: "Will fail",
      });

      expect(result).toEqual({
        success: false,
        error: "Twilio API error: 400",
      });
    });

    it("returns error when fetch throws (network failure)", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));
      vi.stubGlobal("fetch", mockFetch);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await sendSms({
        to: "+13125551234",
        from: "+13125559999",
        body: "Will fail",
      });

      expect(result).toEqual({
        success: false,
        error: "Network unreachable",
      });
    });
  });
});
