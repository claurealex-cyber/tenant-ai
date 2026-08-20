import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_PREFIX = `test_maintenance_${Date.now()}`;

// --------------- Mocks ---------------

const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock("@tenant-ai/shared", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

const mockLeaseFindFirst = vi.fn();
const mockMaintenanceRequestCreate = vi.fn();
const mockMaintenanceRequestUpdate = vi.fn();
const mockMaintenanceRequestFindMany = vi.fn();

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    lease: {
      findFirst: (...args: any[]) => mockLeaseFindFirst(...args),
    },
    maintenanceRequest: {
      create: (...args: any[]) => mockMaintenanceRequestCreate(...args),
      update: (...args: any[]) => mockMaintenanceRequestUpdate(...args),
      findMany: (...args: any[]) => mockMaintenanceRequestFindMany(...args),
    },
  },
}));

import {
  createMaintenanceRequest,
  updateMaintenanceStatus,
  getMaintenanceRequestsForTenant,
} from "../services/maintenance-service.js";

// --------------- Helpers ---------------

const PROPERTY_ID = `${TEST_PREFIX}_prop_1`;
const TENANT_ID = `${TEST_PREFIX}_tenant_1`;
const REQUEST_ID = `${TEST_PREFIX}_req_1`;
const UNIT_ID = `${TEST_PREFIX}_unit_1`;

function makeFakeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    propertyId: PROPERTY_ID,
    tenantId: TENANT_ID,
    unitId: UNIT_ID,
    title: "Leaky faucet",
    description: "Kitchen faucet is dripping constantly",
    category: "plumbing",
    imageUrls: [],
    status: "open",
    createdAt: new Date("2025-06-01T12:00:00Z"),
    property: {
      name: "Oak Apartments",
      userId: "user-1",
      user: { email: "landlord@test.com" },
    },
    tenant: {
      firstName: "John",
      lastName: "Doe",
      email: "john@test.com",
    },
    ...overrides,
  };
}

// --------------- Tests ---------------

