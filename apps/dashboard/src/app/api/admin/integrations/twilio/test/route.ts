import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveIntegration } from "@tenant-ai/shared";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const config = await resolveIntegration("twilio");
    if (!config.account_sid || !config.auth_token) {
      return NextResponse.json({ connected: false, message: "Account SID and Auth Token are required" });
    }

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.account_sid}.json`,
      {
        headers: {
          Authorization: "Basic " + Buffer.from(`${config.account_sid}:${config.auth_token}`).toString("base64"),
        },
      }
    );

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ connected: true, message: `Connected to account: ${data.friendly_name}` });
    }

    return NextResponse.json({ connected: false, message: `Twilio API error: ${res.status}` });
  } catch (error: any) {
    return NextResponse.json({ connected: false, message: error.message || "Connection failed" });
  }
}
