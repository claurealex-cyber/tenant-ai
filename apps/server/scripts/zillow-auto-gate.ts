import { initConfigResolver, resolveConfig } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";
initConfigResolver(prismaConfigStore);
const secret = await resolveConfig("sms_relay", "internal_secret");
const base = `http://localhost:${process.env.SERVER_PORT || "3005"}`;
const headers = { "x-relay-secret": secret!, "Content-Type": "application/json" };
const action = process.argv[2];
if (action === "status") {
  const r = await fetch(`${base}/internal/zillow/auto-status`, { headers });
  const d = await r.json();
  console.log(JSON.stringify({ enabled: d.enabled, autoHour: d.autoHour, baseline: d.baseline, today: d.today, deferred: d.deferredQueue, totals: d.totals }));
} else {
  const force = action === "force";
  const r = await fetch(`${base}/internal/zillow/auto-run`, { method: "POST", headers, body: JSON.stringify(force ? { force: true } : {}) });
  console.log(r.status, JSON.stringify(await r.json()));
}
process.exit(0);
