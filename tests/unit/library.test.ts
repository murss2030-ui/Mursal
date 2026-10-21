/**
 * M5a/b, the evidence library (Section 11): structure-aware chunking of a
 * guideline's text layer — one recommendation, table or drug paragraph per
 * chunk, with its section path and page, its strength only as printed —
 * lexical search (BM25), vectors fused by reciprocal rank with exact drug
 * names on top, the metadata the trainee types or confirms with the licence
 * gate (local search only by default), and the store: encrypted file, hash,
 * duplicates refused, removal that purges. Synthetic documents only.
 */
import { describe, expect, it } from 'vitest';
import { chunkDocument, pageLines, printedStrength, type PageText, type TextPiece } from '../../src/library/chunk';
import { bm25, buildIndex, cosine, hybridSearch, tokenize } from '../../src/library/search';
import { citationOf, isOld, maySend, normalizeDocumentMeta, type DocumentMetaInput } from '../../src/domain/library';
import { IntegrityError } from '../../src/store/store';
import { ValidationError } from '../../src/domain/validation';
import { newSession, rawDump } from './helpers';

/** A line of text as pdf.js would give it: one piece per word, at a size, from the top. */
function line(text: string, y: number, size = 10, x = 72): TextPiece[] {
  const out: TextPiece[] = [];
  let at = x;
  for (const w of text.split(' ')) {
    const width = w.length * size * 0.5;
    out.push({ str: w, x: at, y, width, size });
    at += width + size * 0.28;
  }
  return out;
}
/** A table row: cells far apart. */
function row(cells: string[], y: number, size = 9): TextPiece[] {
  return cells.flatMap((c, i) => line(c, y, size, 72 + i * 150));
}
const page = (n: number, ...lines: TextPiece[][]): PageText => ({ page: n, height: 800, pieces: lines.flat() });

/** A synthetic guideline of three pages (no real guidance). */
const GUIDE: PageText[] = [
  page(
    1,
    line('Synthetic Society — Test Guideline 2024', 30, 8),
    line('1 Introduction', 80, 16),
    line('This synthetic guideline exists only to test how passages are cut. It describes nothing', 110),
    line('real, and none of its content is clinical guidance for any patient or any drug at all.', 124),
    line('2 Treatment of the synthetic infection', 170, 16),
    line('2.1 Empirical therapy', 200, 13),
    line('Recommendation 1. We recommend that the synthetic agent be given within one hour of', 230),
    line('recognition of the synthetic syndrome in adults.', 244),
    line('(Strong recommendation, moderate-quality evidence)', 258),
    line('A second paragraph explains why the first recommendation exists, in enough words to be a pas-', 300),
    line('sage of its own: it mentions timing, the population of adults and the absence of any real data', 314),
    line('behind it, because the whole document is a test fixture written for the unit tests here.', 328),
    line('3', 780, 8),
  ),
  page(
    2,
    line('Synthetic Society — Test Guideline 2024', 30, 8),
    line('Table 2 Synthetic dose adjustment by kidney function', 80, 10),
    row(['CrCl (mL/min)', 'Dose', 'Interval'], 100),
    row(['>50', '1 g', 'every 8 hours'], 114),
    row(['10-50', '1 g', 'every 12 hours'], 128),
    row(['<10', '500 mg', 'every 24 hours'], 142),
    line('2.2 Drug monographs', 190, 13),
    line('Testamycin 15 mg/kg IV every 12 hours is the synthetic dose used in this fixture; it is not a', 220),
    line('dose of any real medicine and must never be read as one by anybody.', 234),
    line('4', 780, 8),
  ),
  page(3, line('Synthetic Society — Test Guideline 2024', 30, 8), line('R2. We suggest synthetic monitoring every day (weak recommendation, low-quality evidence).', 80), line('5', 780, 8)),
];
const isDrug = (w: string) => /^testamycin$/i.test(w);

