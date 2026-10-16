/**
 * The relay's only state: usage counters (Section 6, "It keeps only a per-user
 * usage counter"). No prompt, completion or case data is ever stored.
 *
 * The monthly cap is enforced here, not by provider budget alerts (Section 19):
 * the estimated cost is reserved before the call and reconciled after it, so a
 * crash between the two can only over-count, never under-count.
 */
import type { BudgetState, ModelTask } from '../src/ai/protocol';

export interface CounterStore {
  read<T>(key: string): Promise<{ value: T | null; etag?: string }>;
  /** Conditional write: replaces only if the etag still matches (or creates only if absent). Returns false on a lost race. */
  write<T>(key: string, value: T, expected: { etag?: string }): Promise<boolean>;
}

/** Read-modify-write with optimistic concurrency. */
export async function update<T>(store: CounterStore, key: string, fn: (prev: T | null) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value, etag } = await store.read<T>(key);
    const next = fn(value);
    if (await store.write(key, next, { etag })) return next;
  }
  throw new Error('usage counter is contended');
}

export interface MonthUsage {
  spentUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  byTask: Partial<Record<ModelTask, number>>;
}

export const monthKey = (now: Date) => now.toISOString().slice(0, 7);
const budgetKey = (month: string) => `budget-${month}`;
const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

const EMPTY: MonthUsage = { spentUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0, byTask: {} };

export async function readMonth(store: CounterStore, now: Date): Promise<MonthUsage> {
  return (await store.read<MonthUsage>(budgetKey(monthKey(now)))).value ?? EMPTY;
}

export type Reservation = { ok: true; month: string } | { ok: false; budget: BudgetState };

/** Reserve `estimateUsd` against the month's budget, or refuse when it would cross the cap. */
export async function reserve(store: CounterStore, now: Date, budgetUsd: number, estimateUsd: number, task: ModelTask): Promise<Reservation> {
  const month = monthKey(now);
  let refused: BudgetState | undefined;
  await update<MonthUsage>(store, budgetKey(month), (prev) => {
    const cur = prev ?? EMPTY;
    if (cur.spentUsd + estimateUsd > budgetUsd) {
      refused = { month, budgetUsd, spentUsd: cur.spentUsd };
      return cur; // unchanged
    }
    refused = undefined;
    return {
      ...cur,
      spentUsd: round(cur.spentUsd + estimateUsd),
      calls: cur.calls + 1,
      byTask: { ...cur.byTask, [task]: round((cur.byTask[task] ?? 0) + estimateUsd) },
    };
  });
  return refused ? { ok: false, budget: refused } : { ok: true, month };
}

/** Replace the reservation by the actual cost (or release it when the call cost nothing). */
export async function reconcile(
  store: CounterStore,
  month: string,
  task: ModelTask,
  estimateUsd: number,
  actual: { costUsd: number; inputTokens: number; outputTokens: number } | null,
): Promise<MonthUsage> {
  return update<MonthUsage>(store, budgetKey(month), (prev) => {
    const cur = prev ?? EMPTY;
    const delta = (actual?.costUsd ?? 0) - estimateUsd;
    return {
      ...cur,
      spentUsd: Math.max(0, round(cur.spentUsd + delta)),
      calls: actual ? cur.calls : Math.max(0, cur.calls - 1),
      inputTokens: cur.inputTokens + (actual?.inputTokens ?? 0),
      outputTokens: cur.outputTokens + (actual?.outputTokens ?? 0),
      byTask: { ...cur.byTask, [task]: Math.max(0, round((cur.byTask[task] ?? 0) + delta)) },
    };
  });
}

export type RateResult = { ok: true } | { ok: false; retryAfterSeconds: number; window: 'minute' | 'day' };

/** Per-installation limits per minute and per day, independent of the monthly cap. */
export async function takeRate(store: CounterStore, now: Date, installId: string, perMinute: number, perDay: number): Promise<RateResult> {
  const iso = now.toISOString();
  const minuteKey = `rate-${installId}-${iso.slice(0, 16)}`;
  const dayKey = `rate-${installId}-${iso.slice(0, 10)}`;
  let result: RateResult = { ok: true };
  await update<number>(store, dayKey, (prev) => {
    const n = prev ?? 0;
    if (n >= perDay) {
      const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      result = { ok: false, window: 'day', retryAfterSeconds: Math.ceil((tomorrow - now.getTime()) / 1000) };
      return n;
    }
    result = { ok: true };
    return n + 1;
  });
  if (!result.ok) return result;
  await update<number>(store, minuteKey, (prev) => {
    const n = prev ?? 0;
    if (n >= perMinute) {
      result = { ok: false, window: 'minute', retryAfterSeconds: 60 - now.getUTCSeconds() };
      return n;
    }
    result = { ok: true };
    return n + 1;
  });
  if (!result.ok) {
    // The day counter was taken for a request that will not run; give it back.
    await update<number>(store, dayKey, (prev) => Math.max(0, (prev ?? 1) - 1));
  }
  return result;
}

/** In-memory store for tests and the local test relay. */
export function memoryStore(): CounterStore & { dump(): Record<string, unknown> } {
  const data = new Map<string, { value: unknown; etag: number }>();
  let seq = 0;
  return {
    async read<T>(key: string) {
      const e = data.get(key);
      return e ? { value: structuredClone(e.value) as T, etag: String(e.etag) } : { value: null };
    },
    async write<T>(key: string, value: T, expected: { etag?: string }) {
      const e = data.get(key);
      if (expected.etag === undefined ? e !== undefined : !e || String(e.etag) !== expected.etag) return false;
      data.set(key, { value: structuredClone(value), etag: ++seq });
      return true;
    },
    dump() {
      return Object.fromEntries([...data].map(([k, v]) => [k, v.value]));
    },
  };
}
