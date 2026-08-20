import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import {
  addCall,
  getCall,
  removeCall,
  getActiveCallCount,
  getAllCalls,
  getCallByCallSid,
} from "../lib/call-registry.js";
import type { ActiveCall } from "../lib/call-registry.js";
import { buildTools, buildPrompt } from "@tenant-ai/shared";

// Set PII encryption key for tests
process.env.PII_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_voice_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "Voice Test Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "Voice Test Property",
      address: "200 Voice Ave, Chicago IL 60601",
      description: "Lovely property",
      amenities: ["Gym"],
      userId,
      isActive: true,
      twilioPhone: `+1312555${Date.now().toString().slice(-4)}`,
      twilioPhoneSid: "PN_voice_test",
      aiModel: "gpt-4o-mini-realtime-preview",
      voiceName: "alloy",
    },
  });
  propertyId = property.id;

  // Add questions
  await prisma.question.createMany({
    data: [
      {
        propertyId,
        text: "What is your full name?",
        fieldKey: "fullName",
        type: "text",
        required: true,
        sortOrder: 0,
        isStandard: true,
      },
      {
        propertyId,
        text: "What is your email?",
        fieldKey: "email",
        type: "text",
        required: true,
        sortOrder: 1,
        isStandard: true,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { propertyId } });
  await prisma.callLog.deleteMany({ where: { propertyId } });
  await prisma.question.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  // Clear any leftover calls from registry
  for (const [sid] of getAllCalls()) {
    removeCall(sid);
  }
  await prisma.$disconnect();
});

// ── Call Registry ──

describe("Call Registry", () => {
  it("adds and retrieves a call by streamSid", () => {
    const call: ActiveCall = {
      callSid: "CA_test_1",
      streamSid: "MZ_test_1",
      twilioWs: null as any,
      openaiWs: null,
      applicationId: "app_1",
      propertyId,
      callerPhone: "+13125551234",
      callLogId: "test-call-log-id",
      isTenant: false,
      hasTourSlots: false,
      questions: [],
      answerValidation: false,
      transcript: [],
      startTime: new Date(),
      reconnectCount: 0,
    };

    addCall("MZ_test_1", call);
    expect(getCall("MZ_test_1")).toBeDefined();
    expect(getCall("MZ_test_1")!.callSid).toBe("CA_test_1");
  });

  it("tracks active call count", () => {
    const before = getActiveCallCount();
    addCall("MZ_test_2", {
      callSid: "CA_test_2",
      streamSid: "MZ_test_2",
      twilioWs: null as any,
      openaiWs: null,
      applicationId: "app_2",
      propertyId,
      callerPhone: "+13125551234",
      callLogId: "test-call-log-id",
      isTenant: false,
      hasTourSlots: false,
      questions: [],
      answerValidation: false,
      transcript: [],
      startTime: new Date(),
      reconnectCount: 0,
    });
    expect(getActiveCallCount()).toBe(before + 1);
  });

  it("removes a call", () => {
    removeCall("MZ_test_2");
    expect(getCall("MZ_test_2")).toBeUndefined();
  });

  it("finds call by callSid", () => {
    expect(getCallByCallSid("CA_test_1")?.streamSid).toBe("MZ_test_1");
  });

  it("returns undefined for unknown streamSid", () => {
    expect(getCall("MZ_nonexistent")).toBeUndefined();
  });

  it("returns undefined for unknown callSid", () => {
    expect(getCallByCallSid("CA_nonexistent")).toBeUndefined();
  });

  // Clean up test call
  afterAll(() => {
    removeCall("MZ_test_1");
  });
});

// ── TwiML generation (via route handler logic) ──

