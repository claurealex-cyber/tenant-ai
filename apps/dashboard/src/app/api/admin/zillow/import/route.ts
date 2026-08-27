import { NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** POST: run a Zillow import (Safari extraction, ~15-30s — generous timeout). */
export async function POST() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const res = await proxyToServer("/internal/zillow/import", { method: "POST", timeoutMs: 180_000 });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow import proxy error:", error);
    return NextResponse.json(
      { error: "Import failed to reach the API server — is it running?" },
      { status: 502 },
    );
  }
}
