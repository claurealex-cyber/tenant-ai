import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { buildTextEmAllCsv } from "../services/textemall-csv.js";

const prisma = new PrismaClient();
const P = `test_tea_${Date.now()}`;
let userId: string, propertyId: string, runId: string, seq = 0;
const phone = () => `+1224555${String(seq++).padStart(4, "0")}`;

async function lead(over: Record<string, unknown> = {}) {
  return prisma.zillowLead.create({
    data: { name: `${P} Person`, nameKey: `${P}${seq}`, phone: phone(), propertyText: "x", propertyId, status: "new", firstContactAt: new Date(), importRunId: runId, ...over } as any,
  });
}
async function onlyOurs() {
  const r = await buildTextEmAllCsv({ propertyId, write: false });
  return r;
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
  await prisma.smsOptOut.deleteMany({ where: { propertyId } });
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
  await prisma.zillowImportRun.deleteMany({ where: { id: runId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.zillowLead.deleteMany({ where: { importRunId: runId } });
  await prisma.textEmAllBatch.deleteMany({ where: { groupName: P } });
  await prisma.smsOptOut.deleteMany({ where: { propertyId } });
});

describe("buildTextEmAllCsv", () => {
  it("includes eligible new leads with a single Name column", async () => {
    const a = await lead();
    const r = await onlyOurs();
    expect(r.count).toBe(1);
    expect(r.phones).toEqual([a.phone]);
    expect(r.csv.split("\n")[0]).toBe("Name,Phone");
    expect(r.csv).toContain(`${P} Person,${a.phone}`);
  });

  it("honors the createdAt baseline (existing leads excluded)", async () => {
    await lead({ createdAt: new Date(Date.now() - 5 * 86_400_000) }); // pre-go-live
    const fresh = await lead(); // post-go-live
    const r = await buildTextEmAllCsv({ propertyId, write: false, baseline: new Date(Date.now() - 2 * 86_400_000) });
    expect(r.phones).toEqual([fresh.phone]);
  });

  it("excludes opted-out numbers", async () => {
    const a = await lead();
    await prisma.smsOptOut.create({ data: { phone: a.phone, propertyId } as any });
    const r = await onlyOurs();
    expect(r.count).toBe(0);
  });

  it("excludes phones already in a SENT Text-Em-All batch (no re-broadcast)", async () => {
    const a = await lead();
    await prisma.textEmAllBatch.create({ data: { day: `${P}-sent`, groupName: P, phones: [a.phone], count: 1, status: "sent" } as any });
    const r = await onlyOurs();
    expect(r.count).toBe(0);
    // a NEW lead is still eligible
    const b = await lead();
    const r2 = await onlyOurs();
    expect(r2.phones).toEqual([b.phone]);
  });

  it("empty batch → count 0, no file written", async () => {
    const r = await buildTextEmAllCsv({ propertyId, write: true });
    expect(r.count).toBe(0);
    expect(r.csvPath).toBeNull();
  });

  it("dedupes a phone that appears twice in the lead set", async () => {
    const dup = phone();
    await lead({ phone: dup, nameKey: `${P}d1` });
    await prisma.zillowLead.create({ data: { name: `${P} dup2`, nameKey: `${P}d2`, phone: dup, propertyText: "x", propertyId, status: "new", firstContactAt: new Date(), importRunId: runId } as any }).catch(() => {});
    const r = await onlyOurs();
    expect(r.phones.filter((p) => p === dup).length).toBeLessThanOrEqual(1);
  });
});
