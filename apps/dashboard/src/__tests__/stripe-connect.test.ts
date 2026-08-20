import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_stripeconnect_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let connectedUserId: string;

beforeAll(async () => {
  await prisma.$connect();

  // User without Stripe Connect
  const user = await prisma.user.create({
    data: {
      email: testEmail("nostripe"),
      name: "No Stripe User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  // User with Stripe Connect already set up
  const connectedUser = await prisma.user.create({
    data: {
      email: testEmail("connected"),
      name: "Connected User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
      stripeConnectAccountId: "acct_test_123",
      stripeOnboardingComplete: true,
    },
  });
  connectedUserId = connectedUser.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("Stripe Connect data model", () => {
  it("stores stripeConnectAccountId on user", async () => {
    const user = await prisma.user.findUnique({
      where: { id: connectedUserId },
    });

    expect(user!.stripeConnectAccountId).toBe("acct_test_123");
    expect(user!.stripeOnboardingComplete).toBe(true);
  });

  it("user without Connect has null accountId", async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    expect(user!.stripeConnectAccountId).toBeNull();
    expect(user!.stripeOnboardingComplete).toBe(false);
  });

  it("updates stripeConnectAccountId", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { stripeConnectAccountId: "acct_new_456" },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    expect(user!.stripeConnectAccountId).toBe("acct_new_456");

    // Reset
    await prisma.user.update({
      where: { id: userId },
      data: { stripeConnectAccountId: null },
    });
  });

  it("updates onboarding complete flag", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        stripeConnectAccountId: "acct_onboard_789",
        stripeOnboardingComplete: false,
      },
    });

    let user = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(user!.stripeOnboardingComplete).toBe(false);

    await prisma.user.update({
      where: { id: userId },
      data: { stripeOnboardingComplete: true },
    });

    user = await prisma.user.findUnique({
      where: { id: userId },
    });
    expect(user!.stripeOnboardingComplete).toBe(true);

    // Reset
    await prisma.user.update({
      where: { id: userId },
      data: { stripeConnectAccountId: null, stripeOnboardingComplete: false },
    });
  });

  it("connect status check: returns correct state for non-connected user", async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeConnectAccountId: true,
        stripeOnboardingComplete: true,
      },
    });

    // Mimic what the GET route does
    const connected = !!user?.stripeConnectAccountId;
    expect(connected).toBe(false);
  });

  it("connect status check: returns correct state for connected user", async () => {
    const user = await prisma.user.findUnique({
      where: { id: connectedUserId },
      select: {
        stripeConnectAccountId: true,
        stripeOnboardingComplete: true,
      },
    });

    const connected = !!user?.stripeConnectAccountId;
    expect(connected).toBe(true);
    expect(user!.stripeOnboardingComplete).toBe(true);
  });
});
