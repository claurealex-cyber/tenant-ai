/**
 * Late fee job — runs daily at midnight.
 *
 * Creates late_fee RentCharge records for overdue charges past their grace period.
 * Enforces IL 5-day minimum grace and Cook County RTLO cap.
 */

import type { JobDefinition } from "./scheduler.js";
import { calculateLateFees } from "../services/late-fees.js";

export const lateFeeJob: JobDefinition = {
  name: "late-fee",
  cron: "0 0 * * *", // Daily at midnight
  maxRetries: 3,
  backoffDelay: 5000,

  handler: async () => {
    const created = await calculateLateFees();

    if (created > 0) {
      console.log(`[late-fee] Created ${created} late fee charge(s)`);
    }
  },
};
