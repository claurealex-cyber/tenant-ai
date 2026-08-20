import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/**
 * Rate limit presets for different route categories.
 *
 * SMS webhook:  30 req/min per IP
 * Voice webhook: 10 req/min per IP
 * Dashboard API: 100 req/min per IP
 * Default:       60 req/min per IP
 */
export const RATE_LIMITS = {
  sms: { max: 30, timeWindow: "1 minute" },
  voice: { max: 10, timeWindow: "1 minute" },
  api: { max: 100, timeWindow: "1 minute" },
  default: { max: 60, timeWindow: "1 minute" },
} as const;

/**
 * Register the global rate limiter plugin on the Fastify server.
 * Sets a default limit and enables rate limit headers.
 *
 * Per-route overrides are applied via route-level config:
 *   { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }
 */
export async function registerRateLimiting(
  server: FastifyInstance
): Promise<void> {
  await server.register(rateLimit, {
    global: true,
    max: RATE_LIMITS.default.max,
    timeWindow: RATE_LIMITS.default.timeWindow,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    keyGenerator: (request) => {
      // Use X-Forwarded-For behind a proxy, fall back to IP
      return (
        (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        request.ip
      );
    },
  });
}

/**
 * Route-level rate limit config for SMS webhook.
 */
export const smsRateLimitConfig = {
  config: {
    rateLimit: {
      max: RATE_LIMITS.sms.max,
      timeWindow: RATE_LIMITS.sms.timeWindow,
    },
  },
};

/**
 * Route-level rate limit config for voice webhook.
 */
export const voiceRateLimitConfig = {
  config: {
    rateLimit: {
      max: RATE_LIMITS.voice.max,
      timeWindow: RATE_LIMITS.voice.timeWindow,
    },
  },
};

/**
 * Route-level rate limit config for dashboard API.
 */
export const apiRateLimitConfig = {
  config: {
    rateLimit: {
      max: RATE_LIMITS.api.max,
      timeWindow: RATE_LIMITS.api.timeWindow,
    },
  },
};
