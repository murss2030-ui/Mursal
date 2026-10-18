import { useState, type ReactNode } from 'react';
import { MODULE_BY_ID, MODULES, TASKS, type CheckDef, type ScopedSection, type TaskDef, type TaskFieldDef } from '../../domain/workflow/catalogue';
import { readiness, type ReadinessItem } from '../../domain/workflow/readiness';
import { appliesKey, normalizeTaskInput, scopedKey, taskProgress, TASK_STATUSES, type TaskInput } from '../../domain/workflow/tasks';
import type { CheckValue, TaskRecord, TaskStatus } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { regimenText } from '../../domain/timeline';
import { useI18n } from '../../i18n/i18n';
import { Bi, useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/Progress';
import { Banner, Button, Card, DayLabel, Num, TextAreaField, TextField, useErrorText } from '../components/ui';
import { usePersistentDraft } from '../hooks';
import { MODULE_STYLE } from '../modules-style';
import { useSession } from '../session-context';
import { ChoicePills, MultiPills } from './choice-controls';
import { TaskPanels } from './panels';
import { RegisterList } from './RegisterList';
import { AiDraft } from './AiDraft';
import { TaskCalculators } from '../calc/TaskCalculators';
import { InlineAlertTags, TaskAlerts } from '../rules/SafetyViews';
import { useCaseRules } from '../rules/useCaseRules';
import { GATED_ANSWERS, renalDoseReviewGate, type GateResult } from '../../calc/gate';

type Flat = Record<string, string>;

function flatten(rec: TaskRecord | undefined): Flat {
  const out: Flat = { status: rec?.status ?? 'not_started', naReason: rec?.naReason ?? '', notes: rec?.notes ?? '' };
  for (const [k, v] of Object.entries(rec?.checks ?? {})) out[`c:${k}`] = v;
  for (const [k, v] of Object.entries(rec?.fields ?? {})) out[`f:${k}`] = v;
  return out;
}

function unflatten(v: Flat): TaskInput {
  const checks: Record<string, CheckValue> = {};
  const fields: Record<string, string> = {};
  let answered = false;
  for (const [k, val] of Object.entries(v)) {
    if (!val) continue;
    if (k.startsWith('c:')) {
      checks[k.slice(2)] = val as CheckValue;
      answered = true;
    } else if (k.startsWith('f:')) {
      fields[k.slice(2)] = val;
      answered = true;
    }
  }
  let status = (v.status || 'not_started') as TaskStatus;
  // Answering anything starts the task; "done" and "not applicable" are the trainee's explicit statements.
  if (status === 'not_started' && (answered || v.notes?.trim())) status = 'in_progress';
  return { status, naReason: v.naReason, checks, fields, notes: v.notes };
}

const sameFlat = (a: Flat, b: Flat) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? '') !== (b[k] ?? '')) return false;
  return true;
};

// ---------------------------------------------------------------- controls

