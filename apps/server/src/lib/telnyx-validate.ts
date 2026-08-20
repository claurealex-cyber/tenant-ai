import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveConfig } from "@tenant-ai/shared";

/**
 * Telnyx signs webhooks with Ed25519 over `${timestamp}|${rawBody}`.
 * The portal exposes the public key as base64 of the raw 32-byte key;
 * Node's crypto wants SPKI DER, so we prepend the fixed Ed25519 header.
 * https://developers.telnyx.com/docs/development/webhooks
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Reject webhooks whose timestamp is further than this from now (replay guard). */
export const TELNYX_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export function isTelnyxSignatureValid(
  publicKeyBase64: string,
  signatureBase64: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(publicKeyBase64, "base64"),
      ]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      publicKey,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Fastify preHandler that validates Telnyx webhook signatures.
 * Requires the route's content-type parser to stash the raw body on
 * `request.rawBody` (signatures are computed over the exact bytes sent).
 */
export async function telnyxSignatureHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const publicKey = await resolveConfig("telnyx", "public_key");
  if (!publicKey) {
    request.log.error("TELNYX_PUBLIC_KEY not configured — rejecting webhook");
    reply.code(403).send({ error: "Webhook validation failed" });
    return;
  }

  const signature = request.headers["telnyx-signature-ed25519"] as
    | string
    | undefined;
  const timestamp = request.headers["telnyx-timestamp"] as string | undefined;
  if (!signature || !timestamp) {
    reply.code(403).send({ error: "Missing Telnyx signature headers" });
    return;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > TELNYX_TIMESTAMP_TOLERANCE_SECONDS) {
    reply.code(403).send({ error: "Stale Telnyx webhook timestamp" });
    return;
  }

  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
  if (!rawBody) {
    request.log.error("Telnyx webhook missing raw body — check content-type parser");
    reply.code(403).send({ error: "Webhook validation failed" });
    return;
  }

  if (!isTelnyxSignatureValid(publicKey, signature, timestamp, rawBody)) {
    request.log.warn("Invalid Telnyx signature for %s", request.url);
    reply.code(403).send({ error: "Invalid Telnyx signature" });
    return;
  }
}
