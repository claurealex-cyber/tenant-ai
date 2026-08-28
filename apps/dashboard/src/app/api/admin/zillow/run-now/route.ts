import { NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/**
 * POST: force a full Text-Em-All workflow run NOW — scrape → build the batch
 * (new leads + owner check number) → set the group via the deterministic API →
 * fire the broadcast. Bypasses the 10/16/22 schedule gate. ~30-60s.
 */
export async function POST() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const res = await proxyToServer("/internal/zillow/auto-run", {
      method: "POST",
      body: { force: true },
      timeoutMs: 200_000,
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow run-now proxy error:", error);
    return NextResponse.json(
      { error: "Run failed to reach the API server — is it running?" },
      { status: 502 },
    );
  }
}
