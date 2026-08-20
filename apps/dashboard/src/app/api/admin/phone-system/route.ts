import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPhoneSystemStatus, startPhoneSystem } from "@/lib/phone-system";

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

// POST: start the phone system (ngrok tunnel + webhook sync)
export async function POST(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await startPhoneSystem();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Admin phone-system POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
