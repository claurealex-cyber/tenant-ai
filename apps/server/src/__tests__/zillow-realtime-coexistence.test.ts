import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

/**
 * M4 gate (rev.5): poll ↔ cron coexistence with the REAL sent-batch dedupe.
 * Only the Safari-touching modules are mocked (import scrape, broadcast API,
 * ambiguity probe); buildTextEmAllCsv and the DB are real. Proves:
 *   poll broadcast at 15:58 → the 16:00 cron finds NOTHING new (dedupe), and
 *   in scheduled mode sends only the owner heartbeat; a lead arriving between
 *   the poll and the cron rides the cron normally.
 */

const cfg = {
  channel: "textemall" as string | null,
  method: "api" as string | null,
  runHours: "10,16,22" as string | null,
  owner: "" as string, // always_include_phone — per-test
};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string) => {
      if (ns === "zillow" && key === "auto_enabled") return "true";
      if (ns === "zillow" && key === "auto_hour") return null;
      if (ns === "zillow" && key === "auto_start_hour") return "8";
      if (ns === "zillow" && key === "auto_end_hour") return "22";
      if (ns === "zillow" && key === "auto_run_hours") return cfg.runHours;
      if (ns === "zillow" && key === "auto_baseline") return FUT_BASE.toISOString();
      if (ns === "zillow" && key === "send_channel") return cfg.channel;
      if (ns === "zillow" && key === "broadcast_method") return cfg.method;
      if (ns === "zillow" && key === "textemall_group") return "COEX grp";
      if (ns === "zillow" && key === "textemall_group_url") return null;
      if (ns === "textemall" && key === "always_include_phone") return cfg.owner;
      if (ns === "textemall" && key === "applicant_relay_enabled") return null;
      if (ns === "textemall" && key === "broadcast_message") return "APPLY NOW";
      if (ns === "textemall" && key === "monthly_fire_cap") return null;
      if (ns === "textemall" && key === "broadcast_method") return null;
      return original.resolveConfig(ns, key);
    },
  };
});

const mockImport = vi.fn();
vi.mock("../services/zillow-import.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/zillow-import.js")>();
  return { ...original, runZillowImport: (...a: unknown[]) => mockImport(...a) };
});
const mockBroadcastApi = vi.fn();
vi.mock("../services/textemall-broadcast-api.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/textemall-broadcast-api.js")>();
  return { ...original, sendBroadcastViaApi: (...a: unknown[]) => mockBroadcastApi(...a) };
});
vi.mock("../services/textemall-ambiguity.js", () => ({
  resolveAmbiguousBatches: async () => ({ checked: 0, promoted: 0, demoted: 0, unresolved: 0 }),
}));

import { runDailyAutomation, runZillowCycle, localDay, localSlot, type RunRecorder } from "../services/zillow-auto.js";

const prisma = new PrismaClient();
const P = `test_coex_${Date.now()}`;
// Time-isolation (root fix for parallel-suite interference): this file uses the
// REAL global buildTextEmAllCsv, so leads created concurrently by OTHER test
// files would leak into its broadcasts. Our leads live in the FUTURE and the
// cycle baseline sits between: only our sandbox is visible to our cycles, and
// other suites (which always pass their own propertyId) never see ours.
const FUT_BASE = new Date(Date.now() + 60 * 60_000);
const FUT_LEAD = new Date(Date.now() + 120 * 60_000);
let userId: string, propertyId: string, runId: string, seq = 0;
const phone = () => `+1224888${String(seq++).padStart(4, "0")}`;

async function lead() {
  return prisma.zillowLead.create({
    data: { name: `${P} L`, nameKey: `${P}${seq}`, phone: phone(), propertyText: "x", propertyId, status: "new", firstContactAt: new Date(), createdAt: FUT_LEAD, importRunId: runId },
  });
}

function rec(day: string, slot: string): RunRecorder {
  return {
    finish: async (status, patch) => ({
      day, slot, status, attempts: 1,
      leadsFound: patch.leadsFound ?? 0, leadsNew: patch.leadsNewDelta ?? 0,
      queuedSends: patch.queuedDelta ?? 0, sentImmediate: patch.sentDelta ?? 0,
      error: patch.error ?? null,
    }),
  };
}

// Synthetic days in April 2006.
let daySeq = 1;
function dayAt(hour: number, minute = 0): Date {
  return new Date(2006, 3, daySeq, hour, minute, 0);
}

const IMPORT_OK = { runId: "", status: "done", leadsFound: 1, leadsNew: 1 };

