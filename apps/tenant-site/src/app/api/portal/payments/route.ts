import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal/payments — tenant payment history.
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payments = await prisma.payment.findMany({
    where: { tenantId: session.tenant.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      type: true,
      method: true,
      status: true,
      paidAt: true,
      forMonth: true,
      receiptUrl: true,
      createdAt: true,
    },
  });

  const paymentsWithReceipt = payments.map((p) => ({
    ...p,
    receiptUrl:
      p.status === "completed" ? `/api/portal/payments/${p.id}/receipt` : null,
  }));

  return NextResponse.json({ payments: paymentsWithReceipt });
}
