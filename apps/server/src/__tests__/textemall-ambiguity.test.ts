import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  classifyBroadcastFailure,
  parseTeaDate,
  type ProbeResult,
} from "../services/textemall-broadcast-api.js";
import { resolveAmbiguousBatches, _resetAmbiguityStreak } from "../services/textemall-ambiguity.js";
import { buildTextEmAllCsv } from "../services/textemall-csv.js";

/**
 * M3b gate (rev.5 S4/T3/U5). The probe is ALWAYS injected — these tests must
 * never touch Safari. DB rows are isolated under a unique prefix + cleanup.
 */

const prisma = new PrismaClient();
const P = `test_amb_${Date.now()}`;
let userId: string, propertyId: string, runId: string, seq = 0;
const phone = () => `+1224777${String(seq++).padStart(4, "0")}`;
const ten = (p: string) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

async function lead(over: Record<string, unknown> = {}) {
  return prisma.zillowLead.create({
    data: { name: `${P} Person`, nameKey: `${P}${seq}`, phone: phone(), propertyText: "x", propertyId, status: "new", firstContactAt: new Date(), importRunId: runId, ...over } as any,
  });
}

let batchSeq = 0;
async function ambiguousBatch(phones: string[], over: Record<string, unknown> = {}) {
  return prisma.textEmAllBatch.create({
    data: { day: "2005-01-01", slot: `2005-01-01T09:${String(batchSeq++).padStart(2, "0")}`, groupName: P, phones, count: phones.length, status: "ambiguous", error: "broadcast failed: send 500", ...over } as any,
  });
}

