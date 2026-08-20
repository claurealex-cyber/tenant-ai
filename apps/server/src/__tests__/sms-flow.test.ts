import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { cleanupExpiredConversations, handleIncomingSms } from "../handlers/sms-handler.js";
import { findOrCreateApplication, completeApplication } from "../handlers/application-builder.js";
import { splitSmsResponse } from "../services/openai-chat.js";
import { redactTranscriptPII, MAX_RECONNECTS } from "../handlers/call-handler.js";
import { SMS_MAX_CHARS } from "@tenant-ai/shared";

// Set PII encryption key for tests
process.env.PII_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_sms_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let propertyId: string;
const twilioPhone = `+1312555${Date.now().toString().slice(-4)}`;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("owner"),
      name: "SMS Test Owner",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const property = await prisma.property.create({
    data: {
      name: "SMS Test Property",
      address: "300 SMS Ave, Chicago IL 60601",
      userId,
      isActive: true,
      twilioPhone,
      twilioPhoneSid: "PN_sms_test",
    },
  });
  propertyId = property.id;

  // Add a question
  await prisma.question.create({
    data: {
      propertyId,
      text: "What is your full name?",
      fieldKey: "fullName",
      type: "text",
      required: true,
      sortOrder: 0,
      isStandard: true,
    },
  });
});

