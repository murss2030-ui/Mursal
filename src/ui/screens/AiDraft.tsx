/**
 * The model's draft for one task (owner decisions D2, D3). Every suggestion is
 * shown as what it is — an AI suggestion, not yet decided — with what it
 * rests on: references to the case data, or "general knowledge — no source,
 * unverified". Each one is accepted, edited or rejected (with a reason) on
 * its own; nothing is pre-selected and there is no "accept all".
 */
import { useState } from 'react';
import { UNDRAFTED_TASKS } from '../../ai/analysis/limits';
import { mustEdit, type Suggestion, type SuggestionCheck } from '../../domain/types';
import { draftStatements, originKey, passesDraftGate, type DraftPart } from '../../domain/verdicts';
import { verifyDraft } from '../../ai/verification/draft';
import { CheckButton, VerdictLine } from './verdict-parts';
import type { TaskDef } from '../../domain/workflow/catalogue';
import { REGISTERS, type FieldDef } from '../../domain/workflow/registers';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Banner, Button, LinkButton, Num, TextAreaField, TextField } from '../components/ui';
import { entryText } from '../format';
import { claimTargets, parseClaims, parseLinks, type CardClaim } from '../../domain/card-data';
import { pcneCoherence } from '../../domain/pcne-coherence';
import { calcLabel, CoherenceQuestions, entryLabel } from './card-parts';
import { navigate } from '../router';
import { useSession } from '../session-context';

function checkLabel(def: TaskDef, s: Suggestion, b: CaseBundle, tl: ReturnType<typeof useL>): string {
  const all = [...(def.case?.checks ?? []), ...(def.perMedication?.checks ?? []), ...(def.perProblem?.checks ?? [])];
  const label = all.find((c) => c.id === s.checkId)?.label;
  const scope = s.scope ? b.courses.find((m) => m.medId === s.scope)?.drug ?? b.problems.find((p) => p.problemId === s.scope)?.latest.payload.name : undefined;
  return `${label ? tl(label) : s.checkId}${scope ? ` — ${scope}` : ''}`;
}

/** A field value as the trainee reads it: choices by their label, references by the name of what they point to. */
function shownValue(f: FieldDef | undefined, v: string, b: CaseBundle, tl: ReturnType<typeof useL>, i18n: Pick<ReturnType<typeof useI18n>, 't'>): string {
  if (f?.options) return v.split('|').map((x) => tl(f.options!.find((o) => o.value === x)?.label ?? { en: x, ar: x })).join(', ');
  if (f?.kind === 'links') {
    return parseLinks(v)
      .map((l) => {
        const e = l.kind === 'entry' ? b.entries.find((x) => x.id === l.id) : undefined;
        const r = l.kind === 'calc' ? b.calcResults.find((x) => x.id === l.id) : undefined;
        return e ? entryLabel(e, i18n.t) : r ? calcLabel(r, 'en', i18n.t) : l.id;
      })
      .join(' · ');
  }
  if (f?.kind === 'medRef') return b.courses.find((m) => m.medId === v)?.drug ?? v;
  if (f?.kind === 'problemRef') return b.problems.find((p) => p.problemId === v)?.latest.payload.name ?? v;
  if (f?.kind === 'entryRef') {
    const e = b.current.find((x) => x.id === v);
    return e ? entryText(e, i18n).main : v;
  }
  return v;
}

function claimLabel(c: CardClaim, b: CaseBundle, t: ReturnType<typeof useI18n>['t']): string {
  const cited = claimTargets(c);
  if (!cited.length) return c.title ?? '';
  return cited
    .map((l) => {
      const e = l.kind === 'entry' ? b.entries.find((x) => x.id === l.id) : undefined;
      const r = l.kind === 'calc' ? b.calcResults.find((x) => x.id === l.id) : undefined;
      return e ? entryLabel(e, t) : r ? calcLabel(r, 'en', t) : l.id;
    })
    .join(' · ');
}

function Basis({ s }: { s: Suggestion }) {
  const { t } = useI18n();
  if (s.kind === 'note' && s.noteKind !== 'summary') return null;
  return s.basis === 'general_knowledge' ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-500 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900" data-basis="general_knowledge">
      <Icon name="alert-triangle" className="h-3.5 w-3.5" />
      {t('draft.noSource')}
    </span>
  ) : (
    <span className="flex items-start gap-1 text-xs text-teal-900" data-basis="case_data">
      <Icon name="file-text" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{s.refs.length ? t('draft.fromCase', { refs: s.refs.map((r) => r.label).join('; ') }) : t('draft.fromCaseNoRef')}</span>
    </span>
  );
}

