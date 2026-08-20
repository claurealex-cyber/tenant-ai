import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendNoticeSms } from "@/lib/notice-sms";

/**
 * POST /api/notices/[id]/sms — send or re-send SMS for a notice.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify ownership
    const notice = await prisma.notice.findUnique({
      where: { id },
      include: {
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { userId: true } },
              },
            },
          },
        },
      },
    });

    if (!notice || notice.lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 });
    }

    const result = await sendNoticeSms(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      sid: result.sid,
      smsSentAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[notices] SMS send error:", err);
    return NextResponse.json({ error: "Failed to send SMS" }, { status: 500 });
  }
}