describe('chunking a guideline on the device', () => {
  const chunks = chunkDocument(GUIDE, { isDrug });

  it('builds lines from positioned pieces, with a column break where cells are far apart', () => {
    const [cap, head] = pageLines(GUIDE[1]!).slice(1, 3);
    expect(cap!.text).toBe('Table 2 Synthetic dose adjustment by kidney function');
    expect(head!.cells).toEqual(['CrCl (mL/min)', 'Dose', 'Interval']);
  });

  it('keeps each recommendation whole, with its strength only as printed', () => {
    const recs = chunks.filter((c) => c.kind === 'recommendation');
    expect(recs.map((c) => c.text)).toEqual([
      'Recommendation 1. We recommend that the synthetic agent be given within one hour of recognition of the synthetic syndrome in adults. (Strong recommendation, moderate-quality evidence)',
      'R2. We suggest synthetic monitoring every day (weak recommendation, low-quality evidence).',
    ]);
    expect(recs.map((c) => c.strength)).toEqual(['Strong recommendation, moderate-quality evidence', 'weak recommendation, low-quality evidence']);
    expect(recs[0]).toMatchObject({ page: 1, sectionPath: ['2 Treatment of the synthetic infection', '2.1 Empirical therapy'] });
    // No strength is invented where none is printed.
    expect(chunks.filter((c) => c.kind !== 'recommendation').every((c) => c.strength === undefined)).toBe(true);
    expect(printedStrength('We recommend this.')).toBeUndefined();
  });

  it('keeps a table whole, its rows and cells as printed', () => {
    const [table] = chunks.filter((c) => c.kind === 'table');
    expect(table!.text).toBe(['Table 2 Synthetic dose adjustment by kidney function', 'CrCl (mL/min) | Dose | Interval', '>50 | 1 g | every 8 hours', '10-50 | 1 g | every 12 hours', '<10 | 500 mg | every 24 hours'].join('\n'));
    expect(table!.page).toBe(2);
  });

  it('a paragraph that opens with a drug and gives a dose is a drug paragraph', () => {
    const [drug] = chunks.filter((c) => c.kind === 'drug_paragraph');
    expect(drug!.text).toMatch(/^Testamycin 15 mg\/kg IV every 12 hours/);
    expect(drug!.sectionPath.at(-1)).toBe('2.2 Drug monographs');
  });

  it('joins a word broken at a line end, drops running headers and page numbers, and keeps the section path', () => {
    const para = chunks.find((c) => c.text.startsWith('A second paragraph'))!;
    expect(para.text).toContain('a passage of its own');
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).not.toContain('Synthetic Society — Test Guideline 2024');
    expect(chunks.every((c) => !/^\d+$/.test(c.text))).toBe(true);
    expect(chunks.find((c) => c.text.startsWith('This synthetic guideline'))!.sectionPath).toEqual(['1 Introduction']);
    expect(chunks.map((c) => c.n)).toEqual(chunks.map((_, i) => i + 1));
  });

  it('a scanned PDF, with no text layer, gives no passage', () => {
    expect(chunkDocument([{ page: 1, height: 800, pieces: [] }])).toEqual([]);
  });

  it('a very long paragraph is split at sentence ends', () => {
    const sentence = 'This sentence of the synthetic fixture has exactly twelve words in it.';
    const long = Array.from({ length: 40 }, (_, i) => line(sentence, 60 + i * 14));
    const parts = chunkDocument([page(1, line('Heading of the long section', 30, 16), ...long)]);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.text.split(' ').length <= 320 && p.text.endsWith('.'))).toBe(true);
  });
});

describe('search', () => {
  const docs = [
    { id: 'a', text: 'Vancomycin trough levels and kidney function in adults with sepsis.' },
    { id: 'b', text: 'Empirical therapy for community-acquired pneumonia in adults: beta-lactam plus macrolide.' },
    { id: 'c', text: 'Kidney function estimates: creatinine clearance and eGFR for dosing.' },
    { id: 'd', text: 'Monitoring of statins in adults; statin intolerance.' },
  ];

  it('tokenizes for words: lower case, no stop words, plurals folded, numbers kept', () => {
    expect(tokenize('The Statins, in 2.5 mg/kg doses!')).toEqual(['statin', '2.5', 'mg', 'kg', 'dose']);
  });

  it('ranks by BM25 and leaves out what shares no term', () => {
    const r = bm25(buildIndex(docs), 'kidney function dosing');
    expect(r.map((x) => x.id)).toEqual(['c', 'a']);
  });

  it('fuses words and vectors by reciprocal rank, and keeps an exact drug name on top', () => {
    const vectors = new Map([
      ['a', [1, 0, 0]],
      ['b', [0, 1, 0]],
      ['c', [0.9, 0.1, 0]],
      ['d', [0, 0, 1]],
    ]);
    // A question about meaning the words miss: the vector finds c and a.
    const byMeaning = hybridSearch('renal dose adjustment', { docs, vectors, queryVector: [1, 0.05, 0] });
    expect(byMeaning.map((h) => h.id)).toEqual(['a', 'c']);
    expect(byMeaning[0]).toMatchObject({ vectorRank: 1 });
    // A drug named in the question: the passage naming it, word for word, comes first.
    const drug = hybridSearch('kidney function vancomycin', { docs, vectors, queryVector: [0.9, 0.1, 0], drugs: ['vancomycin'] });
    expect(drug[0]).toMatchObject({ id: 'a', drugMatch: true });
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1);
  });

  it('without vectors, search is by words alone', () => {
    expect(hybridSearch('statin intolerance', { docs }).map((h) => h.id)).toEqual(['d']);
  });
});

