import { useMemo, useState, type ReactNode } from 'react';
import { deriveForm, type CopyMode, type EditTarget, type FieldItem, type FieldState, type FormFieldView, type FormSectionView } from '../../domain/form/derive';
import { FIELD_LABELS, FORM_TITLE, type FormLabel } from '../../domain/form/spec';
import type { Case, TimelineEntry } from '../../domain/types';
import type { CalcResult } from '../../calc/types';
import { Term, useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Banner, Button, Card, Chip, DayLabel, Num, TextAreaField } from '../components/ui';
import { useCalcResults, useEntries, useFormDraft, useIdentifiers, useItems, useTasks, useTrainee } from '../data';
import { resultCurrency } from '../../calc/currency';
import { CALC_BY_ID } from '../../calc/registry';
import { indexTimeline } from '../../domain/timeline';
import { usePersistentDraft } from '../hooks';
import { useSession } from '../session-context';
import { useCaseBundle } from '../case-bundle';
import { DATASETS } from '../../drugs/useVocabulary';
import { useCaseRules } from '../rules/useCaseRules';
import { InteractionCoverageNotice } from '../rules/SafetyViews';
import type { FormContext } from '../../domain/form/derive';

function Label({ l }: { l: FormLabel }) {
  const { lang } = useI18n();
  return (
    <span>
      <span lang="en" dir="ltr">
        {l.en}
      </span>
      {lang === 'ar' && (
        <span lang="ar" className="ms-1 text-[0.85em] font-normal text-slate-600">
          ({l.ar})
        </span>
      )}
    </span>
  );
}

function Item({ item }: { item: FieldItem }) {
  const { t, date } = useI18n();
  return (
    <li className="flex flex-col gap-1">
      <span dir="auto" className="text-slate-900">
        {item.date && (
          <Num>
            {date(item.date)}{' '}
          </Num>
        )}
        {item.day !== undefined && (
          <span className={item.date ? 'text-slate-600' : ''}>
            {item.date ? '(' : ''}
            <DayLabel day={item.day} />
            {item.date ? ')' : ''}
          </span>
        )}
        {item.dayRange && (
          <span className="text-slate-600">
            <Num>
              {item.dayRange[1] === null
                ? t('common.dayOngoing', { a: item.dayRange[0] })
                : t('common.dayRange', { a: item.dayRange[0], b: item.dayRange[1] })}
            </Num>
            {' · '}
          </span>
        )}
        {item.text && (item.day !== undefined || item.date ? ` · ${item.text}` : item.text)}
      </span>
      {item.provenance && (
        <span>
          <ProvenanceBadge state={item.provenance} />
        </span>
      )}
    </li>
  );
}

function StateView({ s }: { s: FieldState }) {
  const { t } = useI18n();
  switch (s.kind) {
    case 'value':
      return (
        <div className="flex flex-col gap-1">
          <ul className="flex flex-col gap-2">
            {s.items.map((it, i) => (
              <Item key={i} item={it} />
            ))}
          </ul>
          {s.missingParts?.map((m) => (
            <Chip key={m} tone="red">
              {t('form.state.missing')}: {t(`form.missing.${m}` as MsgKey)}
            </Chip>
          ))}
          {s.notes?.map((n) => (
            <span key={n} className={`text-xs ${n === 'nkda_conflict' ? 'font-medium text-red-700' : 'text-slate-600'}`}>
              {t(`form.note.${n}` as MsgKey)}
            </span>
          ))}
        </div>
      );
    case 'missing':
      return (
        <span data-form-state="missing">
          <Chip tone="red">
            {t('form.state.missing')}
            {s.hint ? ` — ${t(`form.missing.${s.hint}` as MsgKey)}` : ''}
          </Chip>
        </span>
      );
    case 'empty':
      return <span className="text-slate-500">—</span>;
    case 'not_yet':
      return (
        <span data-form-state="not_yet">
          <Chip>{t('form.state.notYet', { m: s.milestone })}</Chip>
        </span>
      );
    case 'withheld':
      return <Chip tone="violet">{t('form.state.withheld')}</Chip>;
    case 'not_applicable':
      return <span className="text-sm text-slate-600">{s.reason === 'teaching_case' ? t('form.state.notApplicableTeaching') : t('form.state.notDischarged')}</span>;
    case 'signature_line':
      return (
        <span className="block min-h-[40px] w-full border-b-2 border-slate-400" aria-label={t('form.signatureLine')}>
          &nbsp;
        </span>
      );
  }
}

