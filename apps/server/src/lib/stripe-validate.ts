import Stripe from "stripe";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Verify a Stripe webhook event from the raw request body.
 *
 * @param rawBody Raw request body (Buffer or string)
 * @param signature stripe-signature header value
 * @param webhookSecret Stripe webhook endpoint secret
 * @returns Parsed Stripe.Event if valid
 * @throws Error if signature is invalid or payload is tampered
 */
export function verifyStripeWebhook(
  rawBody: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  return Stripe.webhooks.constructEvent(
    rawBody,
    signature,
    webhookSecret
  );
}

/**
 * Fastify preHandler hook for Stripe webhook routes.
 * Verifies the stripe-signature header and attaches the parsed event
 * to the request object.
 *
 * IMPORTANT: The route must be configured to receive the raw body.
 * Use Fastify's `addContentTypeParser` for 'application/json' to get raw body.
 */
export function stripeWebhookHook(
  webhookSecret: string
) {
  return (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void
  ) => {
    const signature = request.headers["stripe-signature"] as string | undefined;
    if (!signature) {
      reply.code(400).send({ error: "Missing stripe-signature header" });
      return done();
    }

    const rawBody = request.rawBody ?? request.body;
    if (!rawBody) {
      reply.code(400).send({ error: "Missing request body" });
      return done();
    }

    try {
      const event = verifyStripeWebhook(
        rawBody as string | Buffer,
        signature,
        webhookSecret
      );

      // Attach parsed event to request for downstream handler
      (request as any).stripeEvent = event;
      done();
    } catch (err: any) {
      request.log.warn("Stripe webhook validation failed: %s", err.message);
      reply.code(400).send({ error: "Invalid Stripe webhook signature" });
      done();
    }
  };
}

// Augment FastifyRequest to include rawBody (set by custom content parser)
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string | Buffer;
    stripeEvent?: Stripe.Event;
  }
}
