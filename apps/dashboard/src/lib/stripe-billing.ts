import Stripe from "stripe";

async function getStripeClient(): Promise<Stripe | null> {
  const { resolveConfig } = await import("@tenant-ai/shared");
  const key = await resolveConfig("stripe", "secret_key");
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Create a Stripe Customer for a landlord (platform billing).
 */
export async function createStripeCustomer(
  email: string,
  name: string | null
): Promise<string | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { platform: "tenant-ai" },
  });

  return customer.id;
}

/**
 * Get or create a Stripe Price for a given amount.
 * Uses a product called "Tenant AI Platform" and creates
 * a recurring monthly price for the given amount.
 */
async function getOrCreatePrice(
  stripe: Stripe,
  priceCents: number
): Promise<string> {
  // Search for existing price with this amount
  const prices = await stripe.prices.search({
    query: `active:"true" AND metadata["platform"]:"tenant-ai" AND metadata["amount_cents"]:"${priceCents}"`,
  });

  if (prices.data.length > 0) {
    return prices.data[0].id;
  }

  // Create product if needed
  const products = await stripe.products.search({
    query: `active:"true" AND metadata["platform"]:"tenant-ai"`,
  });

  let productId: string;
  if (products.data.length > 0) {
    productId = products.data[0].id;
  } else {
    const product = await stripe.products.create({
      name: "Tenant AI Platform",
      metadata: { platform: "tenant-ai" },
    });
    productId = product.id;
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: priceCents,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { platform: "tenant-ai", amount_cents: String(priceCents) },
  });

  return price.id;
}

/**
 * Create a Stripe Subscription with a trial period.
 */
export async function createStripeSubscription(params: {
  customerId: string;
  priceCents: number;
  trialDays: number;
}): Promise<{ subscriptionId: string; clientSecret: string | null } | null> {
  const stripe = await getStripeClient();
  if (!stripe) return null;

  const priceId = await getOrCreatePrice(stripe, params.priceCents);

  const subscription = await stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: priceId }],
    trial_period_days: params.trialDays,
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  });

  return {
    subscriptionId: subscription.id,
    clientSecret: null, // Trial subscriptions don't need immediate payment
  };
}

/**
 * Cancel a Stripe Subscription at period end.
 */
export async function cancelStripeSubscription(
  subscriptionId: string
): Promise<void> {
  const stripe = await getStripeClient();
  if (!stripe) return;

  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

/**
 * Update a Stripe Subscription's price (for plan changes).
 */
export async function updateStripeSubscriptionPrice(
  subscriptionId: string,
  newPriceCents: number
): Promise<void> {
  const stripe = await getStripeClient();
  if (!stripe) return;

  const priceId = await getOrCreatePrice(stripe, newPriceCents);

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = subscription.items.data[0]?.id;
  if (!itemId) return;

  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: "create_prorations",
  });
}