/** Ids of calculation results whose inputs changed since (see src/calc/currency.ts). */
function outOfDate(c: Case, entries: readonly TimelineEntry[], results: readonly CalcResult[]): Set<string> {
  const ctx = { demographics: c.demographics, current: indexTimeline(entries).current };
  const ids = new Set<string>();
  for (const r of results) {
    const def = CALC_BY_ID.get(r.calc);
    if (def && !resultCurrency(r, def, ctx).current) ids.add(r.id);
  }
  return ids;
}

function editHref(caseId: string, e: EditTarget): string | null {
  switch (e.kind) {
    case 'identifiers':
    case 'case_details':
      return `#/cases/${caseId}/details`;
    case 'add_entry':
      return `#/cases/${caseId}/entry/new?type=${e.type}${e.category ? `&category=${e.category}` : ''}`;
    case 'settings':
      return '#/settings';
    case 'task':
      return `#/cases/${caseId}/task/${e.taskId}`;
    case 'calc':
      return `#/cases/${caseId}/calc/${e.calcId}`;
    case 'draft':
      return null;
  }
}

interface DraftEditing {
  editing: boolean;
  values: Record<string, string>;
  set: (k: string, v: string) => void;
}

function FieldRow({ f, caseId, readOnly, draft }: { f: FormFieldView; caseId: string; readOnly: boolean; draft: DraftEditing }) {
  const { t } = useI18n();
  const href = f.edit && !readOnly ? editHref(caseId, f.edit) : null;
  const draftKey = f.edit?.kind === 'draft' ? f.edit.key : null;
  return (
    <div className="flex flex-col border-b border-slate-100 py-2 last:border-b-0" data-field={f.key}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">
          <Label l={f.label} />
        </span>
        {href && (
          <a href={href} className="inline-flex min-h-touch shrink-0 items-center px-2 text-sm font-medium text-teal-900 underline">
            {f.edit?.kind === 'task' ? t('form.openTask') : f.state.kind === 'missing' && f.edit?.kind === 'add_entry' ? t('form.add') : t('form.editSource')}
          </a>
        )}
      </div>
      {draftKey && draft.editing && !readOnly ? (
        <TextAreaField label={<Label l={f.label} />} value={draft.values[draftKey] ?? ''} onChange={(x) => draft.set(draftKey, x)} rows={2} />
      ) : (
        <StateView s={f.state} />
      )}
    </div>
  );
}