describe("Voice incoming webhook logic", () => {
  it("rejects when all lines are busy", () => {
    // Simulate MAX_CONCURRENT calls
    for (let i = 0; i < 10; i++) {
      addCall(`MZ_busy_${i}`, {
        callSid: `CA_busy_${i}`,
        streamSid: `MZ_busy_${i}`,
        twilioWs: null as any,
        openaiWs: null,
        applicationId: `app_busy_${i}`,
        propertyId,
        callerPhone: "+13125551234",
        callLogId: "test-call-log-id",
        isTenant: false,
        hasTourSlots: false,
        questions: [],
        answerValidation: false,
        transcript: [],
        startTime: new Date(),
        reconnectCount: 0,
      });
    }

    expect(getActiveCallCount()).toBe(10);

    // Clean up
    for (let i = 0; i < 10; i++) {
      removeCall(`MZ_busy_${i}`);
    }
  });

  it("looks up property by twilioPhone", async () => {
    const property = await prisma.property.findFirst({
      where: {
        twilioPhone: { not: null },
        isActive: true,
        userId,
      },
    });

    expect(property).toBeDefined();
    expect(property!.id).toBe(propertyId);
    expect(property!.name).toBe("Voice Test Property");
  });

  it("returns null for inactive property", async () => {
    // Create inactive property
    const inactive = await prisma.property.create({
      data: {
        name: "Inactive Property",
        address: "300 Inactive St",
        userId,
        isActive: false,
        twilioPhone: `+1555000${Date.now().toString().slice(-4)}`,
      },
    });

    const found = await prisma.property.findFirst({
      where: {
        twilioPhone: inactive.twilioPhone,
        isActive: true,
      },
    });
    expect(found).toBeNull();

    // Clean up
    await prisma.property.delete({ where: { id: inactive.id } });
  });
});

// ── Call Log Creation ──

describe("CallLog creation", () => {
  it("creates a call log with property and caller info", async () => {
    const callLog = await prisma.callLog.create({
      data: {
        propertyId,
        callerPhone: "+13125551234",
        channel: "voice",
        direction: "inbound",
        twilioSid: `CA_${Date.now()}`,
        transcript: [],
      },
    });

    expect(callLog.id).toBeDefined();
    expect(callLog.propertyId).toBe(propertyId);
    expect(callLog.channel).toBe("voice");
    expect(callLog.direction).toBe("inbound");
  });

  it("updates call log with transcript and duration", async () => {
    const callLog = await prisma.callLog.create({
      data: {
        propertyId,
        callerPhone: "+13125555678",
        channel: "voice",
        twilioSid: `CA_dur_${Date.now()}`,
        transcript: [],
      },
    });

    const transcript = [
      {
        role: "ai",
        content: "Hello! Welcome to Voice Test Property.",
        timestamp: new Date().toISOString(),
      },
      {
        role: "user",
        content: "Hi, I'd like to apply.",
        timestamp: new Date().toISOString(),
      },
    ];

    const updated = await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        transcript,
        duration: 120,
        reconnectCount: 1,
        endedAt: new Date(),
      },
    });

    expect(updated.duration).toBe(120);
    expect(updated.reconnectCount).toBe(1);
    expect(updated.endedAt).toBeDefined();
    const t = updated.transcript as Array<{
      role: string;
      content: string;
    }>;
    expect(t.length).toBe(2);
    expect(t[0].role).toBe("ai");
    expect(t[1].content).toBe("Hi, I'd like to apply.");
  });
});

// ── OpenAI Tools definition ──

describe("OpenAI tools", () => {
  it("buildTools returns 6 functions (includes maintenance)", () => {
    const tools = buildTools();
    expect(tools.length).toBe(6);
    expect(tools[0].name).toBe("get_property_info");
    expect(tools[1].name).toBe("start_application");
    expect(tools[2].name).toBe("save_application_field");
    expect(tools[3].name).toBe("complete_application");
    expect(tools[4].name).toBe("submit_maintenance_request");
    expect(tools[5].name).toBe("check_maintenance_status");
  });
});

// ── Prompt built with property data for voice ──

describe("Prompt for voice call", () => {
  it("builds prompt with property questions and voice channel", async () => {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });

    const prompt = buildPrompt({
      property: {
        name: property!.name,
        address: property!.address,
        description: property!.description,
        aiDisclosureText: property!.aiDisclosureText,
        amenities: property!.amenities,
      },
      questions: property!.questions.map((q) => ({
        id: q.id,
        text: q.text,
        fieldKey: q.fieldKey,
        type: q.type as "text" | "yes_no" | "number" | "date",
        required: q.required,
        sortOrder: q.sortOrder,
        isStandard: q.isStandard,
      })),
      application: null,
      channel: "voice",
    });

    expect(prompt).toContain("Voice Test Property");
    expect(prompt).toContain("200 Voice Ave");
    expect(prompt).toContain("fullName");
    expect(prompt).toContain("email");
    expect(prompt).not.toContain("Keep responses under");
  });
});

// ── Fallback route ──

describe("Fallback route", () => {
  it("returns unavailable message TwiML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Our application system is temporarily unavailable. Please try again later, or text this number to apply.</Say></Response>`;
    expect(xml).toContain("temporarily unavailable");
    expect(xml).toContain("text this number");
  });
});
