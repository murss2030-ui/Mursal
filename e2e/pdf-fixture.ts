/**
 * A small guideline PDF with a text layer, made here (no real guideline is
 * ever in the repository): headings and body at different sizes, a numbered
 * recommendation with its strength as printed, a second recommendation and a
 * table-like block. pdf.js reads it exactly as it reads a trainee's own file.
 */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export interface PdfLine {
  text: string;
  size: number;
  /** Distance from the top of the page, in points. */
  top: number;
  x?: number;
}

export function pdfBytes(pages: PdfLine[][]): Buffer {
  const objects: string[] = [];
  const n = pages.length;
  // 1 catalogue, 2 page tree, 3 font, then a page object and a content stream per page.
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const content = lines.map((l) => `BT /F1 ${l.size} Tf ${l.x ?? 72} ${792 - l.top} Td (${esc(l.text)}) Tj ET`).join('\n');
    objects[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** One page of a synthetic guideline about metformin in kidney injury (no real guidance). */
export function syntheticGuideline(tag = 'A', inText = ''): Buffer {
  return pdfBytes([
    [
      { text: `Synthetic Society - Test Guideline ${tag}`, size: 8, top: 30 },
      { text: '2 Kidney injury', size: 16, top: 70 },
      { text: `Recommendation 1. We recommend that synthetic metformin ${inText}be held in adults with acute kidney injury until`, size: 10, top: 110 },
      { text: 'kidney function is known to be stable, and that the decision be reviewed daily by the treating team.', size: 10, top: 124 },
      { text: '(Strong recommendation, moderate-quality evidence)', size: 10, top: 138 },
      { text: 'A second paragraph explains why the first recommendation exists, in enough words to be a passage of its own:', size: 10, top: 180 },
      { text: 'it mentions timing, the population of adults and the absence of any real data behind it, because the whole', size: 10, top: 194 },
      { text: 'document is a test fixture written for the browser tests here.', size: 10, top: 208 },
    ],
  ]);
}
