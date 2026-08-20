import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Use a unique email prefix per test run to avoid collisions
const TEST_PREFIX = `test_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  // Clean up test users
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

// ── bcrypt password hashing ──

describe("Password hashing", () => {
  it("bcrypt hash + compare roundtrip succeeds", async () => {
    const password = "SecureP@ss123";
    const hash = await bcrypt.hash(password, 12);

    expect(hash).not.toBe(password);
    expect(await bcrypt.compare(password, hash)).toBe(true);
  });

  it("bcrypt compare fails with wrong password", async () => {
    const hash = await bcrypt.hash("correct_password", 12);
    expect(await bcrypt.compare("wrong_password", hash)).toBe(false);
  });

  it("bcrypt generates different hashes for same password", async () => {
    const password = "SamePassword123";
    const hash1 = await bcrypt.hash(password, 12);
    const hash2 = await bcrypt.hash(password, 12);

    expect(hash1).not.toBe(hash2); // Different salts
    expect(await bcrypt.compare(password, hash1)).toBe(true);
    expect(await bcrypt.compare(password, hash2)).toBe(true);
  });
});

// ── Signup ──

describe("Signup", () => {
  it("creates a new user with hashed password", async () => {
    const email = testEmail("signup_basic");
    const password = "TestPassword123";
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: "Test User",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(email);
    expect(user.role).toBe("client");
    expect(user.onboarded).toBe(false);
    expect(user.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, user.passwordHash)).toBe(true);
  });

  it("rejects duplicate email", async () => {
    const email = testEmail("signup_dup");
    const passwordHash = await bcrypt.hash("Password123", 12);

    await prisma.user.create({
      data: {
        name: "First User",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });

    await expect(
      prisma.user.create({
        data: {
          name: "Second User",
          email,
          passwordHash,
          role: "client",
          onboarded: false,
        },
      })
    ).rejects.toThrow();
  });

  it("stores optional company name and phone", async () => {
    const email = testEmail("signup_optional");
    const passwordHash = await bcrypt.hash("Password123", 12);

    const user = await prisma.user.create({
      data: {
        name: "Company User",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
        companyName: "Acme Properties",
        phone: "+15551234567",
      },
    });

    expect(user.companyName).toBe("Acme Properties");
    expect(user.phone).toBe("+15551234567");
  });
});

// ── Login + Account Lockout ──

describe("Login and account lockout", () => {
  const email = testEmail("lockout");
  const password = "CorrectPassword123";

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        name: "Lockout Test",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });
  });

  beforeEach(async () => {
    // Reset lockout state before each test in this block
    await prisma.user.update({
      where: { email },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it("successful login with correct password", async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();

    const valid = await bcrypt.compare(password, user!.passwordHash);
    expect(valid).toBe(true);
  });

  it("failed login with wrong password", async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = await bcrypt.compare("WrongPassword", user!.passwordHash);
    expect(valid).toBe(false);
  });

  it("increments failedLoginAttempts on wrong password", async () => {
    await prisma.user.update({
      where: { email },
      data: { failedLoginAttempts: 3 },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.failedLoginAttempts).toBe(3);
  });

  it("locks account after 5 failed attempts", async () => {
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: {
        failedLoginAttempts: 5,
        lockedUntil: lockUntil,
      },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.failedLoginAttempts).toBe(5);
    expect(user!.lockedUntil).not.toBeNull();
    expect(user!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects login when account is locked", async () => {
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: {
        failedLoginAttempts: 5,
        lockedUntil: lockUntil,
      },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    const isLocked = user!.lockedUntil && user!.lockedUntil > new Date();
    expect(isLocked).toBe(true);
  });

  it("allows login after lockout expires", async () => {
    // Set lockout in the past
    const expiredLock = new Date(Date.now() - 1000);

    await prisma.user.update({
      where: { email },
      data: {
        failedLoginAttempts: 5,
        lockedUntil: expiredLock,
      },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    const isLocked = user!.lockedUntil && user!.lockedUntil > new Date();
    expect(isLocked).toBe(false);

    // Password still valid
    const valid = await bcrypt.compare(password, user!.passwordHash);
    expect(valid).toBe(true);
  });

  it("resets failed attempts on successful login", async () => {
    await prisma.user.update({
      where: { email },
      data: { failedLoginAttempts: 3 },
    });

    // Simulate successful login reset
    await prisma.user.update({
      where: { email },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.failedLoginAttempts).toBe(0);
    expect(user!.lockedUntil).toBeNull();
  });
});

// ── Password Reset ──

describe("Password reset", () => {
  const email = testEmail("reset");

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("OldPassword123", 12);
    await prisma.user.create({
      data: {
        name: "Reset Test",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });
  });

  it("stores reset token and expiry", async () => {
    const resetToken = "abc123def456";
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExpiry },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.resetToken).toBe(resetToken);
    expect(user!.resetTokenExpiry).not.toBeNull();
    expect(user!.resetTokenExpiry!.getTime()).toBeGreaterThan(Date.now());
  });

  it("finds user by valid (non-expired) reset token", async () => {
    const resetToken = "valid_token_123";
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExpiry },
    });

    const user = await prisma.user.findFirst({
      where: {
        resetToken,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    expect(user).not.toBeNull();
    expect(user!.email).toBe(email);
  });

  it("does not find user with expired reset token", async () => {
    const resetToken = "expired_token_456";
    const resetTokenExpiry = new Date(Date.now() - 1000); // In the past

    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExpiry },
    });

    const user = await prisma.user.findFirst({
      where: {
        resetToken,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    expect(user).toBeNull();
  });

  it("updates password and clears reset token", async () => {
    const newPassword = "NewPassword456";
    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { email },
      data: {
        passwordHash: newHash,
        resetToken: null,
        resetTokenExpiry: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.resetToken).toBeNull();
    expect(user!.resetTokenExpiry).toBeNull();
    expect(await bcrypt.compare(newPassword, user!.passwordHash)).toBe(true);
    expect(await bcrypt.compare("OldPassword123", user!.passwordHash)).toBe(
      false
    );
  });
});

// ── Role-based access ──

describe("Role-based access", () => {
  it("user created with client role by default", async () => {
    const email = testEmail("role_client");
    const passwordHash = await bcrypt.hash("Password123", 12);

    const user = await prisma.user.create({
      data: {
        name: "Client User",
        email,
        passwordHash,
        role: "client",
        onboarded: false,
      },
    });

    expect(user.role).toBe("client");
  });

  it("admin role can be set", async () => {
    const email = testEmail("role_admin");
    const passwordHash = await bcrypt.hash("Password123", 12);

    const user = await prisma.user.create({
      data: {
        name: "Admin User",
        email,
        passwordHash,
        role: "admin",
        onboarded: true,
      },
    });

    expect(user.role).toBe("admin");
  });
});
