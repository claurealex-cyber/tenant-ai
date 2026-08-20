import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { stringify as stringifyQuerystring } from "node:querystring";

// ── Mocks (must precede route import) ──

const mockFindFirst = vi.fn();
const mockCallLogUpdateMany = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    property: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    callLog: { updateMany: (...args: unknown[]) => mockCallLogUpdateMany(...args) },
  },
}));

const mockGetActiveCallCount = vi.fn();
vi.mock("../lib/call-registry.js", () => ({
  getActiveCallCount: () => mockGetActiveCallCount(),
}));

vi.mock("../handlers/call-handler.js", () => ({
  MAX_CONCURRENT: 10,
  handleMediaStream: vi.fn(),
}));

const mockResolveConfig = vi.fn();
vi.mock("@tenant-ai/shared", async () => {
  const actual = await vi.importActual<typeof import("@tenant-ai/shared")>(
    "@tenant-ai/shared",
  );
  return {
    ...actual,
    resolveConfig: (...args: unknown[]) => mockResolveConfig(...args),
  };
});

const { telnyxVoiceRoutes } = await import("../routes/telnyx-voice.js");
const { startTelnyxCallRecording } = await import("../services/telnyx-client.js");

// ── Test keypair ──

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

function rawPublicKeyBase64(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64");
}

const PUBLIC_KEY_B64 = rawPublicKeyBase64(publicKey);

