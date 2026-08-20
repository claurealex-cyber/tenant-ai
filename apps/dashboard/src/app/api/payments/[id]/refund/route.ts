import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe-connect";
import { logAudit } from "@tenant-ai/shared";

/**
 * POST /api/payments/[id]/refund — refund a completed payment.
 *
 * Body: { reason?: string }
 *
 * - Validates payment is "completed"
 * - For Stripe payments: issues Stripe refund
 * - Reverses RentCharge FIFO allocations
 * - Updates payment status to "refunded"
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Fetch payment with ownership check
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { userId: true } },
              },
            },
          },
        },
      },
    });

    if (!payment || payment.lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status === "refunded") {
      return NextResponse.json(
        { error: "Payment has already been refunded" },
        { status: 400 }
      );
    }

    if (payment.status !== "completed") {
      return NextResponse.json(
        { error: "Only completed payments can be refunded" },
        { status: 400 }
      );
    }

    // Parse optional reason from body
    let reason: string | undefined;
    try {
      const body = await request.json();
      reason = body.reason;
    } catch {
      // Empty body is fine
    }

    // For Stripe payments, issue a refund via Stripe API
    if (payment.stripePaymentId) {
      const stripe = await getStripeClient();
      if (!stripe) {
        return NextResponse.json(
          { error: "Payment provider not configured" },
          { status: 500 }
        );
      }
      await stripe.refunds.create({
        payment_intent: payment.stripePaymentId,
        ...(reason ? { reason: "requested_by_customer" } : {}),
      });
    }

    // Reverse RentCharge allocations + update payment status in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Find charges for this lease that have been paid (reverse-FIFO: newest first)
      const charges = await tx.rentCharge.findMany({
        where: {
          leaseId: payment.leaseId,
          paidAmount: { gt: 0 },
          status: { in: ["paid", "partial"] },
        },
        orderBy: { dueDate: "desc" },
      });

      let remaining = payment.amount;
      const reversed: { chargeId: string; reversed: number }[] = [];

      for (const charge of charges) {
        if (remaining <= 0) break;

        const toReverse = Math.min(charge.paidAmount, remaining);
        const newPaidAmount = charge.paidAmount - toReverse;
        const newStatus =
          newPaidAmount <= 0
            ? "unpaid"
            : newPaidAmount < charge.amount
              ? "partial"
              : "paid";

        await tx.rentCharge.update({
          where: { id: charge.id },
          data: { paidAmount: newPaidAmount, status: newStatus },
        });

        reversed.push({ chargeId: charge.id, reversed: toReverse });
        remaining -= toReverse;
      }

      // Update payment status
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: "refunded",
          description: reason
            ? `${payment.description || ""} [Refund: ${reason}]`.trim()
            : payment.description,
        },
      });

      return { payment: updated, reversed };
    });

    await logAudit(prisma, {
      userId: session.user.id,
      action: "refund_payment",
      resourceType: "Payment",
      resourceId: id,
      metadata: { amount: payment.amount, reason } as any,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
