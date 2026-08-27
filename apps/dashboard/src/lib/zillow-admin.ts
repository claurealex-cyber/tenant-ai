import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { resolveConfig } from "@tenant-ai/shared";
import "@/lib/prisma"; // initializes the shared config resolver

/**
 * Admin-session guard + authenticated proxy to the API server's internal
 * Zillow endpoints. The x-relay-secret never reaches the browser — the
 * dashboard resolves it server-side per request.
 */

export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function proxyToServer(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<Response> {
  const secret = await resolveConfig("sms_relay", "internal_secret");
  if (!secret) {
    return new Response(JSON.stringify({ error: "internal secret not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const port = parseInt(process.env.SERVER_PORT || "3001", 10);
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-relay-secret": secret,
      ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.method === "POST" ? { body: JSON.stringify(init.body ?? {}) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
}
