import { describe, it, expect, afterAll } from "vitest";
import Fastify from "fastify";
import helmet from "@fastify/helmet";

const server = Fastify();

server.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

server.get("/test", async () => {
  return { ok: true };
});

afterAll(async () => {
  await server.close();
});

describe("Security headers via @fastify/helmet", () => {
  it("returns X-Content-Type-Options header", async () => {
    const res = await server.inject({ method: "GET", url: "/test" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns X-Frame-Options header", async () => {
    const res = await server.inject({ method: "GET", url: "/test" });
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("returns X-DNS-Prefetch-Control header", async () => {
    const res = await server.inject({ method: "GET", url: "/test" });
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("returns X-Download-Options header", async () => {
    const res = await server.inject({ method: "GET", url: "/test" });
    expect(res.headers["x-download-options"]).toBe("noopen");
  });

  it("does NOT set Content-Security-Policy (disabled for frontend)", async () => {
    const res = await server.inject({ method: "GET", url: "/test" });
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("does NOT set Cross-Origin-Embedder-Policy (disabled for Twilio)", async () => {
    const res = await server.inject({ method: "GET", url: "/test" });
    expect(res.headers["cross-origin-embedder-policy"]).toBeUndefined();
  });
});
