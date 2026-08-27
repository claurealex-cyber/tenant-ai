import "dotenv/config";
import { initConfigResolver, resolveConfig } from "@tenant-ai/shared";
import { prismaConfigStore } from "../lib/config-store.js";

initConfigResolver(prismaConfigStore);

(async () => {
  const keys: [string, string][] = [
    ["sms_relay", "survey_mode"],
    ["sms_relay", "survey_base_url"],
    ["zillow", "send_channel"],
    ["zillow", "textemall_group"],
    ["textemall", "textemall_broadcast_hour"],
    ["textemall", "trigger_armed"],
    ["textemall", "trigger_endpoint"],
    ["textemall", "entry_ready"],
  ];
  for (const [i, k] of keys) {
    const v = await resolveConfig(i, k);
    console.log(`  ${i}.${k} = ${v === null ? "(null)" : JSON.stringify(v)}`);
  }
  process.exit(0);
})();
