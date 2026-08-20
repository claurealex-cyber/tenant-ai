import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal/plaid/status
 *
 * Returns whether the tenant has a bank account linked
 * and the display info (bank name + last 4).
 */
export async function GET() {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenant.id },
      select: { bankName: true, bankAccountLast4: true },
    });

    if (tenant?.bankName && tenant?.bankAccountLast4) {
      return NextResponse.json({
        linked: true,
        bankAccount: {
          bankName: tenant.bankName,
          last4: tenant.bankAccountLast4,
        },
      });
    }

    return NextResponse.json({ linked: false, bankAccount: null });
  } catch (err) {
    console.error("[plaid/status] Error:", err);
    return NextResponse.json(
      { error: "Failed to check bank status." },
      { status: 500 }
    );
  }
}
