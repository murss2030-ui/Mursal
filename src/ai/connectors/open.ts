/**
 * The open sources (Section 11, plan M5c): openFDA drug labels, PubMed
 * (E-utilities), Europe PMC and MedlinePlus Connect, each returning
 * SourceRecords. DailyMed is reached by link only (its service sends no CORS
 * headers, so a browser cannot call it): the link is built from the label's
 * set id. Only drug names and the question's words are sent; no key is used
 * (a key could not be kept in a browser); every answer is cached with its
 * retrieval date. The readers are pure functions over the services' own JSON
 * and XML, tested against answers recorded from the real services.
 */
import { dailyMedUrl, europePmcUrl, pubMedUrl, type SourceRecord, type SourceSection } from '../../domain/sources';
import { cached, clip, ConnectorError, decodeEntities, getJson, getText, guardQuery, plainText, type ConnectorDeps } from './http';

export const FDA = 'https://api.fda.gov';
export const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
export const MEDLINEPLUS = 'https://connect.medlineplus.gov/service';

/** The addresses asked, built in one place so the recorded fixtures and the connectors can never disagree. */
export const urls = {
  label: (field: 'openfda.generic_name' | 'openfda.brand_name', name: string, limit: number) => `${FDA}/drug/label.json?search=${encodeURIComponent(`${field}:"${name}"`)}&limit=${limit}`,
  pubmedSearch: (q: string, limit: number) => `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${limit}&tool=preceptor&term=${encodeURIComponent(q)}`,
  pubmedFetch: (ids: readonly string[]) => `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&tool=preceptor&id=${ids.join(',')}`,
  europePmc: (q: string, limit: number) => `${EPMC}/search?format=json&resultType=core&pageSize=${limit}&query=${encodeURIComponent(`${q} NOT SRC:PPR`)}`,
  medlinePlus: (rxcui: string) => `${MEDLINEPLUS}?mainSearchCriteria.v.cs=2.16.840.1.113883.6.88&mainSearchCriteria.v.c=${rxcui}&knowledgeResponseType=application/json&informationRecipient.languageCode.c=en`,
};

export interface Retrieved {
  records: SourceRecord[];
  /** When the answer was retrieved. */
  retrievedAt: string;
  fromCache: boolean;
  /** Kept from an earlier retrieval because the service could not be reached. */
  stale: boolean;
}

type Stored = Omit<SourceRecord, 'retrievedAt'>;
const withDate = (items: Stored[], retrievedAt: string): SourceRecord[] => items.map((s) => ({ ...s, retrievedAt }));

const SECTION_MAX = 8000;
const ABSTRACT_MAX = 6000;

// ------------------------------------------------------------------ openFDA labels

/** Label sections that matter to a medication review, in the order shown (openFDA field → heading). */
export const LABEL_SECTIONS: readonly (readonly [string, string])[] = [
  ['boxed_warning', 'Boxed warning'],
  ['indications_and_usage', 'Indications and usage'],
  ['dosage_and_administration', 'Dosage and administration'],
  ['contraindications', 'Contraindications'],
  ['warnings_and_cautions', 'Warnings and precautions'],
  ['warnings', 'Warnings'],
  ['precautions', 'Precautions'],
  ['drug_interactions', 'Drug interactions'],
  ['use_in_specific_populations', 'Use in specific populations'],
  ['pregnancy', 'Pregnancy'],
  ['pediatric_use', 'Pediatric use'],
  ['geriatric_use', 'Geriatric use'],
];

const RENAL_HEPATIC = /\b(renal|kidney|hepatic|liver|creatinine clearance|CrCl|eGFR|dialysis|cirrhosis|child-pugh)\b/i;

/** The sentences of the label’s own text that mention renal or hepatic function, verbatim, with the section each came from. */
export function renalHepaticSentences(sections: readonly SourceSection[], max = 12): SourceSection | undefined {
  const out: string[] = [];
  for (const s of sections) {
    for (const sentence of s.text.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)) {
      const t = sentence.replace(/\s+/g, ' ').trim();
      if (t.length >= 20 && t.length <= 600 && RENAL_HEPATIC.test(t) && !out.some((o) => o.endsWith(t))) out.push(`[${s.name}] ${t}`);
      if (out.length >= max) break;
    }
    if (out.length >= max) break;
  }
  return out.length ? { name: 'Renal and hepatic mentions (sentences quoted from the sections above)', text: out.join('\n') } : undefined;
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : undefined) : typeof v === 'string' ? v : undefined);

