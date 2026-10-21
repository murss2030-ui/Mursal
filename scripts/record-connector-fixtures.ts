/**
 * Records, once, what the open services really answer, for the connector
 * tests (plan M5c): `npx vite-node scripts/record-connector-fixtures.ts`.
 * The addresses come from the same builders the app uses. Answers are saved
 * as received; the only change is that an openFDA label keeps the fields the
 * app reads (its identifiers, openfda block and the sections in LABEL_SECTIONS)
 * and drops the rest of a long label. No key, no personal data: drug names and
 * a literature question only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { LABEL_SECTIONS, urls } from '../src/ai/connectors/open';

const OUT = new URL('../tests/fixtures/connectors/', import.meta.url);
mkdirSync(OUT, { recursive: true });

interface Recorded {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

async function get(url: string): Promise<Recorded> {
  const res = await fetch(url, { headers: { accept: 'application/json, application/xml;q=0.9' } });
  return { url, status: res.status, contentType: res.headers.get('content-type') ?? '', body: await res.text() };
}

function trimLabel(r: Recorded): Recorded {
  if (r.status !== 200) return r;
  const data = JSON.parse(r.body) as { meta?: unknown; results?: Record<string, unknown>[] };
  const keep = new Set(['set_id', 'id', 'version', 'effective_time', 'openfda', ...LABEL_SECTIONS.map(([f]) => f)]);
  data.results = (data.results ?? []).map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => keep.has(k))));
  return { ...r, body: JSON.stringify(data) };
}

async function save(name: string, reqs: Recorded[]) {
  writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify({ recordedAt: new Date().toISOString(), requests: reqs }, null, 1)}\n`);
  console.log(name, reqs.map((r) => `${r.status} ${r.body.length}B`).join(' · '));
}

const QUESTION = 'vancomycin AUC guided dosing nephrotoxicity';

await save('openfda-vancomycin', [trimLabel(await get(urls.label('openfda.generic_name', 'vancomycin', 3)))]);
await save('openfda-metformin', [trimLabel(await get(urls.label('openfda.generic_name', 'metformin', 3)))]);
await save('openfda-none', [await get(urls.label('openfda.generic_name', 'zzqxnotadrug', 3)), await get(urls.label('openfda.brand_name', 'zzqxnotadrug', 3))]);
const search = await get(urls.pubmedSearch(QUESTION, 3));
const ids = (JSON.parse(search.body) as { esearchresult: { idlist: string[] } }).esearchresult.idlist;
await save('pubmed-vancomycin', [search, await get(urls.pubmedFetch(ids))]);
await save('pubmed-none', [await get(urls.pubmedSearch('zzqxnotaterm qqwwee', 3))]);
await save('europepmc-vancomycin', [await get(urls.europePmc(QUESTION, 3))]);
await save('medlineplus-vancomycin', [await get(urls.medlinePlus('11124'))]);
await save('medlineplus-metformin', [await get(urls.medlinePlus('6809'))]);
