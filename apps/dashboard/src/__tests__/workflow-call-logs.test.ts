import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_wf_calllogs_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// ── Shared state ──

let userId: string;
let otherUserId: string;
let propertyId: string;
let property2Id: string;
let otherPropertyId: string;
let callLogWithTranscriptId: string;
let otherCallLogId: string;

// ── Mock session ──

const mockSession = {
  user: { id: "", email: "", role: "client" },
};

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve(mockSession)),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => {
  const { PrismaClient: RealPrisma } = require("@prisma/client");
  return { prisma: new RealPrisma() };
});

// ── Setup ──

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "WF CallLog Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
  mockSession.user.id = userId;
  mockSession.user.email = user.email;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
    },
  });
  otherUserId = otherUser.id;

  const property = await prisma.property.create({
    data: {
      name: "WF CallLog Property A",
      address: "100 Log Ave",
      userId,
      isActive: true,
    },
  });
  propertyId = property.id;

  const property2 = await prisma.property.create({
    data: {
      name: "WF CallLog Property B",
      address: "200 Log Ave",
      userId,
    },
  });
  property2Id = property2.id;

  const otherProperty = await prisma.property.create({
    data: {
      name: "WF Other Log Property",
      address: "300 Other St",
      userId: otherUserId,
    },
  });
  otherPropertyId = otherProperty.id;

  // Create call logs
  const cl1 = await prisma.callLog.create({
    data: {
      propertyId,
      callerPhone: "+13125550101",
      channel: "voice",
      duration: 323,
      estimatedCostCents: 178,
      startedAt: new Date("2026-02-01T10:00:00Z"),
      endedAt: new Date("2026-02-01T10:05:23Z"),
      transcript: [
        { role: "ai", content: "Hello, how can I help you?", timestamp: "2026-02-01T10:00:00Z" },
        { role: "user", content: "I'd like to apply for the apartment.", timestamp: "2026-02-01T10:00:10Z" },
      ],
      summary: "Caller inquired about apartment availability.",
    },
  });
  callLogWithTranscriptId = cl1.id;

  await prisma.callLog.create({
    data: {
      propertyId,
      callerPhone: "+13125550102",
      channel: "voice",
      duration: 480,
      estimatedCostCents: 264,
      startedAt: new Date("2026-02-02T14:00:00Z"),
      endedAt: new Date("2026-02-02T14:08:00Z"),
      reconnectCount: 1,
    },
  });

  await prisma.callLog.create({
    data: {
      propertyId,
      callerPhone: "+13125550103",
      channel: "sms",
      startedAt: new Date("2026-02-03T09:00:00Z"),
    },
  });

  await prisma.callLog.create({
    data: {
      propertyId: property2Id,
      callerPhone: "+13125550104",
      channel: "voice",
      duration: 120,
      estimatedCostCents: 66,
      startedAt: new Date("2026-02-04T16:00:00Z"),
      endedAt: new Date("2026-02-04T16:02:00Z"),
    },
  });

  // Other user's call log
  const otherLog = await prisma.callLog.create({
    data: {
      propertyId: otherPropertyId,
      callerPhone: "+13125559999",
      channel: "voice",
      duration: 600,
      estimatedCostCents: 330,
      startedAt: new Date("2026-02-01T12:00:00Z"),
    },
  });
  otherCallLogId = otherLog.id;
});

