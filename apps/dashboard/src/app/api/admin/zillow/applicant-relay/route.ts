import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, resolveConfig, clearConfigCache } from "@tenant-ai/shared";
import { proxyToServer } from "@/lib/zillow-admin";

const DEFAULT_MSG =
  "Hi! Thanks for submitting your application with Ghem Properties — we've received it and will follow up with next steps shortly. Reply here with any questions.";

async function admin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") return null;
  return (session.user as any).id ?? "admin";
}

/** GET → applicant-relay toggle + message + counts. */
export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [enabled, message, total, pending] = await Promise.all([
    resolveConfig("textemall", "applicant_relay_enabled"),
    resolveConfig("textemall", "applicant_broadcast_message"),
    prisma.zillowLead.count({ where: { applicationCompleted: true } }),
    prisma.zillowLead.count({ where: { applicationCompleted: true, applicantSentBatchId: null } }),
  ]);
  return NextResponse.json({
    enabled: enabled === "true",
    message: message || DEFAULT_MSG,
    applicantCount: total,
    pendingCount: pending, // applicants not yet messaged on the applicant segment
  });
}

/** POST { enabled?, message? } → write config + refresh both caches. */
export async function POST(request: NextRequest) {
  const userId = await admin();
  if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const writes: Promise<unknown>[] = [];
  if (typeof body.enabled === "boolean") {
    writes.push(prisma.systemConfig.upsert({
      where: { key: "textemall.applicant_relay_enabled" },
      create: { key: "textemall.applicant_relay_enabled", value: encrypt(body.enabled ? "true" : "false"), updatedBy: userId },
      update: { value: encrypt(body.enabled ? "true" : "false"), updatedBy: userId },
    }));
  }
  if (typeof body.message === "string" && body.message.trim()) {
    writes.push(prisma.systemConfig.upsert({
      where: { key: "textemall.applicant_broadcast_message" },
      create: { key: "textemall.applicant_broadcast_message", value: encrypt(body.message.trim()), updatedBy: userId },
      update: { value: encrypt(body.message.trim()), updatedBy: userId },
    }));
  }
  await Promise.all(writes);
  await prisma.auditLog.create({ data: { userId, action: "applicant_relay_update", resourceType: "system_config", resourceId: "textemall.applicant_relay_enabled", metadata: { enabled: body.enabled, hasMessage: typeof body.message === "string" } } }).catch(() => {});
  clearConfigCache();
  try { await proxyToServer("/internal/config/refresh", { method: "POST", timeoutMs: 4000 }); } catch { /* best-effort */ }
  return NextResponse.json({ ok: true });
}
