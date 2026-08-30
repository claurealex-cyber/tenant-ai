import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const TEST_PREFIX = `test_zillow_${Date.now()}`;

// Deterministic config: the import must use OUR default property, never fall
// through to whatever real property happens to be intake-enabled in the DB.
let defaultPropertyIdForTest: string | null = null;
vi.mock("@tenant-ai/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tenant-ai/shared")>();
  return {
    ...original,
    resolveConfig: async (ns: string, key: string) => {
      if (ns === "zillow" && key === "default_property_id") return defaultPropertyIdForTest;
      return original.resolveConfig(ns, key);
    },
  };
});

import {
  normalizePhoneE164,
  parseZillowLead,
  matchProperty,
  ingestLeads,
  leadsToCsv,
} from "../services/zillow-import.js";
import { classifyPageState } from "../services/zillow-extract.js";

const prisma = new PrismaClient();

// Real API shape (from a live capture) — includes the ~20% no-leadId case.
function rawLead(overrides: Record<string, unknown> = {}) {
  return {
    renterInfo: {
      renterName: "Test Renter",
      renterPhoneNumber: "630-461-1750",
      renterRelayEmailAddress: "abc123@convo.zillow.com",
      firstContactDateMs: 1787791207871,
      leadId: "3735601913434552960",
      ...(overrides.renterInfo as object | undefined),
    },
    listingDetails: {
      address: { streetAddress: "7301 Testberry Ln #4", cityStateZip: "Zzville, IL 60999" },
      ...(overrides.listingDetails as object | undefined),
    },
    latestContact: { messageText: "I would like to schedule a tour" },
    statusLabel: { text: "New" },
    ...overrides,
  };
}

describe("normalizePhoneE164", () => {
  it("handles the formats Zillow actually sends", () => {
    expect(normalizePhoneE164("630-461-1750")).toBe("+16304611750");
    expect(normalizePhoneE164("(630) 461-1750")).toBe("+16304611750");
    expect(normalizePhoneE164("+16304611750")).toBe("+16304611750");
    expect(normalizePhoneE164("16304611750")).toBe("+16304611750");
  });
  it("rejects non-US / partial numbers", () => {
    expect(normalizePhoneE164("12345")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164("+44 20 7946 0958")).toBeNull();
  });
});

describe("parseZillowLead", () => {
  it("parses a full lead", () => {
    const lead = parseZillowLead(rawLead());
    expect(lead).toMatchObject({
      name: "Test Renter",
      nameKey: "test renter",
      phone: "+16304611750",
      email: "abc123@convo.zillow.com",
      propertyText: "7301 Testberry Ln #4 Zzville, IL 60999",
      zillowStatus: "New",
      lastMessage: "I would like to schedule a tour",
    });
    expect(lead!.firstContactAt).toEqual(new Date(1787791207871));
  });

  it("captures the applicant signal from applicationInfo (isApplicationCompleted)", () => {
    const applied = parseZillowLead(rawLead({ applicationInfo: { numCoApplicants: 2, isApplicationsAccepted: true, isApplicationSent: true, isApplicationCompleted: true } }));
    expect(applied!.applicationCompleted).toBe(true);
    expect(applied!.applicationSent).toBe(true);
    expect(applied!.coApplicants).toBe(2);
  });

  it("isApplicationsAccepted (a LISTING setting) does NOT mark someone as an applicant", () => {
    // The live sample had isApplicationsAccepted=true for ALL leads — must be ignored.
    const notApplied = parseZillowLead(rawLead({ applicationInfo: { numCoApplicants: 0, isApplicationsAccepted: true, isApplicationSent: false, isApplicationCompleted: false } }));
    expect(notApplied!.applicationCompleted).toBe(false);
    expect(notApplied!.coApplicants).toBe(0);
  });

  it("missing applicationInfo → not an applicant (defaults, no crash)", () => {
    const lead = parseZillowLead(rawLead());
    expect(lead!.applicationCompleted).toBe(false);
    expect(lead!.applicationSent).toBe(false);
    expect(lead!.coApplicants).toBe(0);
  });

  it("survives a lead with no leadId (45/200 real leads lack one)", () => {
    const lead = parseZillowLead(rawLead({ renterInfo: { renterName: "No Id", renterPhoneNumber: "312-555-0000", leadId: undefined } }));
    expect(lead!.name).toBe("No Id");
  });

  it("keeps phone-less leads (they become no_phone) and drops empty ones", () => {
    const noPhone = parseZillowLead(rawLead({ renterInfo: { renterName: "Only Name", renterPhoneNumber: "" } }));
    expect(noPhone).toMatchObject({ name: "Only Name", phone: null });
    expect(parseZillowLead({ renterInfo: { renterName: "", renterPhoneNumber: "" } })).toBeNull();
    expect(parseZillowLead(undefined)).toBeNull();
    expect(parseZillowLead({})).toBeNull();
  });
});

