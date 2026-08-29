import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, resolveConfig, clearConfigCache } from "@tenant-ai/shared";

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
  return NextResponse.json({
    method: (await resolveConfig("textemall", "broadcast_method")) === "api" ? "api" : "form",
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = (session.user as any).id ?? "admin";
  const body = await request.json().catch(() => ({}));
  const method = body.method === "api" ? "api" : "form";
  await prisma.systemConfig.upsert({
    where: { key: "textemall.broadcast_method" },
    create: { key: "textemall.broadcast_method", value: encrypt(method), updatedBy: userId },
    update: { value: encrypt(method), updatedBy: userId },
  });
  await prisma.auditLog.create({
    data: { userId, action: "broadcast_method_update", resourceType: "system_config", resourceId: "textemall.broadcast_method", metadata: { method } },
  }).catch(() => {});
  clearConfigCache();
  return NextResponse.json({ ok: true, method });
}
