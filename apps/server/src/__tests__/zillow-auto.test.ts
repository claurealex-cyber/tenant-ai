import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Daily-automation state machine tests. Import + batch are mocked (no Safari,
 * no sends); ZillowAutoRun rows are real DB, isolated on synthetic days in
 * 2001 so they can never collide with live automation rows.
 */

const cfg = {
  enabled: "true" as string | null,
  startHour: "9" as string | null,
  endHour: "22" as string | null,
  baseline: null as string | null,
  channel: null as string | null,       // send_channel: null/relay | textemall
  broadcastHour: "9" as string | null,  // textemall_broadcast_hour
  runHours: null as string | null,      // auto_run_hours e.g. "10,16,22"
  monthlyCap: null as string | null,    // textemall.monthly_fire_cap
};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string) => {
      if (ns === "zillow" && key === "auto_enabled") return cfg.enabled;
      if (ns === "zillow" && key === "auto_hour") return null;
      if (ns === "zillow" && key === "auto_start_hour") return cfg.startHour;
      if (ns === "zillow" && key === "auto_end_hour") return cfg.endHour;
      if (ns === "zillow" && key === "auto_baseline") return cfg.baseline;
      if (ns === "zillow" && key === "send_channel") return cfg.channel;
      if (ns === "zillow" && key === "textemall_broadcast_hour") return cfg.broadcastHour;
      if (ns === "zillow" && key === "textemall_group") return "GATE grp";
      if (ns === "zillow" && key === "textemall_group_url") return "https://app.text-em-all.com/contacts/group/1271";
      if (ns === "zillow" && key === "auto_run_hours") return cfg.runHours;
      if (ns === "textemall" && key === "monthly_fire_cap") return cfg.monthlyCap;
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

const mockCsv = vi.fn();
vi.mock("../services/textemall-csv.js", () => ({
  buildTextEmAllCsv: (...a: unknown[]) => mockCsv(...a),
}));
const mockIris = vi.fn();
vi.mock("../services/textemall-api.js", () => ({ setGroupViaApi: (...a: unknown[]) => mockIris(...a), groupIdFromUrl: (u: string | null) => (u ? "1271" : null) }));
const mockTrigger = vi.fn();
vi.mock("../services/textemall-trigger.js", () => ({ fireTextEmAllTrigger: (...a: unknown[]) => mockTrigger(...a) }));

import { runDailyAutomation, getAutoStatus, localDay, localSlot, parseRunHours, STALE_RUNNING_MS } from "../services/zillow-auto.js";

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
  await prisma.textEmAllBatch.deleteMany({ where: { day: { startsWith: "2001-" } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  cfg.enabled = "true";
  cfg.startHour = "9";
  cfg.endHour = "22";
  cfg.runHours = null;
  cfg.monthlyCap = null;
  cfg.baseline = null;
  cfg.channel = null;
  cfg.broadcastHour = "9";
  mockImport.mockReset().mockResolvedValue(IMPORT_OK);
  mockBatch.mockReset().mockResolvedValue(BATCH_OK);
  mockCsv.mockReset().mockResolvedValue({ count: 2, phones: ["+12245550001", "+12245550002"], csv: "x", csvPath: "/tmp/x.csv" });
  mockIris.mockReset().mockResolvedValue({ status: "ok", count: 2, phones: ["+12245550001","+12245550002"] });
  mockTrigger.mockReset().mockResolvedValue({ fired: false, reason: "not_armed", body: "x" });
});

describe("runDailyAutomation gates", () => {
  it("disabled → no row, no import", async () => {
    cfg.enabled = "false";
    const result = await runDailyAutomation({ now: nextDay() });
    expect(result.outcome).toBe("disabled");
    expect(mockImport).not.toHaveBeenCalled();
    expect(await prisma.zillowAutoRun.findFirst({ where: { day: usedDays.at(-1)! } })).toBeNull();
  });

  it("disabled + force → runs anyway", async () => {
    cfg.enabled = "false";
    const result = await runDailyAutomation({ force: true, now: nextDay() });
    expect(result.outcome).toBe("ran");
  });

  it("scheduled tick before the window (hour 8 < start 9) → not_in_window, no row", async () => {
    const result = await runDailyAutomation({ scheduled: true, now: nextDay(8) });
    expect(result.outcome).toBe("not_in_window");
    expect(await prisma.zillowAutoRun.findFirst({ where: { day: usedDays.at(-1)! } })).toBeNull();
  });

  it("scheduled tick after the window (hour 23 > end 22) → not_in_window", async () => {
    const result = await runDailyAutomation({ scheduled: true, now: nextDay(23) });
    expect(result.outcome).toBe("not_in_window");
  });

  it("scheduled ticks at the window edges (start and end hours) run", async () => {
    const d = nextDay(9); // start hour
    expect((await runDailyAutomation({ scheduled: true, now: d })).outcome).toBe("ran");
    const end = new Date(d); end.setHours(22); // end hour, same day, different slot
    expect((await runDailyAutomation({ scheduled: true, now: end })).outcome).toBe("ran");
  });

  it("manual (non-scheduled) run ignores the hour window", async () => {
    const result = await runDailyAutomation({ now: nextDay(7) });
    expect(result.outcome).toBe("ran");
  });
});

describe("hourly slot claim state machine", () => {
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

  it("done consumes the HOUR: second call same hour → already_done, no re-import", async () => {
    const now = nextDay(10);
    await runDailyAutomation({ now });
    mockImport.mockClear();
    const again = await runDailyAutomation({ now });
    expect(again.outcome).toBe("already_done");
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("NEW: a later hour the same day runs again (hourly, not once-a-day)", async () => {
    const d = nextDay(10);
    const first = await runDailyAutomation({ now: d });
    expect(first.outcome).toBe("ran");
    const laterHour = new Date(d); laterHour.setHours(11); // same day, next slot
    mockImport.mockClear();
    const second = await runDailyAutomation({ now: laterHour });
    expect(second.outcome).toBe("ran"); // NOT already_done
    expect(mockImport).toHaveBeenCalledTimes(1);
    // two distinct slot rows exist for the day
    const rows = await prisma.zillowAutoRun.findMany({ where: { day: localDay(d) } });
    expect(rows.map((r) => r.slot).sort()).toEqual([localSlot(d), localSlot(laterHour)].sort());
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
      data: { day: localDay(now), slot: localSlot(now), status: "running", attempts: 1, startedAt: now },
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
        slot: localSlot(now),
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
    expect(status.startHour).toBe(9);
    expect(status.endHour).toBe(22);
    expect(status.today).toMatchObject({ day: localDay(now), status: "done" });
    expect(status.totals.leads).toBeGreaterThanOrEqual(0);
    expect(status.deferredQueue).toHaveProperty("depth");
    expect(status.deferredQueue).toHaveProperty("oldestAgeDays");
    expect(Array.isArray(status.last30Days)).toBe(true);
  });
});

describe("send_channel branch (Text-Em-All foundation)", () => {
  it("default channel = relay → sendSurveyBatch runs (relay path unchanged)", async () => {
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockBatch).toHaveBeenCalled();       // relay send
    expect(mockCsv).not.toHaveBeenCalled();     // no textemall
  });

  it("textemall: Iris upload ok + trigger NOT armed → batch 'uploaded', no relay send, no lead flip", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10";
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockBatch).not.toHaveBeenCalled();
    expect(mockIris).toHaveBeenCalled();
    expect(mockTrigger).toHaveBeenCalled();
    const batch = await prisma.textEmAllBatch.findFirst({ where: { day: localDay(now) } });
    expect(batch!.status).toBe("uploaded"); // uploaded, NOT sent (trigger not armed)
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("textemall: Iris ok + trigger FIRED → batch 'sent' + leads flipped to invited/textemall", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10";
    mockTrigger.mockResolvedValue({ fired: true, status: 200 });
    // real leads for the flip
    const p1 = `+1224999${String(Date.now()).slice(-4)}`;
    mockCsv.mockResolvedValue({ count: 1, phones: [p1], csv: "x", csvPath: "/tmp/x.csv" });
    const imp = await prisma.zillowImportRun.create({ data: { status: "done" } });
    const lead = await prisma.zillowLead.create({ data: { name: "TEA", nameKey: `tea${Date.now()}`, phone: p1, propertyText: "x", status: "new", firstContactAt: new Date(), importRunId: imp.id } });
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    const batch = await prisma.textEmAllBatch.findFirst({ where: { day: localDay(now) } });
    expect(batch!.status).toBe("sent");
    const flipped = await prisma.zillowLead.findUnique({ where: { id: lead.id } });
    expect(flipped!.status).toBe("invited");
    expect(flipped!.sentVia).toBe("textemall");
    expect(flipped!.sentBatchId).toBe(batch!.id);
    await prisma.zillowLead.deleteMany({ where: { id: lead.id } });
    await prisma.zillowImportRun.deleteMany({ where: { id: imp.id } });
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("textemall: Iris needs_login → batch failed, NO trigger, NO lead flip", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10";
    mockIris.mockResolvedValue({ status: "needs_login" });
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("needs_login");
    expect(mockTrigger).not.toHaveBeenCalled();
    const batch = await prisma.textEmAllBatch.findFirst({ where: { day: localDay(now) } });
    expect(batch!.status).toBe("failed");
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("channel = textemall BEFORE broadcast_hour → import only, no CSV, no batch", async () => {
    cfg.channel = "textemall";
    cfg.broadcastHour = "14";
    const now = nextDay(10); // before 14
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockCsv).not.toHaveBeenCalled();
    expect(await prisma.textEmAllBatch.findFirst({ where: { day: localDay(now) } })).toBeNull();
  });

  it("textemall is once/day: a later in-window tick does NOT rebuild the batch", async () => {
    cfg.channel = "textemall";
    cfg.broadcastHour = "10";
    const now = nextDay(10);
    await runDailyAutomation({ now });
    mockCsv.mockClear();
    const later = new Date(now); later.setHours(11);
    await runDailyAutomation({ now: later }); // hourly slot claim already done? force a fresh slot
    // the per-day TextEmAllBatch exists → no rebuild even though the hour slot differs
    expect(mockCsv).not.toHaveBeenCalled();
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("reversibility: flipping textemall → relay makes the very next run use the relay again", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10";
    await runDailyAutomation({ now: nextDay(10) });
    expect(mockBatch).not.toHaveBeenCalled();
    // flip back
    cfg.channel = "relay";
    mockBatch.mockClear();
    const res = await runDailyAutomation({ now: nextDay(10) });
    expect(res.outcome).toBe("ran");
    expect(mockBatch).toHaveBeenCalled(); // relay send restored
    await prisma.textEmAllBatch.deleteMany({ where: { day: { startsWith: "2001-" } } });
  });
});

describe("auto_run_hours (free-tier 3×/day cadence)", () => {
  it("parseRunHours: parses, dedupes, sorts, clamps; empty/garbage → null", () => {
    expect(parseRunHours("10,16,22")).toEqual([10, 16, 22]);
    expect(parseRunHours("22, 10, 16, 10")).toEqual([10, 16, 22]);
    expect(parseRunHours("25,-1,10")).toEqual([10]); // out-of-range dropped
    expect(parseRunHours("")).toBeNull();
    expect(parseRunHours(null)).toBeNull();
    expect(parseRunHours("abc")).toBeNull();
  });

  it("run-gate: with run hours set, scheduled ticks fire ONLY at those hours", async () => {
    cfg.runHours = "10,16,22";
    for (const h of [9, 11, 15, 23, 0]) {
      const res = await runDailyAutomation({ now: testNow(h), scheduled: true });
      expect(res.outcome, `hour ${h} should skip`).toBe("not_in_window");
    }
    const res = await runDailyAutomation({ now: nextDay(16), scheduled: true });
    expect(res.outcome).toBe("ran"); // 16:00 is a run hour
  });

  it("per-slot: two run-hours the SAME day each broadcast (one batch per slot)", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall";
    const base = nextDay(10);
    const at16 = new Date(base); at16.setHours(16);
    await runDailyAutomation({ now: base, scheduled: true });   // slot …T10
    await runDailyAutomation({ now: at16, scheduled: true });   // slot …T16
    const batches = await prisma.textEmAllBatch.findMany({ where: { day: localDay(base) } });
    expect(batches.length).toBe(2);                 // one broadcast per slot
    expect(new Set(batches.map((b) => b.slot)).size).toBe(2);
    expect(mockCsv).toHaveBeenCalledTimes(2);
  });

  it("per-slot idempotent: the same slot twice → one broadcast", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall";
    const base = nextDay(10);
    await runDailyAutomation({ now: base, scheduled: true });
    mockCsv.mockClear();
    await runDailyAutomation({ now: new Date(base), scheduled: true }); // same slot
    expect(mockCsv).not.toHaveBeenCalled();
  });

  it("nextRunLabel follows the run hours (next strictly-after, wrapping to tomorrow)", async () => {
    cfg.runHours = "10,16,22"; cfg.enabled = "true";
    const at = (hr: number) => new Date(2001, 1, 5, hr, 30, 0);
    expect((await getAutoStatus(at(9))).nextRunLabel).toBe("10:00");
    expect((await getAutoStatus(at(10))).nextRunLabel).toBe("16:00");
    expect((await getAutoStatus(at(16))).nextRunLabel).toBe("22:00");
    expect((await getAutoStatus(at(22))).nextRunLabel).toBe("10:00 (tomorrow)");
    expect((await getAutoStatus(at(23))).nextRunLabel).toBe("10:00 (tomorrow)");
  });

  it("monthly soft cap: at/over cap → no broadcast (no Iris, no fire)", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall"; cfg.monthlyCap = "1";
    const base = nextDay(10);
    // Seed one already-SENT broadcast in this test-day's month (Feb 2001).
    await prisma.textEmAllBatch.create({
      data: { day: localDay(base), slot: `${localDay(base)}T10seed`, groupName: "g", phones: ["+1"], count: 1, status: "sent", createdAt: base },
    });
    const at16 = new Date(base); at16.setHours(16);
    const res = await runDailyAutomation({ now: at16, scheduled: true });
    expect(res.outcome).toBe("ran");
    expect(mockIris).not.toHaveBeenCalled();     // capped BEFORE the Iris GUI work
    expect(mockTrigger).not.toHaveBeenCalled();  // and before any fire
  });
});
