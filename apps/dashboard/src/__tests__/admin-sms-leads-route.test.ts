import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockGetSmsLeads = vi.fn();
vi.mock("@/lib/sms-leads", () => ({
  getSmsLeads: (...args: any[]) => mockGetSmsLeads(...args),
}));

import { GET } from "../app/api/admin/sms-leads/route";

function req(qs = "") {
  return new NextRequest(`http://x/api/admin/sms-leads${qs}`);
}

beforeEach(() => {
  mockGetServerSession.mockReset().mockResolvedValue({ user: { role: "admin" } });
  mockGetSmsLeads.mockReset().mockResolvedValue({ rows: [], counts: {} });
});

describe("admin/sms-leads route", () => {
  it("rejects non-admins", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "client" } });
    expect((await GET(req())).status).toBe(403);
    mockGetServerSession.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(403);
    expect(mockGetSmsLeads).not.toHaveBeenCalled();
  });

  it("passes only sanctioned, valid filter values through", async () => {
    const res = await GET(req("?origin=zillow&linkKind=google_form&state=applied&includeTenants=true&evil=x"));
    expect(res.status).toBe(200);
    expect(mockGetSmsLeads).toHaveBeenCalledWith({
      origin: "zillow",
      linkKind: "google_form",
      state: "applied",
      includeTenants: true,
    });
  });

  it("drops invalid filter values instead of forwarding them", async () => {
    await GET(req("?origin=DROP%20TABLE&linkKind=nope&state=weird"));
    expect(mockGetSmsLeads).toHaveBeenCalledWith({
      origin: undefined,
      linkKind: undefined,
      state: undefined,
      includeTenants: false,
    });
  });

  it("500s cleanly when the lib throws", async () => {
    mockGetSmsLeads.mockRejectedValue(new Error("db down"));
    expect((await GET(req())).status).toBe(500);
  });
});
