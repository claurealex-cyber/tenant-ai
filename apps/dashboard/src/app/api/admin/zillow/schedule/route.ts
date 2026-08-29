import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { proxyToServer } from "@/lib/zillow-admin";
import {
  encrypt,
  resolveConfig,
  clearConfigCache,
  normalizeRunHours,
  clampWindowHour,
  scheduleSummary,
  DEFAULT_MONTHLY_FIRE_CAP,
} from "@tenant-ai/shared";

/**
 * POST — the ONLY writer of the Zillow automation schedule
 * (zillow.auto_run_hours / auto_start_hour / auto_end_hour / textemall_broadcast_hour).
 *
 *   { mode: "fixed",  hours: number[] | "10,16,22", acknowledgeCap?: boolean }
 *   { mode: "hourly", startHour, endHour, broadcastHour?, acknowledgeCap?: boolean }
 *
 * Fixed mode writes the CSV; hourly mode writes a BLANK auto_run_hours (the
 * engine's parseRunHours("") → null = hourly-window mode — one upsert path, no
 * delete) plus the window and, for the Text-Em-All channel, the once-a-day
 * broadcast hour. Free-tier guard: on the Text-Em-All channel a schedule whose
 * 31-day estimate exceeds the monthly fire cap is refused with `needsAck: true`
 * until the caller re-sends with acknowledgeCap — the cap itself stays the
 * hard stop in the engine. Cache is cleared in BOTH processes (dashboard +
 * server) so the change is live at the next :00 tick.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = (session.user as any).id ?? "admin";
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "hourly" ? "hourly" : body.mode === "fixed" ? "fixed" : null;
  if (!mode) return NextResponse.json({ error: 'mode must be "fixed" or "hourly"' }, { status: 400 });

  // Current values (for the audit trail and as defaults).
  const cur = {
    runHours: (await resolveConfig("zillow", "auto_run_hours")) ?? "",
    startHour: clampWindowHour(await resolveConfig("zillow", "auto_start_hour"), 8),
    endHour: clampWindowHour(await resolveConfig("zillow", "auto_end_hour"), 22),
    broadcastHour: clampWindowHour(await resolveConfig("zillow", "textemall_broadcast_hour"), 12),
  };
  const channel = (await resolveConfig("zillow", "send_channel")) === "textemall" ? "textemall" : "relay";
  const capRaw = parseInt((await resolveConfig("textemall", "monthly_fire_cap")) ?? "", 10);
  const monthlyCap = Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : DEFAULT_MONTHLY_FIRE_CAP;

  const writes: Array<{ key: string; value: string }> = [];
  let runHours: number[] | null;
  let startHour = cur.startHour;
  let endHour = cur.endHour;
  let broadcastHour = cur.broadcastHour;

  if (mode === "fixed") {
    const norm = normalizeRunHours(body.hours);
    if (norm.errors.length) return NextResponse.json({ error: norm.errors.join("; "), errors: norm.errors }, { status: 400 });
    runHours = norm.hours;
    writes.push({ key: "zillow.auto_run_hours", value: runHours.join(",") });
  } else {
    if (body.startHour === undefined || body.endHour === undefined) {
      return NextResponse.json({ error: "startHour and endHour are required in hourly mode" }, { status: 400 });
    }
    startHour = clampWindowHour(body.startHour, -1);
    endHour = clampWindowHour(body.endHour, -1);
    if (startHour < 0 || endHour < 0 || startHour > endHour) {
      return NextResponse.json({ error: "hourly window must satisfy 0 ≤ start ≤ end ≤ 23" }, { status: 400 });
    }
    runHours = null;
    writes.push({ key: "zillow.auto_run_hours", value: "" });
    writes.push({ key: "zillow.auto_start_hour", value: String(startHour) });
    writes.push({ key: "zillow.auto_end_hour", value: String(endHour) });
    if (body.broadcastHour !== undefined) {
      broadcastHour = clampWindowHour(body.broadcastHour, -1);
      if (broadcastHour < 0) return NextResponse.json({ error: "broadcastHour must be 0–23" }, { status: 400 });
      writes.push({ key: "zillow.textemall_broadcast_hour", value: String(broadcastHour) });
    }
  }

  const summary = scheduleSummary({
    enabled: (await resolveConfig("zillow", "auto_enabled")) === "true",
    runHours, startHour, endHour, channel, monthlyCap, nowHour: new Date().getHours(),
  });
  if (summary.capWarning && body.acknowledgeCap !== true) {
    return NextResponse.json(
      {
        error: `${summary.label} on Text-Em-All is ≈ ${summary.monthlyEstimate} broadcasts/month, over the monthly broadcast cap of ${monthlyCap} — broadcasts would stop mid-month. Re-send with acknowledgeCap to save anyway.`,
        needsAck: true,
        estimate: summary.monthlyEstimate,
        cap: monthlyCap,
      },
      { status: 400 },
    );
  }

  for (const { key, value } of writes) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: encrypt(value), updatedBy: userId },
      update: { value: encrypt(value), updatedBy: userId },
    });
  }
  await prisma.auditLog
    .create({
      data: {
        userId,
        action: "zillow_schedule",
        resourceType: "system_config",
        resourceId: "zillow.auto_run_hours",
        metadata: {
          before: cur,
          after: { mode, runHours: runHours?.join(",") ?? "", startHour, endHour, broadcastHour },
          acknowledgedCap: summary.capWarning,
        },
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

  return NextResponse.json({ ok: true, schedule: summary, serverRefreshed });
}
