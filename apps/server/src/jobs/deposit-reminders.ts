/**
 * Daily job: check deposit deadlines and send reminders.
 */

import type { JobDefinition } from "./scheduler.js";
import { sendDepositReminders } from "../services/deposit-lifecycle.js";

export const depositRemindersJob: JobDefinition = {
  name: "deposit-reminders",
  cron: "0 6 * * *", // Daily at 6 AM
  maxRetries: 3,
  backoffDelay: 5000,

  handler: async () => {
    const sent = await sendDepositReminders();

    if (sent > 0) {
      console.log(`[deposit-reminders] Sent ${sent} deposit reminder(s)`);
    }
  },
};
