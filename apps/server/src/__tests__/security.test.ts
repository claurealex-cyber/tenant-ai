import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import twilio from "twilio";
import Stripe from "stripe";
import { registerTwilioValidation } from "../lib/twilio-validate.js";
import { verifyStripeWebhook } from "../lib/stripe-validate.js";
import { registerCsrfProtection, generateCsrfToken } from "../lib/csrf.js";
import { registerRateLimiting, RATE_LIMITS } from "../lib/rate-limit.js";

// ── Twilio Signature Validation ──

describe("Twilio signature validation", () => {
  let server: FastifyInstance;
  const AUTH_TOKEN = "test_auth_token_12345";

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.PUBLIC_URL = "http://localhost:3001";

    server = Fastify();

    // Register formbody to parse application/x-www-form-urlencoded
    await server.register(formbody);

    // Register twilio validation for /voice and /sms prefixes
    registerTwilioValidation(server);

    // Test routes
    server.post("/voice/incoming", async () => ({ ok: true }));
    server.post("/sms/incoming", async () => ({ ok: true }));
    server.get("/health", async () => ({ status: "ok" }));

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.PUBLIC_URL;
  });

  it("accepts request with valid X-Twilio-Signature", async () => {
    const url = "http://localhost:3001/voice/incoming";
    const params = { CallSid: "CA123", From: "+15551234567" };

    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);

    // Send as URL-encoded string to match exact Twilio webhook format
    const body = "CallSid=CA123&From=%2B15551234567";

    const response = await server.inject({
      method: "POST",
      url: "/voice/incoming",
      headers: {
        "x-twilio-signature": signature,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects request with invalid X-Twilio-Signature → 403", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/voice/incoming",
      headers: {
        "x-twilio-signature": "invalid_signature_here",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: { CallSid: "CA123" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("Invalid Twilio signature");
  });

  it("rejects request with missing X-Twilio-Signature → 403", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/sms/incoming",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: { From: "+15551234567" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("Missing X-Twilio-Signature");
  });

  it("does not validate non-webhook routes (e.g., /health)", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
  });
});

// ── Stripe Webhook Signature Validation ──

describe("Stripe webhook signature validation", () => {
  const WEBHOOK_SECRET = "whsec_test_secret_123";

  it("accepts valid stripe-signature", () => {
    const payload = JSON.stringify({ type: "payment_intent.succeeded", data: {} });
    const timestamp = Math.floor(Date.now() / 1000);

    // Generate valid signature using Stripe's header generation
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp,
    });

    const event = verifyStripeWebhook(payload, signature, WEBHOOK_SECRET);
    expect(event).toBeDefined();
    expect(event.type).toBe("payment_intent.succeeded");
  });

  it("rejects tampered payload → throws", () => {
    const payload = JSON.stringify({ type: "payment_intent.succeeded", data: {} });
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp,
    });

    // Tamper with the payload
    const tamperedPayload = JSON.stringify({ type: "charge.refunded", data: {} });

    expect(() =>
      verifyStripeWebhook(tamperedPayload, signature, WEBHOOK_SECRET)
    ).toThrow();
  });

  it("rejects invalid signature → throws", () => {
    const payload = JSON.stringify({ type: "test.event" });

    expect(() =>
      verifyStripeWebhook(payload, "invalid_sig", WEBHOOK_SECRET)
    ).toThrow();
  });

  it("rejects with wrong webhook secret → throws", () => {
    const payload = JSON.stringify({ type: "test.event" });
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp,
    });

    expect(() =>
      verifyStripeWebhook(payload, signature, "whsec_wrong_secret")
    ).toThrow();
  });
});

// ── CSRF Protection ──

