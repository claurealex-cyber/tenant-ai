import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { handleIncomingSms } from "../handlers/sms-handler.js";
import { smsRateLimitConfig } from "../lib/rate-limit.js";

/**
 * Build TwiML XML response for SMS.
 */
function smsResponse(messages: string[]): string {
  const messageElements = messages
    .map((m) => `<Message>${escapeXml(m)}</Message>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messageElements}</Response>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function smsRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /sms/incoming — Twilio SMS webhook.
   */
  server.post(
    "/sms/incoming",
    smsRateLimitConfig,
    async (
      request: FastifyRequest<{
        Body: {
          From?: string;
          To?: string;
          Body?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { From, To, Body: messageBody } = request.body;

      if (!From || !To || !messageBody) {
        reply.type("text/xml").send(smsResponse([]));
        return;
      }

      try {
        const result = await handleIncomingSms(From, To, messageBody);

        if (!result.shouldRespond || result.replies.length === 0) {
          // Empty response — no reply to send
          reply.type("text/xml").send(
            `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
          );
          return;
        }

        reply.type("text/xml").send(smsResponse(result.replies));
      } catch (err) {
        console.error("SMS handler error:", err);
        reply.type("text/xml").send(
          smsResponse([
            "Sorry, something went wrong. Please try again later.",
          ]),
        );
      }
    },
  );
}
