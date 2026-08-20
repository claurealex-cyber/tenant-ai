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

    const apiKey = await resolveConfig("sendgrid", "api_key");
    if (!apiKey) {
      return NextResponse.json({ connected: false, message: "API Key is required" });
    }

    const res = await fetch("https://api.sendgrid.com/v3/scopes", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      return NextResponse.json({ connected: true, message: "Connected to SendGrid API" });
    }

    return NextResponse.json({ connected: false, message: `SendGrid API error: ${res.status}` });
  } catch (error: any) {
    return NextResponse.json({ connected: false, message: error.message || "Connection failed" });
  }
}
