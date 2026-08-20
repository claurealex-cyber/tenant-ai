import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveConfig } from "@tenant-ai/shared";

const PLAID_BASE_URLS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const clientId = await resolveConfig("plaid", "client_id");
    const secret = await resolveConfig("plaid", "secret");
    const env = (await resolveConfig("plaid", "env")) || "sandbox";

    if (!clientId || !secret) {
      return NextResponse.json({
        connected: false,
        message: "Client ID and Secret are required",
      });
    }

    const baseUrl = PLAID_BASE_URLS[env] || PLAID_BASE_URLS.sandbox;

    const res = await fetch(`${baseUrl}/institutions/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        count: 1,
        offset: 0,
        country_codes: ["US"],
      }),
    });

    if (res.ok) {
      return NextResponse.json({
        connected: true,
        message: `Connected to Plaid (${env} environment)`,
      });
    }

    const errorBody = await res.json().catch(() => null);
    const errorMsg =
      errorBody?.error_message || `Plaid API error: ${res.status}`;
    return NextResponse.json({ connected: false, message: errorMsg });
  } catch (error: any) {
    return NextResponse.json({
      connected: false,
      message: error.message || "Connection failed",
    });
  }
}
