import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const capValue = { v: "3" };
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => (ns === "textemall" && k === "monthly_fire_cap" ? capValue.v : null) };
});

import { claimFire, fireCount, fireMonth } from "../services/fire-ledger.js";
const prisma = new PrismaClient();

// A synthetic far-future month so we never collide with real fires.
const TESTNOW = new Date(2099, 3, 15, 12, 0, 0);
const MONTH = fireMonth(TESTNOW);

beforeEach(async () => { await prisma.textEmAllFire.deleteMany({ where: { month: MONTH } }); capValue.v = "3"; });
afterAll(async () => { await prisma.textEmAllFire.deleteMany({ where: { month: MONTH } }); await prisma.$disconnect(); });

describe("shared fire ledger", () => {
  it("allows up to cap across BOTH paths, then blocks", async () => {
    expect((await claimFire("zillow", { now: TESTNOW })).allowed).toBe(true);
    expect((await claimFire("individual", { now: TESTNOW })).allowed).toBe(true);
    expect((await claimFire("individual", { now: TESTNOW })).allowed).toBe(true);
    const over = await claimFire("individual", { now: TESTNOW }); // 4th, cap=3
    expect(over.allowed).toBe(false);
    expect(over.count).toBe(3);
    expect(await fireCount(TESTNOW)).toBe(3); // blocked claim wrote no row
  });
});