function SectionCard({ s, caseId, readOnly, draft }: { s: FormSectionView; caseId: string; readOnly: boolean; draft: DraftEditing }) {
  const { t } = useI18n();
  return (
    <Card
      title={
        <span>
          <span className="me-2 text-teal-800">{s.number}.</span>
          <Label l={s.title} />
        </span>
      }
    >
      <div data-section={s.number}>
        {s.number === 1 && <p className="mb-2 text-xs text-slate-600">{t('form.calcNote')}</p>}
        {s.automatic && (
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-dashed border-slate-400 p-3" data-testid="form-automatic-interactions" data-checked={s.automatic.checked}>
            <h3 className="text-sm font-semibold text-slate-900">{t('form.s7.automatic')}</h3>
            <InteractionCoverageNotice />
            {!s.automatic.checked ? (
              <p className="text-sm text-amber-900">{s.automatic.reason}</p>
            ) : (
              <>
                {s.automatic.rows.length === 0 ? (
                  <p className="text-sm text-slate-800">{t('form.s7.noneFound', { source: s.automatic.source })}</p>
                ) : (
                  s.automatic.rows.map((r) => (
                    <div key={r.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2" data-row={r.key}>
                      {r.cells.map((cell) => (
                        <FieldRow key={cell.key} f={cell} caseId={caseId} readOnly draft={draft} />
                      ))}
                    </div>
                  ))
                )}
                {s.automatic.gaps.map((g) => (
                  <p key={g} className="text-sm text-amber-900" data-testid="form-automatic-gap">
                    {g}
                  </p>
                ))}
              </>
            )}
          </div>
        )}
        {s.automatic && <h3 className="text-sm font-semibold text-slate-900">{t('form.s7.trainee')}</h3>}
        {s.fields.map((f) => (
          <FieldRow key={f.key} f={f} caseId={caseId} readOnly={readOnly} draft={draft} />
        ))}
        {s.excluded && s.excluded.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-amber-400 bg-amber-50 p-3" data-testid={`form-excluded-${s.number}`}>
            <h3 className="text-sm font-semibold text-amber-950">{t('form.excluded.title')}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {s.excluded.map((x) => (
                <li key={x.itemId} data-item={x.itemId} data-reason={x.reason}>
                  <a href={`#/cases/${caseId}/card/${x.itemId}`} className="font-medium text-teal-900 underline" dir="auto">
                    {x.problem}
                  </a>
                  <span className="text-amber-950">
                    {' — '}
                    {x.reason === 'stale' && x.day !== undefined ? t('card.stale.badge', { n: x.day }) : t(`form.excluded.${x.reason}` as MsgKey)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.checkboxes && (
          <div className="mt-2 flex flex-col gap-2" data-testid="drp-checkboxes">
            {s.checkboxes.ticked ? (
              <p className="text-xs text-slate-600">{t('form.drpTicked')}</p>
            ) : s.checkboxes.state.kind === 'empty' ? (
              <Banner tone="info">{t('form.drpNoneRecorded')}</Banner>
            ) : s.checkboxes.state.kind === 'missing' && s.checkboxes.state.hint === 'drp_excluded' ? (
              <Banner tone="warning">{t('form.drpAllExcluded')}</Banner>
            ) : (
              <Banner tone="info">{t('form.drpNotAssessed')}</Banner>
            )}
            <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
              {s.checkboxes.labels.map((l, i) => {
                const on = s.checkboxes!.ticked?.[i] ?? false;
                return (
                  <li key={l.en} className={`flex items-center gap-2 ${s.checkboxes!.ticked ? 'text-slate-900' : 'text-slate-500'}`} data-checked={on}>
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] font-bold ${on ? 'border-teal-800 bg-teal-800 text-white' : s.checkboxes!.ticked ? 'border-slate-500' : 'border-dashed border-slate-400'}`}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <span className="sr-only">{on ? '☑' : '☐'}</span>
                    <Label l={l} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {s.table && (
          <div className="mt-2 flex flex-col gap-3">
            {s.table.rows.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StateView s={s.table.emptyState} />
                {s.table.addTarget && !readOnly && editHref(caseId, s.table.addTarget) && (
                  <a href={editHref(caseId, s.table.addTarget)!} className="inline-flex min-h-touch items-center px-2 text-sm font-medium text-teal-900 underline">
                    {t('form.add')}
                  </a>
                )}
              </div>
            ) : (
              s.table.rows.map((r) => (
                <div key={r.key} className="rounded-lg border border-slate-200 p-2" data-row={r.key}>
                  {r.cells.map((cell) => (
                    <FieldRow key={cell.key} f={cell} caseId={caseId} readOnly={readOnly} draft={draft} />
                  ))}
                </div>
              ))
            )}
            {s.table.rows.length === 0 && s.table.emptyState.kind === 'not_yet' && (
              <p className="text-xs text-slate-600">
                {s.table.columns.map((k) => FIELD_LABELS[k].en).join(' · ')}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function FormTab({ c }: { c: Case }) {
  const { t } = useI18n();
  const { store } = useSession();
  const entries = useEntries(c.id);
  const ids = useIdentifiers(c.id);
  const formDraft = useFormDraft(c.id);
  const trainee = useTrainee();
  const items = useItems(c.id);
  const tasks = useTasks(c.id);
  const calcs = useCalcResults(c.id);
  const bundle = useCaseBundle(c.id);
  const rules = useCaseRules(bundle.status === 'ready' ? bundle.b : undefined);
  const [mode, setMode] = useState<CopyMode>('teaching'); // Teaching copy is the default (Section 15)
  const [editing, setEditing] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string>();
  const notes = usePersistentDraft<Record<string, string>>(`form:${c.id}`, {});
  const readOnly = c.status === 'archived';

  const ready =
    entries.status === 'ready' &&
    ids.status === 'ready' &&
    formDraft.status === 'ready' &&
    trainee.status === 'ready' &&
    items.status === 'ready' &&
    tasks.status === 'ready' &&
    calcs.status === 'ready' &&
    rules.ready;
  const automaticInteractions = useMemo((): FormContext['automaticInteractions'] => {
    if (!rules.ready) return undefined;
    // No dataset, or one refused: no check at all. Otherwise the gaps of a partial check are listed with the rows.
    const none = rules.notChecked.find((n) => n.key === 'interactions');
    if (none) return { checked: false, reason: none.reason.en };
    const found = rules.alerts.filter((a) => a.interaction);
    const gaps = rules.notChecked.filter((n) => n.what === 'interactions').map((n) => n.reason.en);
    return { checked: true, source: found[0]?.source.en ?? DATASETS.interactions?.source ?? '', rows: found.map((a) => ({ key: a.key, ...a.interaction! })), gaps };
  }, [rules.ready, rules.notChecked, rules.alerts]);
  const view = useMemo(
    () =>
      ready
        ? deriveForm({
            case: c,
            identifiers: ids.data,
            entries: entries.data,
            draft: formDraft.data,
            trainee: trainee.data,
            items: items.data,
            tasks: tasks.data,
            calcResults: calcs.data,
            calcOutOfDate: outOfDate(c, entries.data, calcs.data),
            reviews: bundle.status === 'ready' ? bundle.b.reviews : [],
            ...(automaticInteractions ? { automaticInteractions } : {}),
            mode,
          })
        : null,
    [ready, c, ids, entries, formDraft, trainee, items, tasks, calcs, automaticInteractions, mode, bundle],
  );
  if (!view) return <p className="text-slate-600">{t('common.loading')}</p>;

  const startEditing = () => {
    if (!notes.restored) notes.replace({ ...(formDraft.status === 'ready' ? formDraft.data?.fields ?? {} : {}) });
    setEditing(true);
    setSavedMsg(undefined);
  };
  const saveNotes = async () => {
    const merged = { ...(formDraft.status === 'ready' ? formDraft.data?.fields ?? {} : {}), ...notes.values };
    const v = await store.saveFormDraft(c.id, merged);
    await notes.clear();
    setEditing(false);
    setSavedMsg(t('form.notes.saved', { n: v.version }));
  };

  const draft: DraftEditing = { editing, values: notes.values, set: notes.set };
  const sectionLabel = (n: number) => t('form.section', { n });

  return (
    <div className="flex flex-col gap-4" data-testid="department-form">
      <div>
        <h2 className="text-xl font-semibold" lang="en">
          {FORM_TITLE.en}
        </h2>
        <p className="text-sm text-slate-600" lang="ar">
          {FORM_TITLE.ar}
        </p>
      </div>

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('form.copy')}>
            <span className="text-sm font-medium">{t('form.copy')}:</span>
            {(['teaching', 'ward'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={view.mode === m}
                disabled={m === 'ward' && c.kind === 'teaching'}
                onClick={() => setMode(m)}
                className={`min-h-touch rounded-full border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${view.mode === m ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
              >
                <Term id={m === 'teaching' ? 'teaching_copy' : 'ward_copy'} />
              </button>
            ))}
          </div>
          {c.kind === 'teaching' && <p className="text-xs text-slate-600">{t('form.teachingOnly')}</p>}
          <p className="text-xs text-slate-600">{t('form.exportLater')}</p>
        </div>
      </Card>

      <Card title={view.missing.length ? t('form.missingTitle', { n: view.missing.length }) : undefined}>
        {view.missing.length === 0 ? (
          <p className="text-sm text-slate-700">{t('form.noneMissing')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" data-testid="missing-list">
            {view.missing.map((m, i) => (
              <li key={i} className="flex flex-wrap gap-1">
                <span className="font-medium text-slate-700">{sectionLabel(m.section)}:</span>
                <Label l={m.key === 'table' ? m.label : FIELD_LABELS[m.key]} />
                {m.row && <span className="text-slate-600">— {t('form.row', { row: m.row })}</span>}
                {m.code && <span className="text-red-700">— {t(`form.missing.${m.code}` as MsgKey)}</span>}
              </li>
            ))}
          </ul>
        )}
        {view.notYet.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="min-h-touch cursor-pointer py-2 font-medium text-slate-800">{t('form.notYetTitle')}</summary>
            <ul className="flex flex-col gap-1">
              {view.notYet.map((n, i) => (
                <li key={i}>
                  {sectionLabel(n.section)}: <Label l={n.label} /> — {n.milestone}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {!readOnly && (
        <Card>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-600">{t('form.notes.help')}</p>
            {savedMsg && <Banner tone="success" role="status">{savedMsg}</Banner>}
            {notes.restored && !editing && <Banner tone="info">{t('ed.restored')}</Banner>}
            {editing ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={saveNotes}>
                  {t('form.notes.save')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await notes.discard();
                    setEditing(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <Button onClick={startEditing} icon="pencil">
                {t('form.notes.edit')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {view.sections.map((s) => (
        <SectionCard key={s.number} s={s} caseId={c.id} readOnly={readOnly} draft={draft} />
      ))}
    </div>
  );
}

export function FormLabelText({ l }: { l: FormLabel }): ReactNode {
  return <Label l={l} />;
}