const isoDate = (yyyymmdd?: string): string | undefined => (yyyymmdd && /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : undefined);

/** Reads an openFDA label.json answer into one record per label (exported for tests with recorded answers). */
export function readLabels(body: unknown): Stored[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: Stored[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const setId = typeof r.set_id === 'string' ? r.set_id : undefined;
    if (!setId) continue;
    const of = (r.openfda ?? {}) as Record<string, unknown>;
    const brand = first(of.brand_name);
    const generic = first(of.generic_name);
    const sections: SourceSection[] = [];
    for (const [field, name] of LABEL_SECTIONS) {
      const v = r[field];
      const raw = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join('\n') : typeof v === 'string' ? v : '';
      const text = clip(plainText(raw).replace(/^[A-Z][A-Z &,/-]{3,}\s+(?=[A-Z][a-z])/, ''), SECTION_MAX);
      if (text) sections.push({ name, text });
    }
    if (!sections.length) continue;
    const rh = renalHepaticSentences(sections);
    if (rh) sections.push(rh);
    const date = isoDate(typeof r.effective_time === 'string' ? r.effective_time : undefined);
    out.push({
      id: `openfda_label:${setId}`,
      kind: 'openfda_label',
      title: `${brand ?? generic ?? 'Drug label'}${brand && generic && brand.toLowerCase() !== generic.toLowerCase() ? ` (${generic})` : ''} — prescribing information`,
      publisher: first(of.manufacturer_name) ?? 'Label holder not stated',
      ...(date ? { date } : {}),
      url: dailyMedUrl(setId),
      scope: 'label_section',
      sections,
      ids: { setId, ...(typeof r.version === 'string' ? { version: r.version } : {}) },
    });
  }
  return out;
}

/** The labels openFDA holds for a drug (generic name, then brand name), at most three, with a DailyMed link each. */
export async function openFdaLabels(drug: string, deps: ConnectorDeps, limit = 3): Promise<Retrieved> {
  const name = (await guardQuery(deps.store, deps.caseId, drug)).replace(/["\\]/g, '').toLowerCase();
  if (!name) throw new ConnectorError('empty_query', 'There is nothing to look up.');
  const got = await cached<Stored[]>(deps, `openfda:label:${limit}:${name.toLowerCase()}`, async () => {
    for (const field of ['openfda.generic_name', 'openfda.brand_name'] as const) {
      const body = await getJson(deps, urls.label(field, name, limit));
      const labels = readLabels(body);
      if (labels.length) return labels;
    }
    return [];
  });
  return { records: withDate(got.value, got.retrievedAt), retrievedAt: got.retrievedAt, fromCache: got.fromCache, stale: got.stale };
}

// ------------------------------------------------------------------ PubMed (E-utilities)

/** The PMIDs in an esearch answer. */
export function readPubMedIds(body: unknown): string[] {
  const ids = (body as { esearchresult?: { idlist?: unknown } })?.esearchresult?.idlist;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x)) : [];
}

const tag = (xml: string, name: string): string | undefined => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];

