/**
 * Rent posting job — runs daily at midnight.
 *
 * Creates RentCharge records for active leases whose rentDueDay is today.
 * Idempotent: the @@unique(leaseId, forMonth, type) constraint prevents duplicates.
 */

import type { JobDefinition } from "./scheduler.js";
import { postRentCharges } from "../services/rent-charges.js";

export const rentPostingJob: JobDefinition = {
  name: "rent-posting",
  cron: "0 0 * * *", // Daily at midnight
  maxRetries: 3,
  backoffDelay: 5000,

  handler: async () => {
    const created = await postRentCharges();

    if (created > 0) {
      console.log(`[rent-posting] Created ${created} rent charge(s)`);
    }
  },
};
