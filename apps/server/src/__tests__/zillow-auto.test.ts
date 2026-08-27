import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Daily-automation state machine tests. Import + batch are mocked (no Safari,
 * no sends); ZillowAutoRun rows are real DB, isolated on synthetic days in
 * 2001 so they can never collide with live automation rows.
 */

const cfg = {
  enabled: "true" as string | null,
  hour: "9" as string | null,
  baseline: null as string | null,
};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string) => {
      if (ns === "zillow" && key === "auto_enabled") return cfg.enabled;
      if (ns === "zillow" && key === "auto_hour") return cfg.hour;
      if (ns === "zillow" && key === "auto_baseline") return cfg.baseline;
      return original.resolveConfig(ns, key);
    },
  };
});

const mockImport = vi.fn();
vi.mock("../services/zillow-import.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/zillow-import.js")>();
  return { ...original, runZillowImport: (...a: unknown[]) => mockImport(...a) };
});

const mockBatch = vi.fn();
vi.mock("../services/zillow-send.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/zillow-send.js")>();
  return { ...original, sendSurveyBatch: (...a: unknown[]) => mockBatch(...a) };
});

import { runDailyAutomation, getAutoStatus, localDay, STALE_RUNNING_MS } from "../services/zillow-auto.js";

const prisma = new PrismaClient();

// Synthetic clock: each test gets its own fake day in Feb 2001, 10:00 local
// (inside the default 9-o'clock window).
let daySeq = 1;
function testNow(hour = 10): Date {
  return new Date(2001, 1, daySeq, hour, 30, 0);
}
const usedDays: string[] = [];
function nextDay(hour = 10): Date {
  daySeq++;
  const now = testNow(hour);
  usedDays.push(localDay(now));
  return now;
}

