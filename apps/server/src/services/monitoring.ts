/**
 * Monitoring service — health checks, active call tracking, error rate monitoring.
 *
 * Step 58: Monitoring + email notification dispatching.
 */

import { prisma } from "../lib/prisma.js";
import { getLastJobRuns } from "../jobs/scheduler.js";
import { sendNotification } from "./notifications.js";
import {
  getActiveCallCount as getRegistryCallCount,
  getAllCalls,
} from "../lib/call-registry.js";

// ── Active Call Tracking (delegates to call-registry) ──

export function getActiveCalls(): Array<{ callSid: string; propertyId: string; startTime: Date }> {
  return Array.from(getAllCalls().values()).map((c) => ({
    callSid: c.callSid,
    propertyId: c.propertyId,
    startTime: c.startTime,
  }));
}

export function getActiveCallCount(): number {
  return getRegistryCallCount();
}

// ── Error Rate Tracking ──

const recentErrors: Array<{ timestamp: Date; message: string; stack?: string }> = [];
const MAX_ERRORS_KEPT = 50;

export function recordError(message: string, stack?: string): void {
  recentErrors.push({ timestamp: new Date(), message, stack });
  if (recentErrors.length > MAX_ERRORS_KEPT) {
    recentErrors.shift();
  }
}

export function getRecentErrors() {
  return [...recentErrors];
}

/**
 * Check if error rate exceeds threshold (3 errors in 5 minutes).
 * If so, send alert to platform admin.
 */
export async function checkErrorRate(): Promise<boolean> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentCount = recentErrors.filter(
    (e) => e.timestamp > fiveMinAgo
  ).length;

  if (recentCount >= 3) {
    // Find admin email
    const admin = await prisma.user.findFirst({ where: { role: "admin" } });
    if (admin) {
      await sendNotification({
        type: "application_completed", // reuse existing type for system alerts
        recipientEmail: admin.email,
        recipientName: admin.name || "Admin",
        subject: `ALERT: High error rate — ${recentCount} errors in 5 minutes`,
        body: [
          `The platform has recorded ${recentCount} errors in the last 5 minutes.`,
          "",
          "Recent errors:",
          ...recentErrors
            .slice(-5)
            .map((e) => `- [${e.timestamp.toISOString()}] ${e.message}`),
        ].join("\n"),
      });
    }
    return true;
  }

  return false;
}

// ── Health Endpoint Data ──

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  activeCalls: number;
  maxCalls: number;
  memoryUsageMB: number;
  uptimeSeconds: number;
  dbConnected: boolean;
  lastJobRuns: Record<string, { lastRunAt: string | null; lastError: string | null }>;
  recentErrorCount: number;
}

const startTime = Date.now();

export async function getHealthStatus(): Promise<HealthStatus> {
  const maxCalls = parseInt(process.env.MAX_CONCURRENT_CALLS || "10", 10);
  let dbConnected = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbConnected = false;
  }

  const memUsage = process.memoryUsage();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentErrorCount = recentErrors.filter(
    (e) => e.timestamp > fiveMinAgo
  ).length;

  let status: "ok" | "degraded" | "down" = "ok";
  if (!dbConnected) status = "down";
  else if (recentErrorCount >= 3) status = "degraded";

  return {
    status,
    activeCalls: getActiveCallCount(),
    maxCalls,
    memoryUsageMB: Math.round(memUsage.rss / (1024 * 1024)),
    uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
    dbConnected,
    lastJobRuns: getLastJobRuns(),
    recentErrorCount,
  };
}
