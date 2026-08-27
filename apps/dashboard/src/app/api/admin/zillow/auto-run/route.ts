import { NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** POST: "Run now" — forces today's automation run (import + baseline-scoped batch). */
export async function POST() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const res = await proxyToServer("/internal/zillow/auto-run", {
      method: "POST",
      body: { force: true },
      timeoutMs: 300_000,
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow auto-run proxy error:", error);
    return NextResponse.json({ error: "Could not reach the API server" }, { status: 502 });
  }
}
