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
  broadcastMethod: null as string | null, // zillow.broadcast_method (lane): null/form | api
  legacyBroadcastMethod: null as string | null, // textemall.broadcast_method (legacy global fallback)
  broadcastMessage: "APPLY: https://x" as string | null, // textemall.broadcast_message
  applicantRelayEnabled: null as string | null, // textemall.applicant_relay_enabled
  applicantMessage: "THANKS FOR APPLYING" as string | null, // textemall.applicant_broadcast_message
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
      if (ns === "zillow" && key === "broadcast_method") return cfg.broadcastMethod;
      if (ns === "textemall" && key === "broadcast_method") return cfg.legacyBroadcastMethod;
      if (ns === "textemall" && key === "broadcast_message") return cfg.broadcastMessage;
      if (ns === "textemall" && key === "applicant_relay_enabled") return cfg.applicantRelayEnabled;
      if (ns === "textemall" && key === "applicant_broadcast_message") return cfg.applicantMessage;
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
const mockBroadcastApi = vi.fn();
vi.mock("../services/textemall-broadcast-api.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/textemall-broadcast-api.js")>();
  return { ...original, sendBroadcastViaApi: (...a: unknown[]) => mockBroadcastApi(...a) };
});
const mockResolveAmbiguity = vi.fn();
vi.mock("../services/textemall-ambiguity.js", () => ({
  resolveAmbiguousBatches: (...a: unknown[]) => mockResolveAmbiguity(...a),
}));

