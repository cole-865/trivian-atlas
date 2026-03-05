import PDFDocument from "pdfkit";

export async function textToPdfBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36 });
    const chunks: Buffer[] = [];

    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(10).text(text || "(no text extracted)", { width: 540 });
    doc.end();
  });
}