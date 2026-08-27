import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** GET: lead list with delivery state (proxied; supports ?status= filter). */
export async function GET(request: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const status = request.nextUrl.searchParams.get("status");
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await proxyToServer(`/internal/zillow/leads${qs}`);
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    console.error("Zillow leads proxy error:", error);
    return NextResponse.json({ error: "Could not reach the API server" }, { status: 502 });
  }
}
