import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
process.env.PII_ENCRYPTION_KEY = "a".repeat(64);

const cfg: Record<string, string> = {
  "textemall.individual_group": "2. leads 08-28-2026",
  "textemall.individual_cooldown_min": "60",
  "textemall.individual_settle_sec": "0",
  "textemall.monthly_fire_cap": "100",
  "textemall.individual_group_url": "https://app.text-em-all.com/contacts/group/1300",
};
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tenant-ai/shared")>();
  return { ...actual, resolveConfig: async (ns: string, k: string) => cfg[`${ns}.${k}`] ?? null };
});
vi.mock("../handlers/survey-intake.js", () => ({
  resolveSurveyLink: async () => ({ url: "https://x/apply", invite: { id: "inv1" } }),
  buildIntakeReply: () => "Apply here: https://x/apply",
}));
vi.mock("../routes/telnyx-sms.js", () => ({ rewriteForRelay: (t: string) => t }));

import { runIndividualRelay, individualTextEmAllEligible } from "../services/individual-relay.js";
const prisma = new PrismaClient();

const okEdit = vi.fn(async () => ({ status: "ok" as const, count: 1, phones: ["+13125550199"] }));
const fireOk = vi.fn(async () => ({ fired: true as const, status: 200 }));
const relayOk = vi.fn(async () => ({ status: "sent" as const }));

let propId = "";
const PHONE = "+13125550199";
const MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

beforeEach(async () => {
  okEdit.mockClear(); fireOk.mockClear(); relayOk.mockClear();
  cfg["textemall.monthly_fire_cap"] = "100";
  await prisma.textEmAllFire.deleteMany({ where: { ref: PHONE } });
  await prisma.smsOptOut.deleteMany({ where: { phone: PHONE } });
});
afterAll(async () => {
  await prisma.textEmAllFire.deleteMany({ where: { ref: PHONE } });
  await prisma.smsOptOut.deleteMany({ where: { phone: PHONE } });
  if (propId) await prisma.property.deleteMany({ where: { id: propId } });
  await prisma.$disconnect();
});

async function mkProp() {
  const u = await prisma.user.findFirst({ select: { id: true } });
  const p = await prisma.property.create({ data: { name: "IR test", userId: u!.id, address: "1 x", amenities: [] } as any });
  propId = p.id; return p.id;
}

const deps = { setGroup: okEdit as any, fire: fireOk as any, relay: relayOk as any };

describe("runIndividualRelay — R1 truth table", () => {
  it("iris ok + under cap → Text-Em-All fired, no relay", async () => {
    const id = await mkProp();
    const r = await runIndividualRelay({ propertyId: id, callerPhone: PHONE, source: "call_start" }, deps);
    expect(r.via).toBe("textemall");
    expect(fireOk).toHaveBeenCalledOnce();
    expect(relayOk).not.toHaveBeenCalled();
  });

  it("iris FAILED → relay fallback, no fire", async () => {
    const id = propId || (await mkProp());
    const r = await runIndividualRelay({ propertyId: id, callerPhone: PHONE, source: "x" },
      { ...deps, setGroup: (async () => ({ status: "failed", detail: "x" })) as any });
    expect(r.via).toBe("relay-fallback");
    expect(fireOk).not.toHaveBeenCalled();
    expect(relayOk).toHaveBeenCalledOnce();
  });

  it("cap hit → relay fallback, no fire", async () => {
    const id = propId || (await mkProp());
    cfg["textemall.monthly_fire_cap"] = "0";
    const r = await runIndividualRelay({ propertyId: id, callerPhone: PHONE, source: "x" }, deps);
    expect(r.via).toBe("relay-fallback");
    expect(fireOk).not.toHaveBeenCalled();
    expect(relayOk).toHaveBeenCalledOnce();
  });

  it("opted out → neither fires nor relays a marketing link", async () => {
    const id = propId || (await mkProp());
    await prisma.smsOptOut.create({ data: { phone: PHONE, propertyId: id } as any });
    const r = await runIndividualRelay({ propertyId: id, callerPhone: PHONE, source: "x" }, deps);
    expect(r).toMatchObject({ via: "skipped", reason: "opted out" });
    expect(fireOk).not.toHaveBeenCalled();
    expect(relayOk).not.toHaveBeenCalled();
  });

  it("cooldown (recent fire) → skipped", async () => {
    const id = propId || (await mkProp());
    await prisma.textEmAllFire.create({ data: { month: MONTH, path: "individual", ref: PHONE } });
    const r = await runIndividualRelay({ propertyId: id, callerPhone: PHONE, source: "x" }, deps);
    expect(r).toMatchObject({ via: "skipped", reason: "cooldown" });
    expect(fireOk).not.toHaveBeenCalled();
  });
});

describe("individualTextEmAllEligible — the toggle gate (inert by default)", () => {
  it("false when channel not textemall (DEFAULT — relay path unchanged)", async () => {
    delete cfg["sms_relay.individual_channel"];
    expect(await individualTextEmAllEligible("+13125550100")).toBe(false);
  });
  it("false when channel on but NOT armed", async () => {
    cfg["sms_relay.individual_channel"] = "textemall";
    delete cfg["textemall.individual_trigger_armed"];
    expect(await individualTextEmAllEligible("+13125550100")).toBe(false);
  });
  it("true when channel on + armed + no whitelist", async () => {
    cfg["sms_relay.individual_channel"] = "textemall";
    cfg["textemall.individual_trigger_armed"] = "true";
    delete cfg["textemall.individual_test_numbers"];
    expect(await individualTextEmAllEligible("+13125550100")).toBe(true);
  });
  it("whitelist: only listed numbers eligible, others → relay", async () => {
    cfg["sms_relay.individual_channel"] = "textemall";
    cfg["textemall.individual_trigger_armed"] = "true";
    cfg["textemall.individual_test_numbers"] = "+17084158984, +13129752365";
    expect(await individualTextEmAllEligible("+17084158984")).toBe(true);
    expect(await individualTextEmAllEligible("+13125550100")).toBe(false);
  });
});
