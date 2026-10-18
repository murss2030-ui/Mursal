import { useState } from 'react';
import { ANALYTE_BY_ID } from '../../domain/catalogue';
import type { Errors } from '../../domain/entries';
import { formatNumber } from '../../domain/numbers';
import { regimenText, unitText } from '../../domain/timeline';
import type { EntryOf, ExtractedField, RegisterId, RegisterItem, Suggestion } from '../../domain/types';
import { REGISTER_IDS } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { TASKS } from '../../domain/workflow/catalogue';
import { isFieldVisible, normalizeItemFields, REGISTERS, type FieldDef } from '../../domain/workflow/registers';
import { useI18n } from '../../i18n/i18n';
import { Bi, useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { Banner, Button, Card, CheckboxField, Num, PageTitle, SelectField, TextAreaField, TextField, useErrorText } from '../components/ui';
import { useItemHistory } from '../data';
import { usePersistentDraft } from '../hooks';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { ChoicePills, MultiPills } from './choice-controls';
import { SourcePeek } from './SourceViewer';
import { itemTitle } from './RegisterList';
import { CausalityPanel } from '../rules/Causality';

type Mode =
  | { kind: 'new'; register: string }
  | { kind: 'edit'; itemId: string }
  /** M3: correcting a medicine the model read from a document, before it becomes a row of the list. */
  | { kind: 'extracted'; runId: string; field: ExtractedField; attachmentId: string; back: string }
  /** M3: editing a register row the model suggested, before accepting it. */
  | { kind: 'suggested'; analysisId: string; suggestion: Suggestion; back: string };

export type ItemEditorMode = Mode;

function FieldControl({ f, value, set, error, b, register }: { f: FieldDef; value: string; set: (v: string) => void; error?: string; b: CaseBundle; register: RegisterId }) {
  const tl = useL();
  const { t } = useI18n();
  const label = tl(f.label);
  const hint = f.hint ? tl(f.hint) : undefined;
  const optional = !f.required && !f.requiredIf;
  switch (f.kind) {
    case 'text':
      return <TextField label={label} hint={hint} value={value} onChange={set} error={error} optional={optional} name={f.id} />;
    case 'longtext':
      return <TextAreaField label={label} hint={hint} value={value} onChange={set} error={error} optional={optional} name={f.id} />;
    case 'choice':
      return (f.options?.length ?? 0) <= 6 ? (
        <ChoicePills label={label} hint={hint} options={f.options ?? []} value={value} onChange={set} error={error} testId={`field-${f.id}`} />
      ) : (
        <SelectField label={label} hint={hint} value={value} onChange={set} error={error} optional={optional} name={f.id} options={(f.options ?? []).map((o) => ({ value: o.value, label: tl(o.label) }))} />
      );
    case 'multi':
      return <MultiPills label={label} hint={hint} options={f.options ?? []} value={value} onChange={set} error={error} />;
    case 'day':
      return (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField label={label} hint={hint} inputMode="numeric" value={value} onChange={set} error={error} optional={optional} name={f.id} />
          </div>
          {b.today !== null && (
            <Button className="mb-[2px]" onClick={() => set(String(b.today))}>
              {t('ed.today', { d: b.today })}
            </Button>
          )}
        </div>
      );
    case 'time':
      return <TextField label={label} hint={hint} type="time" value={value} onChange={set} error={error} optional={optional} name={f.id} />;
    case 'confirm':
      return <CheckboxField label={label} hint={hint} checked={value === 'yes'} onChange={(x) => set(x ? 'yes' : '')} error={error} name={f.id} />;
    case 'medRef':
      return (
        <SelectField
          label={label}
          hint={hint}
          value={value}
          onChange={set}
          error={error}
          optional={optional}
          name={f.id}
          options={b.courses.map((c) => ({ value: c.medId, label: `${c.drug} — ${regimenText(c)}${c.status === 'stopped' ? ` (${t('item.stopped')})` : ''}` }))}
        />
      );
    case 'problemRef':
      return (
        <SelectField
          label={label}
          hint={hint}
          value={value}
          onChange={set}
          error={error}
          optional={optional}
          name={f.id}
          options={b.problems.map((p) => ({ value: p.problemId, label: p.latest.payload.name }))}
        />
      );
    case 'entryRef': {
      const labs = b.current.filter(
        (e): e is EntryOf<'lab'> => e.type === 'lab' && (register !== 'tdm' || ANALYTE_BY_ID.get(e.payload.analyte)?.group === 'drug_level'),
      );
      return (
        <SelectField
          label={label}
          hint={hint ?? (labs.length === 0 ? t('item.noLevels') : undefined)}
          value={value}
          onChange={set}
          error={error}
          optional={optional}
          name={f.id}
          options={labs.map((e) => ({
            value: e.id,
            label: `${e.payload.analyteName} ${e.payload.result.kind === 'numeric' ? `${formatNumber(e.payload.result.value)} ${unitText(e.payload.unit)}` : e.payload.result.text} — ${t('common.day', { n: e.hospitalDay })}${e.timeOfDay ? ` ${e.timeOfDay}` : ''}`,
          }))}
        />
      );
    }
  }
}

function History({ itemId }: { itemId: string }) {
  const { t, when } = useI18n();
  const h = useItemHistory(itemId);
  if (h.status !== 'ready' || h.data.length <= 1) return null;
  return (
    <details className="surface p-4 text-sm">
      <summary className="min-h-touch cursor-pointer font-medium text-slate-800">{t('item.history', { n: h.data.length })}</summary>
      <ol className="mt-2 flex flex-col gap-2">
        {[...h.data].reverse().map((v: RegisterItem, i, arr) => {
          const prev = arr[i + 1];
          const changed = prev ? Object.keys({ ...prev.fields, ...v.fields }).filter((k) => prev.fields[k] !== v.fields[k]) : [];
          return (
            <li key={v.version} className="rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t('common.version', { n: v.version })}</span>
                <span className="text-xs text-slate-600">
                  <Num>{when(v.versionCreatedAt)}</Num>
                </span>
                {v.status === 'retracted' && <span className="rounded-full bg-slate-200 px-2 text-xs">{t('item.retracted')}</span>}
              </div>
              {v.changeReason && <p className="text-slate-700">{v.changeReason}</p>}
              {changed.length > 0 && <p className="text-xs text-slate-600">{t('item.changed', { fields: changed.join(', ') })}</p>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function EditorBody({
  b,
  register,
  item,
  query,
  extracted,
  suggested,
}: {
  b: CaseBundle;
  register: RegisterId;
  item?: RegisterItem;
  query: URLSearchParams;
  extracted?: { runId: string; field: ExtractedField; attachmentId: string; back: string };
  suggested?: { analysisId: string; suggestion: Suggestion; back: string };
}) {
  const { t } = useI18n();
  const tl = useL();
  const errText = useErrorText();
  const { store } = useSession();
  const def = REGISTERS[register];
  const returnTask = query.get('task');
  const fromTask = query.get('from');
  const back = extracted ? extracted.back : suggested ? suggested.back : returnTask && TASKS.has(returnTask) ? `/cases/${b.case.id}/task/${returnTask}` : `/cases/${b.case.id}/modules`;

  const prefill: Record<string, string> = {};
  if (!item) for (const f of def.fields) if (query.get(f.id)) prefill[f.id] = query.get(f.id)!;
  const initial: Record<string, string> = item ? { ...item.fields } : extracted ? { ...extracted.field.values } : suggested ? { ...(suggested.suggestion.fields ?? {}) } : prefill;
  const draftId = item
    ? `item:edit:${item.id}`
    : extracted
      ? `item:extracted:${extracted.runId}:${extracted.field.id}`
      : suggested
        ? `item:suggested:${suggested.analysisId}:${suggested.suggestion.id}`
        : `item:new:${b.case.id}:${register}`;
  const draft = usePersistentDraft<Record<string, string>>(draftId, initial);
  const v = draft.values;
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [retracting, setRetracting] = useState(false);
  const [failure, setFailure] = useState<string>();
  const readOnly = b.case.status === 'archived' || item?.status === 'retracted';

  if (!draft.ready) return <p className="text-slate-600">{t('common.loading')}</p>;

  const leave = async () => {
    await draft.clear();
    navigate(back);
  };

  const save = async () => {
    setErrors({});
    setFailure(undefined);
    const n = normalizeItemFields(register, v);
    if (!n.ok) {
      setErrors(n.errors as Errors);
      return;
    }
    setBusy(true);
    const here = window.location.hash;
    try {
      if (extracted) await store.decideExtractedField(b.case.id, extracted.runId, extracted.field.id, { kind: 'correct', values: v });
      else if (suggested) await store.decideSuggestion(b.case.id, suggested.analysisId, suggested.suggestion.id, { kind: 'edit', fields: v });
      else if (item) await store.updateItem(b.case.id, item.id, v, reason);
      else await store.addItem(b.case.id, register, v);
      await draft.clear();
      if (window.location.hash === here) navigate(back);
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.errors);
      else setFailure(t('err.generic', { message: (e as Error).message }));
      setBusy(false);
    }
  };

  const retract = async () => {
    if (!item) return;
    if (!reason.trim()) {
      setErrors({ reason: 'required' });
      return;
    }
    setBusy(true);
    try {
      await store.retractItem(b.case.id, item.id, reason);
      await draft.clear();
      navigate(back);
    } catch (e) {
      setFailure(t('err.generic', { message: (e as Error).message }));
      setBusy(false);
    }
  };

  const visible = def.fields.filter((f) => isFieldVisible(f, v));

  return (
    <div className="flex flex-col gap-4" data-testid="item-editor" data-register={register}>
      <PageTitle back={`#${back}`}>{item ? t('item.titleEdit', { noun: tl(def.noun) }) : t('item.titleNew', { noun: tl(def.noun) })}</PageTitle>
      <p className="-mt-3 text-sm text-slate-600">{tl(def.title)}</p>
      {fromTask && TASKS.has(fromTask) && (
        <Banner tone="info">
          <span className="flex flex-col gap-1">
            <span>{t('item.fromTask', { n: TASKS.get(fromTask)!.number })}</span>
            <Bi l={TASKS.get(fromTask)!.title} className="font-medium" />
          </span>
        </Banner>
      )}
      {item?.status === 'retracted' && <Banner tone="warning">{t('item.isRetracted', { reason: item.changeReason ?? '' })}</Banner>}
      {extracted && (
        <>
          <SourcePeek caseId={b.case.id} attachmentId={extracted.attachmentId} />
          <Banner tone="info">
            <span dir="auto">
              {t('review.readAs')} <q className="font-mono text-[13px]">{extracted.field.rawText}</q>
            </span>
          </Banner>
        </>
      )}
      {draft.restored && <Banner tone="info">{t('ed.restored')}</Banner>}
      {register === 'drp' && <Banner tone="info">{t('item.drpTeaching')}</Banner>}

      <Card>
        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          {visible.map((f) => (
            <FieldControl key={f.id} f={f} b={b} register={register} value={v[f.id] ?? ''} set={(x) => draft.set(f.id, x)} error={errText(errors[f.id])} />
          ))}
        </fieldset>
      </Card>

      {item && !readOnly && (
        <TextField label={retracting ? t('item.retractReason') : t('item.changeReason')} optional={!retracting} value={reason} onChange={setReason} error={errText(errors.reason)} />
      )}
      {Object.keys(errors).length > 0 && (
        <Banner tone="danger" role="alert">
          {t('err.fixFields')}
        </Banner>
      )}
      {failure && (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {retracting ? (
            <>
              <Button variant="danger" onClick={retract} disabled={busy} icon="trash">
                {t('item.confirmRetract')}
              </Button>
              <Button variant="ghost" onClick={() => setRetracting(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={save} disabled={busy} icon="check">
                {busy ? t('common.saving') : t('item.save')}
              </Button>
              <Button variant="ghost" onClick={() => void leave()}>
                {t('common.cancel')}
              </Button>
              {item && (
                <Button variant="ghost" onClick={() => setRetracting(true)} icon="trash" className="ms-auto text-red-800">
                  {t('item.retract')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {item?.register === 'adr' && item.status === 'active' && <CausalityPanel b={b} item={item} readOnly={readOnly} />}
      {item && <History itemId={item.id} />}
      {item && (
        <p className="text-xs text-slate-600">
          <Icon name="history" className="me-1 inline h-3.5 w-3.5" />
          {t('item.appendOnly', { title: itemTitle(item) })}
        </p>
      )}
    </div>
  );
}

export function ItemEditor({ caseId, mode, query }: { caseId: string; mode: Mode; query: URLSearchParams }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  if (mode.kind === 'suggested') {
    if (!mode.suggestion.register) return <Banner tone="warning">{t('modules.unknown')}</Banner>;
    return <EditorBody b={b} register={mode.suggestion.register} query={query} suggested={mode} />;
  }
  if (mode.kind === 'extracted') {
    const t = mode.field.target;
    if (t.kind !== 'register') return <Banner tone="warning">{t.kind}</Banner>;
    return <EditorBody b={b} register={t.register} query={query} extracted={mode} />;
  }
  if (mode.kind === 'new') {
    if (!(REGISTER_IDS as readonly string[]).includes(mode.register)) return <Banner tone="warning">{t('modules.unknown')}</Banner>;
    return <EditorBody b={b} register={mode.register as RegisterId} query={query} />;
  }
  const item = b.allItems.find((i) => i.id === mode.itemId);
  if (!item) return <Banner tone="warning">{t('item.notFound')}</Banner>;
  return <EditorBody key={`${item.id}@${item.version}`} b={b} register={item.register} item={item} query={query} />;
}