describe("maintenance-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== createMaintenanceRequest =====

  describe("createMaintenanceRequest", () => {
    it("creates request with correct data", async () => {
      mockLeaseFindFirst.mockResolvedValue({
        id: "lease-1",
        unitId: UNIT_ID,
        unit: { id: UNIT_ID, name: "Unit A" },
      });
      const fakeRequest = makeFakeRequest();
      mockMaintenanceRequestCreate.mockResolvedValue(fakeRequest);

      const data = {
        title: "Leaky faucet",
        description: "Kitchen faucet is dripping constantly",
        category: "plumbing",
        imageUrls: ["https://img.test/photo1.jpg"],
      };

      const result = await createMaintenanceRequest(PROPERTY_ID, TENANT_ID, data);

      expect(mockMaintenanceRequestCreate).toHaveBeenCalledWith({
        data: {
          propertyId: PROPERTY_ID,
          tenantId: TENANT_ID,
          unitId: UNIT_ID,
          title: "Leaky faucet",
          description: "Kitchen faucet is dripping constantly",
          category: "plumbing",
          imageUrls: ["https://img.test/photo1.jpg"],
        },
        include: {
          property: {
            select: {
              name: true,
              userId: true,
              user: { select: { email: true } },
            },
          },
          tenant: { select: { firstName: true, lastName: true, email: true } },
        },
      });

      expect(result).toEqual(fakeRequest);
    });

    it("looks up unit from active lease", async () => {
      mockLeaseFindFirst.mockResolvedValue({
        id: "lease-1",
        unitId: UNIT_ID,
        unit: { id: UNIT_ID, name: "Unit A" },
      });
      mockMaintenanceRequestCreate.mockResolvedValue(makeFakeRequest());

      await createMaintenanceRequest(PROPERTY_ID, TENANT_ID, {
        title: "Broken window",
        description: "Window won't close",
      });

      expect(mockLeaseFindFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, status: "active" },
        include: { unit: true },
      });

      // unitId from the lease should be passed to create
      const createCall = mockMaintenanceRequestCreate.mock.calls[0][0];
      expect(createCall.data.unitId).toBe(UNIT_ID);
    });

    it("sends landlord notification email", async () => {
      mockLeaseFindFirst.mockResolvedValue({
        id: "lease-1",
        unitId: UNIT_ID,
        unit: { id: UNIT_ID },
      });
      mockMaintenanceRequestCreate.mockResolvedValue(makeFakeRequest());

      await createMaintenanceRequest(PROPERTY_ID, TENANT_ID, {
        title: "Leaky faucet",
        description: "Kitchen faucet is dripping constantly",
        category: "plumbing",
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "landlord@test.com",
          subject: "New Maintenance Request - Oak Apartments",
        }),
      );

      const emailCall = mockSendEmail.mock.calls[0];
      expect(emailCall[0].html).toContain("Leaky faucet");
      expect(emailCall[0].html).toContain("John");
      expect(emailCall[0].html).toContain("plumbing");
    });

    it("handles no active lease gracefully (unitId null)", async () => {
      mockLeaseFindFirst.mockResolvedValue(null);
      const fakeRequest = makeFakeRequest({ unitId: null });
      mockMaintenanceRequestCreate.mockResolvedValue(fakeRequest);

      const result = await createMaintenanceRequest(PROPERTY_ID, TENANT_ID, {
        title: "No heat",
        description: "Heating system not working",
      });

      // When no lease found, unitId should be null
      const createCall = mockMaintenanceRequestCreate.mock.calls[0][0];
      expect(createCall.data.unitId).toBeNull();

      // Defaults category to "general" and imageUrls to []
      expect(createCall.data.category).toBe("general");
      expect(createCall.data.imageUrls).toEqual([]);

      expect(result.unitId).toBeNull();
    });

    it("defaults invalid category to general", async () => {
      mockLeaseFindFirst.mockResolvedValue({
        id: "lease-1",
        unitId: UNIT_ID,
        unit: { id: UNIT_ID, name: "Unit A" },
      });
      mockMaintenanceRequestCreate.mockImplementation((args: any) => {
        return Promise.resolve(makeFakeRequest({ category: args.data.category }));
      });

      await createMaintenanceRequest(PROPERTY_ID, TENANT_ID, {
        title: "Broken thing",
        description: "Something is broken",
        category: "invalid_category",
      });

      const createCall = mockMaintenanceRequestCreate.mock.calls[0][0];
      expect(createCall.data.category).toBe("general");
    });
  });

  // ===== updateMaintenanceStatus =====

  describe("updateMaintenanceStatus", () => {
    it("updates status", async () => {
      const fakeRequest = makeFakeRequest({ status: "in_progress" });
      mockMaintenanceRequestUpdate.mockResolvedValue(fakeRequest);

      const result = await updateMaintenanceStatus(REQUEST_ID, {
        status: "in_progress",
      });

      expect(mockMaintenanceRequestUpdate).toHaveBeenCalledWith({
        where: { id: REQUEST_ID },
        data: { status: "in_progress" },
        include: {
          property: { select: { name: true } },
          tenant: { select: { firstName: true, lastName: true, email: true } },
        },
      });

      expect(result.status).toBe("in_progress");
    });

    it("sets resolvedAt when status is completed", async () => {
      const fakeRequest = makeFakeRequest({ status: "completed" });
      mockMaintenanceRequestUpdate.mockResolvedValue(fakeRequest);

      const before = Date.now();
      await updateMaintenanceStatus(REQUEST_ID, { status: "completed" });
      const after = Date.now();

      const updateCall = mockMaintenanceRequestUpdate.mock.calls[0][0];
      expect(updateCall.data.status).toBe("completed");
      expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
      expect(updateCall.data.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(updateCall.data.resolvedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it("sets resolvedAt when status is closed", async () => {
      const fakeRequest = makeFakeRequest({ status: "closed" });
      mockMaintenanceRequestUpdate.mockResolvedValue(fakeRequest);

      const before = Date.now();
      await updateMaintenanceStatus(REQUEST_ID, { status: "closed" });
      const after = Date.now();

      const updateCall = mockMaintenanceRequestUpdate.mock.calls[0][0];
      expect(updateCall.data.status).toBe("closed");
      expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
      expect(updateCall.data.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(updateCall.data.resolvedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it("sends tenant notification on status change", async () => {
      const fakeRequest = makeFakeRequest({ status: "in_progress" });
      mockMaintenanceRequestUpdate.mockResolvedValue(fakeRequest);

      await updateMaintenanceStatus(REQUEST_ID, {
        status: "in_progress",
        notes: "Plumber scheduled for tomorrow",
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "john@test.com",
          subject: "Maintenance Update - Leaky faucet",
        }),
      );

      const emailCall = mockSendEmail.mock.calls[0];
      expect(emailCall[0].html).toContain("in progress");
      expect(emailCall[0].html).toContain("Plumber scheduled for tomorrow");
      expect(emailCall[0].html).toContain("Oak Apartments");
    });

    it("skips notification when tenant has no email", async () => {
      const fakeRequest = makeFakeRequest({
        status: "in_progress",
        tenant: { firstName: "John", lastName: "Doe", email: null },
      });
      mockMaintenanceRequestUpdate.mockResolvedValue(fakeRequest);

      await updateMaintenanceStatus(REQUEST_ID, { status: "in_progress" });

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("throws on invalid status", async () => {
      await expect(
        updateMaintenanceStatus(REQUEST_ID, { status: "xyz" }),
      ).rejects.toThrow("Invalid status: xyz");

      expect(mockMaintenanceRequestUpdate).not.toHaveBeenCalled();
    });

    it("throws on invalid priority", async () => {
      await expect(
        updateMaintenanceStatus(REQUEST_ID, { priority: "xyz" }),
      ).rejects.toThrow("Invalid priority: xyz");

      expect(mockMaintenanceRequestUpdate).not.toHaveBeenCalled();
    });
  });

  // ===== getMaintenanceRequestsForTenant =====

  describe("getMaintenanceRequestsForTenant", () => {
    it("returns open/in_progress requests ordered by createdAt desc", async () => {
      const fakeRequests = [
        { id: "req-2", status: "open", createdAt: new Date("2025-06-02T00:00:00Z") },
        { id: "req-1", status: "in_progress", createdAt: new Date("2025-06-01T00:00:00Z") },
      ];
      mockMaintenanceRequestFindMany.mockResolvedValue(fakeRequests);

      const result = await getMaintenanceRequestsForTenant(TENANT_ID);

      expect(mockMaintenanceRequestFindMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          status: { in: ["open", "in_progress"] },
        },
        orderBy: { createdAt: "desc" },
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("req-2");
      expect(result[1].id).toBe("req-1");
    });
  });
});
