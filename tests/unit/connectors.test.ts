/**
 * M5c: the open sources — openFDA labels, PubMed, Europe PMC, MedlinePlus
 * Connect — read from answers recorded once from the real services
 * (tests/fixtures/connectors, made by scripts/record-connector-fixtures.ts).
 * The stand-in fetch serves a recorded answer only for the exact address the
 * app builds; any other address fails the test. Only drug names and the
 * question's words are sent, never an identifier; answers are cached with the
 * date they were retrieved; DailyMed is a link, never a call.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cached, clip, ConnectorError, decodeEntities, guardQuery, OPEN_HOSTS, plainText, type ConnectorDeps } from '../../src/ai/connectors/http';
import { europePmcSearch, medlinePlusFor, openFdaLabels, pubMedSearch, readLabels, renalHepaticSentences, urls } from '../../src/ai/connectors/open';
import { dailyMedUrl, isLiterature, LITERATURE_LABEL, sourceCitation } from '../../src/domain/sources';
import { newCase, newSession, rawDump } from './helpers';

interface Recorded {
  url: string;
  status: number;
  contentType: string;
  body: string;
}
const fixture = (name: string): Recorded[] => (JSON.parse(readFileSync(new URL(`../fixtures/connectors/${name}.json`, import.meta.url), 'utf8')) as { requests: Recorded[] }).requests;

/** Serves recorded answers by exact address; counts the calls; anything unrecorded is an error. */
function replay(...names: string[]) {
  const byUrl = new Map(names.flatMap(fixture).map((r) => [r.url, r]));
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const r = byUrl.get(url);
    if (!r) throw new Error(`unrecorded address: ${url}`);
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.contentType } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const online = () => true;
async function deps(over: Partial<ConnectorDeps> = {}, ...names: string[]) {
  const { store, clock } = await newSession();
  const r = replay(...names);
  return { d: { store, fetch: r.f, online, ...over } as ConnectorDeps, calls: r.calls, store, clock };
}
const DAY = 86_400_000;

const QUESTION = 'vancomycin AUC guided dosing nephrotoxicity';

describe('openFDA labels', () => {
  it('reads each label into sections with its manufacturer, date and a DailyMed link built from the set id', async () => {
    const { d, calls } = await deps({}, 'openfda-vancomycin');
    const r = await openFdaLabels('vancomycin', d);
    expect(calls).toEqual([urls.label('openfda.generic_name', 'vancomycin', 3)]);
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records.length).toBeLessThanOrEqual(3);
    for (const s of r.records) {
      expect(s).toMatchObject({ kind: 'openfda_label', scope: 'label_section' });
      expect(s.id).toBe(`openfda_label:${s.ids!.setId}`);
      expect(s.url).toBe(dailyMedUrl(s.ids!.setId!));
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.retrievedAt).toBe(r.retrievedAt);
      expect(s.title).toMatch(/prescribing information$/);
      expect(s.sections.map((x) => x.name)).toContain('Dosage and administration');
      expect(s.sections.find((x) => x.name === 'Contraindications')!.text).toMatch(/hypersensitivity/i);
      // The section heading the label prints at the top of each section is not repeated in the text.
      expect(s.sections.find((x) => x.name === 'Dosage and administration')!.text).not.toMatch(/^DOSAGE AND ADMINISTRATION/);
      expect(isLiterature(s)).toBe(false);
    }
  });

  it('collects the sentences about renal and hepatic function verbatim, naming the section of each', async () => {
    const { d } = await deps({}, 'openfda-metformin');
    const r = await openFdaLabels('metformin', d);
    const label = r.records.find((s) => s.sections.some((x) => x.name.startsWith('Renal and hepatic')))!;
    expect(label).toBeTruthy();
    const mentions = label.sections.find((x) => x.name.startsWith('Renal and hepatic'))!;
    const lines = mentions.text.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(12);
    const others = label.sections.filter((x) => x !== mentions);
    for (const line of lines) {
      const [, section, sentence] = /^\[([^\]]+)\] (.+)$/.exec(line)!;
      // Every sentence is found, word for word, in the section it names.
      expect(others.find((o) => o.name === section)!.text.replace(/\s+/g, ' ')).toContain(sentence);
      expect(sentence).toMatch(/renal|kidney|hepatic|liver|creatinine clearance|CrCl|eGFR|dialysis|cirrhosis|child-pugh/i);
    }
    expect(renalHepaticSentences([{ name: 'X', text: 'The tablet is white. Take with water.' }])).toBeUndefined();
  });

  it('tries the brand name when the generic name finds nothing; an unknown drug gives an empty answer, not an error', async () => {
    const { d, calls } = await deps({}, 'openfda-none');
    const r = await openFdaLabels('zzqxnotadrug', d);
    expect(r.records).toEqual([]);
    expect(calls).toEqual([urls.label('openfda.generic_name', 'zzqxnotadrug', 3), urls.label('openfda.brand_name', 'zzqxnotadrug', 3)]);
  });

  it('skips a result with no set id or no section, and one that is not a list', () => {
    expect(readLabels({ results: [{ id: 'x', dosage_and_administration: ['text'] }] })).toEqual([]);
    expect(readLabels({ results: [{ set_id: 'a', openfda: {} }] })).toEqual([]);
    expect(readLabels({ error: { code: 'NOT_FOUND' } })).toEqual([]);
    expect(readLabels(undefined)).toEqual([]);
  });

  it('cites a label from its record, with the date it was retrieved', async () => {
    const { d } = await deps({}, 'openfda-vancomycin');
    const s = (await openFdaLabels('vancomycin', d)).records[0]!;
    const c = sourceCitation(s);
    expect(c).toContain(s.title);
    expect(c).toContain(`Retrieved ${s.retrievedAt.slice(0, 10)}`);
    expect(c).toContain(s.url);
  });
});

