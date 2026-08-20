import { appendFileSync } from "node:fs";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { handleMediaStream } from "../handlers/call-handler.js";
import { voiceRateLimitConfig } from "../lib/rate-limit.js";
import { buildIncomingCallXml, fallbackXml } from "../lib/voice-twiml.js";
import { startTelnyxCallRecording } from "../services/telnyx-client.js";

export async function voiceRoutes(server: FastifyInstance): Promise<void> {
  // Register websocket plugin if not already registered
  if (!server.hasDecorator("websocketServer")) {
    await server.register(fastifyWebsocket);
  }

  /**
   * POST /voice/incoming — Twilio voice webhook.
   * Returns TwiML to connect the caller to an AI-powered media stream.
   */
  server.post(
    "/voice/incoming",
    voiceRateLimitConfig,
    async (
      request: FastifyRequest<{
        Body: {
          To?: string;
          From?: string;
          CallSid?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { To, From, CallSid } = request.body;
      const xml = await buildIncomingCallXml(To, From, CallSid, "twilio");
      reply.type("text/xml").send(xml);
    },
  );

  /**
   * POST /voice/fallback — Twilio fallback when primary webhook fails.
   */
  server.post("/voice/fallback", async (_request, reply: FastifyReply) => {
    reply.type("text/xml").send(fallbackXml());
  });

  /**
   * GET /media-stream — WebSocket endpoint for Twilio Media Stream.
   * Twilio sends custom parameters via the "start" event's customParameters.
   * We intercept the first messages to extract params, then hand off to the
   * call handler, replaying any buffered messages.
   */
  server.get(
    "/media-stream",
    { websocket: true },
    async (socket) => {
      const buffered: Buffer[] = [];
      let resolved = false;
      let debugFrames = 0;

      const onMessage = async (data: Buffer) => {
        try {
          // First-frames debug capture: Telnyx's TeXML stream shape has
          // diverged from Twilio's more than once — keep the evidence cheap.
          if (debugFrames < 5 && process.env.MEDIA_STREAM_DEBUG_LOG) {
            debugFrames++;
            try {
              appendFileSync(
                process.env.MEDIA_STREAM_DEBUG_LOG,
                `${new Date().toISOString()} ${data.toString().slice(0, 1500)}\n`,
              );
            } catch {}
          }

          const msg = JSON.parse(data.toString());
          buffered.push(data);

          if (msg.event === "start") {
            resolved = true;
            socket.removeListener("message", onMessage);

            // Twilio: start.customParameters (camelCase). Telnyx TeXML:
            // start.customParameters or custom_parameters depending on era.
            const start = msg.start || {};
            const params =
              start.customParameters || start.custom_parameters || {};
            const callSid =
              params.callSid || start.callSid || start.call_sid || null;
            const from = params.from || "unknown";
            const propertyId = params.propertyId;

            if (!callSid || !propertyId) {
              console.error(
                `[media-stream] missing callSid/propertyId in start event — closing. start keys: ${Object.keys(start).join(",")} param keys: ${Object.keys(params).join(",")}`,
              );
              socket.close();
              return;
            }

            // Telnyx can't record declaratively via TeXML attributes — the
            // stream starting means the call is answered, so record now.
            if (params.record === "telnyx") {
              startTelnyxCallRecording(callSid).catch((err) => {
                console.error("Failed to start Telnyx call recording:", err);
              });
            }

            await handleMediaStream(socket, callSid, from, propertyId, buffered);
          }
        } catch (err) {
          console.error("Error parsing initial stream message:", err);
          socket.close();
        }
      };

      socket.on("message", onMessage);
    },
  );
}
