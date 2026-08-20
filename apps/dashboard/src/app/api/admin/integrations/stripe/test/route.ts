import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveConfig } from "@tenant-ai/shared";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const secretKey = await resolveConfig("stripe", "secret_key");
    if (!secretKey) {
      return NextResponse.json({ connected: false, message: "Secret Key is required" });
    }

    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (res.ok) {
      return NextResponse.json({ connected: true, message: "Connected to Stripe API" });
    }

    return NextResponse.json({ connected: false, message: `Stripe API error: ${res.status}` });
  } catch (error: any) {
    return NextResponse.json({ connected: false, message: error.message || "Connection failed" });
  }
}