describe('PubMed', () => {
  it('searches, then reads the abstracts; each is literature to appraise, abstract only, with its PubMed link', async () => {
    const { d, calls } = await deps({}, 'pubmed-vancomycin');
    const r = await pubMedSearch(QUESTION, d, 3);
    expect(calls[0]).toBe(urls.pubmedSearch(QUESTION, 3));
    expect(calls[1]).toMatch(/efetch\.fcgi\?.*id=\d+/);
    expect(r.records.length).toBeGreaterThan(0);
    for (const s of r.records) {
      expect(s).toMatchObject({ kind: 'pubmed', scope: 'abstract_only' });
      expect(s.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${s.ids!.pmid}/`);
      expect(s.id).toBe(`pubmed:${s.ids!.pmid}`);
      expect(s.title.length).toBeGreaterThan(10);
      expect(s.title).not.toMatch(/[<>]/);
      expect(s.publisher).not.toBe('Journal not stated');
      expect(s.date).toMatch(/^\d{4}(-\d{2})?$/);
      expect(s.sections[0]?.name).toBe('Abstract');
      expect(s.sections[0]!.text).not.toMatch(/<[a-z]/i);
      expect(isLiterature(s)).toBe(true);
    }
    expect(LITERATURE_LABEL).toBe('Literature to appraise — not a recommendation in itself');
    expect(r.records.some((s) => s.ids!.publicationTypes)).toBe(true);
  });

  it('an empty search stops after one call', async () => {
    const { d, calls } = await deps({}, 'pubmed-none');
    const r = await pubMedSearch('zzqxnotaterm qqwwee', d, 3);
    expect(r.records).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('Europe PMC', () => {
  it('reads core results: journal, authors, date, the abstract without markup, and a free full-text link when there is one', async () => {
    const { d, calls } = await deps({}, 'europepmc-vancomycin');
    const r = await europePmcSearch(QUESTION, d, 3);
    expect(calls).toEqual([urls.europePmc(QUESTION, 3)]);
    expect(decodeURIComponent(calls[0]!)).toContain('NOT SRC:PPR');
    expect(r.records.length).toBeGreaterThan(0);
    for (const s of r.records) {
      expect(s).toMatchObject({ kind: 'europepmc', scope: 'abstract_only' });
      expect(s.url).toBe(`https://europepmc.org/article/${s.ids!.source}/${s.ids!.id}`);
      expect(s.authors).toBeTruthy();
      expect(s.sections[0]?.text ?? '').not.toMatch(/<\/?h4>|<[a-z]+>/i);
      expect(isLiterature(s)).toBe(true);
    }
    expect(r.records.some((s) => s.fullTextUrl)).toBe(true);
  });
});

describe('MedlinePlus Connect', () => {
  it('reads patient-information summaries by RxCUI, with the tracking parameters removed from the link', async () => {
    const { d, calls } = await deps({}, 'medlineplus-vancomycin');
    const r = await medlinePlusFor('11124', d);
    expect(calls).toEqual([urls.medlinePlus('11124')]);
    expect(r.records.length).toBeGreaterThan(0);
    for (const s of r.records) {
      expect(s).toMatchObject({ kind: 'medlineplus', scope: 'summary', publisher: 'MedlinePlus, U.S. National Library of Medicine' });
      expect(s.url).toMatch(/^https:\/\/medlineplus\.gov\/druginfo\/meds\/a\d+\.html$/);
      expect(s.sections[0]!.text).not.toMatch(/<[a-z]/i);
      expect(s.ids).toEqual({ rxcui: '11124' });
    }
  });

  it('is searched by the RxNorm code only', async () => {
    const { d, calls } = await deps();
    await expect(medlinePlusFor('vancomycin', d)).rejects.toMatchObject({ code: 'empty_query' });
    expect(calls).toEqual([]);
  });
});

describe('only drug names and clinical words leave the device', () => {
  it('refuses a query holding the case’s patient name, record number, a phone number, a doctor or a calendar date — before any call', async () => {
    const { store } = await newSession();
    const c = await newCase(store, { kind: 'clinical', identifiers: { patientName: 'Saleh Qaid', mrn: 'MRN-77120', consultantName: 'Hamdan Saif' } } as never);
    const r = replay();
    const d: ConnectorDeps = { store, fetch: r.f, online, caseId: c.id };
    for (const q of ['vancomycin dosing for Saleh', 'vancomycin MRN-77120', 'dose adjustment ask Hamdan', 'vancomycin call 0501234567', 'vancomycin started 16/10/2026', 'vancomycin 2026-10-16', 'vancomycin Dr Hamdan']) {
      await expect(pubMedSearch(q, d), q).rejects.toMatchObject({ code: 'identifier' });
      await expect(europePmcSearch(q, d), q).rejects.toMatchObject({ code: 'identifier' });
      await expect(openFdaLabels(q, d), q).rejects.toMatchObject({ code: 'identifier' });
    }
    expect(r.calls).toEqual([]);
    await expect(guardQuery(store, c.id, '   ')).rejects.toMatchObject({ code: 'empty_query' });
    // Clinical words, doses and ordinary numbers are allowed.
    await expect(guardQuery(store, c.id, 'vancomycin 15 mg/kg every 12 hours creatinine clearance 45 mL/min')).resolves.toContain('vancomycin');
  });

  it('every address is on a host the Content-Security-Policy allows; DailyMed is never called', () => {
    const all = [urls.label('openfda.generic_name', 'x', 3), urls.pubmedSearch('x', 3), urls.pubmedFetch(['1']), urls.europePmc('x', 3), urls.medlinePlus('1')];
    for (const u of all) expect(OPEN_HOSTS.some((h) => u.startsWith(`${h}/`))).toBe(true);
    expect(OPEN_HOSTS.join(' ')).not.toContain('dailymed');
    const config = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    for (const h of OPEN_HOSTS) expect(config).toContain(h);
    expect(config).not.toMatch(/connect-src[^\n]*dailymed/);
    expect(dailyMedUrl('abc-123')).toBe('https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=abc-123');
  });
});

describe('the cache, the connection and the failures', () => {
  it('a lookup is made once: the second is served from the device with the first retrieval date', async () => {
    const { d, calls, store } = await deps({}, 'openfda-vancomycin');
    const first = await openFdaLabels('Vancomycin', d);
    const second = await openFdaLabels('vancomycin', d);
    expect(calls).toHaveLength(1);
    expect(first.fromCache).toBe(false);
    expect(second).toMatchObject({ fromCache: true, stale: false, retrievedAt: first.retrievedAt });
    expect(second.records).toEqual(first.records);
    // Kept encrypted with the rest of the data.
    expect(await rawDump((store as unknown as { db: Parameters<typeof rawDump>[0] }).db)).not.toContain('hypersensitivity');
  });

  it('an old answer is fetched again when online; the trainee can ask to look again', async () => {
    const { d, calls, clock } = await deps({}, 'openfda-vancomycin');
    await openFdaLabels('vancomycin', d);
    clock.advance(29 * DAY);
    await openFdaLabels('vancomycin', d);
    expect(calls).toHaveLength(1);
    clock.advance(2 * DAY);
    await openFdaLabels('vancomycin', d);
    expect(calls).toHaveLength(2);
    await openFdaLabels('vancomycin', { ...d, refresh: true });
    expect(calls).toHaveLength(3);
  });

  it('offline: an old answer is kept and said to be old; with nothing stored it says so', async () => {
    const { d, clock } = await deps({}, 'openfda-vancomycin');
    await expect(openFdaLabels('vancomycin', { ...d, online: () => false })).rejects.toMatchObject({ code: 'offline' });
    await openFdaLabels('vancomycin', d);
    clock.advance(90 * DAY);
    const old = await openFdaLabels('vancomycin', { ...d, online: () => false });
    expect(old).toMatchObject({ fromCache: true, stale: true });
    expect(old.records.length).toBeGreaterThan(0);
  });

  it('when the service fails, an old answer is kept (stale); with none, the failure is named', async () => {
    const { d, store, clock } = await deps({}, 'openfda-vancomycin');
    await openFdaLabels('vancomycin', d);
    clock.advance(40 * DAY);
    const down = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    expect(await openFdaLabels('vancomycin', { ...d, fetch: down })).toMatchObject({ stale: true });
    const limited = (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch;
    await expect(pubMedSearch('vancomycin dosing', { store, fetch: limited, online })).rejects.toMatchObject({ code: 'rate_limited' });
    const broken = (async () => {
      throw new TypeError('failed');
    }) as unknown as typeof fetch;
    await expect(europePmcSearch('vancomycin dosing', { store, fetch: broken, online })).rejects.toMatchObject({ code: 'network' });
    const html = (async () => new Response('<html>maintenance</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(europePmcSearch('vancomycin dosing', { store, fetch: html, online })).rejects.toMatchObject({ code: 'shape' });
    await expect(pubMedSearch('vancomycin dosing', { store, fetch: down, online })).rejects.toBeInstanceOf(ConnectorError);
  });

  it('nothing is cached for a failed lookup', async () => {
    const { store } = await newSession();
    const down = (async () => new Response('busy', { status: 500 })) as unknown as typeof fetch;
    await expect(cached({ store, fetch: down, online }, 'k', async () => Promise.reject(new ConnectorError('http', 'x')))).rejects.toBeTruthy();
    expect(await store.getLookup('k')).toBeUndefined();
  });
});

describe('text helpers', () => {
  it('removes markup, decodes entities, keeps line breaks of block elements', () => {
    expect(plainText('<p>Dose &amp; interval &ge; 12&nbsp;h</p><p>Next <b>line</b></p>')).toBe('Dose & interval ≥ 12 h\nNext line');
    expect(decodeEntities('&#x3BC;g and &#956;g &unknown; &lt;')).toBe('μg and μg &unknown; <');
  });

  it('clips a long text at a sentence or word and says so', () => {
    const t = `${'First sentence is here. '.repeat(30)}`;
    const c = clip(t, 200);
    expect(c.length).toBeLessThanOrEqual(210);
    expect(c.endsWith('[…]')).toBe(true);
    expect(clip('short', 200)).toBe('short');
  });
});
