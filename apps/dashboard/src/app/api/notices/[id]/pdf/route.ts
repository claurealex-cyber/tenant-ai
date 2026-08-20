import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateNoticePdf } from "@/lib/notice-pdf";

/**
 * GET /api/notices/[id]/pdf — download notice as PDF.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const notice = await prisma.notice.findUnique({
      where: { id },
      include: {
        tenant: true,
        lease: {
          include: {
            unit: {
              include: {
                property: { select: { id: true, name: true, address: true, userId: true } },
              },
            },
          },
        },
      },
    });

    if (!notice || notice.lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Notice not found" }, { status: 404 });
    }

    const pdfBuffer = await generateNoticePdf(notice.content);

    const typeLabel = notice.type.replace("_", "-");
    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="notice-${typeLabel}-${notice.id}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[notices] PDF generation error:", err);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
