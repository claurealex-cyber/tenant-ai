import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

const mockNoticeFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notice: {
      findUnique: (...args: any[]) => mockNoticeFindUnique(...args),
    },
  },
}));

// Mock pdfkit
vi.mock("pdfkit", () => {
  const EventEmitter = require("events");
  return {
    default: class MockPDFDocument extends EventEmitter {
      constructor() {
        super();
      }
      fontSize() { return this; }
      font() { return this; }
      text() { return this; }
      moveDown() { return this; }
      moveTo() { return this; }
      lineTo() { return this; }
      stroke() { return this; }
      fillColor() { return this; }
      end() {
        // Emit some data and then end
        this.emit("data", Buffer.from("%PDF-mock"));
        this.emit("end");
      }
    },
  };
});

import { GET } from "../app/api/notices/[id]/pdf/route";

describe("GET /api/notices/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeParams = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/notices/n1/pdf");
    const res = await GET(req, makeParams("n1"));

    expect(res.status).toBe(401);
  });

  it("returns 404 when notice not found", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockNoticeFindUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/notices/n1/pdf");
    const res = await GET(req, makeParams("n1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when notice belongs to different user", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockNoticeFindUnique.mockResolvedValue({
      id: "n1",
      type: "five_day",
      content: "FIVE-DAY NOTICE\nDEMAND FOR PAYMENT OF RENT\n(Pursuant to 735 ILCS 5/9-209)\n\nTest content",
      lease: {
        unit: {
          property: { id: "p1", name: "Test", address: "123 Main", userId: "other-user" },
        },
      },
      tenant: { firstName: "John", lastName: "Doe" },
    });

    const req = new NextRequest("http://localhost/api/notices/n1/pdf");
    const res = await GET(req, makeParams("n1"));

    expect(res.status).toBe(404);
  });

  it("returns PDF with correct headers for valid request", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockNoticeFindUnique.mockResolvedValue({
      id: "n1",
      type: "five_day",
      content: "FIVE-DAY NOTICE\nDEMAND FOR PAYMENT OF RENT\n(Pursuant to 735 ILCS 5/9-209)\n\nTo: John Doe\nYou owe rent.",
      lease: {
        unit: {
          property: { id: "p1", name: "Oak Apartments", address: "123 Main St", userId: "u1" },
        },
      },
      tenant: { firstName: "John", lastName: "Doe" },
    });

    const req = new NextRequest("http://localhost/api/notices/n1/pdf");
    const res = await GET(req, makeParams("n1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("notice-five-day-n1.pdf");
  });

  it("generates correct filename for ten_day notice", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockNoticeFindUnique.mockResolvedValue({
      id: "n2",
      type: "ten_day",
      content: "TEN-DAY NOTICE\nNOTICE TO QUIT FOR LEASE VIOLATION\n(Pursuant to 735 ILCS 5/9-210)\n\nViolation text",
      lease: {
        unit: {
          property: { id: "p1", name: "Test", address: "123 Main", userId: "u1" },
        },
      },
      tenant: { firstName: "Jane", lastName: "Smith" },
    });

    const req = new NextRequest("http://localhost/api/notices/n2/pdf");
    const res = await GET(req, makeParams("n2"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("notice-ten-day-n2.pdf");
  });
});
