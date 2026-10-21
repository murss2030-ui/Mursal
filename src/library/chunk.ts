/**
 * Structure-aware chunking of a guideline's text layer (Section 11: "one
 * recommendation, table or drug paragraph per chunk"), on the device, from
 * the positions and sizes pdf.js gives each piece of text. Headings give each
 * chunk its section path; a numbered recommendation, a table and a paragraph
 * about one drug are each kept whole; running headers, footers and page
 * numbers are dropped. A recommendation's strength or grade is kept only as
 * printed in the document — found in its own text, never inferred.
 *
 * The text of a chunk is the document's own text: pieces are joined with the
 * spaces their positions imply, a word broken by a hyphen at a line end is
 * joined, and nothing else is changed. A PDF with no text layer (a scan)
 * gives no chunks: it is listed as not searchable (plan decision 10).
 */

/** A piece of text as pdf.js gives it, with `y` measured from the top of the page. */
export interface TextPiece {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Font size in page units. */
  size: number;
}

export interface PageText {
  /** 1-based. */
  page: number;
  height: number;
  pieces: TextPiece[];
}

export const CHUNK_KINDS = ['recommendation', 'table', 'drug_paragraph', 'paragraph'] as const;
export type ChunkKind = (typeof CHUNK_KINDS)[number];

export interface DraftChunk {
  /** Order in the document, from 1. */
  n: number;
  kind: ChunkKind;
  sectionPath: string[];
  page: number;
  pageEnd?: number;
  text: string;
  /** As printed in the chunk's own text (e.g. "Strong recommendation, moderate-quality evidence"), never inferred. */
  strength?: string;
}

interface Line {
  page: number;
  y: number;
  x: number;
  size: number;
  text: string;
  /** Column breaks in the line: 2 or more suggests a table row. */
  cells: string[];
}

const MAX_WORDS = 320;
const MIN_WORDS = 25;

/** Lines of one page: pieces on the same baseline, left to right, with a space or a column break where the gap says so. */
export function pageLines(p: PageText): Line[] {
  const pieces = p.pieces.filter((x) => x.str.trim() || x.str === ' ').sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { y: number; size: number; pieces: TextPiece[] }[] = [];
  for (const piece of pieces) {
    const line = lines.find((l) => Math.abs(l.y - piece.y) <= Math.max(1, 0.45 * Math.min(l.size, piece.size || l.size)));
    if (line) {
      line.pieces.push(piece);
      line.size = Math.max(line.size, piece.size);
    } else lines.push({ y: piece.y, size: piece.size, pieces: [piece] });
  }
  return lines
    .sort((a, b) => a.y - b.y)
    .map((l) => {
      const ps = l.pieces.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let cell = '';
      let end = -Infinity;
      for (const piece of ps) {
        const gap = piece.x - end;
        if (cell && gap > 2.2 * l.size) {
          cells.push(cell.trim());
          cell = '';
        } else if (cell && gap > 0.15 * l.size && !cell.endsWith(' ') && !piece.str.startsWith(' ')) cell += ' ';
        cell += piece.str;
        end = piece.x + piece.width;
      }
      if (cell.trim()) cells.push(cell.trim());
      const text = cells.join(' ').replace(/\s+/g, ' ').trim();
      return { page: p.page, y: l.y, x: ps[0]?.x ?? 0, size: l.size, text, cells };
    })
    .filter((l) => l.text);
}

/** A running header or footer: the same words (numbers aside) at the top or bottom of at least half the pages. */
function runningLines(pages: Line[][]): Set<string> {
  const key = (t: string) => t.replace(/\d+/g, '#').toLowerCase();
  const count = new Map<string, number>();
  for (const lines of pages) {
    const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => key(l.text)));
    for (const k of edges) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const min = Math.max(2, Math.ceil(pages.length / 2));
  return new Set([...count].filter(([, n]) => n >= min).map(([k]) => k));
}

