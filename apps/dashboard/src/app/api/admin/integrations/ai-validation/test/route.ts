import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveConfig } from "@tenant-ai/shared";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Try dedicated key first, fall back to main OpenAI key
    const dedicatedKey = await resolveConfig("ai_validation", "api_key");
    const apiKey = dedicatedKey || await resolveConfig("openai", "api_key");

    if (!apiKey) {
      return NextResponse.json({
        connected: false,
        message: "No API key configured (checked AI Validation and OpenAI)",
      });
    }

    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      const source = dedicatedKey ? "AI Validation" : "OpenAI (fallback)";
      return NextResponse.json({
        connected: true,
        message: `Connected using ${source} API key`,
      });
    }

    return NextResponse.json({
      connected: false,
      message: `OpenAI API error: ${res.status}`,
    });
  } catch (error: any) {
    return NextResponse.json({
      connected: false,
      message: error.message || "Connection failed",
    });
  }
}
