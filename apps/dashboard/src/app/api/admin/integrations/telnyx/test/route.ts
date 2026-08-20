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

    const config = await resolveIntegration("telnyx");
    if (!config.api_key) {
      return NextResponse.json({ connected: false, message: "API Key is required" });
    }

    const res = await fetch(
      "https://api.telnyx.com/v2/messaging_profiles?page[size]=1",
      {
        headers: {
          Authorization: `Bearer ${config.api_key}`,
        },
      }
    );

    if (res.ok) {
      const data = await res.json();
      const count = data?.meta?.total_results;
      const suffix =
        typeof count === "number"
          ? ` (${count} messaging profile${count === 1 ? "" : "s"})`
          : "";
      return NextResponse.json({ connected: true, message: `Connected to Telnyx${suffix}` });
    }

    return NextResponse.json({ connected: false, message: `Telnyx API error: ${res.status}` });
  } catch (error: any) {
    return NextResponse.json({ connected: false, message: error.message || "Connection failed" });
  }
}
