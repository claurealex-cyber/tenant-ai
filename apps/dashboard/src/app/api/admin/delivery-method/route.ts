import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setLaneDeliveryMethod, getRoutingStatus, type Lane, type Method } from "@/lib/delivery-method";

const LANES: Lane[] = ["zillow", "individual"];
const METHODS: Method[] = ["imessage", "zapier", "api"];

async function admin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") return null;
  return (session.user as any).id ?? "admin";
}

/** GET → { zillow, individual, perCallerNote } effective-path readout (M1). */
export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await getRoutingStatus());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "status unavailable" }, { status: 502 });
  }
}

/** POST { lane, method } → atomic per-lane write + dual cache refresh (M9). */
export async function POST(request: NextRequest) {
  const userId = await admin();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const lane = body.lane as Lane;
  const method = body.method as Method;
  if (!LANES.includes(lane) || !METHODS.includes(method)) {
    return NextResponse.json({ error: "lane must be zillow|individual, method must be imessage|zapier|api" }, { status: 400 });
  }
  await setLaneDeliveryMethod(lane, method, userId);
  // Return the fresh readout so the UI reflects the true effective path (incl. caveats).
  let status: unknown = null;
  try { status = await getRoutingStatus(); } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true, lane, method, status });
}
