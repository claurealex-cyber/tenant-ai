import { describe, it, expect, vi } from "vitest";
import { logAudit } from "../audit";

describe("logAudit", () => {
  it("creates an audit log record", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
    const mockPrisma = { auditLog: { create: mockCreate } };

    await logAudit(mockPrisma, {
      userId: "user-1",
      action: "test_action",
      resourceType: "TestResource",
      resourceId: "res-1",
      metadata: { key: "value" },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "test_action",
        resourceType: "TestResource",
        resourceId: "res-1",
        metadata: { key: "value" },
      },
    });
  });

  it("omits metadata when not provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: "audit-2" });
    const mockPrisma = { auditLog: { create: mockCreate } };

    await logAudit(mockPrisma, {
      userId: "user-1",
      action: "no_meta",
      resourceType: "TestResource",
      resourceId: "res-2",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "no_meta",
        resourceType: "TestResource",
        resourceId: "res-2",
        metadata: undefined,
      },
    });
  });

  it("does not throw when prisma.create fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockCreate = vi.fn().mockRejectedValue(new Error("DB error"));
    const mockPrisma = { auditLog: { create: mockCreate } };

    // Should not throw
    await logAudit(mockPrisma, {
      userId: "user-1",
      action: "fail_action",
      resourceType: "TestResource",
      resourceId: "res-3",
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[audit]"),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
