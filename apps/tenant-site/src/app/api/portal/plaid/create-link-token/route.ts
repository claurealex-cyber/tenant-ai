import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { createLinkToken } from "@/lib/plaid";

/**
 * POST /api/portal/plaid/create-link-token
 *
 * Creates a Plaid Link token for the frontend to open the Link widget.
 */
export async function POST() {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const linkToken = await createLinkToken(session.tenant.id);
    if (!linkToken) {
      return NextResponse.json(
        { error: "Bank account linking is not available. Please contact your landlord." },
        { status: 503 }
      );
    }

    return NextResponse.json({ linkToken });
  } catch (err) {
    console.error("[plaid/create-link-token] Error:", err);
    return NextResponse.json(
      { error: "Failed to initialize bank linking." },
      { status: 500 }
    );
  }
}
