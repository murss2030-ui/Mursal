/**
 * The model's draft for one task (owner decisions D2, D3). Every suggestion is
 * shown as what it is — an AI suggestion, not yet decided — with what it
 * rests on: references to the case data, or "general knowledge — no source,
 * unverified". Each one is accepted, edited or rejected (with a reason) on
 * its own; nothing is pre-selected and there is no "accept all".
 */
import { useState } from 'react';
import type { Suggestion, SuggestionCheck } from '../../domain/types';
import type { TaskDef } from '../../domain/workflow/catalogue';
import { REGISTERS } from '../../domain/workflow/registers';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Banner, Button, LinkButton, Num, TextAreaField, TextField } from '../components/ui';
import { navigate } from '../router';
import { useSession } from '../session-context';

function checkLabel(def: TaskDef, s: Suggestion, b: CaseBundle, tl: ReturnType<typeof useL>): string {
  const all = [...(def.case?.checks ?? []), ...(def.perMedication?.checks ?? []), ...(def.perProblem?.checks ?? [])];
  const label = all.find((c) => c.id === s.checkId)?.label;
  const scope = s.scope ? b.courses.find((m) => m.medId === s.scope)?.drug ?? b.problems.find((p) => p.problemId === s.scope)?.latest.payload.name : undefined;
  return `${label ? tl(label) : s.checkId}${scope ? ` — ${scope}` : ''}`;
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
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-teal-900" data-basis="case_data">
      <Icon name="file-text" className="h-3.5 w-3.5" />
      {s.refs.length ? t('draft.fromCase', { refs: s.refs.map((r) => r.label).join('; ') }) : t('draft.fromCaseNoRef')}
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
  const [mode, setMode] = useState<'idle' | 'reject' | 'edit'>('idle');
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
        </span>
      </li>
    );
  }

  const incomplete = s.checks.includes('incomplete');
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
            <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
              {Object.entries(s.fields ?? {}).map(([k, v]) => {
                const f = reg.fields.find((x) => x.id === k);
                const shown = f?.options ? (v.split('|').map((x) => tl(f.options!.find((o) => o.value === x)?.label ?? { en: x, ar: x })).join(', ')) : v;
                return (
                  <div key={k} className="contents">
                    <dt className="text-slate-600">{f ? tl(f.label) : k}</dt>
                    <dd dir="auto" className="text-slate-900">
                      {shown}
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
        {s.reason && (
          <p className="text-sm italic text-slate-700" dir="auto">
            {s.reason}
          </p>
        )}
        <Checks checks={s.checks} />
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
            <Button variant="secondary" icon="check" disabled={busy || stale || incomplete} onClick={() => void decide({ kind: 'accept' })}>
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
          </div>
        )}
        {incomplete && <p className="text-xs text-slate-600">{t('draft.incompleteHelp')}</p>}
      </section>
    </li>
  );
}

export function AiDraft({ def, b }: { def: TaskDef; b: CaseBundle }) {
  const { t, when } = useI18n();
  const d = b.draftOf(def.module);
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
