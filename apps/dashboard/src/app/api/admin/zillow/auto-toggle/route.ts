import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@tenant-ai/shared";

/**
 * POST { enabled, baselineMode? }: flip the automation on/off.
 *
 * Dashboard-local by design — SystemConfig values are encrypted at rest, and
 * this is the only writer (encrypt + audit + cache-clear), matching the
 * integrations PUT machinery. The server process picks the change up within
 * its ~60s config-cache TTL; "Run now" uses force and doesn't wait.
 *
 * baselineMode (only meaningful when enabling):
 *  - "today" (default): auto-send only leads discovered from today on
 *  - "all": also queue the existing backlog of new leads (≤60-day window)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const userId = (session.user as any).id ?? "admin";

    const body = await request.json().catch(() => ({}));
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
    }
    // "new" (default): text only leads imported AFTER go-live. "all": include the
    // existing backlog. resetBaseline forces the boundary to now on a re-enable.
    const baselineMode = body.baselineMode === "all" ? "all" : "new";
    const resetBaseline = body.resetBaseline === true;

    const clampHour = (v: unknown, def: number) =>
      Math.min(23, Math.max(0, parseInt(String(v), 10) || def));

    const writes: Array<{ key: string; value: string }> = [
      { key: "zillow.auto_enabled", value: body.enabled ? "true" : "false" },
    ];
    // Optional hourly window (8am–10pm by default). Accepted on any call.
    if (body.startHour !== undefined) {
      writes.push({ key: "zillow.auto_start_hour", value: String(clampHour(body.startHour, 8)) });
    }
    if (body.endHour !== undefined) {
      writes.push({ key: "zillow.auto_end_hour", value: String(clampHour(body.endHour, 22)) });
    }
    if (body.enabled) {
      if (baselineMode === "all") {
        // Explicit backlog blast: baseline = epoch (text everything, subject to caps).
        writes.push({ key: "zillow.auto_baseline", value: new Date(0).toISOString() });
      } else {
        // New-leads-only. Set the boundary to NOW only on the FIRST enable (or an
        // explicit reset) — preserve it on re-enable so a disable→re-enable never
        // skips leads imported while it was off. This grandfathers the leads
        // already in the list at go-live.
        const { resolveConfig } = await import("@tenant-ai/shared");
        const existing = (await resolveConfig("zillow", "auto_baseline"))?.trim();
        const existingValid = existing && !isNaN(new Date(existing).getTime()) && existing !== new Date(0).toISOString();
        if (!existingValid || resetBaseline) {
          writes.push({ key: "zillow.auto_baseline", value: new Date().toISOString() });
        }
      }
    }

    for (const { key, value } of writes) {
      await prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: encrypt(value), updatedBy: userId },
        update: { value: encrypt(value), updatedBy: userId },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: "zillow_automation_toggle",
        resourceType: "system_config",
        resourceId: "zillow.auto_enabled",
        metadata: { enabled: body.enabled, baselineMode: body.enabled ? baselineMode : null, resetBaseline },
      },
    });

    const { clearConfigCache } = await import("@tenant-ai/shared");
    clearConfigCache();

    return NextResponse.json({ success: true, enabled: body.enabled });
  } catch (error) {
    console.error("Zillow auto-toggle POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