function Checks({ checks }: { checks: readonly SuggestionCheck[] }) {
  const { t } = useI18n();
  if (!checks.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {checks.map((c) => (
        <li key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700" data-check={c}>
          {t(`draft.check.${c}` as MsgKey)}
        </li>
      ))}
    </ul>
  );
}

function SuggestionCard({ s, def, b, analysisId, stale }: { s: Suggestion; def: TaskDef; b: CaseBundle; analysisId: string; stale: boolean }) {
  const { t } = useI18n();
  const tl = useL();
  const { store } = useSession();
  const [mode, setMode] = useState<'idle' | 'reject' | 'edit' | 'needs_evidence' | 'needs_senior_review'>('idle');
  const card = s.kind === 'item' && s.register === 'drp';
  const [reason, setReason] = useState('');
  const [text, setText] = useState(s.text ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const decide = async (d: Parameters<typeof store.decideSuggestion>[3]) => {
    setBusy(true);
    setError(undefined);
    try {
      // An accepted answer or note becomes the worksheet's next version; unsaved edits there would silently undo it.
      if (d.kind !== 'reject' && s.kind !== 'item' && (await store.getUiDraft(`task:${b.case.id}:${def.id}`))) {
        setError(t('draft.saveWorksheetFirst'));
        return;
      }
      await store.decideSuggestion(b.case.id, analysisId, s.id, d);
      setMode('idle');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (s.decision) {
    const k = s.decision.kind;
    return (
      <li className="flex items-start gap-2 rounded-xl border border-line bg-white/70 px-3 py-2 text-sm" data-testid="suggestion" data-kind={s.kind} data-decision={k}>
        <ProvenanceBadge state="trainee_decision" />
        <span className={`min-w-0 flex-1 ${k === 'rejected' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
          {s.kind === 'check' ? `${checkLabel(def, s, b, tl)} → ${t(`check.${s.answer!}`)}` : s.kind === 'item' ? `${tl(REGISTERS[s.register!].noun)}: ${s.fields?.[REGISTERS[s.register!].titleField] ?? ''}` : s.text}
          <span className="block text-xs text-slate-600 no-underline">
            {t(`draft.decided.${k}`)}
            {s.decision.reason ? ` — ${s.decision.reason}` : ''}
          </span>
          {s.decision.appliedTo?.kind === 'item' && s.register === 'drp' && (
            <a href={`#/cases/${b.case.id}/card/${s.decision.appliedTo.itemId}?task=${def.id}`} className="mt-0.5 inline-flex min-h-[32px] items-center text-xs font-medium text-teal-900 underline">
              {t('draft.openCard')}
            </a>
          )}
        </span>
      </li>
    );
  }

  // A card whose classification PRECEPTOR questions is edited first: only the trainee corrects the codes or says why they fit.
  const questions = card ? pcneCoherence(s.fields ?? {}) : [];
  const incomplete = mustEdit(s) || questions.length > 0;
  // M5, decision 6: accepted as it is only when the verifier found every statement supported, with a quote.
  const statements = draftStatements(s);
  const verdictOf = (part: DraftPart) => b.verdictAt({ kind: 'suggestion', analysisId, suggestionId: s.id, part });
  const gated = !passesDraftGate(s, analysisId, b.verdictsByOrigin);
  const reasonStatement = statements.find((x) => x.part === 'reason');
  const claimStatement = (i: number) => statements.find((x) => typeof x.part === 'object' && x.part.claim === i);
  const reg = s.register ? REGISTERS[s.register] : undefined;
  return (
    <li>
      <section className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/60 p-3" data-testid="suggestion" data-kind={s.kind} data-decision="pending">
        <div className="flex flex-wrap items-center gap-2">
          <ProvenanceBadge state="ai_suggestion" />
          <Basis s={s} />
        </div>
        {s.kind === 'check' && (
          <p className="text-sm text-slate-900">
            <span className="text-slate-600">{t('draft.checklist')} </span>
            <strong>{checkLabel(def, s, b, tl)}</strong> → <strong>{t(`check.${s.answer!}`)}</strong>
          </p>
        )}
        {s.kind === 'item' && reg && (
          <div className="text-sm text-slate-900">
            <p>
              <span className="text-slate-600">{t('draft.addTo', { list: tl(reg.title) })}</span>
            </p>
            <dl className="mt-1 flex flex-col gap-1.5">
              {Object.entries(s.fields ?? {}).map(([k, v]) => {
                const f = reg.fields.find((x) => x.id === k);
                return (
                  <div key={k} data-field={k}>
                    <dt className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                      {f ? tl(f.label) : k}
                      {/* Owner decision D6 of M4: the drafted teaching explanation is general knowledge, with no source. */}
                      {s.register === 'drp' && k === 'teaching' && (
                        <span className="rounded-full border border-dashed border-amber-500 bg-amber-50 px-1.5 text-[11px] font-medium text-amber-900" data-basis="general_knowledge">
                          {t('draft.noSource')}
                        </span>
                      )}
                    </dt>
                    <dd dir="auto" className="text-slate-900">
                      {f?.kind === 'claims' ? (
                        <ul className="flex flex-col gap-1" data-testid="draft-claims">
                          {parseClaims(v).map((c, i) => {
                            const st = claimStatement(i);
                            return (
                              <li key={i} className={`flex flex-col gap-1 rounded-lg border px-2 py-1 ${c.source === 'none' ? 'border-dashed border-amber-500 bg-amber-50' : 'border-violet-200 bg-white'}`} data-claim-source={c.source}>
                                {c.text}
                                <span className="block text-xs text-slate-600">
                                  {c.source === 'none' ? t('claims.from.none') : t(`claims.from.${c.source}` as MsgKey, { label: claimLabel(c, b, t) })}
                                </span>
                                {st && <VerdictLine v={verdictOf(st.part)} checkable={st.checkable} />}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        shownValue(f, v, b, tl, { t })
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
        {s.kind === 'note' && (
          <p className="text-sm text-slate-900" dir="auto">
            <span className="text-slate-600">{t(`draft.note.${s.noteKind!}`)} </span>
            {s.text}
          </p>
        )}
        {s.kind === 'note' && statements[0] && <VerdictLine v={verdictOf('text')} />}
        {s.reason && (
          <p className="text-sm italic text-slate-700" dir="auto">
            {s.reason}
          </p>
        )}
        {reasonStatement && <VerdictLine v={verdictOf('reason')} checkable={reasonStatement.checkable} />}
        <Checks checks={s.checks} />
        {questions.length > 0 && <CoherenceQuestions issues={questions} />}
        {error && (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        )}
        {mode === 'reject' ? (
          <div className="flex flex-col gap-2">
            <TextField label={t('draft.rejectReason')} value={reason} onChange={setReason} name={`reject-${s.id}`} />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" icon="x" disabled={busy || !reason.trim()} onClick={() => void decide({ kind: 'reject', reason })}>
                {t('draft.reject')}
              </Button>
              <Button variant="ghost" onClick={() => setMode('idle')}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : mode === 'needs_evidence' || mode === 'needs_senior_review' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-700">{t('draft.keepAsCard')}</p>
            <TextField label={t(`cardReview.reason.${mode}`)} value={reason} onChange={setReason} name={`${mode}-${s.id}`} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || reason.trim().length < 3 || stale || incomplete} onClick={() => void decide({ kind: mode, reason })}>
                {t('cardReview.confirm', { decision: t(`cardReview.decision.${mode}`) })}
              </Button>
              <Button variant="ghost" onClick={() => setMode('idle')}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : mode === 'edit' ? (
          <div className="flex flex-col gap-2">
            <TextAreaField label={t('draft.editText')} value={text} onChange={setText} rows={3} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon="check" disabled={busy || !text.trim() || stale} onClick={() => void decide({ kind: 'edit', text })}>
                {t('draft.saveEdit')}
              </Button>
              <Button variant="ghost" onClick={() => setMode('idle')}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {/* Never pre-selected, never focused: each acceptance is deliberate. */}
            <Button variant="secondary" icon="check" disabled={busy || stale || incomplete || gated} onClick={() => void decide({ kind: 'accept' })}>
              {s.kind === 'note' ? t('draft.addToNotes') : t('draft.accept')}
            </Button>
            {s.kind === 'item' && (
              <Button variant="secondary" icon="pencil" disabled={stale} onClick={() => navigate(`/cases/${b.case.id}/suggestion/${analysisId}/${s.id}/edit`)}>
                {t('draft.edit')}
              </Button>
            )}
            {s.kind === 'note' && (
              <Button variant="secondary" icon="pencil" disabled={stale} onClick={() => setMode('edit')}>
                {t('draft.edit')}
              </Button>
            )}
            <Button variant="ghost" icon="x" onClick={() => setMode('reject')}>
              {t('draft.reject')}
            </Button>
            {card && (
              <>
                <Button variant="ghost" icon="search" disabled={stale || incomplete} onClick={() => setMode('needs_evidence')}>
                  {t('cardReview.evidence')}
                </Button>
                <Button variant="ghost" icon="graduation" disabled={stale || incomplete} onClick={() => setMode('needs_senior_review')}>
                  {t('cardReview.senior')}
                </Button>
              </>
            )}
          </div>
        )}
        {incomplete && (
          <p className="text-xs text-slate-600">{questions.length ? t('draft.questionedHelp') : s.checks.includes('incomplete') ? t('draft.incompleteHelp') : t('draft.actionHelp')}</p>
        )}
        {!incomplete && gated && (
          <p className="text-xs text-slate-600" data-testid="draft-gate">
            {s.kind === 'check' ? t('verdict.gateHelpCheck') : t('verdict.gateHelp')}
          </p>
        )}
      </section>
    </li>
  );
}

export function AiDraft({ def, b }: { def: TaskDef; b: CaseBundle }) {
  const { t, when } = useI18n();
  const { store } = useSession();
  const d = b.draftOf(def.module);
  if (UNDRAFTED_TASKS.has(def.id)) {
    return (
      <section className="flex items-center gap-2 rounded-2xl border border-dashed border-line bg-white/60 p-4 text-sm text-slate-700" data-testid="ai-draft" data-state="trainee-only">
        <Icon name="user" className="h-4 w-4 text-slate-500" />
        {t('draft.traineeOnlyTask')}
      </section>
    );
  }
  if (!d) {
    return (
      <section className="rounded-2xl border border-dashed border-violet-300 bg-white/60 p-4 text-sm text-slate-700" data-testid="ai-draft" data-state="none">
        <span className="flex items-center gap-2">
          <Icon name="sparkle" className="h-4 w-4 text-violet-700" />
          {t('draft.none')}
        </span>
        <a href={`#/cases/${b.case.id}/analyse`} className="mt-2 inline-flex min-h-touch items-center font-medium text-teal-900 underline">
          {t('draft.analyse')}
        </a>
      </section>
    );
  }
  const mine = d.analysis.suggestions.filter((s) => s.taskId === def.id);
  const pending = mine.filter((s) => !s.decision);
  const decided = mine.filter((s) => s.decision);
  // M5: statements of this module's draft the verifier has not answered yet (never checked, or the service did not answer).
  const unchecked = d.analysis.suggestions
    .filter((s) => !s.decision)
    .some((s) =>
      draftStatements(s).some((st) => {
        if (!st.checkable) return false;
        const v = b.verdictsByOrigin.get(originKey({ kind: 'suggestion', analysisId: d.analysis.id, suggestionId: s.id, part: st.part }));
        return !v || v.verdict === 'not_checked';
      }),
    );
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-violet-200 bg-white p-4 shadow-card" data-testid="ai-draft" data-state={d.stale ? 'stale' : 'current'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Icon name="sparkle" className="h-5 w-5 text-violet-700" />
          {t('draft.title')}
        </h2>
        <span className="text-xs text-slate-600">
          <Num>{when(d.analysis.createdAt)}</Num> · <span dir="ltr">{d.analysis.model}</span>
        </span>
      </div>
      <p className="text-xs text-slate-600">{t('draft.lead')}</p>
      {unchecked && !d.stale && b.case.status !== 'archived' && (
        <CheckButton label={t('verdict.checkDraft')} testId="check-draft" run={() => verifyDraft(store, b.case.id, d.analysis.id)} />
      )}
      {d.stale && (
        <Banner tone="warning">
          <span className="flex flex-col items-start gap-2" data-testid="draft-stale">
            {t('draft.stale')}
            <LinkButton href={`#/cases/${b.case.id}/analyse`} icon="sparkle">
              {t('draft.reanalyse')}
            </LinkButton>
          </span>
        </Banner>
      )}
      {mine.length === 0 && <p className="text-sm text-slate-600">{t('draft.nothingForTask')}</p>}
      <ol className="flex flex-col gap-2">
        {pending.map((s) => (
          <SuggestionCard key={s.id} s={s} def={def} b={b} analysisId={d.analysis.id} stale={d.stale} />
        ))}
      </ol>
      {decided.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-touch cursor-pointer py-1 font-medium text-slate-700">{t('draft.decidedN', { n: decided.length })}</summary>
          <ol className="mt-1 flex flex-col gap-1.5">
            {decided.map((s) => (
              <SuggestionCard key={s.id} s={s} def={def} b={b} analysisId={d.analysis.id} stale={d.stale} />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