beforeAll(async () => {
  await prisma.$connect();
  const u = await prisma.user.create({ data: { email: `${P}@t.com`, name: "T", passwordHash: await bcrypt.hash("x", 4), role: "client", onboarded: true } });
  userId = u.id;
  const pr = await prisma.property.create({ data: { name: `${P} Prop`, address: "1 A St, Chicago IL", userId, isActive: true } });
  propertyId = pr.id;
  const run = await prisma.zillowImportRun.create({ data: { status: "done" } });
  runId = run.id;
});
afterAll(async () => {
  await prisma.zillowAutoRun.deleteMany({ where: { day: { startsWith: "2006-" } } });
  await prisma.textEmAllBatch.deleteMany({ where: { day: { startsWith: "2006-" } } });
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
  await prisma.zillowImportRun.deleteMany({ where: { id: runId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  daySeq++;
  cfg.channel = "textemall";
  cfg.method = "api";
  cfg.runHours = "10,16,22";
  cfg.owner = "";
  mockImport.mockReset().mockResolvedValue(IMPORT_OK);
  mockBroadcastApi.mockReset().mockImplementation(async (o: { phones: string[] }) => ({
    status: "ok", broadcastId: 1, recipients: o.phones.length, sentPhones: o.phones,
  }));
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
});

describe("M4 — poll and cron share one dedupe; neither double-texts", () => {
  it("poll 15:58 broadcasts lead A → cron 16:00 has nothing new (no second text to A)", async () => {
    const a = await lead();
    const pollNow = dayAt(15, 58);
    const pollSlotKey = `${localSlot(pollNow)}:58`;
    const poll = await runZillowCycle(rec(localDay(pollNow), pollSlotKey), {
      trigger: "poll", now: pollNow, day: localDay(pollNow), slot: pollSlotKey, force: false, runHours: [10, 16, 22], baseline: FUT_BASE,
    });
    expect(poll.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(1);
    expect(mockBroadcastApi.mock.calls[0][0].phones).toEqual([a.phone]);
    expect(await prisma.zillowLead.findUnique({ where: { id: a.id } })).toMatchObject({ status: "invited" });

    // 16:00 cron tick: REAL CSV dedupe finds nothing (A invited + in sent batch),
    // owner unset → leadCount 0 AND count 0 → no broadcast at all.
    const cron = await runDailyAutomation({ now: dayAt(16, 0), scheduled: true });
    expect(cron.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(1); // still just the poll's
  });

  it("with the owner heartbeat configured, the 16:00 cron sends ONLY the owner after a poll drained the leads", async () => {
    cfg.owner = "+17084158984";
    const a = await lead();
    const pollNow = dayAt(15, 58);
    const pollSlotKey = `${localSlot(pollNow)}:58`;
    await runZillowCycle(rec(localDay(pollNow), pollSlotKey), {
      trigger: "poll", now: pollNow, day: localDay(pollNow), slot: pollSlotKey, force: false, runHours: [10, 16, 22], baseline: FUT_BASE,
    });
    expect(mockBroadcastApi.mock.calls[0][0].phones).toEqual(expect.arrayContaining([a.phone, "+17084158984"]));

    const cron = await runDailyAutomation({ now: dayAt(16, 0), scheduled: true });
    expect(cron.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(2);
    expect(mockBroadcastApi.mock.calls[1][0].phones).toEqual(["+17084158984"]); // heartbeat only — A NOT re-texted
  });

  it("a lead arriving AFTER the poll rides the next cron normally", async () => {
    const a = await lead();
    const pollNow = dayAt(15, 58);
    const pollSlotKey = `${localSlot(pollNow)}:58`;
    await runZillowCycle(rec(localDay(pollNow), pollSlotKey), {
      trigger: "poll", now: pollNow, day: localDay(pollNow), slot: pollSlotKey, force: false, runHours: [10, 16, 22], baseline: FUT_BASE,
    });
    const b = await lead(); // appears between poll and cron
    const cron = await runDailyAutomation({ now: dayAt(16, 0), scheduled: true });
    expect(cron.outcome).toBe("ran");
    expect(mockBroadcastApi).toHaveBeenCalledTimes(2);
    expect(mockBroadcastApi.mock.calls[1][0].phones).toEqual([b.phone]);
    expect(await prisma.zillowLead.findUnique({ where: { id: b.id } })).toMatchObject({ status: "invited" });
    expect((await prisma.zillowLead.findUnique({ where: { id: a.id } }))?.sentBatchId).not.toBe(
      (await prisma.zillowLead.findUnique({ where: { id: b.id } }))?.sentBatchId,
    );
  });

  it("a POLL between run-hours never claims the cron's hour slot (cron still runs at 16:00)", async () => {
    await lead();
    const pollNow = dayAt(15, 58);
    const pollSlotKey = `${localSlot(pollNow)}:58`;
    await runZillowCycle(rec(localDay(pollNow), pollSlotKey), {
      trigger: "poll", now: pollNow, day: localDay(pollNow), slot: pollSlotKey, force: false, runHours: [10, 16, 22], baseline: FUT_BASE,
    });
    // The poll used a minute-slot batch key; the hour slot "…T16" is untouched.
    const cron = await runDailyAutomation({ now: dayAt(16, 0), scheduled: true });
    expect(cron.outcome).toBe("ran"); // not already_done
  });
});
