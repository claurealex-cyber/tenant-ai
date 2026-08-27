import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** POST { leadId }: send the survey link to one lead. */
export async function POST(request: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const { leadId, manual } = await request.json().catch(() => ({}));
    if (typeof leadId !== "string" || !leadId) {
      return NextResponse.json({ error: "leadId required" }, { status: 400 });
    }
    const res = await proxyToServer(`/internal/zillow/leads/${encodeURIComponent(leadId)}/send`, {
      method: "POST",
      body: { manual: manual === true },
      timeoutMs: 30_000,
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow send proxy error:", error);
    return NextResponse.json({ error: "Could not reach the API server" }, { status: 502 });
  }
}
