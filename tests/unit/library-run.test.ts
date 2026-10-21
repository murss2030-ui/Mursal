/**
 * M5: searching the evidence library and computing its vectors. Search by
 * words runs on the device; search by meaning adds only the question's vector
 * (computed through the relay), from documents whose text may be sent; a
 * document kept for local search only is never embedded. A failed or missing
 * embedding service leaves search by words working and says why. The relay is
 * a stand-in; no call leaves the test.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentMetaInput } from '../../src/domain/library';
import { EMBED_LIMITS, type EmbedRequest } from '../../src/ai/protocol';
import { embedDocument, searchLibrary } from '../../src/library/run';
import { GUIDE, isDrug, line, page } from './library-fixtures';
import { newSession } from './helpers';

const pdf = (marker: string) => new TextEncoder().encode(`%PDF-1.4\n% synthetic ${marker}\n`);
const META: DocumentMetaInput = { title: 'Synthetic test guideline', publisher: 'Synthetic Society', year: '2024', licence: 'CC BY 4.0', aiUse: 'local_only', role: 'primary', retrievedOn: '2026-10-12' };

/** A stand-in embedding service: a three-number vector that says "penicillin", "kidney", "other". */
const vectorOf = (text: string): number[] => [/penicillin/i.test(text) ? 1 : 0, /kidney|renal|CrCl/i.test(text) ? 1 : 0, 0.1];

function embedRelay(opts: { fail?: boolean } = {}) {
  const bodies: EmbedRequest[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)) as EmbedRequest;
    bodies.push(b);
    if (opts.fail) return new Response(JSON.stringify({ error: { code: 'provider_unavailable', message: 'down' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ vectors: b.texts.map(vectorOf), usage: { inputTokens: 10, outputTokens: 0, costUsd: 0 }, model: b.model, budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, bodies, deps: { fetch: f, online: () => true, sleep: async () => {} } };
}

describe('searching the library', () => {
  it('searches by words on the device, cites from the record, and says when a document is old', async () => {
    const { store } = await newSession();
    const recent = await store.addDocument({ meta: META, file: { name: 'a.pdf', bytes: pdf('a') }, pages: GUIDE, pageCount: 3, isDrug });
    const old = await store.addDocument({
      meta: { ...META, title: 'Older synthetic guideline', year: '2018', role: 'reference' },
      file: { name: 'b.pdf', bytes: pdf('b') },
      pages: [page(1, line('Recommendation 1. We recommend that synthetic monitoring be done every day in adults with the synthetic syndrome, as an older document said.', 80), line('(Strong recommendation, low-quality evidence)', 94))],
      pageCount: 1,
    });
    const r = await searchLibrary(store, 'synthetic monitoring every day');
    expect(r.byMeaning).toBe(false);
    expect(r.meaningSkipped).toBeUndefined();
    const fromOld = r.hits.find((h) => h.doc.id === old.id)!;
    expect(fromOld.old).toBe(true);
    expect(fromOld.citation).toBe(`Synthetic Society. Older synthetic guideline, 2018, p. 1 [reference document]`);
    expect(r.hits.find((h) => h.doc.id === recent.id)!.old).toBe(false);
    expect(r.hits.every((h) => h.citation.includes(h.doc.title) && h.citation.includes('p. '))).toBe(true);
  });

  it('a removed document is not searched', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: META, file: { name: 'a.pdf', bytes: pdf('a') }, pages: GUIDE, pageCount: 3 });
    expect((await searchLibrary(store, 'synthetic agent adults')).hits.length).toBeGreaterThan(0);
    await store.removeDocument(doc.id, 'Superseded by the new edition');
    expect((await searchLibrary(store, 'synthetic agent adults')).hits).toEqual([]);
  });

  it('asks for the question’s vector only when an embedding model is chosen, and keeps the exact words on top', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'a.pdf', bytes: pdf('m') }, pages: GUIDE, pageCount: 3 });
    const relay = embedRelay();
    // No embedding model chosen: by words, and no call.
    const none = await searchLibrary(store, 'renal dosing', { deps: relay.deps });
    expect(none).toMatchObject({ byMeaning: false, hits: [] });
    expect(relay.bodies).toEqual([]);
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    // Chosen but the passages have no vectors yet: says so.
    expect((await searchLibrary(store, 'renal dosing', { deps: relay.deps })).meaningSkipped).toBe('no_vectors');
    expect(relay.bodies).toEqual([]);
    await embedDocument(store, doc.id, relay.deps);
    const found = await searchLibrary(store, 'renal dosing', { deps: relay.deps });
    expect(found.byMeaning).toBe(true);
    expect(found.hits[0]!.chunk.kind).toBe('table');
    expect(found.hits[0]!.chunk.text).toContain('kidney');
    // Only the question was sent, as a query.
    const asked = relay.bodies.at(-1)!;
    expect(asked).toMatchObject({ purpose: 'query', texts: ['renal dosing'], caseKind: 'teaching' });
  });

  it('when the embedding service fails, search by words goes on and the reason is said', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'a.pdf', bytes: pdf('f') }, pages: GUIDE, pageCount: 3 });
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    await embedDocument(store, doc.id, embedRelay().deps);
    const down = embedRelay({ fail: true });
    const r = await searchLibrary(store, 'synthetic agent within one hour', { deps: down.deps });
    expect(r.byMeaning).toBe(false);
    expect(r.meaningSkipped).toBeTruthy();
    expect(r.hits.length).toBeGreaterThan(0);
    // Offline is the same: no call, words only.
    const offline = await searchLibrary(store, 'synthetic agent within one hour', { deps: { online: () => false } });
    expect(offline).toMatchObject({ byMeaning: false, meaningSkipped: 'offline' });
    expect(offline.hits.length).toBeGreaterThan(0);
  });

  it('ignores vectors of another model, and a search by words alone can be asked for', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'a.pdf', bytes: pdf('o') }, pages: GUIDE, pageCount: 3 });
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    await embedDocument(store, doc.id, embedRelay().deps);
    await store.updateAiSettings({ models: { embed: 'embed-b' } });
    const relay = embedRelay();
    expect((await searchLibrary(store, 'renal dosing', { deps: relay.deps })).meaningSkipped).toBe('no_vectors');
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    const wordsOnly = await searchLibrary(store, 'synthetic agent adults', { byMeaning: false, deps: relay.deps });
    expect(wordsOnly.byMeaning).toBe(false);
    expect(relay.bodies).toEqual([]);
  });
});

