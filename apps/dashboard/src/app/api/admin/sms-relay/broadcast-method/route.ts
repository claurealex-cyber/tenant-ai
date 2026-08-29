import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, resolveConfig, clearConfigCache } from "@tenant-ai/shared";
import { proxyToServer } from "@/lib/zillow-admin";

/**
 * GET → current broadcast method. POST { method: "api" | "form" }.
 * "api": send Text-Em-All broadcasts DIRECTLY via its REST API (no Google Form,
 * no Zapier, no 100/mo cap, targets numbers directly). "form" (default): the
 * Google Form → Zapier path. Governs BOTH the Zillow batch and the individual
 * caller/text paths.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Back-compat readout: report "api" when either lane resolves to api (lane key
  // or legacy global). The per-lane truth lives in /api/admin/delivery-method.
  const z = (await resolveConfig("zillow", "broadcast_method")) ?? (await resolveConfig("textemall", "broadcast_method"));
  const i = (await resolveConfig("sms_relay", "broadcast_method")) ?? (await resolveConfig("textemall", "broadcast_method"));
  return NextResponse.json({ method: z === "api" || i === "api" ? "api" : "form" });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = (session.user as any).id ?? "admin";
  const body = await request.json().catch(() => ({}));
  const method = body.method === "api" ? "api" : "form";
  // Write the PER-LANE keys (M0/P1) — never the legacy global — so this legacy
  // toggle and the new per-lane controls share ONE key space (no split-brain).
  for (const key of ["zillow.broadcast_method", "sms_relay.broadcast_method"]) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: encrypt(method), updatedBy: userId },
      update: { value: encrypt(method), updatedBy: userId },
    });
  }
  await prisma.auditLog.create({
    data: { userId, action: "broadcast_method_update", resourceType: "system_config", resourceId: "textemall.broadcast_method", metadata: { method } },
  }).catch(() => {});
  clearConfigCache();
  try { await proxyToServer("/internal/config/refresh", { method: "POST", timeoutMs: 4000 }); } catch { /* best-effort */ }
  return NextResponse.json({ ok: true, method });
}
