import { NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";

/** GET: stream the CSV export through with its download headers. */
export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const res = await proxyToServer("/internal/zillow/leads.csv");
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          res.headers.get("Content-Disposition") ?? `attachment; filename="zillow_leads.csv"`,
      },
    });
  } catch (error) {
    console.error("Zillow CSV proxy error:", error);
    return NextResponse.json({ error: "Could not reach the API server" }, { status: 502 });
  }
}