describe('computing the vectors of a document', () => {
  it('refuses a document kept for local search only, before any call', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: META, file: { name: 'a.pdf', bytes: pdf('l') }, pages: GUIDE, pageCount: 3 });
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    const relay = embedRelay();
    await expect(embedDocument(store, doc.id, relay.deps)).rejects.toThrow(/local search only/);
    expect(relay.bodies).toEqual([]);
  });

  it('sends the passages in batches the relay accepts, reports progress, and stores them all', async () => {
    const { store } = await newSession();
    const n = EMBED_LIMITS.texts + 20;
    // Each passage differs in its words, not only in a number, and sits at a different height: a line repeated in the same place on many pages is a running header and is dropped.
    const word = (i: number) => String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + String.fromCharCode(97 + (Math.floor(i / 676) % 26));
    const pages = Array.from({ length: n }, (_, i) =>
      page(
        i + 1,
        line(`Recommendation ${i + 1}. We recommend that synthetic step ${word(i)}tamycin be taken in adults with the synthetic syndrome after the usual checks, and that the result be written down.`, 80 + (i % 17) * 20),
        line('(Strong recommendation, moderate-quality evidence)', 94 + (i % 17) * 20),
      ),
    );
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'big.pdf', bytes: pdf('big') }, pages, pageCount: n });
    expect(doc.chunks).toBeGreaterThan(EMBED_LIMITS.texts);
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    const relay = embedRelay();
    const seen: [number, number][] = [];
    const done = await embedDocument(store, doc.id, relay.deps, (a, b) => seen.push([a, b]));
    expect(relay.bodies.length).toBeGreaterThan(1);
    expect(relay.bodies.every((b) => b.purpose === 'document' && b.texts.length <= EMBED_LIMITS.texts)).toBe(true);
    expect(seen.at(-1)).toEqual([doc.chunks, doc.chunks]);
    expect(done.vectors).toMatchObject({ model: 'embed-a', chunks: doc.chunks });
    expect(await store.listVectors(doc.id)).toHaveLength(doc.chunks);
    // The audit records which passages were sent, never their text.
    const audits = (await store.listAudit()).filter((e) => e.entity === 'model_call');
    expect(audits.length).toBe(relay.bodies.length);
    expect(JSON.stringify(audits)).not.toContain('tamycin be taken');
  });

  it('stores nothing when a batch fails', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'a.pdf', bytes: pdf('x') }, pages: GUIDE, pageCount: 3 });
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    await expect(embedDocument(store, doc.id, embedRelay({ fail: true }).deps)).rejects.toBeTruthy();
    expect(await store.listVectors(doc.id)).toEqual([]);
    expect((await store.listDocuments())[0]!.vectors).toBeUndefined();
  });

  it('refuses a document with no text', async () => {
    const { store } = await newSession();
    const doc = await store.addDocument({ meta: { ...META, aiUse: 'may_send', licenceConfirmed: 'yes' }, file: { name: 'scan.pdf', bytes: pdf('scan') }, pages: [{ page: 1, height: 800, pieces: [] }], pageCount: 1 });
    await expect(embedDocument(store, doc.id, embedRelay().deps)).rejects.toThrow(/no text/);
  });
});
