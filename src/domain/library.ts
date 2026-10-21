/**
 * The trainee's evidence library (Section 11, plan M5a): guideline PDFs the
 * trainee obtained lawfully and uploads on this device. Each document records
 * its publisher, title, year, version, URL, licence, retrieval date and file
 * hash — typed or confirmed by the trainee, never filled in by a model — its
 * role (the primary document of a topic, or a reference; owner decision of 20
 * October 2026) and one choice about its text (plan decision 3): "local search
 * only" (the default) or "may be sent to the AI service", which only a licence
 * that allows it permits. The app ships no guideline text.
 */
import type { Versioned } from './types';
import type { ChunkKind } from '../library/chunk';

export const AI_USE = ['local_only', 'may_send'] as const;
export type AiUse = (typeof AI_USE)[number];
export const DOC_ROLES = ['primary', 'reference'] as const;
export type DocRole = (typeof DOC_ROLES)[number];

export interface LibraryDocument extends Versioned {
  id: string;
  title: string;
  publisher: string;
  year: number;
  /** Edition or version as printed ("2023 focused update"). */
  edition?: string;
  url?: string;
  /** As the trainee read it in the document or on the publisher's site ("CC BY-NC-SA 3.0 IGO", "All rights reserved"). */
  licence: string;
  aiUse: AiUse;
  role: DocRole;
  /** The clinical topic it covers, for the trainee's own grouping ("Community-acquired pneumonia"). */
  topic?: string;
  /** When the trainee obtained the file (YYYY-MM-DD). */
  retrievedOn: string;
  file: { name: string; bytes: number; sha256: string; pages: number };
  /** A scanned PDF has no text layer: listed, not searchable (plan decision 10). */
  textLayer: boolean;
  chunks: number;
  status: 'active' | 'removed';
  addedAt: string;
  /** Vectors computed for its passages, when its text may be sent (plan decision 4). */
  vectors?: { model: string; at: string; chunks: number };
}

/** One passage: a recommendation, a table, a drug paragraph or a paragraph, with where it is. */
export interface EvidenceChunk {
  id: string;
  docId: string;
  docVersion: number;
  n: number;
  kind: ChunkKind;
  sectionPath: string[];
  page: number;
  pageEnd?: number;
  /** Exactly as extracted from the document's text layer. */
  text: string;
  /** The recommendation's strength or grade, as printed in its own text. */
  strength?: string;
}

/** A passage's vector, computed once by the embedding model named here. */
export interface ChunkVector {
  id: string;
  chunkId: string;
  docId: string;
  model: string;
  vector: number[];
  at: string;
}

export interface DocumentMetaInput {
  title: string;
  publisher: string;
  year: string;
  edition?: string;
  url?: string;
  licence: string;
  aiUse: string;
  /** "yes" when the trainee confirms the licence allows sending the text to an AI service (required for may_send). */
  licenceConfirmed?: string;
  role: string;
  topic?: string;
  retrievedOn: string;
}

export type DocumentMeta = Pick<LibraryDocument, 'title' | 'publisher' | 'year' | 'edition' | 'url' | 'licence' | 'aiUse' | 'role' | 'topic' | 'retrievedOn'>;

export type MetaError = 'required' | 'tooLong' | 'range' | 'invalidChoice' | 'confirm';

/** Checks what the trainee typed; today's date bounds the year and the retrieval date. */
export function normalizeDocumentMeta(input: DocumentMetaInput, today: string): { ok: true; value: DocumentMeta } | { ok: false; errors: Record<string, MetaError> } {
  const e: Record<string, MetaError> = {};
  const text = (k: keyof DocumentMetaInput, max: number, required = false) => {
    const v = (input[k] ?? '').trim();
    if (!v) {
      if (required) e[k] = 'required';
      return undefined;
    }
    if (v.length > max) e[k] = 'tooLong';
    return v;
  };
  const title = text('title', 300, true);
  const publisher = text('publisher', 200, true);
  const edition = text('edition', 100);
  const licence = text('licence', 200, true);
  const topic = text('topic', 200);
  const url = text('url', 500);
  if (url && !/^https?:\/\/\S+$/i.test(url)) e.url = 'invalidChoice';
  const yearText = (input.year ?? '').trim();
  const year = Number(yearText);
  const thisYear = Number(today.slice(0, 4));
  if (!yearText) e.year = 'required';
  else if (!/^\d{4}$/.test(yearText) || year < 1950 || year > thisYear + 1) e.year = 'range';
  const retrievedOn = (input.retrievedOn ?? '').trim();
  if (!retrievedOn) e.retrievedOn = 'required';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn) || retrievedOn > today || Number.isNaN(Date.parse(`${retrievedOn}T00:00:00Z`))) e.retrievedOn = 'range';
  if (!(AI_USE as readonly string[]).includes(input.aiUse)) e.aiUse = 'invalidChoice';
  // Plan decision 3: text is sent to the AI service only when the trainee confirms the licence allows it.
  if (input.aiUse === 'may_send' && input.licenceConfirmed !== 'yes') e.licenceConfirmed = 'confirm';
  if (!(DOC_ROLES as readonly string[]).includes(input.role)) e.role = 'invalidChoice';
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      title: title!,
      publisher: publisher!,
      year,
      ...(edition ? { edition } : {}),
      ...(url ? { url } : {}),
      licence: licence!,
      aiUse: input.aiUse as AiUse,
      role: input.role as DocRole,
      ...(topic ? { topic } : {}),
      retrievedOn,
    },
  };
}

/** Years since the document's year; past five, every citation drawn from it says so (Section 11). */
export const documentAge = (doc: Pick<LibraryDocument, 'year'>, today: string): number => Number(today.slice(0, 4)) - doc.year;
export const AGE_WARNING_YEARS = 5;
export const isOld = (doc: Pick<LibraryDocument, 'year'>, today: string): boolean => documentAge(doc, today) > AGE_WARNING_YEARS;

/** Whether a document's text may be sent to the AI service: active, and the trainee confirmed its licence allows it. */
export const maySend = (doc: Pick<LibraryDocument, 'aiUse' | 'status'>): boolean => doc.status === 'active' && doc.aiUse === 'may_send';

/** How a passage is cited: the document, its edition and year, the page, the section — from the record, never from a model. */
export function citationOf(doc: Pick<LibraryDocument, 'publisher' | 'title' | 'year' | 'edition' | 'role'>, chunk: Pick<EvidenceChunk, 'page' | 'pageEnd' | 'sectionPath'>): string {
  const pages = chunk.pageEnd && chunk.pageEnd !== chunk.page ? `pp. ${chunk.page}–${chunk.pageEnd}` : `p. ${chunk.page}`;
  const section = chunk.sectionPath.length ? ` — ${chunk.sectionPath.join(' › ')}` : '';
  return `${doc.publisher}. ${doc.title}${doc.edition ? ` (${doc.edition})` : ''}, ${doc.year}, ${pages}${section}${doc.role === 'reference' ? ' [reference document]' : ''}`;
}
