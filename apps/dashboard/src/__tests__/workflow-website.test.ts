import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { NextRequest } from "next/server";

const prisma = new PrismaClient();
const TEST_PREFIX = `test_website_${Date.now()}`;

function testEmail(name: string) {
  return `${TEST_PREFIX}_${name}@test.com`;
}

let userId: string;
let otherUserId: string;

// ── Mocks ──

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new PrismaClient(),
}));

function mockSession(id: string) {
  mockGetServerSession.mockResolvedValue({
    user: { id, role: "client", email: testEmail("user") },
  });
}

function mockNoSession() {
  mockGetServerSession.mockResolvedValue(null);
}

beforeAll(async () => {
  await prisma.$connect();

  const user = await prisma.user.create({
    data: {
      email: testEmail("user"),
      name: "Website Test User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: {
      email: testEmail("other"),
      name: "Other Website User",
      passwordHash: await bcrypt.hash("password123", 12),
      role: "client",
      onboarded: true,
    },
  });
  otherUserId = otherUser.id;
});

afterAll(async () => {
  await prisma.websiteConfig.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /api/website-config ──

describe("GET /api/website-config", () => {
  it("returns null config when none exists", async () => {
    mockSession(userId);

    const { GET } = await import("../app/api/website-config/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.config).toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { GET } = await import("../app/api/website-config/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ── POST /api/website-config ──

describe("POST /api/website-config", () => {
  it("creates website config with required fields", async () => {
    mockSession(userId);

    const { POST } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "POST",
      body: JSON.stringify({
        companyName: "Acme Rentals",
        subdomain: `${TEST_PREFIX}-acme`,
        primaryColor: "#ff0000",
        logoUrl: "https://example.com/logo.png",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.config.companyName).toBe("Acme Rentals");
    expect(data.config.subdomain).toBe(`${TEST_PREFIX}-acme`);
    expect(data.config.primaryColor).toBe("#ff0000");
    expect(data.config.logoUrl).toBe("https://example.com/logo.png");
    expect(data.config.userId).toBe(userId);
  });

  it("returns 409 when config already exists", async () => {
    mockSession(userId);

    const { POST } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "POST",
      body: JSON.stringify({
        companyName: "Duplicate",
        subdomain: `${TEST_PREFIX}-dup`,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("returns 400 when companyName is missing", async () => {
    mockSession(otherUserId);

    const { POST } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "POST",
      body: JSON.stringify({
        subdomain: `${TEST_PREFIX}-noname`,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("companyName");
  });

  it("enforces subdomain uniqueness", async () => {
    mockSession(otherUserId);

    const { POST } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "POST",
      body: JSON.stringify({
        companyName: "Other Co",
        subdomain: `${TEST_PREFIX}-acme`, // same subdomain as userId's config
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toContain("subdomain");
  });

  it("uses default primary color when not provided", async () => {
    mockSession(otherUserId);

    const { POST } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "POST",
      body: JSON.stringify({
        companyName: "Default Color Co",
        subdomain: `${TEST_PREFIX}-default`,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.config.primaryColor).toBe("#2563eb");
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { POST } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "POST",
      body: JSON.stringify({ companyName: "Test" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── PUT /api/website-config ──

describe("PUT /api/website-config", () => {
  it("updates website config fields", async () => {
    mockSession(userId);

    const { PUT } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "PUT",
      body: JSON.stringify({
        companyName: "Updated Rentals",
        primaryColor: "#00ff00",
        aboutText: "We are a rental company",
        contactEmail: "info@updated.com",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.config.companyName).toBe("Updated Rentals");
    expect(data.config.primaryColor).toBe("#00ff00");
    expect(data.config.aboutText).toBe("We are a rental company");
    expect(data.config.contactEmail).toBe("info@updated.com");
    // subdomain should remain unchanged
    expect(data.config.subdomain).toBe(`${TEST_PREFIX}-acme`);
  });

  it("rejects subdomain change to a taken subdomain", async () => {
    mockSession(userId);

    const { PUT } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "PUT",
      body: JSON.stringify({
        subdomain: `${TEST_PREFIX}-default`, // taken by otherUserId
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toContain("subdomain");
  });

  it("allows keeping the same subdomain", async () => {
    mockSession(userId);

    const { PUT } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "PUT",
      body: JSON.stringify({
        subdomain: `${TEST_PREFIX}-acme`, // same as current
        companyName: "Still Acme",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.config.subdomain).toBe(`${TEST_PREFIX}-acme`);
    expect(data.config.companyName).toBe("Still Acme");
  });

  it("returns 404 when no config exists", async () => {
    // Create a new user with no config
    const noConfigUser = await prisma.user.create({
      data: {
        email: testEmail("noconfig"),
        name: "No Config User",
        passwordHash: await bcrypt.hash("password123", 12),
        role: "client",
        onboarded: true,
      },
    });

    mockSession(noConfigUser.id);

    const { PUT } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "PUT",
      body: JSON.stringify({ companyName: "Should Fail" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.error).toContain("No website config");

    // Cleanup
    await prisma.user.delete({ where: { id: noConfigUser.id } });
  });

  it("returns 401 when not authenticated", async () => {
    mockNoSession();

    const { PUT } = await import("../app/api/website-config/route");

    const req = new NextRequest("http://localhost/api/website-config", {
      method: "PUT",
      body: JSON.stringify({ companyName: "Test" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/website-config (after creation) ──

describe("GET /api/website-config (after creation)", () => {
  it("returns the existing config", async () => {
    mockSession(userId);

    const { GET } = await import("../app/api/website-config/route");
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.config).not.toBeNull();
    expect(data.config.companyName).toBe("Still Acme");
    expect(data.config.userId).toBe(userId);
  });
});
