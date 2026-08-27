import "dotenv/config";
import { initConfigResolver, clearConfigCache } from "@tenant-ai/shared";
import { prismaConfigStore } from "../lib/config-store.js";
import { fireTextEmAllTrigger } from "../services/textemall-trigger.js";
initConfigResolver(prismaConfigStore);
clearConfigCache(); // ensure the just-set trigger_armed=true is read, not a 60s-stale null
(async () => {
  const r = await fireTextEmAllTrigger({ count: 2, now: new Date(), dryRun: false });
  console.log("FIRE RESULT:", JSON.stringify(r, null, 2));
  process.exit(0);
})();
