/**
 * A retrieved source (Section 11, plan M5c): one record for everything the
 * app shows or cites from outside the model — a passage of the trainee's own
 * library, a section of a drug label, a PubMed or Europe PMC abstract, a
 * patient-information summary. A citation is rendered only from a
 * SourceRecord (Section 24: a model never writes a citation); the retrieval
 * date and the link recorded at retrieval are part of it.
 */
export const SOURCE_KINDS = ['library', 'openfda_label', 'dailymed', 'pubmed', 'europepmc', 'medlineplus'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** What the app holds of the source: a library passage, a label's sections, an abstract only, or a short summary. */
export type SourceScope = 'passage' | 'label_section' | 'abstract_only' | 'summary';

export interface SourceSection {
  name: string;
  text: string;
}

export interface SourceRecord {
  /** `${kind}:${external id}` — stable, so the same item is one source however often it is retrieved. */
  id: string;
  kind: SourceKind;
  title: string;
  /** Who published it: the manufacturer of a label, the journal of an article, the library of a service. */
  publisher: string;
  /** As the source gives it: YYYY, YYYY-MM or YYYY-MM-DD. */
  date?: string;
  /** Where the trainee can open it, recorded at retrieval. */
  url: string;
  scope: SourceScope;
  /** When the app retrieved it (ISO instant). */
  retrievedAt: string;
  sections: SourceSection[];
  /** Authors as the source lists them (articles). */
  authors?: string;
  /** A link to the full text, when the source offers one; the app holds the abstract only. */
  fullTextUrl?: string;
  /** Set for the source's own identifiers a trainee may search by (PMID, DOI, set id). */
  ids?: Record<string, string>;
}

/** Studies are evidence to be appraised, not guidance (plan M5c). */
export const isLiterature = (s: Pick<SourceRecord, 'kind'>): boolean => s.kind === 'pubmed' || s.kind === 'europepmc';

/** The label every literature result carries. */
export const LITERATURE_LABEL = 'Literature to appraise — not a recommendation in itself';

/** The web address of a DailyMed label by its set id; built here, never taken from a model. */
export const dailyMedUrl = (setId: string): string => `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(setId)}`;
export const pubMedUrl = (pmid: string): string => `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`;
export const europePmcUrl = (source: string, id: string): string => `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;

/** How a source is cited: from its record, with the date it was retrieved. */
export function sourceCitation(s: SourceRecord): string {
  const date = s.date ? `, ${s.date}` : '';
  const authors = s.authors ? `${s.authors}. ` : '';
  const scope = s.scope === 'abstract_only' ? ' (abstract only)' : '';
  return `${authors}${s.title} — ${s.publisher}${date}${scope}. Retrieved ${s.retrievedAt.slice(0, 10)}. ${s.url}`;
}
