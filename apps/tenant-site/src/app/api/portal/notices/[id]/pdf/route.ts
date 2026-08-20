import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";

/**
 * GET /api/portal/notices/[id]/pdf — download notice as PDF (tenant portal).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
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
              property: { select: { name: true, address: true } },
            },
          },
        },
      },
    },
  });

  if (!notice || notice.tenantId !== session.tenant.id || !notice.visibleInPortal) {
    return NextResponse.json({ error: "Notice not found" }, { status: 404 });
  }

  const pdfBuffer = await generateNoticePdf(notice);

  const typeLabel = notice.type.replace("_", "-");
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="notice-${typeLabel}-${notice.id}.pdf"`,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateNoticePdf(notice: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Render full content faithfully — no skipping lines
    const lines = (notice.content || "").split("\n");
    doc.fontSize(11).font("Helvetica");
    for (const line of lines) {
      if (line.trim() === "") {
        doc.moveDown(0.5);
      } else {
        doc.text(line);
      }
    }

    doc.moveDown(2);
    doc
      .fontSize(8)
      .font("Helvetica-Oblique")
      .text(
        "This notice is provided as a legal document. It must be physically served to the tenant in accordance with Illinois law. Electronic delivery alone does not constitute valid service.",
        { align: "center" }
      );

    doc.end();
  });
}
