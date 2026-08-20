import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/notices/ai-rewrite — rewrite notice content using AI.
 *
 * Body: { content: string, noticeType: string, instructions?: string }
 * Returns: { rewrittenContent: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { content?: string; noticeType?: string; instructions?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { content, noticeType, instructions } = body;

    if (!content || !noticeType) {
      return NextResponse.json(
        { error: "content and noticeType are required" },
        { status: 400 }
      );
    }

    const { resolveConfig } = await import("@tenant-ai/shared");
    const apiKey = await resolveConfig("openai", "api_key");

    if (!apiKey) {
      return NextResponse.json({
        rewrittenContent: `[AI Rewrite unavailable – configure OpenAI key in Admin > Integrations]\n\n${content}`,
      });
    }

    const systemPrompt = `You are a legal document assistant specializing in Illinois landlord-tenant law. Your task is to rewrite notice content to be clearer and more professional.

Rules:
- Preserve ALL required legal elements (statute references, deadlines, tenant rights)
- Keep the same structure (TO, address, body, date, signature sections)
- Make the language clearer and more professional
- Never fabricate legal citations or invent requirements not in the original
- Never add or remove legal obligations
- Return ONLY the rewritten notice text, no explanations or commentary
${instructions ? `\nAdditional instructions from the landlord: ${instructions}` : ""}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Rewrite this ${noticeType.replace("_", "-")} notice:\n\n${content}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[ai-rewrite] OpenAI error:", errText);

      // Parse OpenAI error for user-friendly message
      let detail = "AI rewrite failed";
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.message) {
          detail = parsed.error.message;
        }
      } catch { /* use default */ }

      return NextResponse.json(
        { error: detail },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rewrittenContent =
      data.choices?.[0]?.message?.content?.trim() || content;

    return NextResponse.json({ rewrittenContent });
  } catch (err) {
    console.error("[ai-rewrite] Error:", err);
    return NextResponse.json(
      { error: "AI rewrite failed. Please try again." },
      { status: 500 }
    );
  }
}
