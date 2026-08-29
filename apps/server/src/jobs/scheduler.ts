import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { getRedisConnection, createRedisConnection } from "../lib/redis.js";

// ── Types ──

export interface JobDefinition {
  /** Unique name for this job type (e.g., "rent-posting", "late-fee") */
  name: string;
  /** The handler function that processes the job */
  handler: (job: Job) => Promise<void>;
  /** Cron pattern for recurring jobs (e.g., "0 0 * * *" for daily midnight) */
  cron?: string;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base backoff delay in ms (default: 1000). Exponential: delay * 2^attempt */
  backoffDelay?: number;
  /** Worker concurrency (default: 1) */
  concurrency?: number;
}

interface RegisteredJob {
  definition: JobDefinition;
  queue: Queue;
  worker: Worker;
  registeredAt: Date;
  lastRunAt: Date | null;
  lastError: string | null;
}

/** Observable state of a registered job (for watchdogs / status endpoints). */
export interface JobState {
  registered: boolean;
  registeredAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
}

/**
 * Read-only view of a job's registration + last-run state. `registered: false`
 * means registerJob() never completed for this name (typically Redis was
 * unavailable at boot — index.ts logs and continues, so the server is up but
 * this job will never tick until a restart with Redis up).
 */
/** The hourly tick stamps lastRunAt every hour (run hour or not); older than this = dead. */
export const JOB_STALE_MS = 65 * 60_000;

/** Registered AND ticked (or freshly registered) within `staleMs`. */
export function jobStateAlive(state: JobState, now: Date, staleMs = JOB_STALE_MS): boolean {
  if (!state.registered) return false;
  const ref = state.lastRunAt ?? state.registeredAt;
  return !!ref && now.getTime() - ref.getTime() <= staleMs;
}

export function getJobState(name: string): JobState {
  const e = registry.get(name);
  return e
    ? { registered: true, registeredAt: e.registeredAt, lastRunAt: e.lastRunAt, lastError: e.lastError }
    : { registered: false, registeredAt: null, lastRunAt: null, lastError: null };
}

// ── Scheduler ──

const registry = new Map<string, RegisteredJob>();
const workers: Worker[] = [];

/**
 * Register a job definition. Creates a BullMQ Queue and Worker.
 * Call this during server startup for each job type.
 */
export async function registerJob(definition: JobDefinition): Promise<void> {
  const {
    name,
    handler,
    cron,
    maxRetries = 3,
    backoffDelay = 1000,
    concurrency = 1,
  } = definition;

  if (registry.has(name)) {
    throw new Error(`Job "${name}" is already registered`);
  }

  const connection = getRedisConnection() as unknown as ConnectionOptions;
  const workerConnection = createRedisConnection() as unknown as ConnectionOptions;

  // Create queue with default job options (retry, backoff, cleanup)
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: maxRetries + 1, // BullMQ counts initial attempt
      backoff: {
        type: "exponential",
        delay: backoffDelay,
      },
      removeOnComplete: { count: 100 }, // Keep last 100 completed
      removeOnFail: { count: 500 }, // Keep last 500 failed for debugging
    },
  });

  // Create worker
  const worker = new Worker(
    name,
    async (job: Job) => {
      await handler(job);

      // Track last successful run
      const entry = registry.get(name);
      if (entry) {
        entry.lastRunAt = new Date();
        entry.lastError = null;
      }
    },
    {
      connection: workerConnection,
      concurrency,
    }
  );

  worker.on("failed", (job, err) => {
    const entry = registry.get(name);
    if (entry) {
      entry.lastError = err.message;
    }
  });

  workers.push(worker);

  registry.set(name, {
    definition,
    queue,
    worker,
    registeredAt: new Date(),
    lastRunAt: null,
    lastError: null,
  });

  // Schedule recurring job if cron is specified
  if (cron) {
    await queue.upsertJobScheduler(
      `${name}-scheduled`,
      { pattern: cron },
      {
        name,
        opts: {
          attempts: maxRetries + 1,
          backoff: {
            type: "exponential",
            delay: backoffDelay,
          },
        },
      }
    );
  }
}

/**
 * Add a one-off job to a registered queue.
 */
export async function addJob(
  name: string,
  data: Record<string, unknown> = {},
  options?: { jobId?: string; delay?: number }
): Promise<string | undefined> {
  const entry = registry.get(name);
  if (!entry) {
    throw new Error(`Job "${name}" is not registered`);
  }

  const job = await entry.queue.add(name, data, {
    jobId: options?.jobId,
    delay: options?.delay,
  });

  return job.id;
}

/**
 * Get the last run timestamps for all registered jobs.
 * Used by the health endpoint.
 */
export function getLastJobRuns(): Record<
  string,
  { lastRunAt: string | null; lastError: string | null }
> {
  const result: Record<
    string,
    { lastRunAt: string | null; lastError: string | null }
  > = {};

  for (const [name, entry] of registry) {
    result[name] = {
      lastRunAt: entry.lastRunAt?.toISOString() ?? null,
      lastError: entry.lastError,
    };
  }

  return result;
}

/**
 * Get a registered queue by name.
 */
export function getQueue(name: string): Queue | undefined {
  return registry.get(name)?.queue;
}

/**
 * Get names of all registered jobs.
 */
export function getRegisteredJobNames(): string[] {
  return Array.from(registry.keys());
}

/**
 * Graceful shutdown: close all workers and queues.
 * Workers drain in-progress jobs before closing.
 */
export async function shutdownScheduler(): Promise<void> {
  // Close workers first (drains in-progress jobs)
  await Promise.all(workers.map((w) => w.close()));

  // Close queues
  for (const [, entry] of registry) {
    await entry.queue.close();
  }

  registry.clear();
  workers.length = 0;
}
