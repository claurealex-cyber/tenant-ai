/**
 * Billing cycle job — runs on the 1st of each month.
 *
 * Aggregates AI usage, calculates overage, and creates invoices
 * for all active subscriptions.
 */

import type { JobDefinition } from "./scheduler.js";
import { runBillingCycle } from "../services/billing-cycle.js";

export const billingCycleJob: JobDefinition = {
  name: "billing-cycle",
  cron: "0 0 1 * *", // 1st of each month at midnight
  maxRetries: 3,
  backoffDelay: 10000,

  handler: async () => {
    // Bill for the previous month
    const now = new Date();
    const billingMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));

    const created = await runBillingCycle(billingMonth);

    if (created > 0) {
      console.log(
        `[billing-cycle] Created ${created} invoice(s) for ${billingMonth.toISOString().slice(0, 7)}`
      );
    }
  },
};
