import { NextResponse } from "next/server";
import { requireAdmin, proxyToServer } from "@/lib/zillow-admin";
import { clearConfigCache } from "@tenant-ai/shared";

// POST: clear the config cache in BOTH processes so a just-saved setting
// (survey mode, intake style, caps) is live immediately, not in up to 60s.
export async function POST() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  clearConfigCache(); // dashboard process
  let server = false;
  try {
    const res = await proxyToServer("/internal/config/refresh", { method: "POST", timeoutMs: 4000 });
    server = res.ok;
  } catch {
    server = false; // server refresh best-effort; its 60s TTL is the fallback
  }
  return NextResponse.json({ ok: true, serverRefreshed: server });
}
