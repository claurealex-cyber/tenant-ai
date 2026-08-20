/**
 * Daily job: check for expiring leases, send reminders, auto-convert expired.
 */

import type { JobDefinition } from "./scheduler.js";
import { checkLeaseExpirations } from "../services/lease-expiration.js";

export const leaseExpirationJob: JobDefinition = {
  name: "lease-expiration",
  cron: "0 1 * * *", // Daily at 1 AM
  maxRetries: 3,
  backoffDelay: 5000,

  handler: async () => {
    const result = await checkLeaseExpirations();

    if (result.reminders > 0 || result.autoConverted > 0) {
      console.log(
        `[lease-expiration] Reminders: ${result.reminders}, Auto-converted: ${result.autoConverted}`
      );
    }
  },
};
