import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";

/**
 * GET /api/payments/[id]/receipt — download payment receipt PDF (landlord).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      tenant: true,
      lease: {
        include: {
          unit: {
            include: {
              property: {
                include: { user: { select: { name: true, companyName: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!payment || payment.lease.unit.property.userId !== session.user.id) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (payment.status !== "completed") {
    return NextResponse.json(
      { error: "Receipt is only available for completed payments" },
      { status: 400 }
    );
  }

  const pdfBuffer = await generateReceiptPdf(payment);

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${payment.id}.pdf"`,
    },
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMethod(method: string): string {
  const methods: Record<string, string> = {
    ach: "ACH Bank Transfer",
    card: "Credit/Debit Card",
    cash: "Cash",
    check: "Check",
  };
  return methods[method] || method;
}

function formatType(type: string): string {
  const types: Record<string, string> = {
    rent: "Rent Payment",
    late_fee: "Late Fee",
    security_deposit: "Security Deposit",
    other: "Other Payment",
  };
  return types[type] || type;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateReceiptPdf(payment: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "LETTER", margin: 72 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      doc.fontSize(20).font("Helvetica-Bold").text("PAYMENT RECEIPT", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica").text(`Receipt #: ${payment.id}`, { align: "center" });
      doc.moveDown(1.5);

      doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(1);

      // From
      const landlordName =
        payment.lease.unit.property.user.companyName ||
        payment.lease.unit.property.user.name ||
        "Property Owner";
      doc.fontSize(12).font("Helvetica-Bold").text("From:");
      doc.fontSize(11).font("Helvetica").text(landlordName);
      doc.text(payment.lease.unit.property.name);
      doc.text(payment.lease.unit.property.address);
      doc.moveDown(1);

      // To
      doc.fontSize(12).font("Helvetica-Bold").text("To:");
      doc.fontSize(11).font("Helvetica").text(`${payment.tenant.firstName} ${payment.tenant.lastName}`);
      if (payment.lease.unit.unitNumber) {
        doc.text(`Unit: ${payment.lease.unit.unitNumber}`);
      }
      doc.moveDown(1.5);

      doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(1);

      // Details
      const details: [string, string][] = [
        [
          "Payment Date:",
          payment.paidAt
            ? new Date(payment.paidAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : new Date(payment.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              }),
        ],
        ["Amount Paid:", formatCents(payment.amount)],
        ["Payment Type:", formatType(payment.type)],
        ["Payment Method:", formatMethod(payment.method)],
      ];

      if (payment.forMonth) {
        details.push([
          "Period Covered:",
          new Date(payment.forMonth).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          }),
        ]);
      }

      for (const [label, value] of details) {
        doc.fontSize(11).font("Helvetica-Bold").text(label, 72, doc.y, {
          continued: true,
          width: 150,
        });
        doc.font("Helvetica").text(`  ${value}`);
        doc.moveDown(0.3);
      }

      doc.moveDown(1.5);

      doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#666666")
        .text(
          "This receipt is generated electronically and serves as proof of payment.",
          { align: "center" }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