describe("Telnyx TeXML voice routes", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.TELNYX_PUBLIC_KEY = PUBLIC_KEY_B64;
    server = Fastify();
    await server.register(telnyxVoiceRoutes);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    delete process.env.TELNYX_PUBLIC_KEY;
  });

  beforeEach(() => {
    mockFindFirst.mockReset();
    mockGetActiveCallCount.mockReset().mockReturnValue(0);
    mockResolveConfig.mockReset().mockImplementation(async (id: unknown, key: unknown) => {
      // telnyx credentials resolve from env (mirrors resolveConfig's env fallback);
      // everything else (twilio public_url) resolves to the test URL
      if (id === "telnyx" && key === "api_key") return process.env.TELNYX_API_KEY ?? null;
      if (id === "telnyx" && key === "account_sid") return process.env.TELNYX_ACCOUNT_SID ?? null;
      if (id === "telnyx" && key === "public_key") return process.env.TELNYX_PUBLIC_KEY ?? null;
      return "https://example.ngrok.dev";
    });
  });

  function injectCall(
    url: string,
    params: Record<string, string>,
    opts: { omitHeaders?: boolean } = {},
  ) {
    const body = stringifyQuerystring(params);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    if (!opts.omitHeaders) {
      headers["telnyx-timestamp"] = timestamp;
      headers["telnyx-signature-ed25519"] = cryptoSign(
        null,
        Buffer.from(`${timestamp}|${body}`),
        privateKey,
      ).toString("base64");
    }
    return server.inject({ method: "POST", url, headers, payload: body });
  }

  const callParams = {
    CallSid: "telnyx-call-abc123",
    From: "+13125550100",
    To: "+13125550199",
  };

  it("connects a signed inbound call to the media stream with rtp mode", async () => {
    mockFindFirst.mockResolvedValue({ id: "prop_1", recordingEnabled: false });

    const response = await injectCall("/telnyx/voice/incoming", callParams);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/xml");

    const xml = response.body;
    expect(xml).toContain(
      '<Stream url="wss://example.ngrok.dev/media-stream" bidirectionalMode="rtp">',
    );
    expect(xml).toContain('<Parameter name="callSid" value="telnyx-call-abc123" />');
    expect(xml).toContain('<Parameter name="from" value="+13125550100" />');
    expect(xml).toContain('<Parameter name="propertyId" value="prop_1" />');
  });

  it("embeds a record stream parameter instead of the Twilio record attribute", async () => {
    mockFindFirst.mockResolvedValue({ id: "prop_1", recordingEnabled: true });

    const response = await injectCall("/telnyx/voice/incoming", callParams);
    expect(response.body).toContain("<Connect><Stream");
    expect(response.body).not.toContain('record="record-from-answer-dual"');
    expect(response.body).toContain('<Parameter name="record" value="telnyx" />');
  });

  it("omits the record parameter when recording is disabled", async () => {
    mockFindFirst.mockResolvedValue({ id: "prop_1", recordingEnabled: false });

    const response = await injectCall("/telnyx/voice/incoming", callParams);
    expect(response.body).not.toContain('<Parameter name="record"');
  });

  it("rejects unsigned requests", async () => {
    const response = await injectCall("/telnyx/voice/incoming", callParams, {
      omitHeaders: true,
    });
    expect(response.statusCode).toBe(403);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("says the number is not in service when no property matches", async () => {
    mockFindFirst.mockResolvedValue(null);

    const response = await injectCall("/telnyx/voice/incoming", callParams);
    expect(response.body).toContain("This number is not in service.");
  });

  it("rejects calls when all lines are busy", async () => {
    mockGetActiveCallCount.mockReturnValue(10);

    const response = await injectCall("/telnyx/voice/incoming", callParams);
    expect(response.body).toContain("All lines are currently busy.");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("serves the signed fallback message", async () => {
    const response = await injectCall("/telnyx/voice/fallback", callParams);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("temporarily unavailable");
  });

  describe("recording status callback", () => {
    beforeEach(() => {
      mockCallLogUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    });

    it("stores the recording URL on the matching call log", async () => {
      const response = await injectCall("/telnyx/voice/recording-status", {
        CallSid: "telnyx-call-abc123",
        RecordingSid: "rec_1",
        RecordingStatus: "completed",
        RecordingUrl: "https://api.telnyx.com/recordings/rec_1.mp3",
      });
      expect(response.statusCode).toBe(200);
      expect(mockCallLogUpdateMany).toHaveBeenCalledWith({
        where: { twilioSid: "telnyx-call-abc123" },
        data: { recordingUrl: "https://api.telnyx.com/recordings/rec_1.mp3" },
      });
    });

    it("ignores failed recordings", async () => {
      const response = await injectCall("/telnyx/voice/recording-status", {
        CallSid: "telnyx-call-abc123",
        RecordingStatus: "failed",
        RecordingUrl: "https://api.telnyx.com/recordings/rec_1.mp3",
      });
      expect(response.statusCode).toBe(200);
      expect(mockCallLogUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects unsigned callbacks", async () => {
      const response = await injectCall(
        "/telnyx/voice/recording-status",
        { CallSid: "x", RecordingUrl: "y" },
        { omitHeaders: true },
      );
      expect(response.statusCode).toBe(403);
      expect(mockCallLogUpdateMany).not.toHaveBeenCalled();
    });
  });
});

describe("startTelnyxCallRecording", () => {
  const mockFetch = vi.fn();

  beforeAll(() => {
    vi.stubGlobal("fetch", mockFetch);
    process.env.TELNYX_API_KEY = "test_api_key";
    process.env.TELNYX_ACCOUNT_SID = "acct_123";
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_ACCOUNT_SID;
  });

  beforeEach(() => {
    mockFetch.mockReset().mockResolvedValue({ ok: true });
    mockResolveConfig.mockReset().mockImplementation(async (id: unknown, key: unknown) => {
      // telnyx credentials resolve from env (mirrors resolveConfig's env fallback);
      // everything else (twilio public_url) resolves to the test URL
      if (id === "telnyx" && key === "api_key") return process.env.TELNYX_API_KEY ?? null;
      if (id === "telnyx" && key === "account_sid") return process.env.TELNYX_ACCOUNT_SID ?? null;
      if (id === "telnyx" && key === "public_key") return process.env.TELNYX_PUBLIC_KEY ?? null;
      return "https://example.ngrok.dev";
    });
  });

  it("requests a dual-channel recording with the status callback URL", async () => {
    await startTelnyxCallRecording("telnyx-call-abc123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.telnyx.com/v2/texml/Accounts/acct_123/Calls/telnyx-call-abc123/Recordings.json",
    );
    expect(init.headers.Authorization).toBe("Bearer test_api_key");

    const params = new URLSearchParams(init.body);
    expect(params.get("RecordingChannels")).toBe("dual");
    expect(params.get("PlayBeep")).toBe("false");
    expect(params.get("RecordingStatusCallback")).toBe(
      "https://example.ngrok.dev/telnyx/voice/recording-status",
    );
  });

  it("throws when the API rejects the request", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "call not in progress",
    });
    await expect(startTelnyxCallRecording("bad-call")).rejects.toThrow(
      "Telnyx recording start failed (422)",
    );
  });

  it("throws when credentials are missing", async () => {
    const saved = process.env.TELNYX_ACCOUNT_SID;
    delete process.env.TELNYX_ACCOUNT_SID;
    await expect(startTelnyxCallRecording("x")).rejects.toThrow(
      "not configured",
    );
    process.env.TELNYX_ACCOUNT_SID = saved;
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
