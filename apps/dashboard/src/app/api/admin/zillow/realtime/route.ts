import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { proxyToServer } from "@/lib/zillow-admin";
import {
  encrypt,
  resolveConfig,
  clearConfigCache,
  normalizePollIntervalSec,
  pollMinutesToSeconds,
  ZILLOW_POLL_FLOOR_SEC,
} from "@tenant-ai/shared";

/**
 * POST — the ONLY writer of the real-time poll interval
 * (`zillow.fast_poll_sec`). Interval-editor plan rev.2 M2.
 *
 *   { minutes?: number, seconds?: number, off?: boolean }
 *
 * POST-only by design (rev.2 P2): reads come from the panel's existing
 * auto-status load — the server's `getPollStatus` is the single source of
 * truth, and this route echoes that block back after writing so the UI
 * updates in one round trip. Validation is the SHARED helper, but the floor
 * is ultimately enforced by the engine's own clamp — the UI/route can only
 * be more polite, never more permissive.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = (session.user as any).id ?? "admin";
  const body = await request.json().catch(() => ({}));

  let normalized: number | null = null;
  let requestedSec: number | null = null;
  if (body.off === true) {
    normalized = 0;
    requestedSec = 0;
  } else if (body.seconds !== undefined) {
    normalized = normalizePollIntervalSec(body.seconds);
    requestedSec = typeof body.seconds === "number" ? Math.round(body.seconds) : null;
  } else if (body.minutes !== undefined) {
    normalized = pollMinutesToSeconds(body.minutes);
    requestedSec = typeof body.minutes === "number" ? Math.round(body.minutes * 60) : null;
  } else {
    return NextResponse.json({ error: "provide minutes, seconds, or off:true" }, { status: 400 });
  }
  if (normalized === null) {
    return NextResponse.json(
      { error: `invalid interval — use off, or ${ZILLOW_POLL_FLOOR_SEC / 60}–60 minutes` },
      { status: 400 },
    );
  }
  const clamped = normalized !== 0 && requestedSec !== null && requestedSec !== normalized;

  const before = (await resolveConfig("zillow", "fast_poll_sec")) ?? "";
  const key = "zillow.fast_poll_sec";
  const value = String(normalized);
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: encrypt(value), updatedBy: userId },
    update: { value: encrypt(value), updatedBy: userId },
  });
  await prisma.auditLog
    .create({
      data: {
        userId,
        action: "zillow_poll_interval_update",
        resourceType: "system_config",
        resourceId: key,
        metadata: { before, after: value, clamped },
      },
    })
    .catch(() => {});

  clearConfigCache(); // dashboard process
  let serverRefreshed = false;
  try {
    const r = await proxyToServer("/internal/config/refresh", { method: "POST", timeoutMs: 4000 });
    serverRefreshed = !!r && r.ok;
  } catch {
    serverRefreshed = false; // best-effort; the server's 60 s TTL is the fallback
  }

  // Echo the SERVER's refreshed realtime block (single source of truth) so the
  // panel can update without a second round trip. Best-effort — null on failure.
  let realtime: unknown = null;
  try {
    const s = await proxyToServer("/internal/zillow/auto-status", { timeoutMs: 5000 });
    if (s.ok) realtime = ((await s.json()) as { realtime?: unknown }).realtime ?? null;
  } catch {
    realtime = null;
  }

  return NextResponse.json({ ok: true, fastPollSec: normalized, clamped, serverRefreshed, realtime });
}
