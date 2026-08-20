import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/billing/invoices — get invoice history for the authenticated landlord.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });

  if (!subscription) {
    return NextResponse.json({ invoices: [] });
  }

  const invoices = await prisma.invoice.findMany({
    where: { subscriptionId: subscription.id },
    orderBy: { billingMonth: "desc" },
  });

  return NextResponse.json({ invoices });
}
