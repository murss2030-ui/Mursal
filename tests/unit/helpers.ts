import { PreceptorDB } from '../../src/store/db';
import { Session } from '../../src/store/session';
import type { Store, StoreOptions } from '../../src/store/store';
import type { RotationInput } from '../../src/domain/validation';

export const PASS = 'correct horse battery staple';
export const FAST_ITERATIONS = 1_000;

export class Clock {
  constructor(public t = new Date('2026-10-13T08:00:00.000Z')) {}
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export async function newSession(opts: { random?: () => number; clock?: Clock; calculators?: StoreOptions['calculators'] } = {}) {
  const clock = opts.clock ?? new Clock();
  const db = new PreceptorDB(`test-${crypto.randomUUID()}`);
  // Advance the clock on every read so recordedAt timestamps are strictly ordered.
  const now = () => {
    clock.advance(1_000);
    return clock.now();
  };
  const session = new Session(db, { now, random: opts.random, ...(opts.calculators ? { calculators: opts.calculators } : {}) }, FAST_ITERATIONS);
  await session.acknowledgeIntendedUse(clock.now());
  await session.setup(PASS);
  return { db, session, store: session.store, clock };
}

export const ROTATION: RotationInput = {
  department: 'internal_medicine',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  competencies: ['direct_patient_care'],
};

export async function newCase(store: Store, over: Partial<Parameters<Store['createCase']>[0]> = {}) {
  const rot = await store.createRotation(ROTATION);
  return store.createCase({
    kind: 'teaching',
    rotationId: rot.id,
    ageYears: 64,
    sex: 'M',
    admissionDay0: '2026-10-10',
    syntheticDataAttested: true,
    ...over,
  });
}

/**
 * A stand-in for the relay answering the verifier (task "verify"): by default
 * every claim is supported, shown by a quote of the first characters of each
 * source it cites (never the case header). `answer` can return another verdict
 * for a claim. Every request body is kept.
 */
export function standInVerifier(
  answer?: (claim: { id: string; text: string; sources: string[] }, sourceText: (id: string) => string) => Record<string, unknown> | undefined,
) {
  const bodies: { task: string; parts: { text: string }[] }[] = [];
  const f = (async (_url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as { task: string; parts: { text: string }[] };
    bodies.push(body);
    const req = JSON.parse(body.parts[1]!.text) as { sources: { id: string; text: string }[]; claims: { id: string; text: string; sources: string[] }[] };
    const text = (id: string) => req.sources.find((s) => s.id === id)?.text ?? '';
    const results = req.claims.map(
      (c) =>
        answer?.(c, text) ?? {
          claimId: c.id,
          verdict: 'supported',
          contradicted: false,
          quotes: c.sources.filter((s) => s !== 'H').map((s) => ({ sourceId: s, text: text(s).slice(0, 24) })),
          unsupportedParts: [],
        },
    );
    return new Response(JSON.stringify({ output: { results }, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.0001 }, model: 'verifier-stand-in', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, bodies };
}

/** All raw bytes and plain fields stored in IndexedDB, as one searchable string. */
export async function rawDump(db: PreceptorDB): Promise<string> {
  const dec = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  for (const t of db.tables) {
    for (const row of await t.toArray()) {
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        if (v instanceof ArrayBuffer) out += dec.decode(new Uint8Array(v));
        else if (v instanceof Uint8Array) out += dec.decode(v);
        else out += `${k}=${JSON.stringify(v)};`;
      }
    }
  }
  return out;
}