export function CheckRow({
  label,
  value,
  onChange,
  issueHref,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  issueHref?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const { t } = useI18n();
  const opts: { v: CheckValue; icon: string; text: string; on: string }[] = [
    { v: 'ok', icon: '✓', text: t('check.ok'), on: 'border-emerald-600 bg-emerald-600 text-white' },
    { v: 'issue', icon: '!', text: t('check.issue'), on: 'border-rose-600 bg-rose-600 text-white' },
    { v: 'na', icon: '—', text: t('check.na'), on: 'border-slate-500 bg-slate-500 text-white' },
  ];
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0" data-testid={testId} data-value={value || 'unanswered'}>
      <span className="text-sm text-slate-900">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={label} className="inline-flex gap-1.5">
          {opts.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={value === o.v}
              disabled={disabled}
              onClick={() => onChange(value === o.v ? '' : o.v)}
              className={`inline-flex min-h-[40px] items-center gap-1 rounded-full border px-3 text-sm font-medium disabled:opacity-50 ${value === o.v ? o.on : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}
            >
              <span aria-hidden="true" className="font-bold">
                {o.icon}
              </span>
              {o.text}
            </button>
          ))}
        </div>
        {value === 'issue' && issueHref && (
          <a href={issueHref} className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-rose-50 px-3 text-sm font-medium text-rose-900 underline-offset-2 hover:underline">
            <Icon name="flag" className="h-4 w-4" />
            {t('check.recordDrp')}
          </a>
        )}
      </div>
    </div>
  );
}

function TaskField({
  f,
  value,
  onChange,
  disabled,
  disabledValues,
  error,
  testId,
}: {
  f: TaskFieldDef;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  disabledValues?: readonly string[];
  error?: string;
  testId?: string;
}) {
  const tl = useL();
  if (f.kind === 'text') return <TextField label={tl(f.label)} hint={f.hint ? tl(f.hint) : undefined} value={value} onChange={onChange} />;
  if (f.kind === 'longtext') return <TextAreaField label={tl(f.label)} hint={f.hint ? tl(f.hint) : undefined} value={value} onChange={onChange} />;
  if (f.kind === 'choice')
    return <ChoicePills label={tl(f.label)} options={f.options ?? []} value={value} onChange={onChange} disabled={disabled} disabledValues={disabledValues} error={error} testId={testId} />;
  return <MultiPills label={tl(f.label)} options={f.options ?? []} value={value} onChange={onChange} disabled={disabled} />;
}

function Readiness({ items, caseId }: { items: ReadinessItem[]; caseId: string }) {
  const { t } = useI18n();
  const tl = useL();
  const href = (r: ReadinessItem): string | null => {
    const a = r.add;
    if (!a) return null;
    switch (a.kind) {
      case 'entry':
        return `#/cases/${caseId}/entry/new?type=${a.type}${a.category ? `&category=${a.category}` : ''}`;
      case 'register':
        return `#/cases/${caseId}/item/new/${a.register}`;
      case 'case_details':
        return `#/cases/${caseId}/details`;
      case 'sources':
        return `#/cases/${caseId}/intake`;
    }
  };
  const missing = items.filter((i) => i.state === 'missing').length;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="search" className="h-5 w-5 text-teal-800" />
          {t('task.data')}
        </span>
      }
      actions={
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${missing ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {missing ? t('task.dataMissing', { n: missing }) : t('task.dataOk')}
        </span>
      }
    >
      <ul className="flex flex-col divide-y divide-line" data-testid="readiness">
        {items.map((r) => {
          const h = href(r);
          return (
            <li key={r.id} className="flex items-start gap-3 py-2" data-state={r.state} data-need={r.id}>
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${r.state === 'ok' ? 'bg-emerald-100 text-emerald-800' : r.state === 'missing' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'}`}
                aria-hidden="true"
              >
                {r.state === 'ok' ? '✓' : r.state === 'missing' ? '!' : '…'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-slate-900">{tl(r.label)}</span>
                {r.state === 'ok' && (r.value || r.day !== undefined) && (
                  <span className="text-xs text-slate-600" dir="auto">
                    {r.value}
                    {r.day !== undefined && (
                      <>
                        {r.value ? ' · ' : ''}
                        <DayLabel day={r.day} />
                      </>
                    )}
                  </span>
                )}
                {r.state === 'missing' && (
                  <span className="text-xs text-rose-800">
                    {t('task.needMissing')}
                    {r.value ? ` — ${t('task.partial', { v: r.value })}` : ''}
                  </span>
                )}
                {r.state === 'not_yet' && <span className="text-xs text-slate-600">{t('task.needNotYet', { m: r.milestone ?? '' })}</span>}
              </div>
              {r.state === 'missing' && h && (
                <a href={h} className="inline-flex min-h-touch shrink-0 items-center px-2 text-sm font-medium text-teal-900 underline">
                  {t('form.add')}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- M2: Verify gate of a per-medication assessment

function GateBox({ gate, caseId }: { gate: GateResult; caseId: string }) {
  const { t } = useI18n();
  const tl = useL();
  const lacking = gate.items.filter((i) => i.state !== 'ok');
  const href = (i: GateResult['items'][number]): string | undefined => {
    const a = i.add;
    if (!a) return undefined;
    if (a.kind === 'entry') return `#/cases/${caseId}/entry/new?type=${a.type}${a.category ? `&category=${a.category}` : ''}`;
    if (a.kind === 'medication') return `#/cases/${caseId}/timeline`;
    return `#/cases/${caseId}/details`;
  };
  return (
    <div className={`my-2 rounded-xl px-3 py-2 text-sm ${gate.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`} data-testid="renal-gate" data-ok={gate.ok ? 'yes' : 'no'}>
      <p className="font-medium">{t('calc.gate.title')}</p>
      {gate.ok ? (
        <p>{t('calc.gate.ok')}</p>
      ) : (
        <>
          <ul className="mt-1 flex flex-col gap-0.5">
            {lacking.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-2" data-gate-item={i.key}>
                <span>
                  {tl(i.label)} — {i.state === 'unverified' ? t('calc.gate.unverified') : t('calc.gate.missing')}
                </span>
                {href(i) && (
                  <a href={href(i)} className="font-medium underline">
                    {t('form.add')}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">{t('calc.gate.locked', { list: lacking.map((i) => tl(i.label)).join(', ') })}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- scoped sections

interface ScopeRow {
  id: string;
  title: string;
  subtitle?: string;
}

function ScopedBlock({
  def,
  sec,
  rows,
  v,
  set,
  issueHref,
  disabled,
  kind,
  gateFor,
  tagsFor,
  errors,
  caseId,
}: {
  def: TaskDef;
  sec: ScopedSection;
  rows: ScopeRow[];
  v: Flat;
  set: (k: string, val: string) => void;
  issueHref: (label: string, drug?: string) => string;
  disabled: boolean;
  kind: 'medication' | 'problem';
  /** M2: the Verify gate of an assessment made per row (Task 8 renal dose review). */
  gateFor?: (rowId: string) => GateResult | undefined;
  /** M2: the safety alerts of this task about one row (a medication), shown on the row itself. */
  tagsFor?: (rowId: string) => ReactNode;
  errors?: Record<string, string>;
  caseId: string;
}) {
  const errText = useErrorText();
  const { t } = useI18n();
  const tl = useL();
  if (!rows.length) {
    return (
      <Banner tone="info">
        {kind === 'medication' ? t('task.noActiveMeds') : t('task.noProblems')}
      </Banner>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => {
        const applies = sec.applies ? v[`f:${appliesKey(r.id)}`] ?? '' : 'yes';
        const answered =
          sec.checks.filter((c) => v[`c:${scopedKey(c.id, r.id)}`]).length + (sec.fields ?? []).filter((f) => f.tracked && v[`f:${scopedKey(f.id, r.id)}`]).length;
        const total = sec.checks.length + (sec.fields ?? []).filter((f) => f.tracked).length;
        return (
          <details key={r.id} className="surface group overflow-hidden" open={rows.length <= 3} data-testid={`scope-${r.id}`}>
            <summary className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
                <Icon name={kind === 'medication' ? 'pill' : 'target'} className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold text-slate-900" dir="auto">
                  {r.title}
                </span>
                {r.subtitle && (
                  <span className="text-xs text-slate-600" dir="ltr">
                    {r.subtitle}
                  </span>
                )}
                {tagsFor?.(r.id)}
              </span>
              <span className="shrink-0 text-xs text-slate-600">
                {sec.applies && applies === 'no' ? t('task.notApplicableShort') : <Num>{`${answered}/${total}`}</Num>}
              </span>
              <Icon name="chevron-down" className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-line px-4 pb-3">
              {sec.applies && (
                <div className="py-3">
                  <ChoicePills
                    label={tl(sec.applies)}
                    options={[
                      { value: 'yes', label: { en: 'Yes', ar: 'نعم' } },
                      { value: 'no', label: { en: 'No', ar: 'لا' } },
                    ]}
                    value={applies}
                    onChange={(x) => set(`f:${appliesKey(r.id)}`, x)}
                    disabled={disabled}
                    testId={`applies-${r.id}`}
                  />
                </div>
              )}
              {applies === 'yes' && gateFor?.(r.id) && <GateBox gate={gateFor(r.id)!} caseId={caseId} />}
              {applies === 'yes' && (
                <>
                  {sec.checks.map((c: CheckDef) => (
                    <CheckRow
                      key={c.id}
                      label={tl(c.label)}
                      value={v[`c:${scopedKey(c.id, r.id)}`] ?? ''}
                      onChange={(x) => set(`c:${scopedKey(c.id, r.id)}`, x)}
                      issueHref={issueHref(tl(c.label), kind === 'medication' ? r.title : undefined)}
                      disabled={disabled}
                      testId={`check-${c.id}-${r.id}`}
                    />
                  ))}
                  <div className="flex flex-col gap-3 pt-2">
                    {(sec.fields ?? []).map((f) => {
                      const key = scopedKey(f.id, r.id);
                      const gate = gateFor?.(r.id);
                      const locked = gate && !gate.ok && f.id === GATED_ANSWERS.field ? GATED_ANSWERS.values : undefined;
                      return (
                        <TaskField
                          key={f.id}
                          f={f}
                          value={v[`f:${key}`] ?? ''}
                          onChange={(x) => set(`f:${key}`, x)}
                          disabled={disabled}
                          disabledValues={locked}
                          error={errors?.[key] ? errText(errors[key] as never) : undefined}
                          testId={`field-${f.id}-${r.id}`}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </details>
        );
      })}
      <p className="text-xs text-slate-600">{def.perMedication && kind === 'medication' ? t('task.medsFromTimeline') : t('task.problemsFromTimeline')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- the worksheet

function Worksheet({ def, b, rec }: { def: TaskDef; b: CaseBundle; rec: TaskRecord | undefined }) {
  const { t } = useI18n();
  const tl = useL();
  const errText = useErrorText();
  const { store } = useSession();
  const initial = flatten(rec);
  const draft = usePersistentDraft<Flat>(`task:${b.case.id}:${def.id}`, initial);
  const rules = useCaseRules(b);
  const v = draft.values;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<number>();
  const [busy, setBusy] = useState(false);
  const readOnly = b.case.status === 'archived';
  const m = MODULE_BY_ID.get(def.module)!;
  const st = MODULE_STYLE[def.module];
  const caseId = b.case.id;

  if (!draft.ready) return <p className="text-slate-600">{t('common.loading')}</p>;

  const set = (k: string, val: string) => {
    setSaved(undefined);
    draft.set(k, val);
  };
  const dirty = !sameFlat(v, initial);
  const input = unflatten(v);
  const scope = { medIds: b.activeCourses.map((c) => c.medId), problemIds: b.problems.map((p) => p.problemId) };
  const progress = taskProgress(def, { checks: input.checks, fields: input.fields }, scope);
  const status = (v.status || 'not_started') as TaskStatus;

  const issueHref = (label: string, drug?: string) => {
    const q = new URLSearchParams({ task: 't05', from: def.id, problem: drug ? `${label} — ${drug}` : label, ...(drug ? { drugs: drug } : {}) });
    return `#/cases/${caseId}/item/new/drp?${q.toString()}`;
  };

  const unanswered = progress.total - progress.answered;
  // "Done" is a statement that every item was looked at; an unanswered item can still be marked N/A.
  const doneBlocked = status === 'done' && unanswered > 0;

  const save = async () => {
    setErrors({});
    if (doneBlocked) {
      setErrors({ save: t('task.doneBlocked', { n: unanswered }) });
      return;
    }
    const n = normalizeTaskInput(def.id, input);
    if (!n.ok) {
      setErrors(n.errors);
      return;
    }
    setBusy(true);
    try {
      const r = await store.saveTask(caseId, def.id, input);
      await draft.clear();
      setSaved(r.version);
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.errors);
      else setErrors({ save: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const ready = def.needs ? readiness(def.needs, { case: b.case, current: b.current, attachments: b.attachments, items: b.items }) : [];
  const modIndex = MODULES.findIndex((x) => x.id === def.module) + 1;

  return (
    <div className="flex flex-col gap-4" data-testid="task-page" data-task={def.id}>
      <section className="surface overflow-hidden">
        <div className={`flex items-start gap-3 p-4 ${st.soft}`}>
          <a href={`#/cases/${caseId}/modules/${def.module}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white/60" aria-label={t('common.back')}>
            <Icon name="chevron-back" className="h-6 w-6" />
          </a>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={`text-xs font-semibold uppercase tracking-wide ${st.text}`}>
              {t('modules.taskN', { n: def.number })} · {t('modules.moduleN', { n: modIndex })} {tl(m.title)}
            </span>
            <h1 className="text-xl font-semibold leading-snug text-slate-900">
              <Bi l={def.title} subClassName="text-sm font-normal text-slate-600" />
            </h1>
            <p className="mt-1 text-sm text-slate-800">{tl(def.purpose)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3">
          {progress.total > 0 && (
            <div className="flex items-center gap-3">
              <ProgressBar value={progress.answered} total={progress.total} barClass={st.bar} label={t('modules.answered', { a: progress.answered, n: progress.total })} />
              <span className="shrink-0 text-xs text-slate-700">
                <Num>{t('modules.answered', { a: progress.answered, n: progress.total })}</Num>
              </span>
            </div>
          )}
          <div role="radiogroup" aria-label={t('task.status')} className="flex flex-wrap gap-1.5" data-testid="task-status">
            {TASK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                disabled={readOnly}
                onClick={() => set('status', s)}
                className={`min-h-[40px] rounded-full border px-3 text-sm font-medium ${status === s ? 'border-ink bg-ink text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}
              >
                {t(`modules.status.${s}`)}
              </button>
            ))}
          </div>
          {status === 'not_applicable' && (
            <TextField label={t('task.naReason')} value={v.naReason ?? ''} onChange={(x) => set('naReason', x)} error={errText(errors.naReason as never)} />
          )}
          {doneBlocked && (
            <p className="flex items-start gap-2 rounded-xl bg-saffron-50 px-3 py-2 text-sm text-saffron-900" data-testid="done-blocked">
              <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('task.doneBlocked', { n: unanswered })}</span>
            </p>
          )}
        </div>
      </section>

      <TaskAlerts b={b} taskId={def.id} />

      {draft.restored && dirty && (
        <Banner tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('ed.restored')}</span>
            <Button variant="ghost" onClick={() => void draft.discard()}>
              {t('task.discardDraft')}
            </Button>
          </div>
        </Banner>
      )}

      <details className="surface group" open={status === 'not_started'}>
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold text-slate-900">
          <span className="flex items-center gap-2">
            <Icon name="compass" className="h-5 w-5 text-saffron-700" />
            {t('task.how')}
          </span>
          <Icon name="chevron-down" className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <ol className="flex flex-col gap-2 border-t border-line px-4 py-3">
          {def.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-800">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-saffron-100 text-xs font-semibold text-saffron-900 tabular">{i + 1}</span>
              <span>{tl(s)}</span>
            </li>
          ))}
        </ol>
      </details>

      <AiDraft def={def} b={b} />

      {ready.length > 0 && <Readiness items={ready} caseId={caseId} />}

      {def.panels && <TaskPanels def={def} b={b} draftFields={input.fields} />}

      {def.calculators && def.calculators.length > 0 && <TaskCalculators b={b} ids={def.calculators} />}

      {def.case && (def.case.checks.length > 0 || (def.case.fields?.length ?? 0) > 0) && (
        <Card title={t('task.checklist')}>
          <div className="flex flex-col">
            {def.case.checks.map((c) => (
              <CheckRow
                key={c.id}
                label={tl(c.label)}
                value={v[`c:${c.id}`] ?? ''}
                onChange={(x) => set(`c:${c.id}`, x)}
                issueHref={issueHref(tl(c.label))}
                disabled={readOnly}
                testId={`check-${c.id}`}
              />
            ))}
          </div>
          {(def.case.fields?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-col gap-4">
              {def.case.fields!.map((f) => (
                <TaskField key={f.id} f={f} value={v[`f:${f.id}`] ?? ''} onChange={(x) => set(`f:${f.id}`, x)} disabled={readOnly} />
              ))}
            </div>
          )}
        </Card>
      )}

      {def.perMedication && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900">{t('task.perMed')}</h2>
          <ScopedBlock
            def={def}
            sec={def.perMedication}
            kind="medication"
            rows={b.activeCourses.map((c) => ({ id: c.medId, title: c.drug, subtitle: regimenText(c) }))}
            v={v}
            set={set}
            issueHref={issueHref}
            disabled={readOnly}
            gateFor={def.id === GATED_ANSWERS.taskId ? (medId) => {
              const course = b.activeCourses.find((c) => c.medId === medId);
              return course ? renalDoseReviewGate(b.calcContext, course) : undefined;
            } : undefined}
            tagsFor={(medId) => (rules.ready ? <InlineAlertTags alerts={rules.forMed(medId).filter((a) => a.taskId === def.id)} /> : null)}
            errors={errors}
            caseId={caseId}
          />
          {b.activeCourses.length === 0 && (
            <a href={`#/cases/${caseId}/entry/new?type=med_start`} className="self-start text-sm font-medium text-teal-900 underline">
              {t('task.addMed')}
            </a>
          )}
        </section>
      )}

      {def.perProblem && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900">{t('task.perProblem')}</h2>
          <ScopedBlock
            def={def}
            sec={def.perProblem}
            kind="problem"
            rows={b.problems.map((p) => ({ id: p.problemId, title: p.latest.payload.name, subtitle: `${p.latest.payload.acuity} · ${p.latest.payload.status}` }))}
            v={v}
            set={set}
            issueHref={issueHref}
            disabled={readOnly}
            caseId={caseId}
          />
          {b.problems.length === 0 && (
            <a href={`#/cases/${caseId}/entry/new?type=note&category=problem`} className="self-start text-sm font-medium text-teal-900 underline">
              {t('task.addProblem')}
            </a>
          )}
        </section>
      )}

      {(def.registers ?? []).map((r) => (
        <RegisterList key={r} b={b} register={r} taskId={def.id} readOnly={readOnly} />
      ))}

      <Card title={t('task.notes')}>
        <TextAreaField label={t('task.notesLabel')} value={v.notes ?? ''} onChange={(x) => set('notes', x)} rows={3} />
      </Card>

      {def.later && def.later.length > 0 && (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Icon name="sparkle" className="h-4 w-4 text-saffron-700" />
            {t('task.later')}
          </h2>
          <ul className="flex flex-col gap-2 text-sm text-slate-700">
            {def.later.map((l) => (
              <li key={l.milestone} className="flex gap-2">
                <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{l.milestone}</span>
                <span>{tl(l.what)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!readOnly && (
        <div className="sticky bottom-[112px] z-10 -mx-1 flex items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 p-3 shadow-lift backdrop-blur" data-print="hide">
          <span className="text-sm" role="status" aria-live="polite">
            {saved ? (
              <span className="font-medium text-emerald-800">{t('task.saved', { n: saved })}</span>
            ) : dirty ? (
              <span className="font-medium text-saffron-800">{t('task.unsaved')}</span>
            ) : rec ? (
              <span className="text-slate-600">{t('task.savedVersion', { n: rec.version })}</span>
            ) : (
              <span className="text-slate-600">{t('task.notSavedYet')}</span>
            )}
            {Object.keys(errors).length > 0 && <span className="block font-medium text-red-700">{errors.save ?? t('err.fixFields')}</span>}
          </span>
          <Button variant="primary" onClick={save} disabled={busy || (!dirty && !!rec)} icon="check">
            {busy ? t('common.saving') : t('task.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function TaskPage({ caseId, taskId }: { caseId: string; taskId: string }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  const def = TASKS.get(taskId);
  if (!def) return <Banner tone="warning">{t('modules.unknown')}</Banner>;
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const rec = state.b.taskById.get(taskId);
  // Re-mount when a new version arrives, so the worksheet starts from the saved record.
  return <Worksheet key={`${taskId}@${rec?.version ?? 0}`} def={def} b={state.b} rec={rec} />;
}

