import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@tenant-ai/shared";
import {
  exchangePublicToken,
  getAccountInfo,
  createProcessorToken,
  removePlaidItem,
} from "@/lib/plaid";
import { getOrCreateCustomer, attachBankSource } from "@/lib/stripe";

/**
 * POST /api/portal/plaid/exchange-token
 *
 * Exchanges a Plaid public token for an access token, retrieves bank info,
 * creates a Stripe processor token, and links the bank to the tenant.
 *
 * Body: { publicToken, accountId }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { publicToken, accountId } = await request.json();

    if (!publicToken || !accountId) {
      return NextResponse.json(
        { error: "publicToken and accountId are required." },
        { status: 400 }
      );
    }

    // If tenant already has a bank linked, remove old Plaid item
    const existingTenant = await prisma.tenant.findUnique({
      where: { id: session.tenant.id },
      select: {
        plaidAccessToken: true,
        stripeCustomerId: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    if (existingTenant?.plaidAccessToken) {
      try {
        const { decrypt } = await import("@tenant-ai/shared");
        const oldAccessToken = decrypt(existingTenant.plaidAccessToken);
        await removePlaidItem(oldAccessToken);
      } catch (err) {
        console.warn("[plaid/exchange-token] Failed to remove old Plaid item:", err);
      }
    }

    // 1. Exchange public token
    const { accessToken, itemId } = await exchangePublicToken(publicToken);

    // 2. Get bank account info
    const { bankName, last4 } = await getAccountInfo(accessToken, accountId);

    // 3. Create Stripe processor token
    const stripeToken = await createProcessorToken(accessToken, accountId);

    // 4. Get or create Stripe customer
    const customerId = await getOrCreateCustomer({
      email: existingTenant!.email,
      name: `${existingTenant!.firstName} ${existingTenant!.lastName}`,
      existingCustomerId: existingTenant!.stripeCustomerId,
    });

    if (!customerId) {
      return NextResponse.json(
        { error: "Payment processing is not configured." },
        { status: 503 }
      );
    }

    // 5. Attach bank source to Stripe customer
    const paymentMethodId = await attachBankSource(customerId, stripeToken);
    if (!paymentMethodId) {
      return NextResponse.json(
        { error: "Failed to attach bank account." },
        { status: 500 }
      );
    }

    // 6. Save all to tenant
    await prisma.tenant.update({
      where: { id: session.tenant.id },
      data: {
        plaidAccessToken: encrypt(accessToken),
        plaidItemId: itemId,
        bankName,
        bankAccountLast4: last4,
        stripeCustomerId: customerId,
        stripePaymentMethodId: paymentMethodId,
      },
    });

    return NextResponse.json(
      { bankAccount: { bankName, last4 } },
      { status: 201 }
    );
  } catch (err) {
    console.error("[plaid/exchange-token] Error:", err);
    return NextResponse.json(
      { error: "Failed to link bank account." },
      { status: 500 }
    );
  }
}
