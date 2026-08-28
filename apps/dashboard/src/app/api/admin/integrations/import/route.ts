import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INTEGRATION_REGISTRY, configDbKey, encrypt, clearConfigCache } from "@tenant-ai/shared";

// POST: import a plain-JSON export (from /export) INTO this instance. Validates
// each "integrationId.fieldKey" against the registry, encrypt+upserts, audits.
// Body: the export object { _meta?, values: { "ns.key": value } }.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const values = payload?.values;
  if (!values || typeof values !== "object") {
    return NextResponse.json({ error: "Invalid export: missing 'values' object" }, { status: 400 });
  }

  const validFlat = new Set<string>();
  for (const i of INTEGRATION_REGISTRY) for (const f of i.fields) validFlat.add(`${i.id}.${f.key}`);

  const imported: string[] = [];
  const skipped: string[] = [];
  const userId = (session.user as any).id;

  for (const [flat, value] of Object.entries(values)) {
    if (!validFlat.has(flat) || typeof value !== "string" || value === "") {
      skipped.push(flat);
      continue;
    }
    const [integrationId, fieldKey] = flat.split(/\.(.+)/); // split on first dot only
    const dbKey = configDbKey(integrationId, fieldKey);
    const encrypted = encrypt(value);
    await prisma.systemConfig.upsert({
      where: { key: dbKey },
      create: { key: dbKey, value: encrypted, updatedBy: userId },
      update: { value: encrypted, updatedBy: userId },
    });
    imported.push(flat);
  }

  if (imported.length > 0) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "integration_config_imported",
        resourceType: "system_config",
        resourceId: "*",
        metadata: { imported, skipped },
      },
    });
    clearConfigCache();
  }

  return NextResponse.json({ success: true, imported: imported.length, skipped: skipped.length, skippedKeys: skipped });
}