function okProbe(broadcasts: Array<{ id: number; createdAtMs: number | null; phones: string[] }>): () => Promise<ProbeResult> {
  return async () => ({ status: "ok", broadcasts });
}

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
  await prisma.textEmAllBatch.deleteMany({ where: { groupName: P } });
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
  await prisma.zillowImportRun.deleteMany({ where: { id: runId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  _resetAmbiguityStreak();
  await prisma.textEmAllBatch.deleteMany({ where: { groupName: P } });
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
});

describe("classifyBroadcastFailure", () => {
  it("pre-send stages are unsent; send-stage and opaque errors are ambiguous", () => {
    expect(classifyBroadcastFailure("draft 400")).toBe("unsent");
    expect(classifyBroadcastFailure("type 500")).toBe("unsent");
    expect(classifyBroadcastFailure("no valid phones")).toBe("unsent");
    expect(classifyBroadcastFailure("no recipients added")).toBe("unsent");
    expect(classifyBroadcastFailure("no text-em-all tab open")).toBe("unsent");
    expect(classifyBroadcastFailure("send 500 upstream body")).toBe("ambiguous");
    expect(classifyBroadcastFailure("Command failed: osascript")).toBe("ambiguous");
    expect(classifyBroadcastFailure("")).toBe("ambiguous"); // unknown → conservative
  });
});

describe("parseTeaDate", () => {
  it("parses TEA's 'YYYY-MM-DD HH:mm:ss-ZZZZ'; garbage → null", () => {
    expect(parseTeaDate("2026-08-28 17:12:12-0500")).toBe(Date.parse("2026-08-28T17:12:12-0500"));
    expect(parseTeaDate("nonsense")).toBeNull();
    expect(parseTeaDate(null)).toBeNull();
  });
});

describe("resolveAmbiguousBatches", () => {
  it("PROMOTES on an exact recipient-set match: batch → sent, leads flipped, NO re-text exposure", async () => {
    const l = await lead();
    const owner = "+17084158984";
    const b = await ambiguousBatch([l.phone!, owner]);
    const res = await resolveAmbiguousBatches(new Date(), {
      scope: { groupName: P },
      probe: okProbe([{ id: 111, createdAtMs: Date.now(), phones: [ten(l.phone!), ten(owner)] }]),
    });
    expect(res).toMatchObject({ checked: 1, promoted: 1, demoted: 0, unresolved: 0 });
    expect(await prisma.textEmAllBatch.findUnique({ where: { id: b.id } })).toMatchObject({ status: "sent" });
    expect(await prisma.zillowLead.findUnique({ where: { id: l.id } })).toMatchObject({ status: "invited", sentVia: "textemall", sentBatchId: b.id });
  });

  it("EXACT set only (U5): an individual-lane-shaped broadcast to the same person does NOT promote", async () => {
    const l = await lead();
    const owner = "+17084158984";
    const b = await ambiguousBatch([l.phone!, "+12247770099", owner]); // 3 phones
    const res = await resolveAmbiguousBatches(new Date(), {
      scope: { groupName: P },
      probe: okProbe([{ id: 222, createdAtMs: Date.now(), phones: [ten(l.phone!), ten(owner)] }]), // subset only
    });
    expect(res).toMatchObject({ promoted: 0, demoted: 1 });
    expect(await prisma.textEmAllBatch.findUnique({ where: { id: b.id } })).toMatchObject({ status: "failed" });
    // Lead untouched — its phone is free for the next cycle's retry.
    expect(await prisma.zillowLead.findUnique({ where: { id: l.id } })).toMatchObject({ status: "new" });
  });

  it("time filter: a matching set from BEFORE the batch does not promote", async () => {
    const l = await lead();
    const b = await ambiguousBatch([l.phone!]);
    const res = await resolveAmbiguousBatches(new Date(), {
      scope: { groupName: P },
      probe: okProbe([{ id: 333, createdAtMs: b.createdAt.getTime() - 5 * 60_000, phones: [ten(l.phone!)] }]),
    });
    expect(res).toMatchObject({ promoted: 0, demoted: 1 });
  });

  it("probe login-wall: quarantine PERSISTS + owner notified once per streak", async () => {
    const l = await lead();
    const b = await ambiguousBatch([l.phone!]);
    const notify = vi.fn();
    const loginProbe = async (): Promise<ProbeResult> => ({ status: "needs_login" });
    const r1 = await resolveAmbiguousBatches(new Date(), { scope: { groupName: P }, probe: loginProbe, notify });
    const r2 = await resolveAmbiguousBatches(new Date(), { scope: { groupName: P }, probe: loginProbe, notify });
    expect(r1.unresolved).toBe(1);
    expect(r2.unresolved).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1); // streak-collapsed
    expect(await prisma.textEmAllBatch.findUnique({ where: { id: b.id } })).toMatchObject({ status: "ambiguous" });
    // Recovery clears the streak → a later failure notifies again.
    await resolveAmbiguousBatches(new Date(), { scope: { groupName: P }, probe: okProbe([]), notify });
    await ambiguousBatch([l.phone!]);
    await resolveAmbiguousBatches(new Date(), { scope: { groupName: P }, probe: loginProbe, notify });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("':appl' batches promote by marking APPLICANTS (applicantSentBatchId), not lead status", async () => {
    const l = await lead({ applicationCompleted: true, status: "invited" });
    const b = await ambiguousBatch([l.phone!], { slot: `2005-01-01T09:${String(batchSeq++).padStart(2, "0")}:appl` });
    const res = await resolveAmbiguousBatches(new Date(), {
      scope: { groupName: P },
      probe: okProbe([{ id: 444, createdAtMs: Date.now(), phones: [ten(l.phone!)] }]),
    });
    expect(res.promoted).toBe(1);
    const after = await prisma.zillowLead.findUnique({ where: { id: l.id } });
    expect(after).toMatchObject({ applicantSentBatchId: b.id, status: "invited" }); // status untouched
    expect(after?.applicantInvitedAt).not.toBeNull();
  });

  it("one TEA broadcast can prove at most ONE batch (no double-claiming)", async () => {
    const l = await lead();
    await ambiguousBatch([l.phone!]);
    await ambiguousBatch([l.phone!]);
    const res = await resolveAmbiguousBatches(new Date(), {
      scope: { groupName: P },
      probe: okProbe([{ id: 555, createdAtMs: Date.now(), phones: [ten(l.phone!)] }]),
    });
    expect(res.promoted).toBe(1);
    expect(res.demoted).toBe(1);
  });
});

describe("quarantine reaches the CSV dedupe", () => {
  it("a lead whose phone sits in an AMBIGUOUS batch is excluded from the next leads CSV", async () => {
    const inQuarantine = await lead();
    const fresh = await lead();
    await ambiguousBatch([inQuarantine.phone!]);
    const csv = await buildTextEmAllCsv({ propertyId, write: false });
    expect(csv.phones).toContain(fresh.phone);
    expect(csv.phones).not.toContain(inQuarantine.phone);
  });
});
