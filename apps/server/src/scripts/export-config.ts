import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@tenant-ai/shared";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.systemConfig.findMany({ select: { key: true, value: true } });
  const values: Record<string, string> = {};
  const failed: string[] = [];
  for (const r of rows) {
    try { values[r.key] = decrypt(r.value); } catch { failed.push(r.key); }
  }
  const out = { _meta: { app: "tenant-ai", kind: "integrations-config-export", version: 1, count: Object.keys(values).length }, values };
  const path = join(homedir(), "Downloads", "tenant-ai-config-export.json");
  writeFileSync(path, JSON.stringify(out, null, 2), "utf8");
  // Masked summary only — never print secret values:
  console.log(`wrote ${Object.keys(values).length} keys to ${path}`);
  for (const k of Object.keys(values).sort()) {
    const v = String(values[k]); console.log(`  ${k} = ${v.length > 8 ? v.slice(0,4)+"…"+v.slice(-3) : v}`);
  }
  if (failed.length) console.log(`COULD NOT DECRYPT (${failed.length}): ${failed.join(", ")}`);
  await prisma.$disconnect();
})();