describe("matchProperty", () => {
  const props = [
    { id: "p1", name: "Testberry", address: "7301 Testberry Ln, Zzville IL", smsIntakeEnabled: true },
    { id: "p2", name: "City only", address: "Chicago, Illinois", smsIntakeEnabled: false },
    { id: "p3", name: "Oak Lawn prop", address: "Oak Lawn, Illinois", smsIntakeEnabled: false },
  ];

  it("matches on ≥2 significant address tokens", () => {
    expect(matchProperty("7301 Testberry Ln #4 Zzville, IL 60999", props, null)).toBe("p1");
    expect(matchProperty("5665 W 95th St #5665 Oak Lawn, IL 60453", props, null)).toBe("p3");
  });

  it("a lone shared city token must NOT match", () => {
    // "Chicago" appears, but p2's only significant token is "chicago" (1 < 2).
    expect(matchProperty("2615 W 61st St #61 Chicago, IL 60629", props, "fallback")).toBe("fallback");
  });

  it("falls back to the sole intake-enabled property when unmatched and no default", () => {
    expect(matchProperty("999 Nowhere Rd, Elsewhere TX", props, null)).toBe("p1");
  });

  it("returns null when unmatched and multiple intake properties exist", () => {
    const multi = props.map((p) => ({ ...p, smsIntakeEnabled: true }));
    expect(matchProperty("999 Nowhere Rd, Elsewhere TX", multi, null)).toBeNull();
  });
});

describe("classifyPageState", () => {
  it("recognizes the signed-in rental-manager app", () => {
    expect(classifyPageState("https://www.zillow.com/rental-manager/lead-management")).toBe("ok");
  });
  it("treats pre-navigation states as loading, not signed-out", () => {
    expect(classifyPageState("about:blank")).toBe("loading");
    expect(classifyPageState("")).toBe("loading");
  });
  it("classifies login/captcha/off-site as needs-login", () => {
    expect(classifyPageState("https://www.zillow.com/user/acct/login?redirect=x")).toBe("needs-login");
    expect(classifyPageState("https://www.zillow.com/captchaPerimeterX/?url=x")).toBe("needs-login");
    expect(classifyPageState("https://www.zillow.com/homes/")).toBe("needs-login");
  });
});

describe("leadsToCsv", () => {
  it("escapes commas, quotes and newlines", () => {
    const csv = leadsToCsv([
      {
        name: 'Jo "JJ" Smith',
        phone: "+13125550001",
        email: null,
        propertyText: "1 Main St, Springfield",
        firstContactAt: new Date("2026-08-01T12:00:00Z"),
        zillowStatus: "New",
        status: "new",
        lastMessage: "line one\nline two",
      },
    ]);
    expect(csv).toContain('"Jo ""JJ"" Smith"');
    expect(csv).toContain('"1 Main St, Springfield"');
    expect(csv).toContain('"line one\nline two"');
    expect(csv.split("\n")[0]).toBe("nombre,telefono,email,propiedad,fecha,estado,estado_app,mensaje");
  });
});

