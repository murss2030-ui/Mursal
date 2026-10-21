/**
 * M5 (decision 6): the verifier runs after every draft, on each statement of
 * the draft that rests on case data, and — on request — on the claims of a
 * Problem Card. Its verdicts are kept as append-only records (verdicts.ts),
 * each tied to exactly the words it checked and what they cite: the gate on
 * accepting a draft and on the department form reads them.
 *
 * A batch the service could not answer leaves its statements "not checked",
 * with the reason; a refusal that would refuse every call (offline, budget,
 * settings) is thrown, and nothing is recorded.
 */
import { claimKeyTargets, claimTargets, parseClaims, researchRefOf } from '../../domain/card-data';
import { kindKey } from '../../domain/problem-card';
import { indexTimeline } from '../../domain/timeline';
import { claimKey, normalizeForMatch, type ClaimVerification, type VerifiedOrigin } from '../../domain/verdicts';
import { sourceCitation } from '../../domain/sources';
import type { Store } from '../../store/store';
import { casePayloadFor } from '../analysis/run';
import { calcSource, caseHeader, entrySource, type CasePayload } from '../analysis/payload';
import { AiError, type CallDeps } from '../client';
import { claimsFromSuggestions, HEADER_SOURCE } from './claims';
import { VERIFY_PROMPT_VERSION, type VerifyClaim, type VerifyInput, type VerifySource } from './contract';
import { verifyClaims, type VerifyRun } from './run';

export interface VerificationOutcome {
  /** Statements sent to the verifier. */
  checked: number;
  records: ClaimVerification[];
  /** Batches the service could not answer: their statements are "not checked". */
  failures: VerifyRun['failures'];
}

export type Located = { origin: VerifiedOrigin; text: string; targets: string[] };

export function toRecords(run: VerifyRun, input: VerifyInput, locate: (claimId: string) => Located | undefined): Omit<ClaimVerification, 'id' | 'caseId' | 'at'>[] {
  const label = new Map(input.sources.map((s) => [s.id, s.label]));
  const failed = new Map(run.failures.flatMap((f) => f.claimIds.map((id) => [id, f.code] as const)));
  const model = new Map(run.calls.flatMap((c) => c.claimIds.map((id) => [id, c.model] as const)));
  return run.verdicts.flatMap((v) => {
    const at = locate(v.claimId);
    if (!at) return [];
    const failure = failed.get(v.claimId);
    const by = model.get(v.claimId);
    return [
      {
        key: claimKey(at.text, at.targets),
        origin: at.origin,
        verdict: v.verdict,
        quotes: v.quotes.map((q) => ({ source: label.get(q.sourceId) ?? q.sourceId, text: q.text })),
        unsupportedParts: v.unsupportedParts,
        flags: v.flags,
        ...(failure ? { failure } : {}),
        ...(by ? { model: by } : {}),
        promptVersion: VERIFY_PROMPT_VERSION,
      },
    ];
  });
}

/** Checks the statements of a module's draft that are still undecided, and records the verdicts. */
export async function verifyDraft(store: Store, caseId: string, analysisId: string, deps: CallDeps = {}, payload?: CasePayload): Promise<VerificationOutcome> {
  const c = await store.getCase(caseId);
  const a = (await store.listAnalyses(caseId)).find((x) => x.id === analysisId);
  if (!c || !a) throw new AiError('bad_request', 'Unknown case or analysis.');
  const p = payload ?? (await casePayloadFor(store, caseId, a.moduleId));
  const { input, origin } = claimsFromSuggestions(
    a.suggestions.filter((s) => !s.decision),
    p,
  );
  if (!input.claims.length) return { checked: 0, records: [], failures: [] };
  const run = await verifyClaims(store, { caseId, caseKind: c.kind }, input, deps);
  const records = await store.addClaimChecks(
    caseId,
    toRecords(run, input, (id) => {
      const o = origin.get(id);
      return o && { origin: { kind: 'suggestion', analysisId, suggestionId: o.suggestionId, part: o.part }, text: o.text, targets: o.targets };
    }),
  );
  return { checked: input.claims.length, records, failures: run.failures };
}

/**
 * Checks the claims of a Problem Card that cite the case's data — the
 * trainee's own on request, or the model's again after a failure — against
 * the current entries and calculation results they cite. Claims with a
 * current verdict are not sent again unless `all` is set.
 */
