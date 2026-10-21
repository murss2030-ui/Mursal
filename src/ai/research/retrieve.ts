/**
 * Retrieval for a researched question (plan M5d): the trainee's library first
 * (the department's primary document before a reference document), then the
 * open sources. Every retrieved item is recorded as a SourceRecord; what the
 * model may read is a separate, smaller list of passages:
 *
 * - a library passage from a document kept for local search is *shown* to the
 *   trainee and never sent to the model (the licence gate, plan decision 3);
 * - a drug label is sent section by section, an article as its abstract;
 * - when nothing is sendable the model is not asked at all.
 */
import { isOld, maySend } from '../../domain/library';
import type { RetrievalNote } from '../../domain/research';
import type { SourceRecord } from '../../domain/sources';
import type { CaseKind } from '../../domain/types';
import type { Store } from '../../store/store';
import type { CallDeps } from '../client';
import { searchLibrary } from '../../library/run';
import { clip, ConnectorError, type ConnectorDeps } from '../connectors/http';
import { europePmcSearch, openFdaLabels, pubMedSearch } from '../connectors/open';
import type { SentSource } from './contract';

/** Library passages and open-source results offered to the model, at most. */
export const LIMITS = { library: 6, localOnly: 4, labels: 2, drugs: 3, articles: 4, passageChars: 3000, sectionChars: 2500, totalChars: 70_000 } as const;

/** The label sections worth sending for a medication question, in this order. */
const LABEL_SEND = ['Dosage and administration', 'Use in specific populations', 'Renal and hepatic mentions', 'Contraindications', 'Drug interactions', 'Warnings and precautions', 'Warnings', 'Precautions'] as const;

export interface Retrieval {
  sources: SourceRecord[];
  sent: SentSource[];
  chunkIds: string[];
  notes: RetrievalNote[];
}

export interface RetrieveInput {
  caseId: string;
  caseKind: CaseKind;
  /** The words searched in the library and in the literature. */
  query: string;
  drugs: readonly string[];
  /** Search only the library (no outside service is called). */
  libraryOnly?: boolean;
  connectors?: Omit<ConnectorDeps, 'store' | 'caseId'>;
  deps?: CallDeps;
}

export async function retrieveEvidence(store: Store, input: RetrieveInput): Promise<Retrieval> {
  const sources: SourceRecord[] = [];
  const sent: SentSource[] = [];
  const chunkIds: string[] = [];
  const notes: RetrievalNote[] = [];
  const today = store.today();
  const retrievedAt = store.nowIso();
  let chars = 0;
  const add = (record: SourceRecord, parts: { section?: string; describe: string; text: string }[]) => {
    if (!sources.some((s) => s.id === record.id)) sources.push(record);
    for (const p of parts) {
      const text = p.text.trim();
      if (!text || chars + text.length > LIMITS.totalChars) continue;
      chars += text.length;
      sent.push({ id: `S${sent.length + 1}`, recordId: record.id, ...(p.section ? { section: p.section } : {}), describe: p.describe, text });
    }
  };

  // ---- the trainee's library, primary documents first
  const docs = (await store.listDocuments()).filter((d) => d.status === 'active');
  if (!docs.length) notes.push('library_empty');
  else {
    const found = await searchLibrary(store, input.query, { caseId: input.caseId, caseKind: input.caseKind, drugs: input.drugs, limit: 20, ...(input.deps ? { deps: input.deps } : {}) });
    const ranked = [...found.hits].sort((a, b) => Number(b.doc.role === 'primary') - Number(a.doc.role === 'primary'));
    let sendable = 0;
    let local = 0;
    for (const h of ranked) {
      const send = maySend(h.doc);
      if (send ? sendable >= LIMITS.library : local >= LIMITS.localOnly) continue;
      const section = h.chunk.sectionPath.join(' › ') || 'Passage';
      const record: SourceRecord = {
        id: `library:${h.chunk.id}`,
        kind: 'library',
        title: `${h.doc.title} — ${section}`,
        publisher: h.doc.publisher,
        date: String(h.doc.year),
        url: `#/library/${h.doc.id}/page/${h.chunk.page}`,
        scope: 'passage',
        retrievedAt,
        sections: [{ name: section, text: h.chunk.text }],
        citation: h.citation,
        role: h.doc.role,
        ...(isOld(h.doc, today) ? { old: true as const } : {}),
        ...(send ? {} : { localOnly: true as const }),
        ids: { docId: h.doc.id, chunkId: h.chunk.id, page: String(h.chunk.page) },
      };
      if (send) {
        sendable++;
        chunkIds.push(h.chunk.id);
        add(record, [{ describe: `guideline passage (${h.doc.role === 'primary' ? 'the department’s primary document' : 'a reference document'}, ${h.doc.year})`, text: clip(h.chunk.text, LIMITS.passageChars) }]);
      } else {
        local++;
        sources.push(record);
      }
    }
    if (local && !sendable) notes.push('library_local_only');
  }

  // ---- the open sources: drug names and the question's words only
  if (!input.libraryOnly) {
    const base: ConnectorDeps = { store, caseId: input.caseId, ...(input.connectors ?? {}) };
    const attempt = async <T>(f: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await f();
      } catch (e) {
        if (e instanceof ConnectorError && e.code === 'identifier') throw e;
        const code = e instanceof ConnectorError && e.code === 'offline' ? 'open_sources_offline' : 'open_sources_failed';
        if (!notes.includes(code)) notes.push(code);
        return undefined;
      }
    };
    const seenPmid = new Set<string>();
    try {
      for (const drug of input.drugs.slice(0, LIMITS.drugs)) {
        const got = await attempt(() => openFdaLabels(drug, base, LIMITS.labels));
        for (const label of got?.records ?? []) {
          const parts = LABEL_SEND.flatMap((name) => {
            const sec = label.sections.find((x) => x.name === name || x.name.startsWith(name));
            return sec ? [{ section: name, describe: `drug label section "${name}" (${label.title})`, text: clip(sec.text, LIMITS.sectionChars) }] : [];
          });
          add(label, parts);
        }
      }
      const articles: SourceRecord[] = [];
      for (const r of (await attempt(() => pubMedSearch(input.query, base, LIMITS.articles)))?.records ?? []) {
        if (r.ids?.pmid) seenPmid.add(r.ids.pmid);
        articles.push(r);
      }
      for (const r of (await attempt(() => europePmcSearch(input.query, base, LIMITS.articles)))?.records ?? []) {
        if (r.ids?.pmid && seenPmid.has(r.ids.pmid)) continue;
        articles.push(r);
      }
      for (const a of articles) {
        const abstract = a.sections.find((x) => x.name === 'Abstract');
        add(a, abstract ? [{ section: 'Abstract', describe: 'abstract of a study — evidence to appraise, not guidance', text: clip(abstract.text, LIMITS.sectionChars) }] : []);
      }
    } catch (e) {
      if (e instanceof ConnectorError && e.code === 'identifier') notes.push('identifier_refused');
      else throw e;
    }
  }
  return { sources, sent, chunkIds, notes };
}
