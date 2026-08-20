import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET: proxy the API server's /health endpoint.
 * The browser can't know which port the server runs on (SERVER_PORT is a
 * runtime env var), so the dashboard fetches it server-side.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const port = parseInt(process.env.SERVER_PORT || "3001", 10);
    const target = `http://127.0.0.1:${port}/health`;

    try {
      const res = await fetch(target, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return NextResponse.json({ ok: false, target });
      }
      const health = await res.json();
      return NextResponse.json({ ok: true, target, health });
    } catch {
      return NextResponse.json({ ok: false, target });
    }
  } catch (error) {
    console.error("Admin server-health GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
