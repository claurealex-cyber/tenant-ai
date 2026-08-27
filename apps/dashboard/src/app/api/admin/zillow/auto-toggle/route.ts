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
    const baselineMode = body.baselineMode === "all" ? "all" : "today";

    const writes: Array<{ key: string; value: string }> = [
      { key: "zillow.auto_enabled", value: body.enabled ? "true" : "false" },
    ];
    if (body.enabled) {
      const baseline =
        baselineMode === "all"
          ? new Date(0).toISOString()
          : (() => {
              const midnight = new Date();
              midnight.setHours(0, 0, 0, 0);
              return midnight.toISOString();
            })();
      writes.push({ key: "zillow.auto_baseline", value: baseline });
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
        metadata: { enabled: body.enabled, baselineMode: body.enabled ? baselineMode : null },
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
