import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveConfig } from "@tenant-ai/shared";
import { relaySendWithGuards } from "../services/relay-guards.js";

/**
 * Internal endpoints. "Localhost-only" is meaningless behind the tunnel (every
 * tunneled request arrives from 127.0.0.1), so auth is a shared secret header
 * compared constant-time — and even a leaked secret is bounded by the relay
 * guards/caps and logged in the ledger.
 */

function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function internalRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Body: { to?: string } }>(
    "/internal/relay-test",
    async (request, reply: FastifyReply) => {
      const secret = await resolveConfig("sms_relay", "internal_secret");
      const header = request.headers["x-relay-secret"];
      if (!secret || typeof header !== "string" || !secretsMatch(header, secret)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const to =
        (typeof request.body?.to === "string" && request.body.to) ||
        (await resolveConfig("sms_relay", "forward_to"));
      if (!to) {
        return reply.code(400).send({ error: "No recipient: set sms_relay.forward_to or pass { to }" });
      }

      const outcome = await relaySendWithGuards(
        to,
        `Tenant AI relay test ${new Date().toISOString().slice(0, 16)} — the Messages relay is working.`,
        { kind: "test" },
      );
      return reply.send(outcome);
    },
  );
}
