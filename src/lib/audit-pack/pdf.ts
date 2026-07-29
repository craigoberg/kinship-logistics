import { jsPDF } from "jspdf";
import { auditDateTime } from "./format";

const MARGIN = 14;
const LINE = 5.5;
const PAGE_BOTTOM = 280;

export function createAuditPdf(title: string): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, MARGIN, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    `Generated ${auditDateTime(new Date())} · Yada Connect Audit Pack`,
    MARGIN,
    24,
  );
  doc.setTextColor(0);
  return doc;
}

export function pdfAddHeading(doc: jsPDF, text: string, y: number): number {
  let cursor = ensureSpace(doc, y, 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(text, MARGIN, cursor);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  return cursor + LINE + 1;
}

export function pdfAddLines(doc: jsPDF, lines: string[], y: number): number {
  let cursor = y;
  const maxWidth = 182;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line || " ", maxWidth) as string[];
    for (const w of wrapped) {
      cursor = ensureSpace(doc, cursor, LINE);
      doc.text(w, MARGIN, cursor);
      cursor += LINE;
    }
  }
  return cursor;
}

export function pdfAddKeyValues(
  doc: jsPDF,
  pairs: Array<[string, string]>,
  y: number,
): number {
  let cursor = y;
  for (const [k, v] of pairs) {
    cursor = ensureSpace(doc, cursor, LINE);
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, MARGIN, cursor);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(v || "—", 140) as string[];
    doc.text(wrapped[0] ?? "—", MARGIN + 42, cursor);
    cursor += LINE;
    for (let i = 1; i < wrapped.length; i++) {
      cursor = ensureSpace(doc, cursor, LINE);
      doc.text(wrapped[i], MARGIN + 42, cursor);
      cursor += LINE;
    }
  }
  return cursor;
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  if (y + need <= PAGE_BOTTOM) return y;
  doc.addPage();
  return 18;
}

export function pdfToBytes(doc: jsPDF): Uint8Array {
  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}
