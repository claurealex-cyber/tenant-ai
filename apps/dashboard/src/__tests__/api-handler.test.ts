import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "../lib/api-handler";

describe("apiHandler", () => {
  it("returns original response when handler succeeds", async () => {
    const handler = apiHandler(async () => {
      return NextResponse.json({ ok: true });
    });

    const req = new NextRequest("http://localhost/test");
    const res = await handler(req, {});
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("returns JSON 500 when handler throws", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const handler = apiHandler(async () => {
      throw new Error("Database connection failed");
    });

    const req = new NextRequest("http://localhost/test");
    const res = await handler(req, {});
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("Internal server error");
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("returns JSON content type on error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const handler = apiHandler(async () => {
      throw new Error("Unexpected");
    });

    const req = new NextRequest("http://localhost/test");
    const res = await handler(req, {});

    expect(res.headers.get("content-type")).toContain("application/json");

    vi.restoreAllMocks();
  });

  it("logs the error to console.error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const handler = apiHandler(async () => {
      throw new Error("Test error");
    });

    const req = new NextRequest("http://localhost/test");
    await handler(req, {});

    expect(consoleSpy).toHaveBeenCalledWith(
      "API route error:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("does not leak error details to the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const handler = apiHandler(async () => {
      throw new Error("Secret database credentials exposed");
    });

    const req = new NextRequest("http://localhost/test");
    const res = await handler(req, {});
    const data = await res.json();

    expect(data.error).toBe("Internal server error");
    expect(JSON.stringify(data)).not.toContain("Secret");
    expect(JSON.stringify(data)).not.toContain("database");

    vi.restoreAllMocks();
  });

  it("passes request and context to the handler", async () => {
    const mockFn = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const handler = apiHandler(mockFn);

    const req = new NextRequest("http://localhost/test");
    const ctx = { params: { id: "123" } };
    await handler(req, ctx);

    expect(mockFn).toHaveBeenCalledWith(req, ctx);
  });
});
