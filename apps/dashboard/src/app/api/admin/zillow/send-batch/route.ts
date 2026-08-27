import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** POST { includeOlder?, propertyId? }: queue the survey for all sendable leads. */
export async function POST(request: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = await request.json().catch(() => ({}));
    const res = await proxyToServer("/internal/zillow/send-batch", {
      method: "POST",
      body: {
        includeOlder: body.includeOlder === true,
        ...(typeof body.propertyId === "string" && body.propertyId ? { propertyId: body.propertyId } : {}),
      },
      // A big batch walks every lead through the guards sequentially.
      timeoutMs: 300_000,
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow send-batch proxy error:", error);
    return NextResponse.json({ error: "Could not reach the API server" }, { status: 502 });
  }
}
