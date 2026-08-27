import { NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** GET: recent import runs. */
export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const res = await proxyToServer("/internal/zillow/runs");
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow runs proxy error:", error);
    return NextResponse.json({ error: "Could not reach the API server" }, { status: 502 });
  }
}