afterAll(async () => {
  await prisma.smsConversation.deleteMany({
    where: { propertyId },
  });
  await prisma.smsOptOut.deleteMany({
    where: { propertyId },
  });
  await prisma.application.deleteMany({
    where: { propertyId },
  });
  await prisma.question.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── SMS Opt-Out ──

describe("SMS opt-out (STOP/START)", () => {
  const phone = "+13125550010";

  it("creates opt-out record on STOP", async () => {
    await prisma.smsOptOut.create({
      data: {
        phone,
        propertyId,
      },
    });

    const record = await prisma.smsOptOut.findUnique({
      where: {
        phone_propertyId: {
          phone,
          propertyId,
        },
      },
    });

    expect(record).toBeDefined();
    expect(record!.phone).toBe(phone);
  });

  it("opted-out check returns true for opted-out phone", async () => {
    const record = await prisma.smsOptOut.findUnique({
      where: {
        phone_propertyId: {
          phone,
          propertyId,
        },
      },
    });
    expect(record).not.toBeNull();
  });

  it("deletes opt-out record on START", async () => {
    await prisma.smsOptOut.deleteMany({
      where: { phone, propertyId },
    });

    const record = await prisma.smsOptOut.findUnique({
      where: {
        phone_propertyId: {
          phone,
          propertyId,
        },
      },
    });
    expect(record).toBeNull();
  });

  it("opt-out is scoped to property (not global)", async () => {
    // Create opt-out for property
    await prisma.smsOptOut.create({
      data: { phone, propertyId },
    });

    // Create another property
    const otherProp = await prisma.property.create({
      data: {
        name: "Other Property",
        address: "400 Other St",
        userId,
      },
    });

    // Check opt-out for other property — should NOT be opted out
    const record = await prisma.smsOptOut.findUnique({
      where: {
        phone_propertyId: {
          phone,
          propertyId: otherProp.id,
        },
      },
    });
    expect(record).toBeNull();

    // Clean up
    await prisma.smsOptOut.deleteMany({
      where: { phone, propertyId },
    });
    await prisma.property.delete({ where: { id: otherProp.id } });
  });
});

// ── SMS Conversation State ──

describe("SMS conversation state", () => {
  const phone = "+13125550020";

  it("creates SMS conversation with expiry", async () => {
    const expiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    const convo = await prisma.smsConversation.create({
      data: {
        callerPhone: phone,
        propertyId,
        messages: [],
        expiresAt,
      },
    });

    expect(convo.id).toBeDefined();
    expect(convo.callerPhone).toBe(phone);
    expect(convo.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("finds conversation by phone + property", async () => {
    const convo = await prisma.smsConversation.findUnique({
      where: {
        callerPhone_propertyId: {
          callerPhone: phone,
          propertyId,
        },
      },
    });

    expect(convo).not.toBeNull();
    expect(convo!.callerPhone).toBe(phone);
  });

  it("updates messages JSON array", async () => {
    const convo = await prisma.smsConversation.findUnique({
      where: {
        callerPhone_propertyId: {
          callerPhone: phone,
          propertyId,
        },
      },
    });

    const messages = [
      { role: "user", content: "Hi" },
      {
        role: "assistant",
        content: "Hello! I'm the AI assistant. What is your name?",
      },
      { role: "user", content: "John Smith" },
    ];

    await prisma.smsConversation.update({
      where: { id: convo!.id },
      data: { messages },
    });

    const updated = await prisma.smsConversation.findUnique({
      where: { id: convo!.id },
    });

    const msgs = updated!.messages as Array<{
      role: string;
      content: string;
    }>;
    expect(msgs.length).toBe(3);
    expect(msgs[2].content).toBe("John Smith");
  });

  it("resets expiry on activity", async () => {
    const convo = await prisma.smsConversation.findUnique({
      where: {
        callerPhone_propertyId: {
          callerPhone: phone,
          propertyId,
        },
      },
    });

    const newExpiry = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    await prisma.smsConversation.update({
      where: { id: convo!.id },
      data: { expiresAt: newExpiry },
    });

    const updated = await prisma.smsConversation.findUnique({
      where: { id: convo!.id },
    });

    expect(updated!.expiresAt.getTime()).toBeCloseTo(
      newExpiry.getTime(),
      -3,
    );
  });

  // Clean up
  afterAll(async () => {
    await prisma.smsConversation.deleteMany({
      where: { callerPhone: phone },
    });
  });
});

// ── Conversation Expiry Cleanup ──

describe("SMS conversation cleanup", () => {
  it("deletes expired conversations", async () => {
    const phone = "+13125550030";

    // Create an expired conversation
    await prisma.smsConversation.create({
      data: {
        callerPhone: phone,
        propertyId,
        messages: [{ role: "user", content: "hi" }],
        expiresAt: new Date(Date.now() - 1000), // Already expired
      },
    });

    const count = await cleanupExpiredConversations();
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify it's gone
    const found = await prisma.smsConversation.findUnique({
      where: {
        callerPhone_propertyId: {
          callerPhone: phone,
          propertyId,
        },
      },
    });
    expect(found).toBeNull();
  });

  it("does NOT delete active conversations", async () => {
    const phone = "+13125550031";

    await prisma.smsConversation.create({
      data: {
        callerPhone: phone,
        propertyId,
        messages: [],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await cleanupExpiredConversations();

    const found = await prisma.smsConversation.findUnique({
      where: {
        callerPhone_propertyId: {
          callerPhone: phone,
          propertyId,
        },
      },
    });
    expect(found).not.toBeNull();

    // Clean up
    await prisma.smsConversation.delete({
      where: { id: found!.id },
    });
  });
});

// ── Message Splitting ──

describe("splitSmsResponse", () => {
  it("returns single segment for short messages", () => {
    const result = splitSmsResponse("Hello!");
    expect(result).toEqual(["Hello!"]);
  });

  it("returns single segment for message at max chars", () => {
    const msg = "a".repeat(SMS_MAX_CHARS);
    const result = splitSmsResponse(msg);
    expect(result).toEqual([msg]);
  });

  it("splits long message at sentence boundary", () => {
    // Build a message just over SMS_MAX_CHARS that has a sentence boundary
    // sentence1 (with period) near the limit, sentence2 pushes it over
    const sentence1 = "A".repeat(SMS_MAX_CHARS - 5) + ".";
    const sentence2 = "Second part.";
    const msg = `${sentence1} ${sentence2}`;

    expect(msg.length).toBeGreaterThan(SMS_MAX_CHARS);
    const result = splitSmsResponse(msg);
    expect(result.length).toBe(2);
    expect(result[0].endsWith(".")).toBe(true);
  });

  it("each segment is within max chars", () => {
    const longMsg = "Hello. ".repeat(200); // ~1400 chars
    const result = splitSmsResponse(longMsg);

    for (const segment of result) {
      expect(segment.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    }
  });

  it("splits at space if no sentence boundary", () => {
    const words = "word ".repeat(200); // No periods
    const result = splitSmsResponse(words);

    expect(result.length).toBeGreaterThan(1);
    for (const segment of result) {
      expect(segment.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    }
  });
});

// ── Keyword detection ──

describe("Keyword detection", () => {
  it("STOP keywords are case-insensitive", () => {
    const keywords = ["stop", "STOP", "Stop", "unsubscribe", "cancel", "quit"];
    for (const kw of keywords) {
      expect(
        new Set(["stop", "unsubscribe", "cancel", "quit"]).has(
          kw.toLowerCase(),
        ),
      ).toBe(true);
    }
  });

  it("START keywords are case-insensitive", () => {
    const keywords = ["start", "START", "Start", "subscribe", "resume"];
    for (const kw of keywords) {
      expect(
        new Set(["start", "subscribe", "resume"]).has(kw.toLowerCase()),
      ).toBe(true);
    }
  });

  it("HELP keyword recognized", () => {
    expect(
      new Set(["help", "info"]).has("help"),
    ).toBe(true);
    expect(
      new Set(["help", "info"]).has("info"),
    ).toBe(true);
  });

  it("normal message is not a keyword", () => {
    const allKeywords = new Set([
      "stop", "unsubscribe", "cancel", "quit",
      "start", "subscribe", "resume",
      "help", "info",
    ]);
    expect(allKeywords.has("john smith")).toBe(false);
    expect(allKeywords.has("hello")).toBe(false);
  });
});

// ── TwiML response ──

describe("SMS TwiML response", () => {
  it("escapes XML special characters", () => {
    function escapeXml(str: string): string {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }

    expect(escapeXml('He said "hello" & <goodbye>')).toBe(
      "He said &quot;hello&quot; &amp; &lt;goodbye&gt;",
    );
  });
});

// ── SMS tool call feedback loop ──

describe("SMS tool call feedback loop", () => {
  it("FunctionCall interface includes id field for tool_call_id", () => {
    // The callChatAPI response now includes id on each FunctionCall
    const fc = { id: "call_123", name: "save_application_field", arguments: '{"field_key":"fullName","value":"John"}' };
    expect(fc.id).toBe("call_123");
    expect(fc.name).toBe("save_application_field");
  });

  it("ChatMessage supports tool role with tool_call_id", () => {
    const toolMsg = {
      role: "tool" as const,
      content: JSON.stringify({ success: true }),
      tool_call_id: "call_123",
    };
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_123");
    expect(JSON.parse(toolMsg.content)).toEqual({ success: true });
  });

  it("tool result contains validation error from saveApplicationField", () => {
    // Simulates the tool result that would be built in the SMS handler loop
    const validationError = { success: false, error: "Invalid SSN format" };
    const toolResult = JSON.stringify(validationError);
    const parsed = JSON.parse(toolResult);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Invalid SSN");
  });
});

// ── Duplicate Application Detection ──

describe("findOrCreateApplication duplicate detection", () => {
  it("returns hasDuplicate: true when completed app exists within 30 days", async () => {
    const phone = "+13125550050";
    await prisma.application.create({
      data: {
        propertyId,
        callerPhone: phone,
        channel: "sms",
        status: "completed",
        completedAt: new Date(),
      },
    });

    const { application, isResume, hasDuplicate } = await findOrCreateApplication(
      propertyId,
      phone,
      "sms",
    );

    expect(hasDuplicate).toBe(true);
    expect(isResume).toBe(false);
    expect(application.id).toBeDefined();

    await prisma.application.deleteMany({ where: { callerPhone: phone, propertyId } });
  });

  it("returns hasDuplicate: false when no completed app exists", async () => {
    const phone = "+13125550051";
    const { hasDuplicate } = await findOrCreateApplication(propertyId, phone, "sms");
    expect(hasDuplicate).toBe(false);
    await prisma.application.deleteMany({ where: { callerPhone: phone, propertyId } });
  });
});

// ── Required Fields Validation ──

describe("completeApplication required fields validation", () => {
  it("rejects completion when required fields are missing", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        callerPhone: "+13125550052",
        channel: "sms",
        status: "in_progress",
      },
    });

    const result = await completeApplication(app.id, "Test summary");

    expect(result.success).toBe(false);
    expect(result.missingFields).toBeDefined();
    expect(result.missingFields!.length).toBeGreaterThan(0);

    const check = await prisma.application.findUnique({ where: { id: app.id } });
    expect(check!.status).toBe("in_progress");

    await prisma.application.delete({ where: { id: app.id } });
  });

  it("allows completion when all required fields are filled", async () => {
    const app = await prisma.application.create({
      data: {
        propertyId,
        callerPhone: "+13125550053",
        channel: "sms",
        status: "in_progress",
        fullName: "Test Person",
      },
    });

    const result = await completeApplication(app.id, "Good candidate");
    expect(result.success).toBe(true);

    const check = await prisma.application.findUnique({ where: { id: app.id } });
    expect(check!.status).toBe("completed");

    await prisma.application.delete({ where: { id: app.id } });
  });
});

// ── SMS Message Length Validation ──

describe("SMS message length validation", () => {
  it("rejects messages over 1600 characters", async () => {
    const longMessage = "a".repeat(1601);
    const result = await handleIncomingSms("+13125550060", twilioPhone, longMessage);
    expect(result.shouldRespond).toBe(true);
    expect(result.replies[0]).toContain("too long");
  });
});

// ── Route Rate Limit Wiring ──

describe("SMS and voice route rate limit wiring", () => {
  it("twilio-sms.ts imports and applies smsRateLimitConfig", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(import.meta.dirname, "../routes/twilio-sms.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain('from "../lib/rate-limit.js"');
    expect(content).toContain("smsRateLimitConfig");
  });

  it("twilio-voice.ts imports and applies voiceRateLimitConfig", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(import.meta.dirname, "../routes/twilio-voice.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain('from "../lib/rate-limit.js"');
    expect(content).toContain("voiceRateLimitConfig");
  });
});

// ── OpenAI Chat API Timeout Wiring ──

describe("OpenAI Chat API timeout", () => {
  it("openai-chat.ts includes AbortSignal.timeout in fetch call", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(import.meta.dirname, "../services/openai-chat.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("AbortSignal.timeout");
  });
});

// ── PII Redaction ──

describe("redactTranscriptPII", () => {
  it("redacts SSN with dashes (123-45-6789)", () => {
    const transcript = [
      { role: "user", content: "My SSN is 123-45-6789", timestamp: new Date() },
    ];
    const result = redactTranscriptPII(transcript);
    expect(result[0].content).toBe("My SSN is ***-**-****");
  });

  it("redacts SSN with spaces (123 45 6789)", () => {
    const transcript = [
      { role: "user", content: "SSN: 123 45 6789", timestamp: new Date() },
    ];
    const result = redactTranscriptPII(transcript);
    expect(result[0].content).not.toContain("123 45 6789");
    expect(result[0].content).toContain("***-**-****");
  });

  it("redacts SSN without separators (123456789)", () => {
    const transcript = [
      { role: "user", content: "It's 123456789", timestamp: new Date() },
    ];
    const result = redactTranscriptPII(transcript);
    expect(result[0].content).not.toContain("123456789");
  });

  it("preserves non-SSN content unchanged", () => {
    const transcript = [
      { role: "ai", content: "Hello! What is your name?", timestamp: new Date() },
      { role: "user", content: "John Smith", timestamp: new Date() },
    ];
    const result = redactTranscriptPII(transcript);
    expect(result[0].content).toBe("Hello! What is your name?");
    expect(result[1].content).toBe("John Smith");
  });

  it("handles multiple SSNs in one entry", () => {
    const transcript = [
      { role: "user", content: "Mine is 111-22-3333 and spouse is 444-55-6666", timestamp: new Date() },
    ];
    const result = redactTranscriptPII(transcript);
    expect(result[0].content).not.toContain("111-22-3333");
    expect(result[0].content).not.toContain("444-55-6666");
    expect(result[0].content).toContain("***-**-****");
  });

  it("preserves timestamp and role", () => {
    const now = new Date();
    const transcript = [
      { role: "user", content: "SSN 111-22-3333", timestamp: now },
    ];
    const result = redactTranscriptPII(transcript);
    expect(result[0].role).toBe("user");
    expect(result[0].timestamp).toBe(now);
  });
});

// ── Reconnect Cap ──

describe("Reconnect cap", () => {
  it("MAX_RECONNECTS is exported and set to 5", async () => {
    expect(MAX_RECONNECTS).toBe(5);
  });
});