afterAll(async () => {
  // Delete applications before call logs (FK constraint)
  await prisma.application.deleteMany({
    where: { propertyId: { in: [propertyId, property2Id, otherPropertyId] } },
  });
  await prisma.callLog.deleteMany({
    where: { propertyId: { in: [propertyId, property2Id, otherPropertyId] } },
  });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyId, property2Id, otherPropertyId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── Duration Formatting Helper (pure function) ──

describe("formatDuration helper", () => {
  // Imported from the page component; since it's an inline function,
  // we replicate it here as the canonical implementation to test.
  function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return "--";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  it("formats 323 seconds as 5m 23s", () => {
    expect(formatDuration(323)).toBe("5m 23s");
  });

  it("formats 60 seconds as 1m 0s", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  it("formats 45 seconds as 45s", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats 0 seconds as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats null as --", () => {
    expect(formatDuration(null)).toBe("--");
  });

  it("formats 3661 seconds as 61m 1s", () => {
    expect(formatDuration(3661)).toBe("61m 1s");
  });
});

// ── GET /api/call-logs ──

describe("GET /api/call-logs", () => {
  it("returns call logs with pagination and summary", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest("http://localhost/api/call-logs?page=1&limit=25");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.callLogs).toBeDefined();
    expect(Array.isArray(data.callLogs)).toBe(true);
    expect(data.callLogs.length).toBe(4);
    expect(data.pagination).toBeDefined();
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.total).toBe(4);
    expect(data.summary).toBeDefined();
    expect(data.summary.totalCalls).toBe(4);
  });

  it("only returns logs for authenticated user's properties (data isolation)", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest("http://localhost/api/call-logs");
    const res = await GET(req);
    const data = await res.json();

    const phones = data.callLogs.map((l: any) => l.callerPhone);
    expect(phones).not.toContain("+13125559999");

    for (const log of data.callLogs) {
      expect([propertyId, property2Id]).toContain(log.propertyId);
    }
  });

  it("includes property info in each call log", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest("http://localhost/api/call-logs");
    const res = await GET(req);
    const data = await res.json();

    for (const log of data.callLogs) {
      expect(log.property).toBeDefined();
      expect(log.property.name).toBeDefined();
    }
  });

  it("filters by propertyId", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest(`http://localhost/api/call-logs?propertyId=${propertyId}`);
    const res = await GET(req);
    const data = await res.json();

    expect(data.callLogs.length).toBe(3);
    for (const log of data.callLogs) {
      expect(log.propertyId).toBe(propertyId);
    }
  });

  it("filters by channel=sms", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest("http://localhost/api/call-logs?channel=sms");
    const res = await GET(req);
    const data = await res.json();

    expect(data.callLogs.length).toBe(1);
    expect(data.callLogs[0].channel).toBe("sms");
  });

  it("filters by date range", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest(
      "http://localhost/api/call-logs?from=2026-02-02T00:00:00Z&to=2026-02-03T23:59:59Z"
    );
    const res = await GET(req);
    const data = await res.json();

    expect(data.callLogs.length).toBe(2);
  });

  it("paginates correctly", async () => {
    const { GET } = await import("@/app/api/call-logs/route");

    const req1 = new NextRequest("http://localhost/api/call-logs?page=1&limit=2");
    const res1 = await GET(req1);
    const data1 = await res1.json();

    const req2 = new NextRequest("http://localhost/api/call-logs?page=2&limit=2");
    const res2 = await GET(req2);
    const data2 = await res2.json();

    expect(data1.callLogs.length).toBe(2);
    expect(data2.callLogs.length).toBe(2);
    expect(data1.pagination.totalPages).toBe(2);

    // No overlap
    const ids1 = data1.callLogs.map((l: any) => l.id);
    const ids2 = data2.callLogs.map((l: any) => l.id);
    for (const id of ids1) {
      expect(ids2).not.toContain(id);
    }
  });

  it("returns summary stats aggregation", async () => {
    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest("http://localhost/api/call-logs");
    const res = await GET(req);
    const data = await res.json();

    expect(data.summary.totalCalls).toBe(4);
    // voice durations: 323 + 480 + 120 = 923; sms has null
    expect(data.summary.totalDurationSeconds).toBe(923);
    // costs: 178 + 264 + 66 = 508; sms has null
    expect(data.summary.totalEstimatedCostCents).toBe(508);
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/call-logs/route");
    const req = new NextRequest("http://localhost/api/call-logs");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});

