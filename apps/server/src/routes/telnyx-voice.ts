import { parse as parseQuerystring } from "node:querystring";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";
import { voiceRateLimitConfig } from "../lib/rate-limit.js";
import { telnyxSignatureHook } from "../lib/telnyx-validate.js";
import { buildIncomingCallXml, fallbackXml } from "../lib/voice-twiml.js";

/**
 * Telnyx TeXML voice webhooks.
 *
 * TeXML is Twilio-compatible: requests carry the same form-encoded
 * CallSid/From/To params and expect the same XML response format, so these
 * routes reuse the shared builder and the existing /media-stream WebSocket
 * (Telnyx's start/media/stop stream events mirror Twilio's). Signatures use
 * Telnyx's Ed25519 scheme, computed over the raw request body.
 */
export async function telnyxVoiceRoutes(
  server: FastifyInstance,
): Promise<void> {
  // Scoped parsers that keep the raw body around for signature validation.
  // The built-in json parser may be replaced directly, but @fastify/formbody's
  // urlencoded parser (inherited from the root scope) must be removed first or
  // Fastify throws FST_ERR_CTP_ALREADY_PRESENT at boot.
  if (server.hasContentTypeParser("application/x-www-form-urlencoded")) {
    server.removeContentTypeParser("application/x-www-form-urlencoded");
  }
  server.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (request, body, done) => {
      (request as FastifyRequest & { rawBody?: string }).rawBody =
        body as string;
      done(null, parseQuerystring(body as string));
    },
  );
  server.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      (request as FastifyRequest & { rawBody?: string }).rawBody =
        body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  /**
   * POST /telnyx/voice/incoming — TeXML voice webhook.
   */
  server.post<{ Body: { To?: string; From?: string; CallSid?: string } }>(
    "/telnyx/voice/incoming",
    { ...voiceRateLimitConfig, preHandler: telnyxSignatureHook },
    async (request, reply: FastifyReply) => {
      const { To, From, CallSid } = request.body ?? {};
      const xml = await buildIncomingCallXml(To, From, CallSid, "telnyx");
      reply.type("text/xml").send(xml);
    },
  );

  /**
   * POST /telnyx/voice/hold — inert TeXML (long pause) for the outbound leg
   * of diagnostic loopback calls, so only the inbound leg engages the AI.
   */
  server.post(
    "/telnyx/voice/hold",
    { preHandler: telnyxSignatureHook },
    async (_request, reply: FastifyReply) => {
      reply
        .type("text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="40"/></Response>');
    },
  );

  /**
   * POST /telnyx/voice/fallback — TeXML fallback when the primary fails.
   */
  server.post(
    "/telnyx/voice/fallback",
    { preHandler: telnyxSignatureHook },
    async (_request, reply: FastifyReply) => {
      reply.type("text/xml").send(fallbackXml());
    },
  );

  /**
   * POST /telnyx/voice/recording-status — recording status callback.
   * Fired when a recording started via startTelnyxCallRecording completes;
   * stores the recording URL on the matching call log.
   */
  server.post<{
    Body: {
      CallSid?: string;
      RecordingUrl?: string;
      RecordingStatus?: string;
    };
  }>(
    "/telnyx/voice/recording-status",
    { preHandler: telnyxSignatureHook },
    async (request, reply: FastifyReply) => {
      const { CallSid, RecordingUrl, RecordingStatus } = request.body ?? {};

      if (CallSid && RecordingUrl && RecordingStatus !== "failed") {
        const updated = await prisma.callLog.updateMany({
          where: { twilioSid: CallSid },
          data: { recordingUrl: RecordingUrl },
        });
        if (updated.count === 0) {
          request.log.warn(
            "Recording callback for unknown CallSid %s",
            CallSid,
          );
        }
      }

      reply.code(200).send({ received: true });
    },
  );
}
