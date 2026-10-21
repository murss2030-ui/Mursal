/**
 * Searching the evidence library and computing its vectors (Section 11).
 *
 * Search runs on the device over the active documents' passages: words always
 * (BM25); meaning too when an embedding model is chosen and the passages have
 * vectors — the question alone is sent to compute its vector. A document kept
 * for local search only is searched by words and never sent anywhere.
 */
import type { CaseKind } from '../domain/types';
import { citationOf, isOld, maySend, type EvidenceChunk, type LibraryDocument } from '../domain/library';
import type { Store } from '../store/store';
import { AiError, callEmbed, type CallDeps } from '../ai/client';
import { EMBED_LIMITS } from '../ai/protocol';
import { buildIndex, hybridSearch, type SearchHit } from './search';

export interface LibraryHit extends SearchHit {
  chunk: EvidenceChunk;
  doc: LibraryDocument;
  /** How it is cited: from the document's record, never from a model. */
  citation: string;
  /** Older than five years: every citation drawn from it says so. */
  old: boolean;
}

export interface LibrarySearch {
  hits: LibraryHit[];
  /** Whether search by meaning took part (an embedding model, vectors, a connection). */
  byMeaning: boolean;
  /** Why it did not, when it was asked for. */
  meaningSkipped?: string;
}

export interface SearchOptions {
  /** The case a research question comes from (its kind decides whether its vector may be computed on a free-tier key). */
  caseId?: string;
  caseKind?: CaseKind;
  /** Drug names in the question, matched as whole words and kept on top. */
  drugs?: readonly string[];
  /** Search by meaning as well, when possible (default true). */
  byMeaning?: boolean;
  limit?: number;
  deps?: CallDeps;
}

export async function searchLibrary(store: Store, query: string, opts: SearchOptions = {}): Promise<LibrarySearch> {
  const docs = (await store.listDocuments()).filter((d) => d.status === 'active');
  const byId = new Map(docs.map((d) => [d.id, d]));
  const chunks = (await store.listChunks()).filter((c) => byId.has(c.docId));
  const index = buildIndex(chunks.map((c) => ({ id: c.id, text: c.text })));
  let vectors: Map<string, number[]> | undefined;
  let queryVector: number[] | undefined;
  let meaningSkipped: string | undefined;
  const settings = await store.getAiSettings();
  if (opts.byMeaning !== false && settings.models.embed) {
    // Only vectors of the chosen model, of documents still allowed to be sent.
    const model = settings.models.embed;
    const all = (await store.listVectors()).filter((v) => v.model === model && maySend(byId.get(v.docId) ?? { aiUse: 'local_only', status: 'removed' }));
    if (all.length) {
      try {
        const q = await callEmbed(store, { ...(opts.caseId ? { caseId: opts.caseId } : {}), caseKind: opts.caseKind ?? 'teaching', purpose: 'query', texts: [query.slice(0, EMBED_LIMITS.charsPerText)] }, opts.deps);
        queryVector = q.vectors[0];
        vectors = new Map(all.map((v) => [v.chunkId, v.vector]));
      } catch (e) {
        // Search by words goes on; the reason is said.
        meaningSkipped = e instanceof AiError ? e.code : 'network';
      }
    } else meaningSkipped = 'no_vectors';
  }
  const hits = hybridSearch(query, { docs: chunks.map((c) => ({ id: c.id, text: c.text })), index, ...(vectors && queryVector ? { vectors, queryVector } : {}), ...(opts.drugs ? { drugs: opts.drugs } : {}), limit: opts.limit ?? 20 });
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const today = store.today();
  return {
    hits: hits.map((h) => {
      const chunk = chunkById.get(h.id)!;
      const doc = byId.get(chunk.docId)!;
      return { ...h, chunk, doc, citation: citationOf(doc, chunk), old: isOld(doc, today) };
    }),
    byMeaning: Boolean(vectors && queryVector),
    ...(meaningSkipped ? { meaningSkipped } : {}),
  };
}

/**
 * Computes the vectors of a document's passages once (plan decision 4), in
 * batches the relay accepts, and stores them all or none. Refused for a
 * document kept for local search only.
 */
export async function embedDocument(store: Store, docId: string, deps: CallDeps = {}, onProgress?: (done: number, total: number) => void): Promise<LibraryDocument> {
  const doc = (await store.listDocuments()).find((d) => d.id === docId);
  if (!doc || doc.status !== 'active') throw new AiError('bad_request', 'That document is not in your library.');
  if (!maySend(doc)) throw new AiError('bad_request', 'This document is for local search only: its text is never sent to the AI service.');
  const chunks = await store.listChunks(docId);
  if (!chunks.length) throw new AiError('bad_request', 'This document has no text to index.');
  const out: { chunkId: string; vector: number[] }[] = [];
  let model = '';
  for (let i = 0; i < chunks.length; ) {
    const batch: EvidenceChunk[] = [];
    let chars = 0;
    while (i < chunks.length && batch.length < EMBED_LIMITS.texts && chars + Math.min(chunks[i]!.text.length, EMBED_LIMITS.charsPerText) <= EMBED_LIMITS.totalChars) {
      chars += Math.min(chunks[i]!.text.length, EMBED_LIMITS.charsPerText);
      batch.push(chunks[i]!);
      i++;
    }
    const r = await callEmbed(store, { caseKind: 'teaching', purpose: 'document', texts: batch.map((c) => c.text.slice(0, EMBED_LIMITS.charsPerText)), chunkIds: batch.map((c) => c.id) }, deps);
    model = r.model;
    r.vectors.forEach((v, j) => out.push({ chunkId: batch[j]!.id, vector: v }));
    onProgress?.(out.length, chunks.length);
  }
  return store.addVectors(docId, model, out);
}
