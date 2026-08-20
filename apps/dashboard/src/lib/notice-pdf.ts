import PDFDocument from "pdfkit";

/**
 * Generate a PDF from notice content text.
 * Renders the full content faithfully in uniform 11pt Helvetica
 * with a "Tenant AI" footer disclaimer.
 */
export async function generateNoticePdf(content: string): Promise<Buffer> {
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
    const lines = (content || "").split("\n");
    doc.fontSize(11).font("Helvetica");
    for (const line of lines) {
      if (line.trim() === "") {
        doc.moveDown(0.5);
      } else {
        doc.text(line);
      }
    }

    // Footer
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
