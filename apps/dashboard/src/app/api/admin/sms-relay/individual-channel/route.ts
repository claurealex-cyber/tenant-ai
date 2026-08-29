import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, resolveConfig, clearConfigCache } from "@tenant-ai/shared";
import { proxyToServer } from "@/lib/zillow-admin";

async function setCfg(key: string, value: string, userId: string) {
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: encrypt(value), updatedBy: userId },
    update: { value: encrypt(value), updatedBy: userId },
  });
}

/**
 * GET → current individual-relay toggle state.
 * POST { channel?: "relay"|"textemall", armed?: boolean, testNumbers?: string }
 * Ships disarmed; the relay is the guaranteed fallback so flipping the channel on
 * (while disarmed) still delivers every link via relay — nothing fires until armed.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    channel: (await resolveConfig("sms_relay", "individual_channel")) === "textemall" ? "textemall" : "relay",
    armed: (await resolveConfig("textemall", "individual_trigger_armed")) === "true",
    testNumbers: (await resolveConfig("textemall", "individual_test_numbers")) || "",
    group: (await resolveConfig("textemall", "individual_group")) || "2. leads 08-28-2026",
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = (session.user as any).id ?? "admin";
  const body = await request.json().catch(() => ({}));

  if (body.channel !== undefined) {
    await setCfg("sms_relay.individual_channel", body.channel === "textemall" ? "textemall" : "relay", userId);
  }
  if (body.armed !== undefined) {
    await setCfg("textemall.individual_trigger_armed", body.armed ? "true" : "false", userId);
  }
  if (body.testNumbers !== undefined) {
    await setCfg("textemall.individual_test_numbers", String(body.testNumbers || ""), userId);
  }
  await prisma.auditLog.create({
    data: { userId, action: "individual_channel_update", resourceType: "system_config", resourceId: "sms_relay.individual_channel", metadata: { channel: body.channel, armed: body.armed } },
  }).catch(() => {});
  clearConfigCache();
  try { await proxyToServer("/internal/config/refresh", { method: "POST", timeoutMs: 4000 }); } catch { /* best-effort */ }
  return NextResponse.json({ ok: true });
}