describe('the metadata, typed or confirmed by the trainee', () => {
  const META: DocumentMetaInput = {
    title: 'Synthetic test guideline',
    publisher: 'Synthetic Society',
    year: '2019',
    licence: 'All rights reserved',
    aiUse: 'local_only',
    role: 'primary',
    retrievedOn: '2026-10-20',
  };

  it('requires the title, publisher, year, licence and retrieval date; local search only is the default choice', () => {
    expect(normalizeDocumentMeta({ ...META, title: ' ', year: '19', retrievedOn: '2026-12-01' }, '2026-10-21')).toEqual({
      ok: false,
      errors: { title: 'required', year: 'range', retrievedOn: 'range' },
    });
    const ok = normalizeDocumentMeta(META, '2026-10-21');
    expect(ok.ok && ok.value).toMatchObject({ aiUse: 'local_only', year: 2019 });
  });

  it('text is marked as sendable to the AI service only when the trainee confirms the licence allows it', () => {
    expect(normalizeDocumentMeta({ ...META, aiUse: 'may_send', licence: 'CC BY-NC-SA 3.0 IGO' }, '2026-10-21')).toEqual({ ok: false, errors: { licenceConfirmed: 'confirm' } });
    const ok = normalizeDocumentMeta({ ...META, aiUse: 'may_send', licence: 'CC BY-NC-SA 3.0 IGO', licenceConfirmed: 'yes' }, '2026-10-21');
    expect(ok.ok).toBe(true);
    expect(normalizeDocumentMeta({ ...META, url: 'not a url' }, '2026-10-21')).toEqual({ ok: false, errors: { url: 'invalidChoice' } });
  });

  it('a document older than five years says so; a citation comes from the record, with page and section', () => {
    expect(isOld({ year: 2019 }, '2026-10-21')).toBe(true);
    expect(isOld({ year: 2022 }, '2026-10-21')).toBe(false);
    expect(citationOf({ publisher: 'Synthetic Society', title: 'Test guideline', year: 2024, role: 'reference' }, { page: 2, pageEnd: 3, sectionPath: ['2 Treatment', '2.1 Empirical therapy'] })).toBe(
      'Synthetic Society. Test guideline, 2024, pp. 2–3 — 2 Treatment › 2.1 Empirical therapy [reference document]',
    );
    expect(maySend({ aiUse: 'may_send', status: 'active' })).toBe(true);
    expect(maySend({ aiUse: 'local_only', status: 'active' })).toBe(false);
  });
});

