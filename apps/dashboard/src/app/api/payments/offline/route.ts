import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@tenant-ai/shared";

/**
 * POST /api/payments/offline — record a cash or check payment (IL HB 4206).
 *
 * Body:
 *   leaseId     — required
 *   tenantId    — required
 *   amount      — amount in cents
 *   method      — "cash" | "check"
 *   forMonth    — ISO date string (which month this covers)
 *   description — optional note
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { leaseId, tenantId, amount, method, forMonth, description } = body;

    // Validation
    if (!leaseId || !tenantId || !amount || !method) {
      return NextResponse.json(
        { error: "leaseId, tenantId, amount, and method are required" },
        { status: 400 }
      );
    }

    if (!["cash", "check"].includes(method)) {
      return NextResponse.json(
        { error: "Method must be 'cash' or 'check'" },
        { status: 400 }
      );
    }

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number (in cents)" },
        { status: 400 }
      );
    }

    // Verify lease belongs to this landlord
    const lease = await prisma.lease.findFirst({
      where: {
        id: leaseId,
        unit: {
          property: { userId: session.user.id },
        },
      },
    });

    if (!lease) {
      return NextResponse.json({ error: "Lease not found" }, { status: 404 });
    }

    // Verify tenant belongs to this landlord
    const tenant = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        userId: session.user.id,
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Wrap payment + charge updates in a transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Create the payment record
      const payment = await tx.payment.create({
        data: {
          leaseId,
          tenantId,
          amount,
          type: "rent",
          method,
          status: "completed", // Offline payments are immediately completed
          description: description || `${method === "cash" ? "Cash" : "Check"} payment`,
          forMonth: forMonth ? new Date(forMonth) : undefined,
          paidAt: new Date(),
        },
      });

      // Apply payment to oldest outstanding RentCharges (FIFO)
      const charges = await tx.rentCharge.findMany({
        where: {
          leaseId,
          status: { in: ["unpaid", "partial"] },
        },
        orderBy: { dueDate: "asc" },
      });

      let remaining = amount;
      const applied: { chargeId: string; applied: number }[] = [];

      for (const charge of charges) {
        if (remaining <= 0) break;

        const owed = charge.amount - charge.paidAmount;
        const toApply = Math.min(remaining, owed);
        const newPaidAmount = charge.paidAmount + toApply;
        const newStatus = newPaidAmount >= charge.amount ? "paid" : "partial";

        await tx.rentCharge.update({
          where: { id: charge.id },
          data: { paidAmount: newPaidAmount, status: newStatus },
        });

        applied.push({ chargeId: charge.id, applied: toApply });
        remaining -= toApply;
      }

      return { payment, applied };
    });

    await logAudit(prisma, {
      userId: session.user.id,
      action: "record_offline_payment",
      resourceType: "Payment",
      resourceId: result.payment.id,
      metadata: { amount, method, tenantId } as any,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
