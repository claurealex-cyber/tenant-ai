/**
 * SMS cleanup job — runs hourly.
 *
 * Deletes expired SMS conversations to free up space.
 */

import type { JobDefinition } from "./scheduler.js";
import { cleanupExpiredConversations } from "../handlers/sms-handler.js";

export const smsCleanupJob: JobDefinition = {
  name: "sms-cleanup",
  cron: "0 * * * *", // Hourly
  maxRetries: 2,
  backoffDelay: 5000,

  handler: async () => {
    const deleted = await cleanupExpiredConversations();

    if (deleted > 0) {
      console.log(`[sms-cleanup] Cleaned up ${deleted} expired conversation(s)`);
    }
  },
};