describe("CSRF protection", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    registerCsrfProtection(server, ["/webhook"]);

    // Test routes
    server.get("/api/data", async () => ({ data: "read" }));
    server.post("/api/data", async () => ({ data: "created" }));
    server.put("/api/data", async () => ({ data: "updated" }));
    server.delete("/api/data", async () => ({ data: "deleted" }));
    server.post("/webhook/stripe", async () => ({ ok: true }));

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET request succeeds without CSRF token", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/data",
    });

    expect(response.statusCode).toBe(200);
  });

  it("sets __csrf cookie with SameSite=Strict on response", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/data",
    });

    const setCookie = response.headers["set-cookie"] as string;
    expect(setCookie).toContain("__csrf=");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("POST without CSRF token → 403", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/data",
      payload: { test: true },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("CSRF");
  });

  it("PUT without CSRF token → 403", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/api/data",
      payload: { test: true },
    });

    expect(response.statusCode).toBe(403);
  });

  it("DELETE without CSRF token → 403", async () => {
    const response = await server.inject({
      method: "DELETE",
      url: "/api/data",
    });

    expect(response.statusCode).toBe(403);
  });

  it("POST with valid CSRF token → succeeds", async () => {
    // First GET to obtain the CSRF cookie
    const getResponse = await server.inject({
      method: "GET",
      url: "/api/data",
    });

    const setCookie = getResponse.headers["set-cookie"] as string;
    const csrfToken = setCookie.match(/__csrf=([^;]+)/)?.[1];
    expect(csrfToken).toBeDefined();

    // POST with matching cookie and header
    const response = await server.inject({
      method: "POST",
      url: "/api/data",
      headers: {
        cookie: `__csrf=${csrfToken}`,
        "x-csrf-token": csrfToken!,
      },
      payload: { test: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: "created" });
  });

  it("POST with mismatched CSRF token → 403", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/data",
      headers: {
        cookie: "__csrf=token_a",
        "x-csrf-token": "token_b",
      },
      payload: { test: true },
    });

    expect(response.statusCode).toBe(403);
  });

  it("excluded prefix (webhook) bypasses CSRF check", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/webhook/stripe",
      payload: { event: "test" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("generateCsrfToken returns a hex string of correct length", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 64 hex chars
  });
});

// ── Rate Limiting ──

describe("Rate limiting", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    await registerRateLimiting(server);

    // Route with voice rate limit (10 req/min)
    server.post(
      "/voice/incoming",
      {
        config: {
          rateLimit: {
            max: RATE_LIMITS.voice.max,
            timeWindow: RATE_LIMITS.voice.timeWindow,
          },
        },
      },
      async () => ({ ok: true })
    );

    // Route with SMS rate limit (30 req/min)
    server.post(
      "/sms/incoming",
      {
        config: {
          rateLimit: {
            max: RATE_LIMITS.sms.max,
            timeWindow: RATE_LIMITS.sms.timeWindow,
          },
        },
      },
      async () => ({ ok: true })
    );

    // Route with API rate limit (100 req/min)
    server.get(
      "/api/data",
      {
        config: {
          rateLimit: {
            max: RATE_LIMITS.api.max,
            timeWindow: RATE_LIMITS.api.timeWindow,
          },
        },
      },
      async () => ({ data: [] })
    );

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns rate limit headers on response", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/data",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-ratelimit-limit"]).toBeDefined();
    expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(response.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("voice webhook: 11th request → 429", async () => {
    // Send 10 requests (voice limit)
    for (let i = 0; i < 10; i++) {
      const res = await server.inject({
        method: "POST",
        url: "/voice/incoming",
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    }

    // 11th should be rate limited
    const response = await server.inject({
      method: "POST",
      url: "/voice/incoming",
      payload: {},
    });

    expect(response.statusCode).toBe(429);
  });

  it("SMS webhook: requests within limit succeed", async () => {
    // Send a few requests (well under 30 limit)
    for (let i = 0; i < 5; i++) {
      const res = await server.inject({
        method: "POST",
        url: "/sms/incoming",
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("API rate limit header shows correct limit value", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/data",
    });

    expect(response.headers["x-ratelimit-limit"]).toBe(
      String(RATE_LIMITS.api.max)
    );
  });
});