const RECOMMENDATION = /^(?:recommendation\s*\d+(?:\.\d+)*\s*[.:)]?|r\d+(?:\.\d+)*\s*[.:)]|\d+(?:\.\d+)+\s+(?:we|it is)\s+(?:strongly\s+)?(?:recommend|suggest)|(?:we|it is)\s+(?:strongly\s+)?(?:recommend(?:ed)?|suggest(?:ed)?)\b)/i;
const TABLE_CAPTION = /^table\s+\d+[a-z]?\b/i;
const NUMBERED_HEADING = /^\d+(?:\.\d+){0,3}\.?\s+\p{Lu}/u;
const STRENGTH: readonly RegExp[] = [
  /\((?:strong|weak|conditional)\s+recommendation[^)]{0,160}\)/i,
  /\b(?:strong|weak|conditional)\s+recommendation(?:\s*[,;]\s*(?:very\s+)?(?:high|moderate|low|very low)[- ]quality(?:\s+of)?\s+evidence)?/i,
  /\b(?:grade|level)\s+[1-3][A-D]?\b/i,
  /\bclass\s+(?:I{1,3}|IIa|IIb)\b(?:\s*[,;]?\s*level\s+(?:of\s+evidence\s+)?[A-C](?:-[A-Z]{1,3})?)?/i,
  /\bGRADE\s*[1-2][A-D]\b/,
];
const DOSE = /\b\d+(?:\.\d+)?\s?(?:mg|g|mcg|µg|units?|mL|mmol)(?:\/(?:kg|day|h|m2))?\b/i;
const WORDS = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The strength or grade printed in a recommendation's own text, if any. */
export function printedStrength(text: string): string | undefined {
  for (const re of STRENGTH) {
    const m = re.exec(text);
    if (m) return m[0].replace(/^\(|\)$/g, '').trim();
  }
  return undefined;
}

