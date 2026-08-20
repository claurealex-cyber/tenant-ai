/**
 * Stripe helpers for tenant-site ACH payments.
 *
 * Mirrors apps/dashboard/src/lib/stripe-connect.ts pattern.
 * Separate file because Next.js apps can't cross-import.
 */

import Stripe from "stripe";

async function getStripeClient(): Promise<Stripe | null> {
  const { resolveConfig } = await import("@tenant-ai/shared");
  const key = await resolveConfig("stripe", "secret_key");
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Get or create a Stripe Customer for a tenant.
 */
export async function getOrCreateCustomer(params: {
  email: string;
  name: string;
  existingCustomerId?: string | null;
}): Promise<string | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  // If we already have a customer ID, verify it exists
  if (params.existingCustomerId) {
    try {
      await stripe.customers.retrieve(params.existingCustomerId);
      return params.existingCustomerId;
    } catch {
      // Customer doesn't exist, create a new one
    }
  }

  const customer = await stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: { platform: "tenant-ai" },
  });

  return customer.id;
}

/**
 * Attach a Plaid processor bank account token as a source on a Stripe Customer.
 */
export async function attachBankSource(
  customerId: string,
  processorToken: string
): Promise<string | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const source = await stripe.customers.createSource(customerId, {
    source: processorToken,
  });

  return (source as Stripe.BankAccount).id;
}

/**
 * Create an ACH PaymentIntent that transfers to a landlord's Connect account.
 * ACH payments are confirmed server-side (no client secret needed).
 */
export async function createAchPaymentIntent(params: {
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  connectedAccountId: string;
  idempotencyKey: string;
  description?: string;
}): Promise<{
  paymentIntentId: string;
  clientSecret: string;
} | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const intent = await stripe.paymentIntents.create(
    {
      amount: params.amountCents,
      currency: "usd",
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      payment_method_types: ["us_bank_account"],
      confirm: true,
      transfer_data: {
        destination: params.connectedAccountId,
      },
      description: params.description,
      metadata: { platform: "tenant-ai" },
    },
    {
      idempotencyKey: params.idempotencyKey,
    }
  );

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret!,
  };
}
