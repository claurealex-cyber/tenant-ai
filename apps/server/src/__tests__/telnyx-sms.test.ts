import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  isTelnyxSignatureValid,
  TELNYX_TIMESTAMP_TOLERANCE_SECONDS,
} from "../lib/telnyx-validate.js";

// ── Mocks ──

const mockHandleIncomingSms = vi.fn();
vi.mock("../handlers/sms-handler.js", () => ({
  handleIncomingSms: (...args: unknown[]) => mockHandleIncomingSms(...args),
}));

const mockSendTelnyxSms = vi.fn();
vi.mock("../services/telnyx-client.js", () => ({
  sendTelnyxSms: (...args: unknown[]) => mockSendTelnyxSms(...args),
}));

const { telnyxSmsRoutes, processTelnyxInbound } = await import(
  "../routes/telnyx-sms.js"
);

// ── Test keypair ──

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

/** Telnyx publishes the raw 32-byte key as base64 — the SPKI DER suffix. */
function rawPublicKeyBase64(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64");
}

const PUBLIC_KEY_B64 = rawPublicKeyBase64(publicKey);

function signPayload(body: string, timestamp: string): string {
  return cryptoSign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString(
    "base64",
  );
}

function inboundWebhook(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      event_type: "message.received",
      payload: {
        direction: "inbound",
        text: "Hello, is the unit available?",
        from: { phone_number: "+13125550100" },
        to: [{ phone_number: "+13125550199" }],
        ...overrides,
      },
    },
  };
}

// ── Signature primitive ──

describe("isTelnyxSignatureValid", () => {
  it("accepts a valid Ed25519 signature", () => {
    const body = JSON.stringify(inboundWebhook());
    const ts = "1700000000";
    expect(
      isTelnyxSignatureValid(PUBLIC_KEY_B64, signPayload(body, ts), ts, body),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify(inboundWebhook());
    const ts = "1700000000";
    const signature = signPayload(body, ts);
    expect(
      isTelnyxSignatureValid(PUBLIC_KEY_B64, signature, ts, body + " "),
    ).toBe(false);
  });

  it("rejects a signature made with a different key", () => {
    const other = generateKeyPairSync("ed25519");
    const body = JSON.stringify(inboundWebhook());
    const ts = "1700000000";
    const signature = cryptoSign(
      null,
      Buffer.from(`${ts}|${body}`),
      other.privateKey,
    ).toString("base64");
    expect(isTelnyxSignatureValid(PUBLIC_KEY_B64, signature, ts, body)).toBe(false);
  });

  it("returns false on malformed key material instead of throwing", () => {
    expect(isTelnyxSignatureValid("not-a-key", "not-a-sig", "0", "{}")).toBe(false);
  });
});

// ── Webhook route ──

describe("POST /telnyx/sms", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.TELNYX_PUBLIC_KEY = PUBLIC_KEY_B64;
    server = Fastify();
    await server.register(telnyxSmsRoutes);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    delete process.env.TELNYX_PUBLIC_KEY;
  });

  beforeEach(() => {
    mockHandleIncomingSms.mockReset();
    mockSendTelnyxSms.mockReset();
  });

  function injectSigned(
    payload: unknown,
    opts: { timestamp?: string; signature?: string; omitHeaders?: boolean } = {},
  ) {
    const body = JSON.stringify(payload);
    const timestamp =
      opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (!opts.omitHeaders) {
      headers["telnyx-timestamp"] = timestamp;
      headers["telnyx-signature-ed25519"] =
        opts.signature ?? signPayload(body, timestamp);
    }
    return server.inject({
      method: "POST",
      url: "/telnyx/sms",
      headers,
      payload: body,
    });
  }

  it("accepts a signed inbound message and replies via the Telnyx API", async () => {
    mockHandleIncomingSms.mockResolvedValue({
      shouldRespond: true,
      replies: ["Yes, it's available!", "Want to book a tour?"],
    });
    mockSendTelnyxSms.mockResolvedValue(undefined);

    const response = await injectSigned(inboundWebhook());
    expect(response.statusCode).toBe(200);

    // Processing happens after the 200 ack
    await vi.waitFor(() => {
      expect(mockHandleIncomingSms).toHaveBeenCalledWith(
        "+13125550100",
        "+13125550199",
        "Hello, is the unit available?",
      );
      expect(mockSendTelnyxSms).toHaveBeenCalledTimes(2);
    });

    // Replies go out from our number to the caller, in order
    expect(mockSendTelnyxSms).toHaveBeenNthCalledWith(
      1,
      "+13125550199",
      "+13125550100",
      "Yes, it's available!",
    );
    expect(mockSendTelnyxSms).toHaveBeenNthCalledWith(
      2,
      "+13125550199",
      "+13125550100",
      "Want to book a tour?",
    );
  });

  it("acks delivery receipts without invoking the SMS handler", async () => {
    const response = await injectSigned({
      data: {
        event_type: "message.finalized",
        payload: { direction: "outbound", text: "sent earlier" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(mockHandleIncomingSms).not.toHaveBeenCalled();
  });

  it("rejects requests with no signature headers", async () => {
    const response = await injectSigned(inboundWebhook(), { omitHeaders: true });
    expect(response.statusCode).toBe(403);
    expect(mockHandleIncomingSms).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    const response = await injectSigned(inboundWebhook(), {
      signature: Buffer.from("bogus-signature-bytes-here-64-long!!").toString(
        "base64",
      ),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("Invalid Telnyx signature");
    expect(mockHandleIncomingSms).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay guard)", async () => {
    const stale = (
      Math.floor(Date.now() / 1000) -
      TELNYX_TIMESTAMP_TOLERANCE_SECONDS -
      60
    ).toString();
    const response = await injectSigned(inboundWebhook(), { timestamp: stale });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("Stale");
  });
});

// ── Inbound processing ──

describe("processTelnyxInbound", () => {
  beforeEach(() => {
    mockHandleIncomingSms.mockReset();
    mockSendTelnyxSms.mockReset();
  });

  it("sends nothing when the handler declines to respond", async () => {
    mockHandleIncomingSms.mockResolvedValue({ shouldRespond: false, replies: [] });
    const sent = await processTelnyxInbound({
      direction: "inbound",
      text: "hi",
      from: { phone_number: "+13125550100" },
      to: [{ phone_number: "+13125550199" }],
    });
    expect(sent).toBe(0);
    expect(mockSendTelnyxSms).not.toHaveBeenCalled();
  });

  it("skips malformed payloads without calling the handler", async () => {
    const sent = await processTelnyxInbound({ text: "no numbers" });
    expect(sent).toBe(0);
    expect(mockHandleIncomingSms).not.toHaveBeenCalled();
  });
});
