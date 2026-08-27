import "dotenv/config";
import { encrypt, configDbKey } from "@tenant-ai/shared";
import { prisma } from "../lib/prisma.js";
(async () => {
  const [integrationId, fieldKey, ...rest] = process.argv.slice(2);
  const value = rest.join(" ");
  if (!integrationId || !fieldKey) { console.error("usage: set-config <integration> <field> <value>"); process.exit(1); }
  const key = configDbKey(integrationId, fieldKey);
  const enc = encrypt(value);
  await prisma.systemConfig.upsert({ where: { key }, create: { key, value: enc, updatedBy: "textemall-livegate" }, update: { value: enc, updatedBy: "textemall-livegate" } });
  console.log(`set ${key} = ${JSON.stringify(value)}`);
  process.exit(0);
})();
