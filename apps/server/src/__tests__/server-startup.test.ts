import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

const mockRegisterJob = vi.fn();
const mockRegisterShutdownHandlers = vi.fn();

vi.mock("../jobs/scheduler.js", () => ({
  registerJob: (...args: any[]) => mockRegisterJob(...args),
}));

vi.mock("../lib/graceful-shutdown.js", () => ({
  registerShutdownHandlers: (...args: any[]) => mockRegisterShutdownHandlers(...args),
}));

// Mock Prisma
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    systemConfig: { findFirst: vi.fn() },
    $disconnect: vi.fn(),
  },
}));

// Mock Redis
vi.mock("../lib/redis.js", () => ({
  getRedisClient: vi.fn().mockReturnValue({}),
  closeRedisConnection: vi.fn(),
}));

// Mock config store
vi.mock("../lib/config-store.js", () => ({
  prismaConfigStore: {},
}));

// Mock shared
vi.mock("@tenant-ai/shared", async () => {
  const actual = await vi.importActual<typeof import("@tenant-ai/shared")>("@tenant-ai/shared");
  return {
    ...actual,
    initConfigResolver: vi.fn(),
  };
});

// Mock rate-limit (registers as plugin)
const mockRegisterRateLimiting = vi.fn();
vi.mock("../lib/rate-limit.js", () => ({
  registerRateLimiting: (...args: any[]) => mockRegisterRateLimiting(...args),
}));

// Import the jobs to get the JobDefinition objects
import { billingCycleJob } from "../jobs/billing-cycle.js";
import { rentPostingJob } from "../jobs/rent-posting.js";
import { lateFeeJob } from "../jobs/late-fee.js";
import { depositRemindersJob } from "../jobs/deposit-reminders.js";
import { leaseExpirationJob } from "../jobs/lease-expiration.js";
import { smsCleanupJob } from "../jobs/sms-cleanup.js";

describe("Job definitions", () => {
  it("billing-cycle job has correct shape", () => {
    expect(billingCycleJob).toMatchObject({
      name: "billing-cycle",
      cron: expect.any(String),
      handler: expect.any(Function),
    });
  });

  it("rent-posting job has correct shape", () => {
    expect(rentPostingJob).toMatchObject({
      name: "rent-posting",
      cron: expect.any(String),
      handler: expect.any(Function),
    });
  });

  it("late-fee job has correct shape", () => {
    expect(lateFeeJob).toMatchObject({
      name: "late-fee",
      cron: expect.any(String),
      handler: expect.any(Function),
    });
  });

  it("deposit-reminders job has correct shape", () => {
    expect(depositRemindersJob).toMatchObject({
      name: "deposit-reminders",
      cron: "0 6 * * *",
      handler: expect.any(Function),
      maxRetries: 3,
    });
  });

  it("lease-expiration job has correct shape", () => {
    expect(leaseExpirationJob).toMatchObject({
      name: "lease-expiration",
      cron: "0 1 * * *",
      handler: expect.any(Function),
      maxRetries: 3,
    });
  });

  it("sms-cleanup job has correct shape", () => {
    expect(smsCleanupJob).toMatchObject({
      name: "sms-cleanup",
      cron: "0 * * * *",
      handler: expect.any(Function),
    });
  });
});

describe("Server index.ts wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("index.ts file imports all required modules", async () => {
    // Verify the index file can be read and has all imports
    const fs = await import("fs");
    const path = await import("path");
    const indexPath = path.resolve(
      import.meta.dirname,
      "../index.ts"
    );
    const content = fs.readFileSync(indexPath, "utf-8");

    // Verify critical imports
    expect(content).toContain('from "@fastify/helmet"');
    expect(content).toContain('from "@fastify/formbody"');
    expect(content).toContain('from "./lib/rate-limit.js"');
    expect(content).toContain('from "./routes/twilio-voice.js"');
    expect(content).toContain('from "./routes/twilio-sms.js"');
    expect(content).toContain('from "./jobs/scheduler.js"');
    expect(content).toContain('from "./jobs/billing-cycle.js"');
    expect(content).toContain('from "./jobs/rent-posting.js"');
    expect(content).toContain('from "./jobs/late-fee.js"');
    expect(content).toContain('from "./jobs/deposit-reminders.js"');
    expect(content).toContain('from "./jobs/lease-expiration.js"');
    expect(content).toContain('from "./lib/graceful-shutdown.js"');
    expect(content).toContain('from "./lib/twilio-validate.js"');
    expect(content).toContain('from "./jobs/sms-cleanup.js"');

    // Verify registrations
    expect(content).toContain("server.register(formbody)");
    expect(content).toContain("server.register(helmet");
    expect(content).toContain("registerRateLimiting(server)");
    expect(content).toContain("registerTwilioValidation(server)");
    expect(content).toContain("server.register(voiceRoutes)");
    expect(content).toContain("server.register(smsRoutes)");
    expect(content).toContain("registerJob(job)");
    expect(content).toContain("registerShutdownHandlers");
    expect(content).toContain("smsCleanupJob");

    // Verify graceful error handling per job
    expect(content).toContain("try {");
    expect(content).toContain("catch (err)");
  });

  it("does NOT register voiceFallbackRoute separately", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const indexPath = path.resolve(
      import.meta.dirname,
      "../index.ts"
    );
    const content = fs.readFileSync(indexPath, "utf-8");

    // voiceFallbackRoute is already included in voiceRoutes
    expect(content).not.toContain("voiceFallbackRoute");
    expect(content).not.toContain("twilio-voice-fallback");
  });
});
