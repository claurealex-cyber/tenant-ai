import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/survey/[token] — validate an SMS survey invite and return the minimal
 * info the apply form needs (property + phone prefill). Public endpoint.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const invite = await prisma.surveyInvite.findUnique({
      where: { token },
      include: { property: { select: { id: true, name: true, isActive: true } } },
    });

    if (!invite || !invite.property?.isActive) {
      return NextResponse.json({ valid: false, reason: "not_found" }, { status: 404 });
    }
    if (invite.usedAt) {
      return NextResponse.json({ valid: false, reason: "used" }, { status: 410 });
    }
    if (invite.expiresAt < new Date()) {
      return NextResponse.json({ valid: false, reason: "expired" }, { status: 410 });
    }

    return NextResponse.json({
      valid: true,
      propertyId: invite.propertyId,
      propertyName: invite.property.name,
      phone: invite.phone,
    });
  } catch (err) {
    console.error("Survey lookup error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
