import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  sendEmail,
  buildPaymentReceivedEmail,
  buildPaymentFailedEmail,
} from "@tenant-ai/shared";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /api/stripe/webhook — unified Stripe webhook handler.
 *
 * Routes events to Connect (rent payments) or Billing (subscriptions) handlers.
 */
export async function POST(request: NextRequest) {
  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      // ── Connect: Rent Payments ──

      case "payment_intent.succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.processing":
        await handlePaymentProcessing(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      // ── Billing: Landlord Subscriptions ──

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice
        );
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription
        );
        break;

      case "customer.subscription.trial_will_end":
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;

      default:
        // Unknown event type — log and return 200
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] Error handling ${event.type}:`, err);
    // Return 200 anyway to prevent Stripe from retrying
    // (we log the error for investigation)
  }

  return NextResponse.json({ received: true });
}

// ── Connect Handlers ──

async function handlePaymentSucceeded(intent: Stripe.PaymentIntent) {
  const { id: stripePaymentId } = intent;

  // Find the payment record linked to this PaymentIntent
  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId },
  });

  if (!payment) return;

  // Update payment status
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "completed",
      paidAt: new Date(),
    },
  });

  // Apply payment to oldest RentCharges (FIFO)
  const charges = await prisma.rentCharge.findMany({
    where: {
      leaseId: payment.leaseId,
      status: { in: ["unpaid", "partial"] },
    },
    orderBy: { dueDate: "asc" },
  });

  let remaining = payment.amount;

  for (const charge of charges) {
    if (remaining <= 0) break;

    const owed = charge.amount - charge.paidAmount;
    const toApply = Math.min(remaining, owed);
    const newPaidAmount = charge.paidAmount + toApply;
    const newStatus = newPaidAmount >= charge.amount ? "paid" : "partial";

    await prisma.rentCharge.update({
      where: { id: charge.id },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });

    remaining -= toApply;
  }

  // Send notification emails (best-effort)
  try {
    const pd = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: {
        tenant: true,
        lease: {
          include: {
            unit: { include: { property: { include: { user: true } } } },
          },
        },
      },
    });
    if (pd) {
      const amount = `$${(pd.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const prop = pd.lease.unit.property;
      // Tenant email
      await sendEmail({
        to: pd.tenant.email,
        subject: `Payment of ${amount} received`,
        html: buildPaymentReceivedEmail({
          recipientName: pd.tenant.firstName,
          amount,
          propertyName: prop.name,
          paymentMethod: pd.method,
          isLandlord: false,
        }),
      });
      // Landlord email
      await sendEmail({
        to: prop.user.email,
        subject: `Payment received from ${pd.tenant.firstName} ${pd.tenant.lastName}`,
        html: buildPaymentReceivedEmail({
          recipientName: prop.user.name || "Landlord",
          amount,
          propertyName: prop.name,
          paymentMethod: pd.method,
          isLandlord: true,
        }),
      });
    }
  } catch (err) {
    console.error("[stripe-webhook] Notification error:", err);
  }
}

async function handlePaymentProcessing(intent: Stripe.PaymentIntent) {
  const { id: stripePaymentId } = intent;

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId },
  });

  if (!payment) return;

  // ACH payments go through "processing" for 3-5 days before succeeding.
  // Do NOT apply to RentCharges yet — funds haven't cleared.
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "processing" },
  });
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent) {
  const { id: stripePaymentId } = intent;

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentId },
  });

  if (!payment) return;

  // Update payment status — RentCharges remain unpaid
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "failed" },
  });

  // Send notification emails (best-effort)
  try {
    const pd = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: {
        tenant: true,
        lease: {
          include: {
            unit: { include: { property: { include: { user: true } } } },
          },
        },
      },
    });
    if (pd) {
      const amount = `$${(pd.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const prop = pd.lease.unit.property;
      // Tenant email
      await sendEmail({
        to: pd.tenant.email,
        subject: `Your payment of ${amount} failed`,
        html: buildPaymentFailedEmail({
          recipientName: pd.tenant.firstName,
          amount,
          propertyName: prop.name,
          paymentMethod: pd.method,
          isLandlord: false,
        }),
      });
      // Landlord email
      await sendEmail({
        to: prop.user.email,
        subject: `Payment from ${pd.tenant.firstName} ${pd.tenant.lastName} failed`,
        html: buildPaymentFailedEmail({
          recipientName: prop.user.name || "Landlord",
          amount,
          propertyName: prop.name,
          paymentMethod: pd.method,
          isLandlord: true,
        }),
      });
    }
  } catch (err) {
    console.error("[stripe-webhook] Notification error:", err);
  }
}

// ── Billing Handlers ──

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeInvoiceId = invoice.id;

  const dbInvoice = await prisma.invoice.findFirst({
    where: { stripeInvoiceId },
  });

  if (!dbInvoice) return;

  await prisma.invoice.update({
    where: { id: dbInvoice.id },
    data: {
      status: "paid",
      paidAt: new Date(),
    },
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeInvoiceId = invoice.id;

  const dbInvoice = await prisma.invoice.findFirst({
    where: { stripeInvoiceId },
  });

  if (!dbInvoice) return;

  await prisma.invoice.update({
    where: { id: dbInvoice.id },
    data: { status: "failed" },
  });

  // Check if subscription should move to past_due
  const sub = await prisma.subscription.findUnique({
    where: { id: dbInvoice.subscriptionId },
  });

  if (sub && sub.status === "active") {
    // Count failed invoices
    const failedCount = await prisma.invoice.count({
      where: {
        subscriptionId: sub.id,
        status: "failed",
      },
    });

    if (failedCount >= 3) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "past_due" },
      });
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const stripeSubId = subscription.id;

  const dbSub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSubId },
  });

  if (!dbSub) return;

  // Map Stripe status to our status
  const statusMap: Record<string, string> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    trialing: "trialing",
    unpaid: "past_due",
  };

  const newStatus = statusMap[subscription.status] || dbSub.status;

  // Access period timestamps from the raw Stripe object
  const raw = subscription as unknown as Record<string, unknown>;
  const periodStart =
    typeof raw.current_period_start === "number"
      ? new Date(raw.current_period_start * 1000)
      : dbSub.currentPeriodStart;
  const periodEnd =
    typeof raw.current_period_end === "number"
      ? new Date(raw.current_period_end * 1000)
      : dbSub.currentPeriodEnd;

  await prisma.subscription.update({
    where: { id: dbSub.id },
    data: {
      status: newStatus,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const stripeSubId = subscription.id;

  const dbSub = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSubId },
  });

  if (!dbSub) return;

  await prisma.subscription.update({
    where: { id: dbSub.id },
    data: {
      status: "canceled",
      canceledAt: new Date(),
    },
  });
}

async function handleTrialWillEnd(_subscription: Stripe.Subscription) {
  // This event fires 3 days before trial ends.
  // In a production system, this would trigger an email reminder.
  // For now, we just log it.
}
