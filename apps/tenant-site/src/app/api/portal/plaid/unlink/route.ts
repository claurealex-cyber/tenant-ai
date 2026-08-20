import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@tenant-ai/shared";
import { removePlaidItem } from "@/lib/plaid";

/**
 * DELETE /api/portal/plaid/unlink
 *
 * Unlinks the tenant's bank account by removing the Plaid item
 * and clearing all bank-related fields.
 */
export async function DELETE() {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenant.id },
      select: { plaidAccessToken: true, bankName: true },
    });

    if (!tenant?.plaidAccessToken) {
      return NextResponse.json(
        { error: "No bank account is linked." },
        { status: 400 }
      );
    }

    // Remove Plaid item (best-effort)
    try {
      const accessToken = decrypt(tenant.plaidAccessToken);
      await removePlaidItem(accessToken);
    } catch (err) {
      console.warn("[plaid/unlink] Failed to remove Plaid item:", err);
    }

    // Clear all bank fields regardless of Plaid removal success
    await prisma.tenant.update({
      where: { id: session.tenant.id },
      data: {
        plaidAccessToken: null,
        plaidItemId: null,
        bankName: null,
        bankAccountLast4: null,
        stripePaymentMethodId: null,
      },
    });

    return NextResponse.json({ message: "Bank account unlinked." });
  } catch (err) {
    console.error("[plaid/unlink] Error:", err);
    return NextResponse.json(
      { error: "Failed to unlink bank account." },
      { status: 500 }
    );
  }
}
