import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtemp, writeFile, utimes, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** M6 gate (rev.5 S7/U4): retention prune + persistRaw pass-through. */

const mockExtract = vi.fn();
vi.mock("../services/zillow-extract.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/zillow-extract.js")>();
  return { ...original, runZillowExtraction: (...a: unknown[]) => mockExtract(...a) };
});

import { runZillowImport, pruneZillowArtifacts, _resetPruneDay } from "../services/zillow-import.js";

const prisma = new PrismaClient();
const DAY = 86_400_000;
let outDir: string;

beforeAll(async () => {
  await prisma.$connect();
  outDir = await mkdtemp(path.join(tmpdir(), "zillow-ret-"));
  process.env.ZILLOW_OUT_DIR = outDir;
});
afterAll(async () => {
  delete process.env.ZILLOW_OUT_DIR;
  await prisma.textEmAllBatch.deleteMany({ where: { groupName: { startsWith: "test_ret_" } } });
  await prisma.$disconnect();
});

describe("pruneZillowArtifacts", () => {
  it("prunes lead-less old runs, old raw files, and old SENT batches — never ambiguous, never runs with leads", async () => {
    _resetPruneDay();
    // A 1990 clock (root fix for parallel-suite interference): the prune is
    // GLOBAL by design, and sibling suites seed deliberately-ancient rows
    // (2001–2006 sandboxes). Pruning as of 1990 can only ever touch THIS
    // file's 1989 fixtures.
    const now = new Date(1990, 0, 15);
    const G = `test_ret_${Date.now()}`;

    const oldEmptyRun = await prisma.zillowImportRun.create({
      data: { status: "done", startedAt: new Date(now.getTime() - 30 * DAY) },
    });
    const oldRunWithLead = await prisma.zillowImportRun.create({
      data: { status: "done", startedAt: new Date(now.getTime() - 30 * DAY) },
    });
    const keptLead = await prisma.zillowLead.create({
      data: { name: `${G} L`, nameKey: G, phone: null, propertyText: "x", status: "no_phone", importRunId: oldRunWithLead.id },
    });
    const freshRun = await prisma.zillowImportRun.create({ data: { status: "done" } });

    const oldSent = await prisma.textEmAllBatch.create({
      data: { day: "2001-01-01", slot: `${G}:sent`, groupName: G, phones: ["+1"], count: 1, status: "sent", createdAt: new Date(now.getTime() - 120 * DAY) },
    });
    const oldAmbiguous = await prisma.textEmAllBatch.create({
      data: { day: "2001-01-01", slot: `${G}:amb`, groupName: G, phones: ["+1"], count: 1, status: "ambiguous", createdAt: new Date(now.getTime() - 120 * DAY) },
    });
    const recentSent = await prisma.textEmAllBatch.create({
      data: { day: "2001-01-02", slot: `${G}:recent`, groupName: G, phones: ["+1"], count: 1, status: "sent" },
    });

    const oldFile = path.join(outDir, "leads-raw-2020-01-01T00-00-00-000Z.json");
    const newFile = path.join(outDir, "leads-raw-fresh.json");
    await writeFile(oldFile, "{}");
    await writeFile(newFile, "{}");
    const oldSec = (now.getTime() - 30 * DAY) / 1000;
    await utimes(oldFile, oldSec, oldSec);

    const res = await pruneZillowArtifacts(now);
    expect(res).not.toBeNull();
    expect(res!.files).toBeGreaterThanOrEqual(1);

    expect(await prisma.zillowImportRun.findUnique({ where: { id: oldEmptyRun.id } })).toBeNull();
    expect(await prisma.zillowImportRun.findUnique({ where: { id: oldRunWithLead.id } })).not.toBeNull(); // FK-safe
    expect(await prisma.zillowImportRun.findUnique({ where: { id: freshRun.id } })).not.toBeNull();
    expect(await prisma.textEmAllBatch.findUnique({ where: { id: oldSent.id } })).toBeNull();
    expect(await prisma.textEmAllBatch.findUnique({ where: { id: oldAmbiguous.id } })).toMatchObject({ status: "ambiguous" }); // NEVER pruned
    expect(await prisma.textEmAllBatch.findUnique({ where: { id: recentSent.id } })).not.toBeNull();
    const left = await readdir(outDir);
    expect(left).toContain("leads-raw-fresh.json");
    expect(left).not.toContain("leads-raw-2020-01-01T00-00-00-000Z.json");

    // Once per day: the second call is a no-op.
    expect(await pruneZillowArtifacts(now)).toBeNull();

    // Cleanup our lead + run.
    await prisma.zillowLead.delete({ where: { id: keptLead.id } });
    await prisma.zillowImportRun.deleteMany({ where: { id: { in: [oldRunWithLead.id, freshRun.id] } } });
  });
});

describe("persistRaw pass-through (poll cycles write no raw snapshot)", () => {
  it("runZillowImport({persistRaw:false}) → extraction gets the flag; run row keeps rawJsonPath null", async () => {
    mockExtract.mockResolvedValue({ leads: [], totalLeadCount: 0, rawJsonPath: "" });
    const summary = await runZillowImport({ persistRaw: false });
    expect(summary.status).toBe("done");
    expect(mockExtract).toHaveBeenCalledWith(expect.objectContaining({ persistRaw: false }));
    const row = await prisma.zillowImportRun.findUnique({ where: { id: summary.runId } });
    expect(row?.rawJsonPath).toBeNull();
    await prisma.zillowImportRun.delete({ where: { id: summary.runId } });
  });

  it("default (scheduled/manual) keeps the audit snapshot path", async () => {
    mockExtract.mockResolvedValue({ leads: [], totalLeadCount: 0, rawJsonPath: "/tmp/leads-raw-x.json" });
    const summary = await runZillowImport();
    expect(mockExtract).toHaveBeenCalledWith(expect.objectContaining({ persistRaw: undefined }));
    const row = await prisma.zillowImportRun.findUnique({ where: { id: summary.runId } });
    expect(row?.rawJsonPath).toBe("/tmp/leads-raw-x.json");
    await prisma.zillowImportRun.delete({ where: { id: summary.runId } });
  });
});