/** Reads an efetch XML answer (PubmedArticleSet) into records, abstract only (exported for tests with recorded answers). */
export function readPubMedXml(xml: string): Stored[] {
  const out: Stored[] = [];
  for (const m of xml.matchAll(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g)) {
    const a = m[0];
    const pmid = /<PMID\b[^>]*>(\d+)<\/PMID>/.exec(a)?.[1];
    const title = plainText(tag(a, 'ArticleTitle') ?? '');
    if (!pmid || !title) continue;
    const abstract = [...a.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map((x) => {
        const label = /Label="([^"]*)"/.exec(x[1] ?? '')?.[1];
        const text = plainText(x[2] ?? '');
        return text ? (label ? `${decodeEntities(label)}: ${text}` : text) : '';
      })
      .filter(Boolean)
      .join('\n');
    const journal = plainText(tag(tag(a, 'Journal') ?? '', 'Title') ?? '') || 'Journal not stated';
    const pub = tag(tag(a, 'JournalIssue') ?? '', 'PubDate') ?? '';
    const year = /<Year>(\d{4})<\/Year>/.exec(pub)?.[1] ?? /(\d{4})/.exec(tag(pub, 'MedlineDate') ?? '')?.[1];
    const monthText = /<Month>([^<]+)<\/Month>/.exec(pub)?.[1];
    const month = monthText ? (/^\d+$/.test(monthText) ? Number(monthText) : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(monthText.slice(0, 3).toLowerCase()) + 1) : 0;
    const date = year ? (month > 0 ? `${year}-${String(month).padStart(2, '0')}` : year) : undefined;
    const authors = [...(tag(a, 'AuthorList') ?? '').matchAll(/<Author\b[\s\S]*?<\/Author>/g)]
      .map((x) => {
        const last = tag(x[0], 'LastName');
        const ini = tag(x[0], 'Initials');
        const collective = tag(x[0], 'CollectiveName');
        return plainText(collective ?? (last ? `${last}${ini ? ` ${ini}` : ''}` : ''));
      })
      .filter(Boolean);
    const doi = /<ArticleId\b[^>]*IdType="doi"[^>]*>([^<]+)<\/ArticleId>/.exec(a)?.[1];
    const types = [...a.matchAll(/<PublicationType\b[^>]*>([^<]+)<\/PublicationType>/g)].map((x) => decodeEntities(x[1]!.trim()));
    out.push({
      id: `pubmed:${pmid}`,
      kind: 'pubmed',
      title,
      publisher: journal,
      ...(date ? { date } : {}),
      url: pubMedUrl(pmid),
      scope: 'abstract_only',
      sections: abstract ? [{ name: 'Abstract', text: clip(abstract, ABSTRACT_MAX) }] : [],
      ...(authors.length ? { authors: authors.length > 6 ? `${authors.slice(0, 6).join(', ')}, et al` : authors.join(', ') } : {}),
      ...(doi ? { fullTextUrl: `https://doi.org/${doi}` } : {}),
      ids: { pmid, ...(doi ? { doi } : {}), ...(types.length ? { publicationTypes: types.join('; ') } : {}) },
    });
  }
  return out;
}

/** PubMed abstracts for a question's words (the most relevant few), each labelled as literature to appraise. */
export async function pubMedSearch(query: string, deps: ConnectorDeps, limit = 5): Promise<Retrieved> {
  const q = await guardQuery(deps.store, deps.caseId, query);
  const got = await cached<Stored[]>(deps, `pubmed:search:${limit}:${q.toLowerCase()}`, async () => {
    const found = await getJson(deps, urls.pubmedSearch(q, limit));
    const ids = readPubMedIds(found);
    if (!ids.length) return [];
    return readPubMedXml(await getText(deps, urls.pubmedFetch(ids)));
  });
  return { records: withDate(got.value, got.retrievedAt), retrievedAt: got.retrievedAt, fromCache: got.fromCache, stale: got.stale };
}

// ------------------------------------------------------------------ Europe PMC

interface EpmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalInfo?: { journal?: { title?: string } };
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  abstractText?: string;
  isOpenAccess?: string;
  fullTextUrlList?: { fullTextUrl?: { url?: string; availabilityCode?: string; documentStyle?: string }[] };
  pubTypeList?: { pubType?: string[] };
}

