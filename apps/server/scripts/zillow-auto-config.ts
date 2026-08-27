/**
 * Seed/inspect the zillow automation config keys (encrypted SystemConfig).
 * Usage: tsx scripts/zillow-auto-config.ts set <key> <value> | get <key>
 * Keys: auto_enabled | auto_hour | auto_baseline
 */
import { initConfigResolver, resolveConfig, encrypt, clearConfigCache } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";
import { prisma } from "../src/lib/prisma.js";

initConfigResolver(prismaConfigStore);
const [action, key, value] = process.argv.slice(2);
const dbKey = `zillow.${key}`;

if (action === "set" && key && value !== undefined) {
  await prisma.systemConfig.upsert({
    where: { key: dbKey },
    update: { value: encrypt(value), updatedBy: "zillow-auto-config" },
    create: { key: dbKey, value: encrypt(value), updatedBy: "zillow-auto-config" },
  });
  clearConfigCache?.();
  console.log(`${dbKey} set`);
} else if (action === "get" && key) {
  console.log(`${dbKey} = ${await resolveConfig("zillow", key)}`);
} else {
  console.error("Usage: set <key> <value> | get <key>");
  process.exit(1);
}
process.exit(0);
