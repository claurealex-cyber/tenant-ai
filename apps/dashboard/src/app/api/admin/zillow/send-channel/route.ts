import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, resolveConfig, clearConfigCache } from "@tenant-ai/shared";

/**
 * POST { channel: "relay" | "textemall" }: pick the Zillow auto-send channel.
 * Guard (rev.4 I): textemall requires survey_mode=google_form globally, because
 * a broadcast can only carry ONE shared link. We do NOT auto-change survey_mode
 * (it also drives intake texts + caller links) — the operator sets it first.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = (session.user as any).id ?? "admin";
  const body = await request.json().catch(() => ({}));
  const channel = body.channel === "textemall" ? "textemall" : "relay";

  if (channel === "textemall") {
    const mode = await resolveConfig("sms_relay", "survey_mode");
    if (mode !== "google_form") {
      return NextResponse.json(
        { error: "Text-Em-All needs Survey Link Mode = Google Form first (a broadcast carries one shared link). Set that, then switch channel." },
        { status: 400 },
      );
    }
  }

  await prisma.systemConfig.upsert({
    where: { key: "zillow.send_channel" },
    create: { key: "zillow.send_channel", value: encrypt(channel), updatedBy: userId },
    update: { value: encrypt(channel), updatedBy: userId },
  });
  await prisma.auditLog.create({
    data: { userId, action: "zillow_send_channel", resourceType: "system_config", resourceId: "zillow.send_channel", metadata: { channel } },
  }).catch(() => {});
  clearConfigCache();
  return NextResponse.json({ ok: true, channel });
}