describe('the library in the store', () => {
  const pdf = (marker = 'A') => new TextEncoder().encode(`%PDF-1.4\n% synthetic test file ${marker}\n`);
  const META: DocumentMetaInput = { title: 'Synthetic test guideline', publisher: 'Synthetic Society', year: '2024', licence: 'CC BY 4.0', aiUse: 'local_only', role: 'primary', retrievedOn: '2026-10-12' };

  it('stores the file encrypted with its hash and its passages; the same file twice is refused; the audit holds no text', async () => {
    const { store, db } = await newSession();
    const doc = await store.addDocument({ meta: META, file: { name: 'synthetic.pdf', bytes: pdf() }, pages: GUIDE, pageCount: 3, isDrug });
    expect(doc).toMatchObject({ title: 'Synthetic test guideline', aiUse: 'local_only', textLayer: true, status: 'active', version: 1 });
    expect(doc.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    const chunks = await store.listChunks(doc.id);
    expect(chunks).toHaveLength(doc.chunks);
    expect(chunks.map((c) => c.kind)).toContain('recommendation');
    expect(new TextDecoder().decode(await store.documentFile(doc.id))).toContain('synthetic test file A');
    const dump = await rawDump(db);
    expect(dump).not.toContain('We recommend that the synthetic agent');
    expect(dump).not.toContain('synthetic test file A');
    await expect(store.addDocument({ meta: { ...META, title: 'Again' }, file: { name: 'copy.pdf', bytes: pdf() }, pages: GUIDE, pageCount: 3 })).rejects.toBeInstanceOf(IntegrityError);
    const audit = (await store.listAudit()).filter((e) => e.entity === 'library_document');
    expect(JSON.stringify(audit)).not.toContain('We recommend');
  });

  it('refuses a file that is not a PDF; keeps a scanned PDF as not searchable', async () => {
    const { store } = await newSession();
    const notPdf = await store.addDocument({ meta: META, file: { name: 'x.txt', bytes: new TextEncoder().encode('hello') }, pages: [], pageCount: 1 }).catch((e: unknown) => e);
    expect(notPdf).toBeInstanceOf(ValidationError);
    expect((notPdf as ValidationError).errors).toEqual({ file: 'invalidChoice' });
    const scan = await store.addDocument({ meta: META, file: { name: 'scan.pdf', bytes: pdf('scan') }, pages: [{ page: 1, height: 800, pieces: [] }], pageCount: 1 });
    expect(scan).toMatchObject({ textLayer: false, chunks: 0 });
  });

  it('a change of metadata is a new version with its reason; a document taken back to local search loses its vectors', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'a.pdf', bytes: pdf('B') }, pages: GUIDE, pageCount: 3 });
    const chunks = await store.listChunks(doc.id);
    const withVectors = await store.addVectors(doc.id, 'embed-test', chunks.map((c, i) => ({ chunkId: c.id, vector: [i, 1, 0] })));
    expect(withVectors.vectors).toMatchObject({ model: 'embed-test', chunks: chunks.length });
    expect(await store.listVectors(doc.id)).toHaveLength(chunks.length);
    // A newer model replaces the vectors of the older one.
    await store.addVectors(doc.id, 'embed-test-2', chunks.slice(0, 2).map((c) => ({ chunkId: c.id, vector: [1, 1, 1] })));
    expect((await store.listVectors(doc.id)).map((v) => v.model)).toEqual(['embed-test-2', 'embed-test-2']);
    await expect(store.updateDocument(doc.id, META, '')).rejects.toBeInstanceOf(ValidationError);
    const local = await store.updateDocument(doc.id, META, 'The licence does not allow it after all');
    expect(local).toMatchObject({ aiUse: 'local_only', version: 4, changeReason: 'The licence does not allow it after all' });
    expect(local.vectors).toBeUndefined();
    expect(await store.listVectors(doc.id)).toEqual([]);
    // A local document is never embedded.
    await expect(store.addVectors(doc.id, 'embed-test', [{ chunkId: chunks[0]!.id, vector: [1] }])).rejects.toThrow(/local search only/);
    expect((await store.documentHistory(doc.id)).map((v) => v.version)).toEqual([1, 2, 3, 4]);
  });

  it('removing a document purges its file, passages and vectors; its record and the removal stay', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'a.pdf', bytes: pdf('C') }, pages: GUIDE, pageCount: 3 });
    const chunks = await store.listChunks(doc.id);
    await store.addVectors(doc.id, 'embed-test', [{ chunkId: chunks[0]!.id, vector: [1, 0] }]);
    const gone = await store.removeDocument(doc.id, 'Superseded by the new edition');
    expect(gone.status).toBe('removed');
    expect(await store.listChunks(doc.id)).toEqual([]);
    expect(await store.listVectors(doc.id)).toEqual([]);
    expect(await store.documentFile(doc.id)).toBeUndefined();
    expect((await store.listDocuments()).find((d) => d.id === doc.id)).toMatchObject({ status: 'removed', changeReason: 'Superseded by the new edition' });
    // Once removed, the same file can be added again.
    await expect(store.addDocument({ meta: META, file: { name: 'a.pdf', bytes: pdf('C') }, pages: GUIDE, pageCount: 3 })).resolves.toMatchObject({ status: 'active' });
  });
});
