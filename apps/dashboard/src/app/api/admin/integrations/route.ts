import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { INTEGRATION_REGISTRY, configDbKey, encrypt, decrypt } from "@tenant-ai/shared";

// GET: Return all integrations with status per field (hasValue, source)
// NEVER return actual key values
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch all SystemConfig rows
    const configs = await prisma.systemConfig.findMany();
    const configMap = new Map(configs.map((c) => [c.key, c]));

    const integrations = INTEGRATION_REGISTRY.map((integration) => ({
      id: integration.id,
      name: integration.name,
      description: integration.description,
      icon: integration.icon,
      category: integration.category,
      testEndpoint: integration.testEndpoint || null,
      fields: integration.fields.map((field) => {
        const dbKey = configDbKey(integration.id, field.key);
        const dbEntry = configMap.get(dbKey);
        const envValue = process.env[field.envVar];

        let source: "database" | "environment" | "none" = "none";
        let hasValue = false;
        if (dbEntry?.value) {
          source = "database";
          hasValue = true;
        } else if (envValue) {
          source = "environment";
          hasValue = true;
        }

        return {
          key: field.key,
          label: field.label,
          sensitive: field.sensitive,
          required: field.required,
          placeholder: field.placeholder || null,
          helpText: field.helpText || null,
          hasValue,
          source,
          updatedAt: dbEntry?.updatedAt?.toISOString() || null,
        };
      }),
    }));

    return NextResponse.json({ integrations });
  } catch (error) {
    console.error("Admin integrations GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT: Save integration config values (encrypted)
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = (session.user as any).id;
    const { integrationId, values } = await request.json();

    if (!integrationId || !values || typeof values !== "object") {
      return NextResponse.json({ error: "integrationId and values are required" }, { status: 400 });
    }

    // Validate integrationId exists
    const integration = INTEGRATION_REGISTRY.find((i) => i.id === integrationId);
    if (!integration) {
      return NextResponse.json({ error: "Unknown integration" }, { status: 400 });
    }

    // Validate field keys
    const validKeys = new Set(integration.fields.map((f) => f.key));
    const changedFields: string[] = [];

    for (const [fieldKey, value] of Object.entries(values)) {
      if (!validKeys.has(fieldKey)) continue;

      const dbKey = configDbKey(integrationId, fieldKey);
      changedFields.push(fieldKey);

      if (value === null || value === "") {
        // Clear DB value (revert to env fallback)
        await prisma.systemConfig.deleteMany({ where: { key: dbKey } });
      } else {
        // Encrypt and upsert
        const encrypted = encrypt(value as string);
        await prisma.systemConfig.upsert({
          where: { key: dbKey },
          create: { key: dbKey, value: encrypted, updatedBy: userId },
          update: { value: encrypted, updatedBy: userId },
        });
      }
    }

    // Audit log
    if (changedFields.length > 0) {
      await prisma.auditLog.create({
        data: {
          userId,
          action: "integration_config_update",
          resourceType: "system_config",
          resourceId: integrationId,
          metadata: { fields: changedFields },
        },
      });
    }

    // Clear config cache so services pick up new values
    const { clearConfigCache } = await import("@tenant-ai/shared");
    clearConfigCache();

    return NextResponse.json({ success: true, fieldsUpdated: changedFields.length });
  } catch (error) {
    console.error("Admin integrations PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
