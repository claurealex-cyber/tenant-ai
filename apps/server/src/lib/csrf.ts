import { randomBytes } from "crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";

const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE = "__csrf";
const TOKEN_LENGTH = 32;

/** HTTP methods that are considered state-changing and require CSRF validation. */
const PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Generate a cryptographically random CSRF token.
 */
export function generateCsrfToken(): string {
  return randomBytes(TOKEN_LENGTH).toString("hex");
}

/**
 * Register CSRF protection on a Fastify server.
 *
 * How it works:
 * - On every response, set a `__csrf` cookie with a random token
 *   (SameSite=Strict, HttpOnly=false so JS can read it)
 * - On state-changing requests (POST/PUT/PATCH/DELETE), verify that
 *   the `X-CSRF-Token` header matches the `__csrf` cookie value
 * - GET/HEAD/OPTIONS requests are exempt (read-only)
 *
 * @param server Fastify instance
 * @param excludePrefixes URL prefixes to exclude from CSRF checks
 *   (e.g., webhook endpoints that use their own signature validation)
 */
export function registerCsrfProtection(
  server: FastifyInstance,
  excludePrefixes: string[] = ["/voice", "/sms", "/stripe"]
) {
  // Set CSRF cookie on every response
  server.addHook("onSend", (request, reply, _payload, done) => {
    const existing = parseCookies(request.headers.cookie || "")[CSRF_COOKIE];
    if (!existing) {
      const token = generateCsrfToken();
      reply.header(
        "set-cookie",
        `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict; Secure`
      );
    }
    done();
  });

  // Validate CSRF token on state-changing requests
  server.addHook("preHandler", (request, reply, done) => {
    // Skip safe methods
    if (!PROTECTED_METHODS.has(request.method)) {
      return done();
    }

    // Skip excluded prefixes (webhooks use their own auth)
    if (excludePrefixes.some((p) => request.url.startsWith(p))) {
      return done();
    }

    const cookieToken = parseCookies(request.headers.cookie || "")[CSRF_COOKIE];
    const headerToken = request.headers[CSRF_HEADER] as string | undefined;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      reply.code(403).send({ error: "Invalid or missing CSRF token" });
      return done();
    }

    done();
  });
}

/**
 * Simple cookie parser — no external dependency needed.
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      cookies[key.trim()] = rest.join("=").trim();
    }
  }
  return cookies;
}
