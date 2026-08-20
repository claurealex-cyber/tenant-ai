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

const mockResolveConfig = vi.fn();
vi.mock("@tenant-ai/shared", () => ({
  resolveConfig: (...args: any[]) => mockResolveConfig(...args),
}));

import { POST } from "../app/api/notices/ai-rewrite/route";

describe("POST /api/notices/ai-rewrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/notices/ai-rewrite", {
      method: "POST",
      body: JSON.stringify({ content: "test", noticeType: "five_day" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when content is missing", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });

    const req = new NextRequest("http://localhost/api/notices/ai-rewrite", {
      method: "POST",
      body: JSON.stringify({ noticeType: "five_day" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("content and noticeType are required");
  });

  it("returns 400 when noticeType is missing", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });

    const req = new NextRequest("http://localhost/api/notices/ai-rewrite", {
      method: "POST",
      body: JSON.stringify({ content: "Some notice content" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("content and noticeType are required");
  });

  it("returns original content with prefix when no API key (dev mode)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockResolveConfig.mockResolvedValue(null);

    const content = "Pay your rent or face eviction.";
    const req = new NextRequest("http://localhost/api/notices/ai-rewrite", {
      method: "POST",
      body: JSON.stringify({ content, noticeType: "five_day" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rewrittenContent).toBe(
      `[AI Rewrite unavailable – configure OpenAI key in Admin > Integrations]\n\n${content}`
    );
  });

  it("returns rewritten content from OpenAI on success", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockResolveConfig.mockResolvedValue("sk-test-key");

    const rewritten = "Professional rewritten notice content.";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: rewritten } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest("http://localhost/api/notices/ai-rewrite", {
      method: "POST",
      body: JSON.stringify({
        content: "Pay your rent.",
        noticeType: "five_day",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rewrittenContent).toBe(rewritten);

    // Verify fetch was called with correct OpenAI endpoint and auth header
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer sk-test-key");
  });

  it("returns 502 when OpenAI returns an error", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1" } });
    mockResolveConfig.mockResolvedValue("sk-test-key");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest("http://localhost/api/notices/ai-rewrite", {
      method: "POST",
      body: JSON.stringify({
        content: "Pay your rent.",
        noticeType: "five_day",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("AI rewrite failed");
  });
});