import { runDailyAutomation, runZillowCycle, getAutoStatus, localDay, localSlot, parseRunHours, STALE_RUNNING_MS, type RunRecorder } from "../services/zillow-auto.js";

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
  cfg.broadcastMethod = null;
  cfg.legacyBroadcastMethod = null;
  cfg.broadcastMessage = "APPLY: https://x";
  cfg.applicantRelayEnabled = null;
  cfg.applicantMessage = "THANKS FOR APPLYING";
  mockImport.mockReset().mockResolvedValue(IMPORT_OK);
  mockBatch.mockReset().mockResolvedValue(BATCH_OK);
  mockCsv.mockReset().mockResolvedValue({ count: 2, leadCount: 2, phones: ["+12245550001", "+12245550002"], csv: "x", csvPath: "/tmp/x.csv" });
  mockIris.mockReset().mockResolvedValue({ status: "ok", count: 2, phones: ["+12245550001","+12245550002"] });
  mockTrigger.mockReset().mockResolvedValue({ fired: false, reason: "not_armed", body: "x" });
  mockBroadcastApi.mockReset().mockResolvedValue({ status: "ok", broadcastId: 1, recipients: 2, sentPhones: [] });
  mockResolveAmbiguity.mockReset().mockResolvedValue({ checked: 0, promoted: 0, demoted: 0, unresolved: 0 });
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

  it("schedule block: hourly window mode (relay) — label, runs/day, next run, no cap warning", async () => {
    const status = await getAutoStatus(testNow(12));
    expect(status.schedule).toMatchObject({
      mode: "hourly", startHour: 9, endHour: 22, runsPerDay: 14, label: "hourly from 09:00 to 22:00",
      nextRunLabel: "13:00", channel: "relay", capWarning: false, timezone: "America/Chicago",
    });
    expect(status.nextRunLabel).toBe(status.schedule.nextRunLabel);
    expect(status.autoHour).toBe(9);
  });

  it("schedule block: fixed hours on Text-Em-All — 3×/day inside the cap, 4×/day warns; autoHour = first run hour", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall";
    let status = await getAutoStatus(testNow(11));
    expect(status.schedule).toMatchObject({ mode: "fixed", hours: [10, 16, 22], runsPerDay: 3, monthlyEstimate: 93, monthlyCap: 96, capWarning: false, label: "3×/day at 10:00, 16:00, 22:00", nextRunLabel: "16:00" });
    expect(status.autoHour).toBe(10);
    cfg.runHours = "9,12,16,20";
    status = await getAutoStatus(testNow(11));
    expect(status.schedule).toMatchObject({ runsPerDay: 4, monthlyEstimate: 124, capWarning: true });
    cfg.monthlyCap = "130";
    status = await getAutoStatus(testNow(11));
    expect(status.schedule).toMatchObject({ monthlyCap: 130, capWarning: false });
  });

  it("schedulerOnline is false in the test process (no zillow-daily job registered)", async () => {
    const status = await getAutoStatus(testNow(11));
    expect(status.schedulerOnline).toBe(false);
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

  it("broadcast_method=api: PARTIAL add → flips ONLY sentPhones leads, unsent lead stays 'new', batch.phones=sentPhones", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api";
    const stamp = String(Date.now()).slice(-5);
    const p1 = `+1224970${stamp}`; // this one is reported sent
    const p2 = `+1224971${stamp}`; // this one's add FAILED — must NOT flip
    mockCsv.mockResolvedValue({ count: 2, phones: [p1, p2], csv: "x", csvPath: "/tmp/x.csv" });
    // API reports only p1 actually made it into the broadcast
    mockBroadcastApi.mockResolvedValue({ status: "ok", broadcastId: 42, recipients: 1, sentPhones: [p1] });
    const imp = await prisma.zillowImportRun.create({ data: { status: "done" } });
    const l1 = await prisma.zillowLead.create({ data: { name: "L1", nameKey: `l1${stamp}`, phone: p1, propertyText: "x", status: "new", firstContactAt: new Date(), importRunId: imp.id } });
    const l2 = await prisma.zillowLead.create({ data: { name: "L2", nameKey: `l2${stamp}`, phone: p2, propertyText: "x", status: "new", firstContactAt: new Date(), importRunId: imp.id } });
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalled();
    expect(mockIris).not.toHaveBeenCalled();   // API path, NOT the group-edit form path
    expect(mockTrigger).not.toHaveBeenCalled();
    const batch = await prisma.textEmAllBatch.findFirst({ where: { day: localDay(now) } });
    expect(batch!.status).toBe("sent");
    expect(batch!.phones).toEqual([p1]);       // stored phones = actually-sent, not intended
    const f1 = await prisma.zillowLead.findUnique({ where: { id: l1.id } });
    const f2 = await prisma.zillowLead.findUnique({ where: { id: l2.id } });
    expect(f1!.status).toBe("invited");        // sent → flipped
    expect(f1!.sentVia).toBe("textemall");
    expect(f2!.status).toBe("new");            // add failed → NOT flipped, retried next run
    expect(f2!.sentVia).toBeNull();
    await prisma.zillowLead.deleteMany({ where: { id: { in: [l1.id, l2.id] } } });
    await prisma.zillowImportRun.deleteMany({ where: { id: imp.id } });
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("M0 legacy fallback: no zillow.broadcast_method but legacy textemall.broadcast_method=api → API path", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10";
    cfg.broadcastMethod = null;          // lane key ABSENT
    cfg.legacyBroadcastMethod = "api";   // legacy global set → both lanes inherit
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalled(); // fell back to legacy → API path
    expect(mockIris).not.toHaveBeenCalled();
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("M0 lane override wins over legacy: lane=form beats legacy=api → form path", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10";
    cfg.broadcastMethod = "form";        // explicit lane value
    cfg.legacyBroadcastMethod = "api";   // legacy would say api, but lane wins
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).not.toHaveBeenCalled(); // lane=form → NOT the API path
    expect(mockIris).toHaveBeenCalled();             // group-edit form path instead
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("applicant segment OFF by default → only the leads broadcast fires", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api";
    const now = nextDay(10);
    await runDailyAutomation({ now });
    expect(mockBroadcastApi).toHaveBeenCalledTimes(1); // leads only
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("relay OFF → leads CSV built WITHOUT excludeApplicants (applicants still get the lead msg)", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = null;
    const now = nextDay(10);
    await runDailyAutomation({ now });
    const leadCall = mockCsv.mock.calls.find((c: any[]) => (c[0]?.segment ?? "leads") === "leads");
    expect(leadCall![0].excludeApplicants).toBeFalsy();
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("relay ON → leads CSV built WITH excludeApplicants (applicants routed to the follow-up)", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = "true";
    mockCsv.mockImplementation(async (o: any) => o?.segment === "applicants"
      ? { count: 1, leadCount: 0, phones: ["+17084158984"], csv: "x", csvPath: null }
      : { count: 2, leadCount: 2, phones: ["+12245550001","+12245550002"], csv: "x", csvPath: "/tmp/l.csv" });
    const now = nextDay(10);
    await runDailyAutomation({ now });
    const leadCall = mockCsv.mock.calls.find((c: any[]) => (c[0]?.segment ?? "leads") === "leads");
    expect(leadCall![0].excludeApplicants).toBe(true);
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("applicant segment ON + new applicants → SECOND broadcast with the applicant message; marks applicantSentBatchId", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api";
    cfg.applicantRelayEnabled = "true"; cfg.applicantMessage = "THANKS FOR APPLYING";
    const ap = `+1224968${String(Date.now()).slice(-4)}`;
    // leads segment empty; applicants segment returns our applicant
    mockCsv.mockImplementation(async (o: any) => o?.segment === "applicants"
      ? { count: 2, leadCount: 1, phones: [ap, "+17084158984"], csv: "x", csvPath: "/tmp/a.csv" }
      : { count: 1, leadCount: 0, phones: ["+17084158984"], csv: "x", csvPath: "/tmp/l.csv" });
    mockBroadcastApi.mockImplementation(async (o: any) => ({ status: "ok", broadcastId: 7, recipients: o.phones.length, sentPhones: o.phones }));
    const imp = await prisma.zillowImportRun.create({ data: { status: "done" } });
    const a = await prisma.zillowLead.create({ data: { name: "APP", nameKey: `app${Date.now()}`, phone: ap, propertyText: "x", status: "invited", applicationCompleted: true, firstContactAt: new Date(), importRunId: imp.id } });
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(2); // leads + applicants
    const applCall = mockBroadcastApi.mock.calls.find((c: any[]) => c[0].message === "THANKS FOR APPLYING");
    expect(applCall).toBeTruthy();
    const marked = await prisma.zillowLead.findUnique({ where: { id: a.id } });
    expect(marked!.applicantSentBatchId).toBeTruthy();
    expect(marked!.applicantInvitedAt).toBeTruthy();
    await prisma.zillowLead.deleteMany({ where: { id: a.id } });
    await prisma.zillowImportRun.deleteMany({ where: { id: imp.id } });
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("applicant segment ON but only owner (leadCount 0) → NO applicant broadcast (no owner spam)", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = "true";
    mockCsv.mockImplementation(async (o: any) => o?.segment === "applicants"
      ? { count: 1, leadCount: 0, phones: ["+17084158984"], csv: "x", csvPath: "/tmp/a.csv" } // owner only
      : { count: 2, leadCount: 2, phones: ["+12245550001","+12245550002"], csv: "x", csvPath: "/tmp/l.csv" });
    const now = nextDay(10);
    await runDailyAutomation({ now });
    expect(mockBroadcastApi).toHaveBeenCalledTimes(1); // leads only; applicant owner-only skipped
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(now) } });
  });

  it("broadcast_method=api: needs_login → batch failed, NO flip, NO group-edit", async () => {
    cfg.channel = "textemall"; cfg.broadcastHour = "10"; cfg.broadcastMethod = "api";
    mockBroadcastApi.mockResolvedValue({ status: "needs_login" });
    const now = nextDay(10);
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("needs_login");
    expect(mockIris).not.toHaveBeenCalled();
    const batch = await prisma.textEmAllBatch.findFirst({ where: { day: localDay(now) } });
    expect(batch!.status).toBe("failed");
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

  it("a FAILED batch does not block its slot: the next same-slot run rebuilds and retries the broadcast", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall";
    const base = nextDay(10);
    mockIris.mockResolvedValueOnce({ status: "failed", detail: "group-set 500" });
    const first = await runDailyAutomation({ now: base, scheduled: true });
    expect(first.outcome).toBe("failed");
    const failedBatch = await prisma.textEmAllBatch.findUnique({ where: { slot: localSlot(base) } });
    expect(failedBatch?.status).toBe("failed");
    mockCsv.mockClear(); mockIris.mockClear();
    // failed run rows are reclaimable in the same slot; the batch must be rebuilt, not skipped
    const second = await runDailyAutomation({ now: new Date(base), scheduled: true });
    expect(second.outcome).toBe("ran");
    expect(mockCsv).toHaveBeenCalledTimes(1);
    expect(mockIris).toHaveBeenCalledTimes(1);
    const rebuilt = await prisma.textEmAllBatch.findUnique({ where: { slot: localSlot(base) } });
    expect(rebuilt?.status).toBe("uploaded"); // trigger not armed in this fixture
  });

  it("a SENT batch still blocks its slot (no re-broadcast)", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall";
    mockTrigger.mockResolvedValue({ fired: true, status: 200 });
    const base = nextDay(16);
    await runDailyAutomation({ now: base, scheduled: true });
    expect((await prisma.textEmAllBatch.findUnique({ where: { slot: localSlot(base) } }))?.status).toBe("sent");
    // force a same-slot re-entry without `force` (a reclaim needs a failed row → simulate by resetting the run row)
    await prisma.zillowAutoRun.updateMany({ where: { slot: localSlot(base) }, data: { status: "failed" } });
    mockCsv.mockClear();
    const again = await runDailyAutomation({ now: new Date(base), scheduled: true });
    expect(again.outcome).toBe("ran");
    expect(mockCsv).not.toHaveBeenCalled();
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

  it("broadcast_method=api is EXEMPT from the monthly cap (no Zapier → no 100/mo budget to protect)", async () => {
    cfg.runHours = "10,16,22"; cfg.channel = "textemall"; cfg.monthlyCap = "1"; cfg.broadcastMethod = "api";
    const base = nextDay(10);
    // Same seed that blocks the form path at cap 1/1 — must NOT block the API path.
    await prisma.textEmAllBatch.create({
      data: { day: localDay(base), slot: `${localDay(base)}T10seedapi`, groupName: "g", phones: ["+1"], count: 1, status: "sent", createdAt: base },
    });
    const at16 = new Date(base); at16.setHours(16);
    const res = await runDailyAutomation({ now: at16, scheduled: true });
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalled(); // API broadcast still fired despite being over cap
    expect(mockIris).not.toHaveBeenCalled();
    await prisma.textEmAllBatch.deleteMany({ where: { day: localDay(base) } });
  });
});

/** Lazy-style fake recorder: collects finishes, returns the row-shaped summary. */
function fakeRec(day: string, slot: string) {
  const finishes: Array<{ status: string; patch: Record<string, unknown> }> = [];
  const rec: RunRecorder = {
    finish: async (status, patch) => {
      finishes.push({ status, patch });
      return {
        day, slot, status, attempts: 1,
        leadsFound: (patch.leadsFound as number) ?? 0,
        leadsNew: (patch.leadsNewDelta as number) ?? 0,
        queuedSends: (patch.queuedDelta as number) ?? 0,
        sentImmediate: (patch.sentDelta as number) ?? 0,
        error: (patch.error as string) ?? null,
      };
    },
  };
  return { rec, finishes };
}

function pollCtx(now: Date) {
  const minuteSlot = `${localSlot(now)}:${String(now.getMinutes()).padStart(2, "0")}`;
  return {
    ctx: { trigger: "poll" as const, now, day: localDay(now), slot: minuteSlot, force: false, runHours: null, baseline: null },
    minuteSlot,
  };
}

describe("M2 — independent segments + poll gates (rev.5 T1/T2/S5)", () => {
  it("POLL + owner-only leads (leadCount 0) → NO broadcast at all (no owner spam at poll cadence)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api";
    const now = nextDay();
    mockCsv.mockResolvedValue({ count: 1, leadCount: 0, phones: ["+17084158984"], csv: "x", csvPath: null });
    const { ctx } = pollCtx(now);
    const { rec } = fakeRec(ctx.day, ctx.slot);
    const res = await runZillowCycle(rec, ctx);
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).not.toHaveBeenCalled();
  });

  it("SCHEDULED + owner-only (count 1, leadCount 0) → heartbeat broadcast STILL fires (today's behavior preserved)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockCsv.mockResolvedValue({ count: 1, leadCount: 0, phones: ["+17084158984"], csv: "x", csvPath: null });
    const res = await runDailyAutomation({ now, scheduled: true });
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(1);
  });

  it("POLL + 0 new leads + 1 new applicant → applicant follow-up ONLY (T1: segments decoupled)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = "true";
    const now = nextDay();
    mockCsv.mockImplementation(async (opts: { segment?: string }) =>
      opts?.segment === "applicants"
        ? { count: 2, leadCount: 1, phones: ["+12245550009", "+17084158984"], csv: "x", csvPath: null }
        : { count: 1, leadCount: 0, phones: ["+17084158984"], csv: "x", csvPath: null },
    );
    mockBroadcastApi.mockResolvedValue({ status: "ok", broadcastId: 9, recipients: 2, sentPhones: ["+12245550009", "+17084158984"] });
    const { ctx, minuteSlot } = pollCtx(now);
    const { rec } = fakeRec(ctx.day, ctx.slot);
    const res = await runZillowCycle(rec, ctx);
    expect(res.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(1);
    expect(mockBroadcastApi.mock.calls[0][0].message).toBe("THANKS FOR APPLYING");
    // Applicant batch keyed off the poll's minute slot; no leads batch exists.
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: `${minuteSlot}:appl` } })).toMatchObject({ status: "sent" });
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: minuteSlot } })).toBeNull();
  });

  it("LEADS failure does NOT starve the applicant segment (and outcome reports needs_login)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = "true"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockCsv.mockImplementation(async (opts: { segment?: string }) =>
      opts?.segment === "applicants"
        ? { count: 1, leadCount: 1, phones: ["+12245550008"], csv: "x", csvPath: null }
        : { count: 2, leadCount: 2, phones: ["+12245550001", "+12245550002"], csv: "x", csvPath: null },
    );
    mockBroadcastApi
      .mockResolvedValueOnce({ status: "needs_login" })
      .mockResolvedValueOnce({ status: "ok", broadcastId: 3, recipients: 1, sentPhones: ["+12245550008"] });
    const res = await runDailyAutomation({ now, scheduled: true });
    expect(res.outcome).toBe("needs_login");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(2); // applicants attempted despite leads failing
    const slot = localSlot(now);
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot } })).toMatchObject({ status: "failed" });
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: `${slot}:appl` } })).toMatchObject({ status: "sent" });
  });

  it("APPLICANT failure does not undo the leads segment (outcome failed, leads batch sent)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = "true"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockCsv.mockImplementation(async (opts: { segment?: string }) =>
      opts?.segment === "applicants"
        ? { count: 1, leadCount: 1, phones: ["+12245550008"], csv: "x", csvPath: null }
        : { count: 2, leadCount: 2, phones: ["+12245550001", "+12245550002"], csv: "x", csvPath: null },
    );
    mockBroadcastApi
      .mockResolvedValueOnce({ status: "ok", broadcastId: 4, recipients: 2, sentPhones: ["+12245550001", "+12245550002"] })
      .mockResolvedValueOnce({ status: "failed", detail: "send 500" });
    const res = await runDailyAutomation({ now, scheduled: true });
    expect(res.outcome).toBe("failed");
    // "send 500" is a SEND-stage failure → M3b quarantines it as ambiguous.
    expect(res.run?.error).toContain("applicant broadcast ambiguous (quarantined)");
    const slot = localSlot(now);
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot } })).toMatchObject({ status: "sent" });
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: `${slot}:appl` } })).toMatchObject({ status: "ambiguous" });
  });

  it("api mode builds CSVs with write:false — no files for either segment (T2)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.applicantRelayEnabled = "true"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockCsv.mockImplementation(async (opts: { segment?: string }) =>
      opts?.segment === "applicants"
        ? { count: 1, leadCount: 1, phones: ["+12245550008"], csv: "x", csvPath: null }
        : { count: 2, leadCount: 2, phones: ["+12245550001", "+12245550002"], csv: "x", csvPath: null },
    );
    await runDailyAutomation({ now, scheduled: true });
    for (const call of mockCsv.mock.calls) expect(call[0]).toMatchObject({ write: false });
  });

  it("POLL uses its minute slot as the batch key even in legacy window mode (runHours null)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api";
    const now = nextDay();
    mockCsv.mockResolvedValue({ count: 2, leadCount: 1, phones: ["+12245550007", "+17084158984"], csv: "x", csvPath: null });
    mockBroadcastApi.mockResolvedValue({ status: "ok", broadcastId: 5, recipients: 2, sentPhones: ["+12245550007", "+17084158984"] });
    const { ctx, minuteSlot } = pollCtx(now);
    const { rec } = fakeRec(ctx.day, ctx.slot);
    const res = await runZillowCycle(rec, ctx);
    expect(res.outcome).toBe("ran");
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: minuteSlot } })).toMatchObject({ status: "sent" });
  });
});