/** Joins two lines of one paragraph: a word broken at the line end by a hyphen is joined back. */
function join(a: string, b: string): string {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

function splitLong(text: string): string[] {
  if (WORDS(text) <= MAX_WORDS) return [text];
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const next = cur ? `${cur} ${s.trim()}` : s.trim();
    if (cur && WORDS(next) > MAX_WORDS) {
      out.push(cur);
      cur = s.trim();
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export interface ChunkOptions {
  /** Whether a word is a drug name (from the app's vocabulary): a paragraph that starts with one and gives a dose is a drug paragraph. */
  isDrug?: (word: string) => boolean;
}

/** The chunks of a document. */
export function chunkDocument(pages: readonly PageText[], opts: ChunkOptions = {}): DraftChunk[] {
  const perPage = pages.map(pageLines);
  const running = runningLines(perPage);
  const lines = perPage.flat().filter((l) => !/^\d{1,4}$/.test(l.text) && !/^page\s+\d+(\s+of\s+\d+)?$/i.test(l.text) && !running.has(l.text.replace(/\d+/g, '#').toLowerCase()));
  if (!lines.length) return [];

  // The body size: the size most characters are set in.
  const bySize = new Map<number, number>();
  for (const l of lines) bySize.set(Math.round(l.size * 2) / 2, (bySize.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length);
  const body = [...bySize].sort((a, b) => b[1] - a[1])[0]![0];
  const headingSizes = [...new Set(lines.filter((l) => l.size >= body * 1.15).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const isHeading = (l: Line) =>
    l.text.length <= 150 && !/[.;,]$/.test(l.text) && (l.size >= body * 1.15 || (NUMBERED_HEADING.test(l.text) && l.text.length <= 90 && WORDS(l.text) <= 12 && !RECOMMENDATION.test(l.text)));
  const levelOf = (l: Line) => (l.size >= body * 1.15 ? headingSizes.indexOf(Math.round(l.size * 2) / 2) + 1 : headingSizes.length + 1);
  const isTableRow = (l: Line) => l.cells.length >= 3;

  type Block = { kind: ChunkKind; lines: Line[]; path: string[] };
  const blocks: Block[] = [];
  const path: { level: number; text: string }[] = [];
  let cur: Block | undefined;
  const close = () => {
    if (cur?.lines.length) blocks.push(cur);
    cur = undefined;
  };
  let prev: Line | undefined;
  for (const l of lines) {
    const gap = prev && prev.page === l.page ? l.y - prev.y : Infinity;
    if (isHeading(l)) {
      close();
      const level = levelOf(l);
      while (path.length && path.at(-1)!.level >= level) path.pop();
      path.push({ level, text: l.text });
      prev = l;
      continue;
    }
    const sectionPath = path.map((p) => p.text);
    if (TABLE_CAPTION.test(l.text) || (isTableRow(l) && cur?.kind !== 'table')) {
      close();
      cur = { kind: 'table', lines: [l], path: sectionPath };
    } else if (cur?.kind === 'table') {
      // A table goes on while its rows do (a short line in between is a wrapped cell).
      if (isTableRow(l) || (l.text.length < 60 && gap < 2.2 * l.size)) cur.lines.push(l);
      else {
        close();
        cur = { kind: RECOMMENDATION.test(l.text) ? 'recommendation' : 'paragraph', lines: [l], path: sectionPath };
      }
    } else if (RECOMMENDATION.test(l.text)) {
      close();
      cur = { kind: 'recommendation', lines: [l], path: sectionPath };
    } else if (!cur || gap > 1.75 * l.size || gap < 0) {
      // A recommendation keeps its strength when printed on its own short line just after it.
      if (cur?.kind === 'recommendation' && printedStrength(l.text) && WORDS(l.text) <= 25 && gap < 3 * l.size) cur.lines.push(l);
      else {
        close();
        cur = { kind: 'paragraph', lines: [l], path: sectionPath };
      }
    } else cur.lines.push(l);
    prev = l;
  }
  close();

  // Text of each block; drug paragraphs; small paragraphs merged with the next in the same section; long ones split.
  const out: DraftChunk[] = [];
  let carry: { text: string; page: number; path: string[] } | undefined;
  const push = (kind: ChunkKind, text: string, page: number, pageEnd: number, sectionPath: string[]) => {
    const strength = kind === 'recommendation' ? printedStrength(text) : undefined;
    out.push({ n: out.length + 1, kind, sectionPath, page, ...(pageEnd !== page ? { pageEnd } : {}), text, ...(strength ? { strength } : {}) });
  };
  for (const b of blocks) {
    const page = b.lines[0]!.page;
    const pageEnd = b.lines.at(-1)!.page;
    if (b.kind === 'table') {
      if (carry) {
        push('paragraph', carry.text, carry.page, carry.page, carry.path);
        carry = undefined;
      }
      push('table', b.lines.map((l) => (l.cells.length >= 2 ? l.cells.join(' | ') : l.text)).join('\n'), page, pageEnd, b.path);
      continue;
    }
    let text = b.lines.map((l) => l.text).reduce(join);
    const first = text.split(/\s+/).slice(0, 4).map((w) => w.replace(/[^\p{L}-]/gu, ''));
    const kind: ChunkKind = b.kind === 'recommendation' ? 'recommendation' : opts.isDrug && first.some((w) => w && opts.isDrug!(w)) && DOSE.test(text) ? 'drug_paragraph' : 'paragraph';
    if (kind !== 'paragraph') {
      if (carry) {
        push('paragraph', carry.text, carry.page, carry.page, carry.path);
        carry = undefined;
      }
      for (const part of splitLong(text)) push(kind, part, page, pageEnd, b.path);
      continue;
    }
    if (carry && carry.path.join('\u0000') === b.path.join('\u0000')) text = `${carry.text} ${text}`;
    else if (carry) push('paragraph', carry.text, carry.page, carry.page, carry.path);
    const carryPage = carry && carry.path.join('\u0000') === b.path.join('\u0000') ? carry.page : page;
    carry = undefined;
    if (WORDS(text) < MIN_WORDS) {
      carry = { text, page: carryPage, path: b.path };
      continue;
    }
    for (const part of splitLong(text)) push('paragraph', part, carryPage, pageEnd, b.path);
  }
  if (carry) push('paragraph', carry.text, carry.page, carry.page, carry.path);
  return out;
}
