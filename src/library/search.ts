/**
 * Search of the evidence library (Section 11): hybrid — a lexical index
 * (BM25) and, for documents whose licence allows their text to be sent,
 * vectors — fused by reciprocal rank, with exact drug-name matches kept on
 * top because drug names fail semantic search. Everything runs on the
 * device; only a question's vector is computed by the AI service.
 */

const STOPWORDS = new Set(
  'a an and are as at be been by for from has have in into is it its of on or that the their there these this to was were which with within without not no than then also may can should would could will such per via vs'.split(' '),
);

/** Lower case, punctuation removed, stop words dropped, plurals folded ("statins" → "statin"); numbers and drug names kept whole. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)))
    .map((t) => (/\d/.test(t) ? t : t.replace(/ies$/, 'y').replace(/(?<=[^s])s$/, '')));
}

export interface IndexedDoc {
  id: string;
  text: string;
}

export interface Bm25Index {
  ids: string[];
  /** Term frequencies per document. */
  tf: Map<string, number>[];
  lengths: number[];
  df: Map<string, number>;
  avg: number;
}

export function buildIndex(docs: readonly IndexedDoc[]): Bm25Index {
  const tf: Map<string, number>[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    const tokens = tokenize(d.text);
    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    lengths.push(tokens.length);
  }
  return { ids: docs.map((d) => d.id), tf, lengths, df, avg: lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length) };
}

const K1 = 1.2;
const B = 0.75;

/** Documents ranked by BM25 for a query; documents sharing no term are left out. */
export function bm25(index: Bm25Index, query: string): { id: string; score: number }[] {
  const terms = [...new Set(tokenize(query))];
  const n = index.ids.length;
  const out: { id: string; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    let score = 0;
    for (const t of terms) {
      const f = index.tf[i]!.get(t);
      if (!f) continue;
      const df = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * index.lengths[i]!) / (index.avg || 1)));
    }
    if (score > 0) out.push({ id: index.ids[i]!, score });
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The constant of reciprocal rank fusion: a document's score is the sum of 1 / (K + rank) over the rankings that hold it. */
export const RRF_K = 60;
/** Vector matches below this similarity are not counted as matches at all. */
export const MIN_SIMILARITY = 0.3;

export interface SearchHit {
  id: string;
  score: number;
  lexicalRank?: number;
  vectorRank?: number;
  similarity?: number;
  /** The passage names a drug the question names, word for word. */
  drugMatch: boolean;
}

export interface HybridInput {
  docs: readonly IndexedDoc[];
  index?: Bm25Index;
  /** Vectors by document id: only passages that may be sent to the AI service have one. */
  vectors?: ReadonlyMap<string, readonly number[]>;
  queryVector?: readonly number[];
  /** Drug names in the question (from the app's vocabulary), matched as whole words. */
  drugs?: readonly string[];
  limit?: number;
}

const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');

export function hybridSearch(query: string, input: HybridInput): SearchHit[] {
  const index = input.index ?? buildIndex(input.docs);
  const lexical = bm25(index, query);
  const vector =
    input.queryVector && input.vectors
      ? [...input.vectors]
          .map(([id, v]) => ({ id, similarity: cosine(input.queryVector!, v) }))
          .filter((x) => x.similarity >= MIN_SIMILARITY)
          .sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : 1))
      : [];
  const hits = new Map<string, SearchHit>();
  const hit = (id: string) => hits.get(id) ?? hits.set(id, { id, score: 0, drugMatch: false }).get(id)!;
  lexical.forEach((x, i) => {
    const h = hit(x.id);
    h.lexicalRank = i + 1;
    h.score += 1 / (RRF_K + i + 1);
  });
  vector.forEach((x, i) => {
    const h = hit(x.id);
    h.vectorRank = i + 1;
    h.similarity = x.similarity;
    h.score += 1 / (RRF_K + i + 1);
  });
  const text = new Map(input.docs.map((d) => [d.id, d.text]));
  const drugs = (input.drugs ?? []).map(word);
  for (const h of hits.values()) h.drugMatch = drugs.some((re) => re.test(text.get(h.id) ?? ''));
  return [...hits.values()]
    .sort((a, b) => Number(b.drugMatch) - Number(a.drugMatch) || b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, input.limit ?? 20);
}