const IMPORT_OK = { runId: "run-x", status: "done", leadsFound: 10, leadsNew: 2 };
const BATCH_OK = { eligible: 2, sent: 1, deferred: 1, skipped: 0, failed: 0, outcomes: [] };

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.zillowAutoRun.deleteMany({ where: { day: { startsWith: "2001-" } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  cfg.enabled = "true";
  cfg.hour = "9";
  cfg.baseline = null;
  mockImport.mockReset().mockResolvedValue(IMPORT_OK);
  mockBatch.mockReset().mockResolvedValue(BATCH_OK);
});

describe("runDailyAutomation gates", () => {
  it("disabled → no row, no import", async () => {
    cfg.enabled = "false";
    const result = await runDailyAutomation({ now: nextDay() });
    expect(result.outcome).toBe("disabled");
    expect(mockImport).not.toHaveBeenCalled();
    expect(await prisma.zillowAutoRun.findUnique({ where: { day: usedDays.at(-1)! } })).toBeNull();
  });

  it("disabled + force → runs anyway", async () => {
    cfg.enabled = "false";
    const result = await runDailyAutomation({ force: true, now: nextDay() });
    expect(result.outcome).toBe("ran");
  });

  it("scheduled tick before the window → not_in_window, no row", async () => {
    const result = await runDailyAutomation({ scheduled: true, now: nextDay(8) });
    expect(result.outcome).toBe("not_in_window");
    expect(await prisma.zillowAutoRun.findUnique({ where: { day: usedDays.at(-1)! } })).toBeNull();
  });

  it("manual (non-scheduled) run ignores the hour window", async () => {
    const result = await runDailyAutomation({ now: nextDay(7) });
    expect(result.outcome).toBe("ran");
  });
});

describe("day claim state machine", () => {
  it("happy path: claims, imports, batches, records done", async () => {
    const now = nextDay();
    const result = await runDailyAutomation({ now });
    expect(result.outcome).toBe("ran");
    expect(result.run).toMatchObject({
      day: localDay(now),
      status: "done",
      attempts: 1,
      leadsFound: 10,
      leadsNew: 2,
      queuedSends: 2, // sent + deferred
      sentImmediate: 1,
    });
  });

  it("done consumes the day: second call → already_done, no re-import", async () => {
    const now = nextDay();
    await runDailyAutomation({ now });
    mockImport.mockClear();
    const again = await runDailyAutomation({ now });
    expect(again.outcome).toBe("already_done");
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("force re-runs a done day: attempts and counters accumulate", async () => {
    const now = nextDay();
    await runDailyAutomation({ now });
    const forced = await runDailyAutomation({ force: true, now });
    expect(forced.outcome).toBe("ran");
    expect(forced.run).toMatchObject({ attempts: 2, leadsNew: 4, queuedSends: 4, sentImmediate: 2 });
  });

  it("needs_login does NOT consume the day and heals on the next tick", async () => {
    const now = nextDay();
    mockImport.mockResolvedValueOnce({
      runId: "r",
      status: "failed",
      leadsFound: 0,
      leadsNew: 0,
      error: "needs-login: Safari is at login — sign in",
    });
    const first = await runDailyAutomation({ now });
    expect(first.outcome).toBe("needs_login");
    expect(first.run).toMatchObject({ status: "needs_login", attempts: 1 });
    expect(mockBatch).not.toHaveBeenCalled();

    // user re-logs in; next hourly tick succeeds
    const healed = await runDailyAutomation({ scheduled: true, now });
    expect(healed.outcome).toBe("ran");
    expect(healed.run).toMatchObject({ status: "done", attempts: 2 });
  });

  it("generic import failure → failed, retryable, error recorded", async () => {
    const now = nextDay();
    mockImport.mockResolvedValueOnce({
      runId: "r", status: "failed", leadsFound: 0, leadsNew: 0, error: "http: http-500",
    });
    const first = await runDailyAutomation({ now });
    expect(first.outcome).toBe("failed");
    expect(first.run!.error).toContain("http-500");
    const retry = await runDailyAutomation({ now });
    expect(retry.outcome).toBe("ran");
  });

  it("batch failure records failed with the import stats kept", async () => {
    const now = nextDay();
    mockBatch.mockRejectedValueOnce(new Error("db exploded"));
    const result = await runDailyAutomation({ now });
    expect(result.outcome).toBe("failed");
    expect(result.run).toMatchObject({ status: "failed", leadsFound: 10, leadsNew: 2 });
    expect(result.run!.error).toContain("db exploded");
  });

  it("a live running row is NOT claimable (claim_lost)", async () => {
    const now = nextDay();
    await prisma.zillowAutoRun.create({
      data: { day: localDay(now), status: "running", attempts: 1, startedAt: now },
    });
    const result = await runDailyAutomation({ now });
    expect(result.outcome).toBe("claim_lost");
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("a stale running row (crashed run) IS reclaimable", async () => {
    const now = nextDay();
    await prisma.zillowAutoRun.create({
      data: {
        day: localDay(now),
        status: "running",
        attempts: 1,
        startedAt: new Date(now.getTime() - STALE_RUNNING_MS - 60_000),
      },
    });
    const result = await runDailyAutomation({ now });
    expect(result.outcome).toBe("ran");
    expect(result.run!.attempts).toBe(2);
  });
});

describe("baseline plumb-through", () => {
  it("passes the configured baseline to the batch as sinceDate", async () => {
    cfg.baseline = "2001-02-01T00:00:00.000Z";
    await runDailyAutomation({ now: nextDay() });
    expect(mockBatch).toHaveBeenCalledWith({ sinceDate: new Date("2001-02-01T00:00:00.000Z") });
  });

  it("no baseline → batch called without sinceDate", async () => {
    await runDailyAutomation({ now: nextDay() });
    expect(mockBatch).toHaveBeenCalledWith({ sinceDate: undefined });
  });
});

describe("getAutoStatus", () => {
  it("reports today's row, flag, window, and queue depth shape", async () => {
    const now = nextDay();
    await runDailyAutomation({ now });
    const status = await getAutoStatus(now);
    expect(status.enabled).toBe(true);
    expect(status.autoHour).toBe(9);
    expect(status.today).toMatchObject({ day: localDay(now), status: "done" });
    expect(status.totals.leads).toBeGreaterThanOrEqual(0);
    expect(status.deferredQueue).toHaveProperty("depth");
    expect(status.deferredQueue).toHaveProperty("oldestAgeDays");
    expect(Array.isArray(status.last30Days)).toBe(true);
  });
});
