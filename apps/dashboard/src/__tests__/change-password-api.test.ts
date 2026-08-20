import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcrypt";

const mockSessionUser = { id: "user-pw-1", role: "client", email: "pw@test.com" };

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: mockSessionUser,
  }),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      update: (...args: any[]) => mockUserUpdate(...args),
    },
  },
}));

describe("Change Password API", () => {
  let storedHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    storedHash = await bcrypt.hash("OldPassword123", 12);
    mockUserFindUnique.mockResolvedValue({ passwordHash: storedHash });
    mockUserUpdate.mockResolvedValue({});
  });

  it("changes password with correct current password", async () => {
    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPassword123",
        newPassword: "NewPassword456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toContain("changed successfully");

    // Verify user.update was called with a hashed password
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockUserUpdate.mock.calls[0][0];
    expect(updateCall.where.id).toBe("user-pw-1");
    expect(updateCall.data.passwordHash).toBeDefined();
    // Verify the new hash is valid bcrypt
    const newHashValid = await bcrypt.compare("NewPassword456", updateCall.data.passwordHash);
    expect(newHashValid).toBe(true);
  });

  it("rejects wrong current password", async () => {
    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "WrongPassword",
        newPassword: "NewPassword456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("incorrect");

    // Should NOT have called update
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as any).mockResolvedValueOnce(null);

    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPassword123",
        newPassword: "NewPassword456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toContain("authenticated");
  });

  it("returns 400 when currentPassword is missing", async () => {
    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        newPassword: "NewPassword456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 when newPassword is missing", async () => {
    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPassword123",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns 400 when new password is too short", async () => {
    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPassword123",
        newPassword: "short",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("8 characters");
  });

  it("returns 400 when user record has no passwordHash", async () => {
    mockUserFindUnique.mockResolvedValue({ passwordHash: null });

    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPassword123",
        newPassword: "NewPassword456",
      }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("looks up user by session user id", async () => {
    const { PUT } = await import("../app/api/auth/change-password/route");

    const req = new NextRequest("http://localhost/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: "OldPassword123",
        newPassword: "NewPassword456",
      }),
    });

    await PUT(req);

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-pw-1" },
      })
    );
  });
});
