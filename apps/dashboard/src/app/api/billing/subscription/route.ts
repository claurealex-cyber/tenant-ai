import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createStripeCustomer,
  createStripeSubscription,
  updateStripeSubscriptionPrice,
  cancelStripeSubscription,
} from "@/lib/stripe-billing";

const TRIAL_DAYS = 14;

/**
 * GET /api/billing/subscription — get current user's subscription.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
    include: {
      tier: {
        select: {
          id: true,
          name: true,
          displayName: true,
          basePriceCents: true,
          includedAiCents: true,
          aiMarkupPercent: true,
          maxProperties: true,
          maxPhoneNumbers: true,
          websiteEnabled: true,
          customDomainEnabled: true,
        },
      },
    },
  });

  return NextResponse.json({ subscription });
}

/**
 * POST /api/billing/subscription — create a new subscription (plan selection).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tierId } = await request.json();

    if (!tierId) {
      return NextResponse.json(
        { error: "Tier ID is required" },
        { status: 400 }
      );
    }

    // Check for existing subscription (idempotent)
    const existing = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
      include: { tier: true },
    });

    if (existing) {
      return NextResponse.json({ subscription: existing });
    }

    // Validate tier exists and is active
    const tier = await prisma.pricingTier.findUnique({
      where: { id: tierId },
    });

    if (!tier || !tier.isActive) {
      return NextResponse.json(
        { error: "Invalid or inactive pricing tier" },
        { status: 400 }
      );
    }

    // Create Stripe Customer (returns null if no Stripe key configured)
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    const stripeCustomerId = await createStripeCustomer(
      user!.email,
      user!.name
    );

    // Create Stripe Subscription
    let stripeSubscriptionId: string | null = null;
    if (stripeCustomerId) {
      const result = await createStripeSubscription({
        customerId: stripeCustomerId,
        priceCents: tier.basePriceCents,
        trialDays: TRIAL_DAYS,
      });
      stripeSubscriptionId = result?.subscriptionId || null;
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const subscription = await prisma.subscription.create({
      data: {
        userId: session.user.id,
        tierId: tier.id,
        status: "trialing",
        stripeSubscriptionId,
        stripeCustomerId,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: trialEnd,
      },
      include: { tier: true },
    });

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/billing/subscription — change plan (upgrade/downgrade).
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tierId } = await request.json();

    if (!tierId) {
      return NextResponse.json(
        { error: "Tier ID is required" },
        { status: 400 }
      );
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    const newTier = await prisma.pricingTier.findUnique({
      where: { id: tierId },
    });

    if (!newTier || !newTier.isActive) {
      return NextResponse.json(
        { error: "Invalid or inactive pricing tier" },
        { status: 400 }
      );
    }

    // Update Stripe subscription price if connected
    if (subscription.stripeSubscriptionId) {
      await updateStripeSubscriptionPrice(
        subscription.stripeSubscriptionId,
        newTier.basePriceCents
      );
    }

    const updated = await prisma.subscription.update({
      where: { userId: session.user.id },
      data: { tierId: newTier.id },
      include: { tier: true },
    });

    return NextResponse.json({ subscription: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/billing/subscription — cancel subscription.
 */
export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 }
      );
    }

    if (subscription.stripeSubscriptionId) {
      await cancelStripeSubscription(subscription.stripeSubscriptionId);
    }

    const updated = await prisma.subscription.update({
      where: { userId: session.user.id },
      data: {
        status: "canceled",
        canceledAt: new Date(),
      },
      include: { tier: true },
    });

    return NextResponse.json({ subscription: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
