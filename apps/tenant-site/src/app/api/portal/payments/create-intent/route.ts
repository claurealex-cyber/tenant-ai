import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAchPaymentIntent } from "@/lib/stripe";

/**
 * POST /api/portal/payments/create-intent — create a payment record.
 *
 * Body: { amount, leaseId, paymentMethodType? }
 *
 * Creates a Payment record with status "pending".
 * For ACH (bank) payments, also creates a Stripe PaymentIntent server-side.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Authenticate tenant ─────────────────────────────────
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { amount, leaseId, paymentMethodType } = await request.json();

    // ── Validate inputs ─────────────────────────────────────
    if (!amount || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "A valid positive amount is required." },
        { status: 400 }
      );
    }

    if (!leaseId) {
      return NextResponse.json(
        { error: "leaseId is required." },
        { status: 400 }
      );
    }

    // ── Verify lease belongs to the tenant ───────────────────
    const lease = await prisma.lease.findFirst({
      where: {
        id: leaseId,
        tenantId: session.tenant.id,
        status: "active",
      },
      include: {
        unit: {
          include: {
            property: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!lease) {
      return NextResponse.json(
        { error: "Lease not found or does not belong to this tenant." },
        { status: 404 }
      );
    }

    // ── UTC forMonth ─────────────────────────────────────────
    const now = new Date();
    const forMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));

    // ── ACH (bank) payment path ──────────────────────────────
    if (paymentMethodType === "bank") {
      const tenant = await prisma.tenant.findUnique({
        where: { id: session.tenant.id },
        select: {
          stripePaymentMethodId: true,
          stripeCustomerId: true,
        },
      });

      if (!tenant?.stripePaymentMethodId || !tenant?.stripeCustomerId) {
        return NextResponse.json(
          { error: "No bank account linked. Please link your bank in Settings." },
          { status: 400 }
        );
      }

      const landlord = lease.unit.property.user;
      if (!landlord.stripeConnectAccountId) {
        return NextResponse.json(
          { error: "Your landlord has not set up payment processing. Please contact them." },
          { status: 400 }
        );
      }

      // Create pending payment record
      const payment = await prisma.payment.create({
        data: {
          leaseId: lease.id,
          tenantId: session.tenant.id,
          amount,
          type: "rent",
          method: "ach",
          status: "pending",
          forMonth,
        },
      });

      // Create Stripe ACH PaymentIntent
      const result = await createAchPaymentIntent({
        amountCents: amount,
        customerId: tenant.stripeCustomerId,
        paymentMethodId: tenant.stripePaymentMethodId,
        connectedAccountId: landlord.stripeConnectAccountId,
        idempotencyKey: `ach_${payment.id}`,
        description: `Rent payment for ${lease.unit.property.name}`,
      });

      if (!result) {
        // Mark payment as failed
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "failed" },
        });
        return NextResponse.json(
          { error: "Payment processing is not configured." },
          { status: 503 }
        );
      }

      // Store Stripe PaymentIntent ID
      await prisma.payment.update({
        where: { id: payment.id },
        data: { stripePaymentId: result.paymentIntentId },
      });

      return NextResponse.json({ paymentId: payment.id }, { status: 201 });
    }

    // ── Card payment path (existing) ─────────────────────────
    const payment = await prisma.payment.create({
      data: {
        leaseId: lease.id,
        tenantId: session.tenant.id,
        amount,
        type: "rent",
        method: "card",
        status: "pending",
        forMonth,
      },
    });

    return NextResponse.json({ paymentId: payment.id }, { status: 201 });
  } catch (error) {
    console.error("[create-intent] Error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
