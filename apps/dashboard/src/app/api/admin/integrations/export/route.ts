import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INTEGRATION_REGISTRY, configDbKey, decrypt } from "@tenant-ai/shared";

// POST: export EVERY configured integration value across the registry as plain
// JSON, so the same credentials can be re-imported on another instance. Admin
// only, audited, no-store. WARNING: the file is your secrets in the clear.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.systemConfig.findMany();
  const dbMap = new Map(rows.map((r) => [r.key, r.value]));

  const values: Record<string, string> = {};
  const exportedKeys: string[] = [];
  for (const integration of INTEGRATION_REGISTRY) {
    for (const field of integration.fields) {
      const flat = `${integration.id}.${field.key}`;
      const enc = dbMap.get(configDbKey(integration.id, field.key));
      if (enc) {
        values[flat] = decrypt(enc);
        exportedKeys.push(flat);
      } else if (process.env[field.envVar]) {
        values[flat] = process.env[field.envVar]!;
        exportedKeys.push(flat);
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: (session.user as any).id,
      action: "integration_config_exported",
      resourceType: "system_config",
      resourceId: "*",
      metadata: { keys: exportedKeys }, // key NAMES only, never values
    },
  });

  const body = {
    _meta: { app: "tenant-ai", kind: "integration-config-export", version: 1, count: exportedKeys.length },
    values,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="tenant-ai-integrations-export.json"`,
    },
  });
}