/** Reads a Europe PMC search answer (resultType=core) into records (exported for tests with recorded answers). */
export function readEuropePmc(body: unknown): Stored[] {
  const list = (body as { resultList?: { result?: EpmcResult[] } })?.resultList?.result;
  if (!Array.isArray(list)) return [];
  const out: Stored[] = [];
  for (const r of list) {
    if (!r.id || !r.source || !r.title) continue;
    const title = plainText(r.title);
    const abstract = r.abstractText ? plainText(r.abstractText.replace(/<h4>([^<]*)<\/h4>/gi, '\n$1: ')) : '';
    const free = r.fullTextUrlList?.fullTextUrl?.find((u) => u.availabilityCode === 'F' || u.availabilityCode === 'OA');
    const date = r.firstPublicationDate && /^\d{4}-\d{2}-\d{2}$/.test(r.firstPublicationDate) ? r.firstPublicationDate : r.pubYear;
    const authors = r.authorString?.replace(/\.$/, '').trim();
    const types = r.pubTypeList?.pubType?.filter((t) => typeof t === 'string') ?? [];
    out.push({
      id: `europepmc:${r.source}:${r.id}`,
      kind: 'europepmc',
      title,
      publisher: plainText(r.journalInfo?.journal?.title ?? r.journalTitle ?? '') || 'Journal not stated',
      ...(date ? { date } : {}),
      url: europePmcUrl(r.source, r.id),
      scope: 'abstract_only',
      sections: abstract ? [{ name: 'Abstract', text: clip(abstract, ABSTRACT_MAX) }] : [],
      ...(authors ? { authors } : {}),
      ...(free?.url ? { fullTextUrl: free.url } : r.doi ? { fullTextUrl: `https://doi.org/${r.doi}` } : {}),
      ids: { source: r.source, id: r.id, ...(r.pmid ? { pmid: r.pmid } : {}), ...(r.doi ? { doi: r.doi } : {}), ...(types.length ? { publicationTypes: types.join('; ') } : {}) },
    });
  }
  return out;
}

/** Europe PMC abstracts (peer-reviewed sources only; preprints are left out). */
export async function europePmcSearch(query: string, deps: ConnectorDeps, limit = 5): Promise<Retrieved> {
  const q = await guardQuery(deps.store, deps.caseId, query);
  const got = await cached<Stored[]>(deps, `europepmc:search:${limit}:${q.toLowerCase()}`, async () =>
    readEuropePmc(await getJson(deps, urls.europePmc(q, limit))),
  );
  return { records: withDate(got.value, got.retrievedAt), retrievedAt: got.retrievedAt, fromCache: got.fromCache, stale: got.stale };
}

// ------------------------------------------------------------------ MedlinePlus Connect

interface FeedEntry {
  title?: { _value?: string };
  link?: { href?: string }[];
  summary?: { _value?: string };
  updated?: { _value?: string };
}

/** Reads a MedlinePlus Connect (JSON) answer into patient-information summaries. */
export function readMedlinePlus(body: unknown, rxcui: string): Stored[] {
  const entries = (body as { feed?: { entry?: FeedEntry[] } })?.feed?.entry;
  if (!Array.isArray(entries)) return [];
  const out: Stored[] = [];
  for (const e of entries) {
    const title = e.title?._value ? plainText(e.title._value) : '';
    const href = e.link?.[0]?.href?.replace(/[?&]utm_[^&]*/g, '').replace(/\?$/, '');
    const text = e.summary?._value ? plainText(e.summary._value) : '';
    if (!title || !href || !/^https:\/\/medlineplus\.gov\//.test(href) || !text) continue;
    out.push({
      id: `medlineplus:${href.replace(/^https:\/\/medlineplus\.gov\//, '')}`,
      kind: 'medlineplus',
      title,
      publisher: 'MedlinePlus, U.S. National Library of Medicine',
      url: href,
      scope: 'summary',
      sections: [{ name: 'Summary for patients', text: clip(text, SECTION_MAX) }],
      ids: { rxcui },
    });
  }
  return out;
}

/** Patient-counselling summaries for an RxNorm concept (the drug's RxCUI is the only thing sent). */
export async function medlinePlusFor(rxcui: string, deps: ConnectorDeps): Promise<Retrieved> {
  if (!/^\d{1,10}$/.test(rxcui)) throw new ConnectorError('empty_query', 'MedlinePlus is searched by the drug’s RxNorm code.');
  const got = await cached<Stored[]>(deps, `medlineplus:rxcui:${rxcui}`, async () =>
    readMedlinePlus(await getJson(deps, urls.medlinePlus(rxcui)), rxcui),
  );
  return { records: withDate(got.value, got.retrievedAt), retrievedAt: got.retrievedAt, fromCache: got.fromCache, stale: got.stale };
}
