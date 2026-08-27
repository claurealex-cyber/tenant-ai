import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveConfig, clearConfigCache } from "@tenant-ai/shared";
import { relaySendWithGuards } from "../services/relay-guards.js";
import { prisma } from "../lib/prisma.js";
import { runZillowImport, leadsToCsv } from "../services/zillow-import.js";
import { sendSurveyToLead, sendSurveyBatch } from "../services/zillow-send.js";
import { runDailyAutomation, getAutoStatus } from "../services/zillow-auto.js";

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

async function requireInternalSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = await resolveConfig("sms_relay", "internal_secret");
  const header = request.headers["x-relay-secret"];
  if (!secret || typeof header !== "string" || !secretsMatch(header, secret)) {
    reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function internalRoutes(server: FastifyInstance): Promise<void> {
  // Clear the server process's own config cache so a dashboard setting change
  // (survey mode, intake style, caps) takes effect immediately instead of
  // waiting out the 60s TTL. The dashboard clears its own cache in-process.
  server.post(
    "/internal/config/refresh",
    { preHandler: requireInternalSecret },
    async (_request, reply: FastifyReply) => {
      clearConfigCache();
      return reply.send({ ok: true });
    },
  );

  server.post<{ Body: { to?: string } }>(
    "/internal/relay-test",
    { preHandler: requireInternalSecret },
    async (request, reply: FastifyReply) => {
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

  // ── Zillow leads ──────────────────────────────────────────────────────────

  /**
   * Start an import. Runs inline (the Safari extraction takes ~15s) so the
   * caller gets the full summary; a second concurrent call is rejected.
   */
  server.post(
    "/internal/zillow/import",
    { preHandler: requireInternalSecret },
    async (_request, reply: FastifyReply) => {
      try {
        const summary = await runZillowImport();
        return reply.send(summary);
      } catch (err) {
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  server.get(
    "/internal/zillow/runs",
    { preHandler: requireInternalSecret },
    async (_request, reply: FastifyReply) => {
      const runs = await prisma.zillowImportRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 10,
      });
      return reply.send({ runs });
    },
  );

  server.get<{ Querystring: { status?: string; propertyId?: string } }>(
    "/internal/zillow/leads",
    { preHandler: requireInternalSecret },
    async (request, reply: FastifyReply) => {
      const { status, propertyId } = request.query;
      const leads = await prisma.zillowLead.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(propertyId ? { propertyId } : {}),
        },
        orderBy: [{ firstContactAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      });
      // Delivery state for invited leads comes from the relay ledger.
      const inviteIds = leads.map((l) => l.inviteId).filter((v): v is string => !!v);
      const ledger = inviteIds.length
        ? await prisma.outboundRelayMessage.findMany({
            where: { inviteId: { in: inviteIds } },
            select: { inviteId: true, status: true, lastError: true, sentAt: true },
          })
        : [];
      const ledgerByInvite = new Map(ledger.map((r) => [r.inviteId, r]));
      return reply.send({
        leads: leads.map((l) => ({
          ...l,
          delivery: l.inviteId ? (ledgerByInvite.get(l.inviteId) ?? null) : null,
        })),
      });
    },
  );

  server.get(
    "/internal/zillow/leads.csv",
    { preHandler: requireInternalSecret },
    async (_request, reply: FastifyReply) => {
      const leads = await prisma.zillowLead.findMany({
        orderBy: [{ firstContactAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      });
      reply.header("Content-Disposition", `attachment; filename="zillow_leads_${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.type("text/csv; charset=utf-8").send(leadsToCsv(leads));
    },
  );

  server.post<{ Params: { id: string } }>(
    "/internal/zillow/leads/:id/send",
    { preHandler: requireInternalSecret },
    async (request, reply: FastifyReply) => {
      const outcome = await sendSurveyToLead(request.params.id);
      return reply.send(outcome);
    },
  );

  /**
   * POST /internal/zillow/auto-run — run the daily automation inline.
   * {force: true} bypasses the enabled gate and re-runs a consumed day.
   * Direct HTTP path (no BullMQ/Redis) — the Iris supervisor's trigger.
   */
  server.post<{ Body: { force?: boolean } }>(
    "/internal/zillow/auto-run",
    { preHandler: requireInternalSecret },
    async (request, reply: FastifyReply) => {
      const result = await runDailyAutomation({ force: request.body?.force === true });
      return reply.send(result);
    },
  );

  server.get(
    "/internal/zillow/auto-status",
    { preHandler: requireInternalSecret },
    async (_request, reply: FastifyReply) => {
      return reply.send(await getAutoStatus());
    },
  );

  server.post<{ Body: { includeOlder?: boolean; propertyId?: string } }>(
    "/internal/zillow/send-batch",
    { preHandler: requireInternalSecret },
    async (request, reply: FastifyReply) => {
      const result = await sendSurveyBatch({
        includeOlder: request.body?.includeOlder === true,
        propertyId: typeof request.body?.propertyId === "string" ? request.body.propertyId : undefined,
      });
      return reply.send(result);
    },
  );
}
