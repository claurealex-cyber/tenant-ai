/**
 * Stripe Connect helpers for landlord onboarding.
 *
 * Landlords are onboarded as Stripe Connect Express accounts so they can
 * receive tenant rent payments (via PaymentIntents with transfer_data).
 */

import Stripe from "stripe";

export async function getStripeClient(): Promise<Stripe | null> {
  const { resolveConfig } = await import("@tenant-ai/shared");
  const key = await resolveConfig("stripe", "secret_key");
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Create a Stripe Connect Express account for a landlord.
 *
 * @returns The Stripe account ID (acct_xxx)
 */
export async function createConnectAccount(params: {
  email: string;
  companyName?: string | null;
}): Promise<string | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const account = await stripe.accounts.create({
    type: "express",
    email: params.email,
    capabilities: {
      transfers: { requested: true },
    },
    business_type: "individual",
    metadata: { platform: "tenant-ai" },
    ...(params.companyName && {
      business_profile: { name: params.companyName },
    }),
  });

  return account.id;
}

/**
 * Create an Account Link for Stripe Connect onboarding.
 * Redirects the landlord to Stripe's hosted onboarding flow.
 *
 * @returns URL to redirect the landlord to
 */
export async function createAccountLink(params: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const link = await stripe.accountLinks.create({
    account: params.accountId,
    refresh_url: params.refreshUrl,
    return_url: params.returnUrl,
    type: "account_onboarding",
  });

  return link.url;
}

/**
 * Check if a Connect account has completed onboarding.
 */
export async function isAccountOnboarded(
  accountId: string
): Promise<boolean | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const account = await stripe.accounts.retrieve(accountId);
  return account.charges_enabled && account.payouts_enabled;
}

/**
 * Create a Stripe PaymentIntent for a rent payment.
 * Transfers funds to the landlord's Connect account.
 */
export async function createRentPaymentIntent(params: {
  amountCents: number;
  customerId: string;
  connectedAccountId: string;
  paymentMethodId?: string;
  paymentMethodType?: "us_bank_account" | "card";
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
      payment_method_types: [params.paymentMethodType ?? "us_bank_account"],
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