describe("M3b — ambiguous-send classification + resolution wiring (rev.5 S4)", () => {
  it("a SEND-stage failure quarantines the batch as 'ambiguous' (never blind-retried)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockBroadcastApi.mockResolvedValue({ status: "failed", detail: "send 500 upstream" });
    const res = await runDailyAutomation({ now, scheduled: true });
    expect(res.outcome).toBe("failed");
    expect(res.run?.error).toContain("ambiguous (quarantined)");
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: localSlot(now) } })).toMatchObject({ status: "ambiguous" });
  });

  it("an osascript timeout (opaque error) also quarantines", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockBroadcastApi.mockResolvedValue({ status: "failed", detail: "Command failed: osascript timed out" });
    await runDailyAutomation({ now, scheduled: true });
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: localSlot(now) } })).toMatchObject({ status: "ambiguous" });
  });

  it("a DRAFT-stage failure stays 'failed' — definitely unsent, retries freely", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.runHours = "10,16,22";
    const now = nextDay(10);
    mockBroadcastApi.mockResolvedValue({ status: "failed", detail: "draft 400" });
    await runDailyAutomation({ now, scheduled: true });
    expect(await prisma.textEmAllBatch.findUnique({ where: { slot: localSlot(now) } })).toMatchObject({ status: "failed" });
  });

  it("resolution runs at cycle start on the textemall channel (both api and form modes)", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.runHours = "10,16,22";
    await runDailyAutomation({ now: nextDay(10), scheduled: true });
    expect(mockResolveAmbiguity).toHaveBeenCalledTimes(1);
    cfg.broadcastMethod = null; // form mode
    await runDailyAutomation({ now: nextDay(10), scheduled: true });
    expect(mockResolveAmbiguity).toHaveBeenCalledTimes(2);
  });

  it("a resolution failure holds the quarantine but never blocks the cycle", async () => {
    cfg.channel = "textemall"; cfg.broadcastMethod = "api"; cfg.runHours = "10,16,22";
    mockResolveAmbiguity.mockRejectedValue(new Error("probe blew up"));
    const res = await runDailyAutomation({ now: nextDay(10), scheduled: true });
    expect(res.outcome).toBe("ran"); // cycle completed despite resolution failing
    expect(mockBroadcastApi).toHaveBeenCalled();
  });
});