// ── GET /api/call-logs/[id] ──

describe("GET /api/call-logs/[id]", () => {
  it("returns call log detail with transcript", async () => {
    const { GET } = await import("@/app/api/call-logs/[id]/route");

    const req = new NextRequest(`http://localhost/api/call-logs/${callLogWithTranscriptId}`);
    const res = await GET(req, { params: Promise.resolve({ id: callLogWithTranscriptId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.callLog).toBeDefined();
    expect(data.callLog.id).toBe(callLogWithTranscriptId);
    expect(data.callLog.duration).toBe(323);
    expect(data.callLog.channel).toBe("voice");

    const transcript = data.callLog.transcript as Array<{ role: string; content: string }>;
    expect(transcript).toBeDefined();
    expect(transcript.length).toBe(2);
    expect(transcript[0].role).toBe("ai");
    expect(transcript[1].role).toBe("user");
  });

  it("includes property info", async () => {
    const { GET } = await import("@/app/api/call-logs/[id]/route");

    const req = new NextRequest(`http://localhost/api/call-logs/${callLogWithTranscriptId}`);
    const res = await GET(req, { params: Promise.resolve({ id: callLogWithTranscriptId }) });
    const data = await res.json();

    expect(data.callLog.property).toBeDefined();
    expect(data.callLog.property.name).toBe("WF CallLog Property A");
  });

  it("returns 404 for non-existent call log", async () => {
    const { GET } = await import("@/app/api/call-logs/[id]/route");

    const req = new NextRequest("http://localhost/api/call-logs/nonexistent-id");
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent-id" }) });

    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's call log (data isolation)", async () => {
    const { GET } = await import("@/app/api/call-logs/[id]/route");

    const req = new NextRequest(`http://localhost/api/call-logs/${otherCallLogId}`);
    const res = await GET(req, { params: Promise.resolve({ id: otherCallLogId }) });

    expect(res.status).toBe(404);
  });
});

// ── Call Log ↔ Application Link ──

describe("Call log → application linking", () => {
  let linkedAppId: string;

  beforeAll(async () => {
    // Create an application linked to the first call log
    const app = await prisma.application.create({
      data: {
        propertyId,
        callerPhone: "+13125550170",
        channel: "voice",
        status: "completed",
        callLogId: callLogWithTranscriptId,
      },
    });
    linkedAppId = app.id;
  });

  afterAll(async () => {
    await prisma.application.delete({ where: { id: linkedAppId } });
  });

  it("detail endpoint includes linked application data", async () => {
    const { GET } = await import("@/app/api/call-logs/[id]/route");

    const req = new NextRequest(`http://localhost/api/call-logs/${callLogWithTranscriptId}`);
    const res = await GET(req, { params: Promise.resolve({ id: callLogWithTranscriptId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.callLog.application).toBeDefined();
    expect(data.callLog.application.id).toBe(linkedAppId);
  });

  it("list endpoint includes linked application id", async () => {
    const { GET } = await import("@/app/api/call-logs/route");

    const req = new NextRequest("http://localhost/api/call-logs");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const linkedLog = data.callLogs.find((l: any) => l.id === callLogWithTranscriptId);
    expect(linkedLog).toBeDefined();
    expect(linkedLog.application).toBeDefined();
    expect(linkedLog.application.id).toBe(linkedAppId);
  });

  it("call log without application returns null application", async () => {
    const { GET } = await import("@/app/api/call-logs/route");

    const req = new NextRequest("http://localhost/api/call-logs");
    const res = await GET(req);
    const data = await res.json();

    const unlinkedLog = data.callLogs.find(
      (l: any) => l.id !== callLogWithTranscriptId && l.callerPhone !== "+13125559999"
    );
    expect(unlinkedLog).toBeDefined();
    expect(unlinkedLog.application).toBeNull();
  });
});