export async function verifyCardClaims(store: Store, caseId: string, itemId: string, deps: CallDeps = {}, opts: { all?: boolean } = {}): Promise<VerificationOutcome> {
  const c = await store.getCase(caseId);
  const item = (await store.listItems(caseId)).find((i) => i.id === itemId && i.register === 'drp' && i.status === 'active');
  if (!c || !item) throw new AiError('bad_request', 'Unknown case or Problem Card.');
  const ctx = await store.cardContext(caseId);
  const idx = indexTimeline(ctx.entries);
  const sources: VerifySource[] = [{ id: HEADER_SOURCE, label: 'Case header', text: `Case: ${JSON.stringify(caseHeader(c, store.today()))}`, context: true }];
  const sourceOf = new Map<string, string>();
  const source = (kind: 'entry' | 'calc', id: string): string | undefined => {
    const key = `${kind}:${id}`;
    const known = sourceOf.get(key);
    if (known) return known;
    let s: Omit<VerifySource, 'id'> | undefined;
    if (kind === 'entry') {
      const e = idx.byId.get(id);
      if (e) {
        const x = entrySource(e);
        s = { label: `${x.label} — Day ${e.hospitalDay}`, text: x.text.replace(/\s+/g, ' ').trim(), subject: kindKey(e), day: e.hospitalDay };
      }
    } else {
      const r = ctx.calcResults.find((x) => x.id === id);
      if (r) {
        const x = calcSource(r);
        s = { label: r.day !== undefined ? `${x.label} — Day ${r.day}` : x.label, text: x.text, subject: `calc:${r.calc}`, ...(r.day !== undefined ? { day: r.day } : {}) };
      }
    }
    if (!s) return undefined;
    const sid = `S${sources.length}`;
    sourceOf.set(key, sid);
    sources.push({ id: sid, ...s });
    return sid;
  };
  const claims: VerifyClaim[] = [];
  const located = new Map<string, Located>();
  const runs = await store.listResearchRuns(caseId);
  parseClaims(item.fields.claims).forEach((cl, i) => {
    // M5d: a claim from a research run is checked against the very passage it was quoted from (the trainee's rewording too).
    const from = researchRefOf(cl);
    if (from) {
      const run = runs.find((r) => r.id === from.runId);
      const st = run?.statements[from.n];
      const p = run && st && run.sent.find((x) => x.recordId === st.sourceId && (x.section ?? '') === (st.section ?? ''));
      if (!run || !st || !p) return;
      const keyTargets = claimKeyTargets(cl);
      const current = ctx.verdicts?.get(claimKey(cl.text, keyTargets));
      if (!opts.all && current && current.verdict !== 'not_checked') return;
      let sid = sourceOf.get(`passage:${run.id}:${p.id}`);
      if (!sid) {
        sid = `S${sources.length}`;
        sourceOf.set(`passage:${run.id}:${p.id}`, sid);
        const rec = run.sources.find((x) => x.id === p.recordId);
        sources.push({ id: sid, label: `${rec ? sourceCitation(rec) : p.recordId}${p.section ? ` [${p.section}]` : ''}`, text: p.text.replace(/\s+/g, ' ').trim() });
      }
      const id = `V${claims.length + 1}`;
      claims.push({ id, text: cl.text, sourceIds: [sid] });
      // Unchanged, it is the run's own statement (its verdict is shown wherever it appears); reworded, it is this card's claim.
      const same = normalizeForMatch(cl.text) === normalizeForMatch(st.text);
      located.set(id, { origin: same ? { kind: 'research', runId: run.id, claim: from.n } : { kind: 'card', itemId, claim: i }, text: cl.text, targets: keyTargets });
      return;
    }
    const targets = claimTargets(cl);
    if (!targets.length) return;
    const keyTargets = targets.map((l) => `${l.kind}:${l.id}`);
    const current = ctx.verdicts?.get(claimKey(cl.text, keyTargets));
    if (!opts.all && current && current.verdict !== 'not_checked') return;
    const ids = targets.map((l) => source(l.kind, l.id)).filter((x): x is string => Boolean(x));
    if (!ids.length) return;
    const id = `V${claims.length + 1}`;
    claims.push({ id, text: cl.text, sourceIds: [HEADER_SOURCE, ...ids] });
    located.set(id, { origin: { kind: 'card', itemId, claim: i }, text: cl.text, targets: keyTargets });
  });
  if (!claims.length) return { checked: 0, records: [], failures: [] };
  const input: VerifyInput = { claims, sources };
  const run = await verifyClaims(store, { caseId, caseKind: c.kind }, input, deps);
  const records = await store.addClaimChecks(caseId, toRecords(run, input, (id) => located.get(id)));
  return { checked: claims.length, records, failures: run.failures };
}
