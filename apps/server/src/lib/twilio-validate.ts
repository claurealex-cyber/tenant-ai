import twilio from "twilio";
const { validateRequest } = twilio;
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { resolveConfig } from "@tenant-ai/shared";

/**
 * Validate an incoming Twilio webhook request signature.
 *
 * Uses HMAC-SHA1 validation per Twilio's spec:
 * https://www.twilio.com/docs/usage/security#validating-requests
 *
 * @param authToken Twilio Auth Token
 * @param signature X-Twilio-Signature header value
 * @param url Full webhook URL (must match what Twilio sees)
 * @param params POST body parameters
 */
export function isTwilioSignatureValid(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  return validateRequest(authToken, signature, url, params);
}

/**
 * Fastify preHandler hook that validates Twilio webhook signatures.
 * Returns 403 if the signature is missing or invalid.
 */
export async function twilioSignatureHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authToken = await resolveConfig("twilio", "auth_token");
  if (!authToken) {
    request.log.error("TWILIO_AUTH_TOKEN not configured — rejecting webhook");
    reply.code(403).send({ error: "Webhook validation failed" });
    return;
  }

  const signature = request.headers["x-twilio-signature"] as string | undefined;
  if (!signature) {
    reply.code(403).send({ error: "Missing X-Twilio-Signature header" });
    return;
  }

  const publicUrl = await resolveConfig("twilio", "public_url", "http://localhost:3001") || "http://localhost:3001";
  const url = `${publicUrl}${request.url}`;
  const params = (request.body as Record<string, string>) || {};

  const valid = isTwilioSignatureValid(authToken, signature, url, params);
  if (!valid) {
    request.log.warn("Invalid Twilio signature for %s", request.url);
    reply.code(403).send({ error: "Invalid Twilio signature" });
    return;
  }
}

/**
 * Register the Twilio signature validation hook on specific route prefixes.
 */
export function registerTwilioValidation(
  server: FastifyInstance,
  prefixes: string[] = ["/voice", "/sms"]
) {
  server.addHook("preHandler", async (request, reply) => {
    const matchesPrefix = prefixes.some((p) => request.url.startsWith(p));
    if (matchesPrefix) {
      await twilioSignatureHook(request, reply);
    }
  });
}
