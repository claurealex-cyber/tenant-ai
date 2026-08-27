/**
 * Zillow daily automation — hourly tick; the service's hour-window + day-claim
 * logic decides whether anything actually happens (see zillow-auto.ts).
 *
 * maxRetries: 0 and a catch-all handler: domain failures (needs_login etc.)
 * are recorded results, and BullMQ's retry/backoff must never hammer a
 * logged-out Safari. Only a truly unexpected throw is logged — not retried.
 */

import type { JobDefinition } from "./scheduler.js";
import { runDailyAutomation } from "../services/zillow-auto.js";

export const zillowDailyJob: JobDefinition = {
  name: "zillow-daily",
  cron: "0 * * * *", // hourly tick
  maxRetries: 0,

  handler: async () => {
    try {
      const result = await runDailyAutomation({ scheduled: true });
      if (result.outcome !== "not_in_window" && result.outcome !== "disabled") {
        console.log(
          `[zillow-daily] ${result.outcome}` +
            (result.run
              ? ` — day ${result.run.day} attempt ${result.run.attempts}: ${result.run.leadsNew} new, ${result.run.queuedSends} queued`
              : ""),
        );
      }
    } catch (err) {
      // Infra-level failure (DB down etc.). Swallow: the next hourly tick is
      // the retry policy; BullMQ backoff would add nothing but noise.
      console.error(`[zillow-daily] unexpected error: ${err}`);
    }
  },
};