describe("ingestLeads (real DB)", () => {
  let userId: string;
  let propertyId: string;
  let runId: string;

  // Fixture phones are FIXED (not prefixed) because ingestLeads dedupes by
  // phone globally and keeps a lead's ORIGINAL property. A leftover lead from
  // an earlier run therefore (a) makes "new" assertions fail and (b) gets
  // re-pointed to THIS run's importRunId, so deleting the run hit the FK and
  // aborted teardown — orphaning the test user/property every run. Purge by
  // phone + prefix up front, and tear down child-first by run/property/phone.
  const FIXTURE_PHONES = ["+13122000001", "+13122000002", "+13122000003", "+13122000777"];
  const purgeLeftovers = async () => {
    // ZillowLead.propertyId is a bare column (no Prisma relation), so resolve
    // the leftover test properties first.
    const stale = await prisma.property.findMany({
      where: { name: { startsWith: "test_zillow_" } },
      select: { id: true },
    });
    await prisma.zillowLead.deleteMany({
      where: {
        OR: [
          { phone: { in: FIXTURE_PHONES } },
          { propertyId: { in: stale.map((p) => p.id) } },
        ],
      },
    });
    await prisma.property.deleteMany({ where: { name: { startsWith: "test_zillow_" } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test_zillow_" } } });
  };

  beforeAll(async () => {
    await prisma.$connect();
    await purgeLeftovers();
    const user = await prisma.user.create({
      data: {
        email: `${TEST_PREFIX}@test.com`,
        name: "Zillow Test Owner",
        passwordHash: await bcrypt.hash("password123", 12),
        role: "client",
        onboarded: true,
      },
    });
    userId = user.id;
    const property = await prisma.property.create({
      data: {
        name: `${TEST_PREFIX}_prop`,
        address: "7301 Testberry Ln, Zzville IL 60999",
        userId,
        isActive: true,
        smsIntakeEnabled: true,
      },
    });
    propertyId = property.id;
    defaultPropertyIdForTest = propertyId; // unmatched leads land here, never on real rows
    const run = await prisma.zillowImportRun.create({ data: { status: "running" } });
    runId = run.id;
  });

  afterAll(async () => {
    await prisma.zillowLead.deleteMany({
      where: { OR: [{ importRunId: runId }, { propertyId }, { phone: { in: FIXTURE_PHONES } }] },
    });
    await prisma.zillowImportRun.deleteMany({ where: { id: runId } });
    await prisma.property.deleteMany({ where: { id: propertyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates new leads, matched to the right property", async () => {
    const summary = await ingestLeads(runId, [
      rawLead({ renterInfo: { renterName: "Alice A", renterPhoneNumber: "312-200-0001" } }),
      rawLead({ renterInfo: { renterName: "Bob NoPhone", renterPhoneNumber: "" } }),
    ]);
    expect(summary).toEqual({ leadsFound: 2, leadsNew: 2 });

    const alice = await prisma.zillowLead.findFirst({ where: { phone: "+13122000001" } });
    expect(alice).toMatchObject({ propertyId, status: "new", name: "Alice A" });
    const bob = await prisma.zillowLead.findFirst({ where: { nameKey: "bob nophone", propertyId } });
    expect(bob).toMatchObject({ status: "no_phone", phone: null });
  });

  it("re-import is idempotent and refreshes Zillow fields", async () => {
    const again = await ingestLeads(runId, [
      rawLead({
        renterInfo: { renterName: "Alice A", renterPhoneNumber: "312-200-0001" },
        statusLabel: { text: "Contacted" },
      }),
    ]);
    expect(again).toEqual({ leadsFound: 1, leadsNew: 0 });
    const alice = await prisma.zillowLead.findFirst({ where: { phone: "+13122000001" } });
    expect(alice!.zillowStatus).toBe("Contacted");
    expect(alice!.status).toBe("new");
  });

  it("never regresses sticky lifecycle statuses on re-import", async () => {
    await prisma.zillowLead.updateMany({
      where: { phone: "+13122000001" },
      data: { status: "invited" },
    });
    await ingestLeads(runId, [
      rawLead({ renterInfo: { renterName: "Alice A", renterPhoneNumber: "312-200-0001" } }),
    ]);
    const alice = await prisma.zillowLead.findFirst({ where: { phone: "+13122000001" } });
    expect(alice!.status).toBe("invited");
  });

  it("flips no_phone → new when the phone shows up in a later import", async () => {
    await ingestLeads(runId, [
      rawLead({ renterInfo: { renterName: "Bob NoPhone", renterPhoneNumber: "312-200-0002" } }),
    ]);
    // The phone-keyed row is new; the old phone-less row stays (different key)
    const bobWithPhone = await prisma.zillowLead.findFirst({ where: { phone: "+13122000002" } });
    expect(bobWithPhone).toMatchObject({ status: "new", nameKey: "bob nophone" });
  });

  it("census flap: a property-matching change must NOT duplicate existing leads", async () => {
    // Lead imported normally, matched to our property...
    await ingestLeads(runId, [
      rawLead({ renterInfo: { renterName: "Flap Victim", renterPhoneNumber: "312-200-0777" } }),
    ]);
    const before = await prisma.zillowLead.count({ where: { phone: "+13122000777" } });
    expect(before).toBe(1);

    // ...then matching resolves DIFFERENTLY (here: to null — a stray second
    // intake property breaks the "single intake property" fallback, exactly as
    // happened live 2026-08-26). Simulated by ADDING a second intake property
    // rather than disabling ours: disabling ours made the fallback resolve to
    // whatever real intake property the dev DB happens to hold (Ghem LLC 1),
    // which the code rightly treats as a new inquiry — an environment-dependent
    // failure, not a product one.
    defaultPropertyIdForTest = null;
    const stray = await prisma.property.create({
      data: {
        name: `${TEST_PREFIX}_prop2_stray`,
        address: "1 Strayberry Ct, Zzville IL 60999",
        userId,
        isActive: true,
        smsIntakeEnabled: true,
      },
    });
    try {
      const summary = await ingestLeads(runId, [
        rawLead({
          renterInfo: { renterName: "Flap Victim", renterPhoneNumber: "312-200-0777" },
          listingDetails: { address: { streetAddress: "999 Unknownberry Rd", cityStateZip: "Elsewhere, TX" } },
        }),
      ]);
      expect(summary.leadsNew).toBe(0); // adopted the existing row, no orphan
      const after = await prisma.zillowLead.findMany({ where: { phone: "+13122000777" } });
      expect(after).toHaveLength(1);
      expect(after[0].propertyId).toBe(propertyId); // kept its home
    } finally {
      defaultPropertyIdForTest = propertyId;
      await prisma.property.deleteMany({ where: { id: stray.id } });
    }
  });

  it("dedupes repeats inside one batch", async () => {
    const summary = await ingestLeads(runId, [
      rawLead({ renterInfo: { renterName: "Dup D", renterPhoneNumber: "312-200-0003" } }),
      rawLead({ renterInfo: { renterName: "Dup D", renterPhoneNumber: "312-200-0003" } }),
    ]);
    expect(summary.leadsNew).toBe(1);
  });
});
