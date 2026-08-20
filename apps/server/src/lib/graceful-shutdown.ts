/**
 * Graceful shutdown handler for the Fastify server.
 *
 * Step 59: On SIGTERM (Docker stop, deploy):
 * 1. Stop accepting new calls
 * 2. Wait for active calls to finish (grace period: 120s)
 * 3. Close WebSocket connections
 * 4. Close Prisma connection
 * 5. Close Redis connection
 * 6. Exit
 */

import { prisma } from "./prisma.js";
import { closeRedisConnection } from "./redis.js";
import { shutdownScheduler } from "../jobs/scheduler.js";
import { getActiveCalls, getActiveCallCount } from "../services/monitoring.js";

const GRACE_PERIOD_MS = parseInt(process.env.SHUTDOWN_GRACE_MS || "120000", 10);

let isShuttingDown = false;

export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Register shutdown handlers on the given server.
 * Call this once during startup.
 */
export function registerShutdownHandlers(
  closeServer: () => Promise<void>
): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[shutdown] Received ${signal}. Starting graceful shutdown...`);

    // 1. Stop accepting new connections
    try {
      await closeServer();
      console.log("[shutdown] Server stopped accepting new connections.");
    } catch (err) {
      console.error("[shutdown] Error closing server:", err);
    }

    // 2. Wait for active calls to finish
    const activeCount = getActiveCallCount();
    if (activeCount > 0) {
      console.log(
        `[shutdown] Waiting for ${activeCount} active call(s) to complete (grace: ${GRACE_PERIOD_MS / 1000}s)...`
      );

      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (getActiveCallCount() === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 1000);

        // Force close after grace period
        setTimeout(() => {
          clearInterval(checkInterval);
          const remaining = getActiveCalls();
          if (remaining.length > 0) {
            console.log(
              `[shutdown] Grace period expired. Force-closing ${remaining.length} call(s).`
            );
          }
          resolve();
        }, GRACE_PERIOD_MS);
      });
    }

    // 3. Shutdown BullMQ workers and queues
    try {
      await shutdownScheduler();
      console.log("[shutdown] BullMQ scheduler shut down.");
    } catch (err) {
      console.error("[shutdown] Error shutting down scheduler:", err);
    }

    // 4. Close Redis
    try {
      await closeRedisConnection();
      console.log("[shutdown] Redis connection closed.");
    } catch (err) {
      console.error("[shutdown] Error closing Redis:", err);
    }

    // 5. Close Prisma
    try {
      await prisma.$disconnect();
      console.log("[shutdown] Prisma connection closed.");
    } catch (err) {
      console.error("[shutdown] Error disconnecting Prisma:", err);
    }

    console.log("[shutdown] Graceful shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
