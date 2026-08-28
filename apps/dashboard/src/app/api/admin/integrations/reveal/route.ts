import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INTEGRATION_REGISTRY, configDbKey, decrypt } from "@tenant-ai/shared";

// POST: reveal the actual value of ONE integration field (admin only, audited).
// Deliberately NOT part of the bulk GET — on-demand so secrets stay out of every
// page load, cache, and log. Body: { integrationId, fieldKey }.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { integrationId, fieldKey } = await request.json().catch(() => ({}));
  const integration = INTEGRATION_REGISTRY.find((i) => i.id === integrationId);
  const field = integration?.fields.find((f) => f.key === fieldKey);
  if (!integration || !field) {
    return NextResponse.json({ error: "Unknown integration or field" }, { status: 400 });
  }

  const dbKey = configDbKey(integrationId, fieldKey);
  const row = await prisma.systemConfig.findUnique({ where: { key: dbKey } });

  let value: string | null = null;
  let source: "database" | "environment" | "none" = "none";
  if (row?.value) {
    value = decrypt(row.value);
    source = "database";
  } else if (process.env[field.envVar]) {
    value = process.env[field.envVar]!;
    source = "environment";
  }

  await prisma.auditLog.create({
    data: {
      userId: (session.user as any).id,
      action: "integration_secret_revealed",
      resourceType: "system_config",
      resourceId: integrationId,
      metadata: { fieldKey, source },
    },
  });

  return NextResponse.json(
    { value, source },
    { headers: { "Cache-Control": "no-store" } },
  );
}
