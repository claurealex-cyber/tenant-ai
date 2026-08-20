// Set encryption key BEFORE any imports that use it
process.env.PII_ENCRYPTION_KEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { decrypt } from "@tenant-ai/shared";

// ── Mock prisma ─────────────────────────────────────────────────────────────
const mockPropertyFindUnique = vi.fn();
const mockApplicationFindFirst = vi.fn();
const mockApplicationCreate = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    property: {
      findUnique: (...args: any[]) => mockPropertyFindUnique(...args),
    },
    application: {
      findFirst: (...args: any[]) => mockApplicationFindFirst(...args),
      create: (...args: any[]) => mockApplicationCreate(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
  },
}));

// Mock sendEmail
const mockSendEmail = vi.fn();
vi.mock("@tenant-ai/shared", async () => {
  const actual = await vi.importActual<typeof import("@tenant-ai/shared")>("@tenant-ai/shared");
  return {
    ...actual,
    sendEmail: (...args: any[]) => mockSendEmail(...args),
  };
});

// ── Mock tenant-context ─────────────────────────────────────────────────────
const mockResolveTenantContext = vi.fn();

vi.mock("@/lib/tenant-context", () => ({
  resolveTenantContext: (...args: any[]) => mockResolveTenantContext(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const MOCK_CONTEXT = {
  userId: "landlord-apply-001",
  subdomain: "apply-test",
  companyName: "Apply Test LLC",
  primaryColor: "#000000",
};

const VALID_PROPERTY = {
  id: "prop-apply-1",
  userId: "landlord-apply-001",
  isActive: true,
  name: "Apply Test Property",
};

function makeApplyRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://apply-test.tenantai.com/api/apply", {
    method: "POST",
    headers: { "x-tenant-host": "apply-test.tenantai.com" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/apply
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/apply — web rental application submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTenantContext.mockResolvedValue(MOCK_CONTEXT);
    mockPropertyFindUnique.mockResolvedValue(VALID_PROPERTY);
    mockApplicationFindFirst.mockResolvedValue(null); // no duplicate by default
    mockUserFindUnique.mockResolvedValue({
      email: "landlord@test.com",
      name: "Test Landlord",
    });
    mockSendEmail.mockResolvedValue(undefined);
  });

  it("creates application with standard fields and returns 201", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-new-1",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "John Doe",
      email: "john@example.com",
      monthlyIncome: "5000",
      employer: "Tech Corp",
      employerPhone: "+13125551234",
      currentAddress: "100 Main St, Chicago IL",
      moveInDate: "2026-03-01",
      hasPets: false,
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.applicationId).toBe("app-new-1");
    expect(data.status).toBe("completed");

    // Verify create was called with correct data
    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.propertyId).toBe("prop-apply-1");
    expect(createCall.data.status).toBe("completed");
    expect(createCall.data.channel).toBe("web");
    expect(createCall.data.fullName).toBe("John Doe");
    expect(createCall.data.email).toBe("john@example.com");
    expect(createCall.data.monthlyIncome).toBe("5000");
    expect(createCall.data.employer).toBe("Tech Corp");
    expect(createCall.data.employerPhone).toBe("+13125551234");
    expect(createCall.data.moveInDate).toBe("2026-03-01");
    expect(createCall.data.hasPets).toBe(false);
    expect(createCall.data.completedAt).toBeInstanceOf(Date);
  });

  it("encrypts SSN before storing", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-ssn",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Jane Smith",
      email: "jane@example.com",
      ssn: "123-45-6789",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    // SSN should be encrypted, not plaintext
    expect(createCall.data.ssn).not.toBe("123-45-6789");
    expect(createCall.data.ssn).toMatch(/^v1:/);
    // Should decrypt back to the original
    expect(decrypt(createCall.data.ssn)).toBe("123-45-6789");
  });

  it("encrypts DOB before storing", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-dob",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Jane Smith",
      email: "jane@example.com",
      dateOfBirth: "1990-05-15",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.dateOfBirth).not.toBe("1990-05-15");
    expect(createCall.data.dateOfBirth).toMatch(/^v1:/);
    expect(decrypt(createCall.data.dateOfBirth)).toBe("1990-05-15");
  });

  it("encrypts both SSN and DOB when both provided", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-both-pii",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Both PII",
      email: "both@example.com",
      ssn: "987-65-4321",
      dateOfBirth: "1985-12-25",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(decrypt(createCall.data.ssn)).toBe("987-65-4321");
    expect(decrypt(createCall.data.dateOfBirth)).toBe("1985-12-25");
  });

  it("stores custom responses for screening questions", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-custom",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Custom User",
      email: "custom@example.com",
      // Custom (non-standard) fields
      felonies: "no",
      smoker: "no",
      reasonForMoving: "Job relocation",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.customResponses).toEqual({
      felonies: "no",
      smoker: "no",
      reasonForMoving: "Job relocation",
    });
  });

  it("does not set customResponses when no custom fields provided", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-no-custom",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Standard Only",
      email: "standard@example.com",
      employer: "Standard Corp",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.customResponses).toBeUndefined();
  });

  it("returns 400 when propertyId is missing", async () => {
    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      fullName: "No Property",
      email: "noprop@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("propertyId");
  });

  it("returns 404 when property does not exist", async () => {
    mockPropertyFindUnique.mockResolvedValue(null);

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "nonexistent-prop",
      fullName: "Ghost",
      email: "ghost@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns 404 when property belongs to different landlord", async () => {
    mockPropertyFindUnique.mockResolvedValue({
      ...VALID_PROPERTY,
      userId: "different-landlord",
    });

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Wrong Landlord",
      email: "wrong@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns 404 when property is inactive", async () => {
    mockPropertyFindUnique.mockResolvedValue({
      ...VALID_PROPERTY,
      isActive: false,
    });

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Inactive Prop",
      email: "inactive@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Property not found");
  });

  it("returns 404 when tenant context cannot be resolved", async () => {
    mockResolveTenantContext.mockResolvedValue(null);

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "No Context",
      email: "nocontext@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Website not found");
  });

  it("returns 409 for duplicate application within 30 days", async () => {
    mockApplicationFindFirst.mockResolvedValue({
      id: "existing-app",
      propertyId: "prop-apply-1",
      email: "duplicate@example.com",
      status: "completed",
      completedAt: new Date(),
    });

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Duplicate User",
      email: "duplicate@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already have a recent application");
  });

  it("checks duplicate with correct 30-day window", async () => {
    mockApplicationFindFirst.mockResolvedValue(null);
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-dup-check",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Dup Check",
      email: "dupcheck@example.com",
    });

    const beforeTime = Date.now();
    await POST(req);

    // Verify the duplicate check query
    const findCall = mockApplicationFindFirst.mock.calls[0][0];
    expect(findCall.where.propertyId).toBe("prop-apply-1");
    expect(findCall.where.email).toBe("dupcheck@example.com");
    expect(findCall.where.status).toBe("completed");
    expect(findCall.where.completedAt.gte).toBeInstanceOf(Date);

    // The gte date should be approximately 30 days ago
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const gteTime = findCall.where.completedAt.gte.getTime();
    expect(gteTime).toBeLessThanOrEqual(beforeTime - thirtyDaysMs + 5000);
    expect(gteTime).toBeGreaterThanOrEqual(beforeTime - thirtyDaysMs - 5000);
  });

  it("always sets channel to 'web'", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-channel",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Channel Test",
      email: "channel@example.com",
    });

    await POST(req);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.channel).toBe("web");
  });

  it("handles application without SSN or DOB gracefully", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-no-pii",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "No PII",
      email: "nopii@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.ssn).toBeUndefined();
    expect(createCall.data.dateOfBirth).toBeUndefined();
  });

  it("maps phone field to callerPhone", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-phone",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Phone Test",
      email: "phone@example.com",
      phone: "+13125559999",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.callerPhone).toBe("+13125559999");
  });

  it("converts vehicles string to JSON array", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-vehicle",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Vehicle Test",
      email: "vehicle@example.com",
      vehicles: "2020 Honda Civic (ABC123)",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.vehicles).toEqual([
      { year: "2020", makeModel: "Honda Civic", licensePlate: "ABC123" },
    ]);
  });

  it("stores unparseable vehicles as description fallback", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-vehicle-raw",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Vehicle Raw Test",
      email: "vehicleraw@example.com",
      vehicles: "blue sedan",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.vehicles).toEqual([{ description: "blue sedan" }]);
  });

  it("sends landlord notification email after web application", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-notify",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Notify Test",
      email: "notify@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // sendEmail should have been called to notify landlord
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendEmail.mock.calls[0][0];
    expect(emailCall.to).toBe("landlord@test.com");
    expect(emailCall.subject).toContain("Apply Test Property");
  });

  // ── CAPTCHA / Turnstile Tests ─────────────────────────────────────────────

  it("without TURNSTILE_SECRET_KEY, submission works without token", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-no-captcha",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "No Captcha",
      email: "nocaptcha@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("with TURNSTILE_SECRET_KEY set, returns 400 when token missing", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Missing Token",
      email: "missingtoken@example.com",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("CAPTCHA");

    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("with TURNSTILE_SECRET_KEY set, returns 400 when token is invalid", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    // Mock global fetch to intercept the Turnstile verification call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false }),
    }) as any;

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Invalid Token",
      email: "invalidtoken@example.com",
      turnstileToken: "bad-token",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("CAPTCHA");

    globalThis.fetch = originalFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("with TURNSTILE_SECRET_KEY set, allows submission when token is valid", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    }) as any;

    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-valid-captcha",
      ...data,
    }));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Valid Captcha",
      email: "validcaptcha@example.com",
      turnstileToken: "valid-token-abc",
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify the turnstileToken was NOT saved in the application data
    const createCall = mockApplicationCreate.mock.calls[0][0];
    expect(createCall.data.customResponses).toBeUndefined();

    globalThis.fetch = originalFetch;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("does not fail when landlord notification email fails", async () => {
    mockApplicationCreate.mockImplementation(({ data }: any) => ({
      id: "app-notify-fail",
      ...data,
    }));
    mockSendEmail.mockRejectedValue(new Error("SMTP error"));

    const { POST } = await import("../app/api/apply/route");

    const req = makeApplyRequest({
      propertyId: "prop-apply-1",
      fullName: "Notify Fail Test",
      email: "notifyfail@example.com",
    });

    const res = await POST(req);
    // Should still succeed even if email fails
    expect(res.status).toBe(201);
  });
});
