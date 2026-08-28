import type { JobDefinition } from "./scheduler.js";
import { runIndividualRelay, type IndividualRelayJobData } from "../services/individual-relay.js";

/**
 * Individual caller/text → Text-Em-All relay. Enqueued on demand (no cron).
 * concurrency=1 serializes the per-call group edits (F1); maxRetries=0 so a retry
 * can never double-fire (R6/F5) — the handler itself falls back to the relay on
 * any failure, so the caller still gets exactly one link.
 */
export const individualRelayJob: JobDefinition = {
  name: "individual-relay",
  maxRetries: 0,
  concurrency: 1,
  handler: async (job) => {
    const data = job.data as IndividualRelayJobData;
    try {
      const outcome = await runIndividualRelay(data);
      const extra = "reason" in outcome ? ` (${outcome.reason})` : "";
      console.log(`[individual-relay] ${data.callerPhone} → ${outcome.via}${extra}`);
    } catch (err) {
      console.error(`[individual-relay] unexpected error: ${err}`);
    }
  },
};
