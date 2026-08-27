import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPhoneSystemStatus, startPhoneSystem, setWebAccess } from "@/lib/phone-system";

// GET: current phone system status (tunnel, public reachability, webhooks)
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const status = await getPhoneSystemStatus();
    return NextResponse.json({ status });
  } catch (error) {
    console.error("Admin phone-system GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: { action?: "start" | "web-on" | "web-off" } — default "start"
// (ngrok tunnel + webhook sync). web-on/off retarget the static domain
// between the Caddy proxy (dashboard public) and the server (kill-switch).
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let action = "start";
    try {
      const body = await request.json();
      if (body && typeof body.action === "string") action = body.action;
    } catch {
      // no / non-JSON body → start
    }
    if (action === "web-on" || action === "web-off") {
      const result = await setWebAccess(action === "web-on");
      return NextResponse.json(result);
    }
    if (action !== "start") {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const result = await startPhoneSystem();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Admin phone-system POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
