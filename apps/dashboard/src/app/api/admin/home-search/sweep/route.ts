import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** POST { areas?, rolling?, priceAnchor?, maxAreas? } -> compile listings into the dataset. */
export async function POST(request: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const b = await request.json().catch(() => ({}));
  try {
    const res = await proxyToServer("/internal/home-search/sweep", { method: "POST", body: b, timeoutMs: 170_000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sweep failed" }, { status: 502 });
  }
}