describe("M1 — whole-cycle mutex + import-busy (rev.5 S3/U2)", () => {
  it("concurrent same-slot runs SERIALIZE: the loser waits and sees already_done (not claim_lost)", async () => {
    const now = nextDay();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // First run's import blocks until we release it — holding the cycle mutex.
    mockImport.mockImplementationOnce(async () => {
      await gate;
      return IMPORT_OK;
    });
    const first = runDailyAutomation({ now });
    await new Promise((r) => setTimeout(r, 20));
    const secondP = runDailyAutomation({ now }); // must WAIT, not race the claim
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [firstRes, secondRes] = await Promise.all([first, secondP]);
    expect(firstRes.outcome).toBe("ran");
    expect(secondRes.outcome).toBe("already_done"); // pre-M1 this raced to claim_lost
    expect(mockImport).toHaveBeenCalledTimes(1);
  });

  it("a concurrent manual import (runZillowImport throws 'already running') → recorded failed outcome, NO throw", async () => {
    const now = nextDay();
    mockImport.mockRejectedValueOnce(new Error("an import is already running"));
    const res = await runDailyAutomation({ now });
    expect(res.outcome).toBe("failed"); // retryable — next tick reclaims
    expect(res.run?.error).toContain("import busy");
    expect(res.run?.error).toContain("already running");
    // The slot heals: a retry the same hour succeeds.
    const retry = await runDailyAutomation({ now });
    expect(retry.outcome).toBe("ran");
  });
});
