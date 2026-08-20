import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_forgot_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

// Mock sendEmail so we don't actually send emails
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  buildPasswordResetEmail: vi.fn().mockReturnValue("<html>reset</html>"),
}));

let userId: string;

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("existing"),
      name: "Forgot Test User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// Import the POST handler from the forgot-password route
import { POST } from "../app/api/auth/forgot-password/route";
import { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/auth/forgot-password", () => {
  it("returns 200 with valid existing email", async () => {
    const req = makeRequest({ email: testEmail("existing") });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain("If an account exists");
  });

  it("saves resetToken and resetTokenExpiry to User record", async () => {
    const req = makeRequest({ email: testEmail("existing") });
    await POST(req);

    const user = await prisma.user.findUnique({
      where: { email: testEmail("existing") },
    });

    expect(user!.resetToken).not.toBeNull();
    expect(user!.resetToken!.length).toBe(64); // 32 bytes = 64 hex chars
    expect(user!.resetTokenExpiry).not.toBeNull();
  });

  it("returns 200 for non-existent email (no enumeration)", async () => {
    const req = makeRequest({ email: "nonexistent_xyz@nowhere.com" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toContain("If an account exists");
  });

  it("does not set resetToken for non-existent email", async () => {
    // Make sure no user has this email with a resetToken
    const user = await prisma.user.findUnique({
      where: { email: "nonexistent_xyz@nowhere.com" },
    });

    expect(user).toBeNull();
  });

  it("sets resetTokenExpiry at least 30 minutes in the future", async () => {
    // Clear existing token first
    await prisma.user.update({
      where: { email: testEmail("existing") },
      data: { resetToken: null, resetTokenExpiry: null },
    });

    const req = makeRequest({ email: testEmail("existing") });
    await POST(req);

    const user = await prisma.user.findUnique({
      where: { email: testEmail("existing") },
    });

    const thirtyMinFromNow = new Date(Date.now() + 30 * 60 * 1000);
    expect(user!.resetTokenExpiry!.getTime()).toBeGreaterThan(
      thirtyMinFromNow.getTime()
    );
  });

  it("returns 400 when email is missing", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Email is required");
  });
});
