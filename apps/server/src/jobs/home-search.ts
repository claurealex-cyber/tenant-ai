import type { JobDefinition } from "./scheduler.js";
import { runAllEnabled } from "../services/home-search/engine.js";

/**
 * Home Search — scheduled two-stage run over all enabled saved searches.
 * Conservative cadence (config/search-API-limit driven). HTTP-only pipeline, so it
 * does not contend with the Safari GUI lock (only the alert send briefly does).
 */
export const homeSearchJob: JobDefinition = {
  name: "home-search",
  cron: "0 8,14,20 * * *", // 3×/day; tune to the search-API tier
  maxRetries: 1,
  concurrency: 1,
  handler: async () => {
    const runs = await runAllEnabled();
    const totals = runs.reduce((a, r) => ({ n: a.n + r.inserted, x: a.x + r.notified }), { n: 0, x: 0 });
    if (runs.length) console.log(`[home-search] ran ${runs.length} search(es): ${totals.n} new, ${totals.x} alerted`);
  },
};
