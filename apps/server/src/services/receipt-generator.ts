/**
 * Payment receipt PDF generator.
 *
 * Illinois law requires rent receipts include:
 *  - Date of payment
 *  - Amount paid (formatted $X,XXX.XX)
 *  - Tenant full name
 *  - Landlord/company name
 *  - Property address
 *  - Payment method
 *  - Period covered
 */

import PDFDocument from "pdfkit";

export interface ReceiptData {
  /** Payment date */
  date: Date;
  /** Amount in cents */
  amountCents: number;
  /** Tenant full name */
  tenantName: string;
  /** Landlord or company name */
  landlordName: string;
  /** Property address */
  propertyAddress: string;
  /** Payment method: ach | card | cash | check */
  method: string;
  /** Type: rent | late_fee | security_deposit | other */
  type: string;
  /** Month the payment covers */
  forMonth?: Date;
  /** Property name */
  propertyName?: string;
  /** Unit number */
  unitNumber?: string;
  /** Receipt number / payment ID */
  receiptNumber: string;
}

/**
 * Format cents as USD string (e.g., 150000 → "$1,500.00").
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a payment method for display.
 */
export function formatMethod(method: string): string {
  const methods: Record<string, string> = {
    ach: "ACH Bank Transfer",
    card: "Credit/Debit Card",
    cash: "Cash",
    check: "Check",
  };
  return methods[method] || method;
}

/**
 * Format a payment type for display.
 */
export function formatType(type: string): string {
  const types: Record<string, string> = {
    rent: "Rent Payment",
    late_fee: "Late Fee",
    security_deposit: "Security Deposit",
    other: "Other Payment",
  };
  return types[type] || type;
}

/**
 * Generate a payment receipt as a PDF buffer.
 *
 * Returns a Buffer containing the PDF data.
 */
export function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "LETTER", margin: 72 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text("PAYMENT RECEIPT", { align: "center" });

      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Receipt #: ${data.receiptNumber}`, { align: "center" });

      doc.moveDown(1.5);

      // Horizontal line
      doc
        .moveTo(72, doc.y)
        .lineTo(540, doc.y)
        .stroke();

      doc.moveDown(1);

      // From section
      doc.fontSize(12).font("Helvetica-Bold").text("From:");
      doc.fontSize(11).font("Helvetica").text(data.landlordName);
      if (data.propertyName) {
        doc.text(data.propertyName);
      }
      doc.text(data.propertyAddress);

      doc.moveDown(1);

      // To section
      doc.fontSize(12).font("Helvetica-Bold").text("To:");
      doc.fontSize(11).font("Helvetica").text(data.tenantName);
      if (data.unitNumber) {
        doc.text(`Unit: ${data.unitNumber}`);
      }

      doc.moveDown(1.5);

      // Payment details
      doc
        .moveTo(72, doc.y)
        .lineTo(540, doc.y)
        .stroke();

      doc.moveDown(1);

      const details: [string, string][] = [
        ["Payment Date:", data.date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })],
        ["Amount Paid:", formatCents(data.amountCents)],
        ["Payment Type:", formatType(data.type)],
        ["Payment Method:", formatMethod(data.method)],
      ];

      if (data.forMonth) {
        details.push([
          "Period Covered:",
          data.forMonth.toLocaleDateString("en-US", {
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

      // Footer
      doc
        .moveTo(72, doc.y)
        .lineTo(540, doc.y)
        .stroke();

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
