import "dotenv/config";
import { initConfigResolver } from "@tenant-ai/shared";
import { prismaConfigStore } from "../lib/config-store.js";
import { fireTextEmAllTrigger } from "../services/textemall-trigger.js";
initConfigResolver(prismaConfigStore);
(async () => {
  const r = await fireTextEmAllTrigger({ count: 2, now: new Date(2026, 7, 27), dryRun: true });
  console.log("dry-run result:", JSON.stringify(r, null, 2));
  process.exit(0);
})();
