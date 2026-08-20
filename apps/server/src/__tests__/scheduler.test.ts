import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import {
  registerJob,
  addJob,
  getLastJobRuns,
  getQueue,
  getRegisteredJobNames,
  shutdownScheduler,
} from "../jobs/scheduler.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6380";

let redis: IORedis;
let redisAvailable = false;

beforeAll(async () => {
  redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    redisAvailable = true;
  } catch {
    console.log("Redis not available — skipping scheduler tests");
  }
});

afterAll(async () => {
  await shutdownScheduler();
  if (redis) {
    await redis.quit();
  }
});

afterEach(async () => {
  // Clean up between tests
  await shutdownScheduler();
});

// Helper to wait for a condition
function waitFor(
  fn: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error("waitFor timed out"));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// Helper to clean a queue
async function cleanQueue(name: string) {
  const q = new Queue(name, {
    connection: {
      host: "localhost",
      port: 6380,
      maxRetriesPerRequest: null,
    } as any,
  });
  await q.obliterate({ force: true }).catch(() => {});
  await q.close();
}

describe("Redis connection", () => {
  it("connects successfully (ping → PONG)", async () => {
    if (!redisAvailable) return;
    const result = await redis.ping();
    expect(result).toBe("PONG");
  });
});

describe("BullMQ scheduler", () => {
  it("creates queue for registered job", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-create-queue");

    await registerJob({
      name: "test-create-queue",
      handler: async () => {},
    });

    const queue = getQueue("test-create-queue");
    expect(queue).toBeDefined();
    expect(queue!.name).toBe("test-create-queue");
  });

  it("registers job names correctly", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-names-a");
    await cleanQueue("test-names-b");

    await registerJob({
      name: "test-names-a",
      handler: async () => {},
    });
    await registerJob({
      name: "test-names-b",
      handler: async () => {},
    });

    const names = getRegisteredJobNames();
    expect(names).toContain("test-names-a");
    expect(names).toContain("test-names-b");
  });

  it("prevents duplicate registration", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-dup");

    await registerJob({
      name: "test-dup",
      handler: async () => {},
    });

    await expect(
      registerJob({ name: "test-dup", handler: async () => {} })
    ).rejects.toThrow("already registered");
  });

  it("worker processes a job and handler executes", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-process");

    let handlerCalled = false;
    let receivedData: any = null;

    await registerJob({
      name: "test-process",
      handler: async (job) => {
        handlerCalled = true;
        receivedData = job.data;
      },
    });

    await addJob("test-process", { foo: "bar" });

    await waitFor(() => handlerCalled, 5000);
    expect(handlerCalled).toBe(true);
    expect(receivedData).toEqual({ foo: "bar" });
  });

  it("tracks lastRunAt after successful job", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-lastrun");

    let done = false;
    await registerJob({
      name: "test-lastrun",
      handler: async () => {
        done = true;
      },
    });

    // Before any job
    const beforeRuns = getLastJobRuns();
    expect(beforeRuns["test-lastrun"].lastRunAt).toBeNull();

    await addJob("test-lastrun", {});
    await waitFor(() => done, 5000);

    const afterRuns = getLastJobRuns();
    expect(afterRuns["test-lastrun"].lastRunAt).not.toBeNull();
    expect(afterRuns["test-lastrun"].lastError).toBeNull();
  });

  it("tracks lastError after failed job", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-error-track");

    let attempts = 0;
    await registerJob({
      name: "test-error-track",
      handler: async () => {
        attempts++;
        throw new Error("intentional failure");
      },
      maxRetries: 0, // No retries — fail immediately
      backoffDelay: 100,
    });

    await addJob("test-error-track", {});

    // Wait for failure to be recorded
    await waitFor(() => {
      const runs = getLastJobRuns();
      return runs["test-error-track"]?.lastError !== null;
    }, 5000);

    const runs = getLastJobRuns();
    expect(runs["test-error-track"].lastError).toBe("intentional failure");
  });

  it("retries failed jobs with exponential backoff", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-retry");

    const attemptTimestamps: number[] = [];

    await registerJob({
      name: "test-retry",
      handler: async (job) => {
        attemptTimestamps.push(Date.now());
        if (attemptTimestamps.length < 3) {
          throw new Error("fail to trigger retry");
        }
        // Succeed on 3rd attempt
      },
      maxRetries: 3,
      backoffDelay: 200, // Use short delay for testing
    });

    await addJob("test-retry", {});

    // Wait for 3 attempts
    await waitFor(() => attemptTimestamps.length >= 3, 10000);

    expect(attemptTimestamps.length).toBe(3);

    // Verify exponential backoff: gap between attempts should increase
    if (attemptTimestamps.length >= 3) {
      const gap1 = attemptTimestamps[1] - attemptTimestamps[0];
      const gap2 = attemptTimestamps[2] - attemptTimestamps[1];
      // Second gap should be roughly 2x the first (exponential)
      // Use loose bounds due to timing variance
      expect(gap1).toBeGreaterThanOrEqual(100); // ~200ms base
      expect(gap2).toBeGreaterThan(gap1 * 1.3); // Should be noticeably larger
    }
  });

  it("moves job to failed after max retries exceeded", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-max-retry");

    let totalAttempts = 0;

    await registerJob({
      name: "test-max-retry",
      handler: async () => {
        totalAttempts++;
        throw new Error("always fails");
      },
      maxRetries: 2, // 2 retries = 3 total attempts
      backoffDelay: 100,
    });

    await addJob("test-max-retry", {});

    // Wait for all attempts to complete
    await waitFor(() => totalAttempts >= 3, 10000);

    // Give a moment for BullMQ to finalize
    await new Promise((r) => setTimeout(r, 500));

    const queue = getQueue("test-max-retry")!;
    const failed = await queue.getFailed();
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(totalAttempts).toBe(3); // Initial + 2 retries
  });

  it("prevents duplicate jobs with same jobId", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-dedup");

    let callCount = 0;
    await registerJob({
      name: "test-dedup",
      handler: async () => {
        callCount++;
      },
    });

    // Add same job twice with same jobId
    await addJob("test-dedup", { n: 1 }, { jobId: "unique-123" });
    // Second add with same jobId should be a no-op (BullMQ deduplicates)
    await addJob("test-dedup", { n: 2 }, { jobId: "unique-123" });

    await waitFor(() => callCount >= 1, 5000);

    // Brief pause to ensure no second execution
    await new Promise((r) => setTimeout(r, 500));
    expect(callCount).toBe(1);
  });

  it("addJob throws for unregistered job name", async () => {
    if (!redisAvailable) return;
    await expect(addJob("nonexistent", {})).rejects.toThrow("not registered");
  });

  it("schedules recurring job with cron pattern", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-cron");

    await registerJob({
      name: "test-cron",
      handler: async () => {},
      cron: "0 0 * * *", // Daily at midnight
    });

    const queue = getQueue("test-cron")!;
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.length).toBeGreaterThanOrEqual(1);

    // Find by key — BullMQ may use 'key' or 'id' depending on version
    const found = schedulers.some(
      (s: any) =>
        s.id === "test-cron-scheduled" ||
        s.key === "test-cron-scheduled" ||
        s.name === "test-cron-scheduled"
    );
    expect(found).toBe(true);
  });

  it("graceful shutdown closes all workers and queues", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-shutdown");

    await registerJob({
      name: "test-shutdown",
      handler: async () => {},
    });

    expect(getRegisteredJobNames()).toContain("test-shutdown");

    await shutdownScheduler();

    expect(getRegisteredJobNames()).toHaveLength(0);
  });

  it("health endpoint format: lastJobRuns has correct shape", async () => {
    if (!redisAvailable) return;
    await cleanQueue("test-health");

    await registerJob({
      name: "test-health",
      handler: async () => {},
    });

    const runs = getLastJobRuns();
    expect(runs).toHaveProperty("test-health");
    expect(runs["test-health"]).toHaveProperty("lastRunAt");
    expect(runs["test-health"]).toHaveProperty("lastError");
    expect(runs["test-health"].lastRunAt).toBeNull();
    expect(runs["test-health"].lastError).toBeNull();
  });
});
