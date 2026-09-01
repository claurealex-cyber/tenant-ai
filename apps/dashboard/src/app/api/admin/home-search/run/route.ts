import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** POST { searchId? } -> trigger a run in the server process (where the engine lives). */
export async function POST(request: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const b = await request.json().catch(() => ({}));
  try {
    const res = await proxyToServer("/internal/home-search/run", {
      method: "POST",
      body: { searchId: b.searchId },
      timeoutMs: 120_000,
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "run failed" }, { status: 502 });
  }
}
