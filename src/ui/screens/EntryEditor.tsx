import { useMemo, useState, type ReactNode } from 'react';
import { ANALYTES, ANALYTE_BY_ID, CULTURE_SPECIMENS, DOSE_UNITS, FREQUENCIES, IMAGING_MODALITIES, OTHER, ROUTES, VITALS, VITAL_BY_ID } from '../../domain/catalogue';
import { dateOfHospitalDay, hospitalDayOf, isValidHospitalDay } from '../../domain/dates';
import {
  ALLERGY_KINDS,
  buildEntryMeta,
  buildPayload,
  contextForEntry,
  CULTURE_STATUSES,
  entryToValues,
  EVENT_CATEGORIES,
  HABIT_STATUSES,
  NOTE_CATEGORIES,
  PROBLEM_STATUSES,
  SEVERITIES,
  WEIGHT_METHODS,
  type BuildContext,
  type Errors,
  type Values,
} from '../../domain/entries';
import { parseInteger } from '../../domain/numbers';
import { deriveMedCourses, deriveProblems, indexTimeline, regimenText } from '../../domain/timeline';
import { M1_MANUAL_ENTRY_TYPES, type Case, type EntryType, type TimelineEntry } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { Term, useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import type { TermId } from '../../i18n/terms';
import { Banner, Button, Card, CheckboxField, PageTitle, RadioGroup, SelectField, TextAreaField, TextField, useErrorText, type Option } from '../components/ui';
import { useCaseVersions, useEntries } from '../data';
import { usePersistentDraft } from '../hooks';
import { navigate } from '../router';
import { useSession } from '../session-context';

export type EditorMode =
  | { kind: 'new'; type: string; category: string }
  | { kind: 'correct'; entryId: string }
  | { kind: 'med_change'; medId: string }
  | { kind: 'med_stop'; medId: string }
  | { kind: 'problem_update'; problemId: string };

interface FieldProps {
  v: Values;
  set: (k: string, x: string) => void;
  err: (k: string) => string | undefined;
}

function useOptions() {
  const { t, term } = useI18n();
  return {
    list: (items: readonly string[], withOther = false): Option[] => [
      ...items.map((x) => ({ value: x, label: x })),
      ...(withOther ? [{ value: OTHER, label: t('common.other') }] : []),
    ],
    keyed: (items: readonly string[], prefix: string): Option[] => items.map((x) => ({ value: x, label: t(`${prefix}.${x}` as MsgKey) })),
    terms: (items: readonly string[], prefix: string): Option[] => items.map((x) => ({ value: x, label: term(`${prefix}.${x}` as TermId) })),
  };
}

function ListWithOther({ name, label, otherLabel, items, v, set, err, optional }: FieldProps & { name: string; label: string; otherLabel: string; items: readonly string[]; optional?: boolean }) {
  const o = useOptions();
  return (
    <>
      <SelectField label={label} name={name} optional={optional} value={v[name] ?? ''} onChange={(x) => set(name, x)} options={o.list(items, true)} error={err(name)} />
      {v[name] === OTHER && <TextField label={otherLabel} name={`${name}Other`} value={v[`${name}Other`] ?? ''} onChange={(x) => set(`${name}Other`, x)} error={err(`${name}Other`)} />}
    </>
  );
}

function DoseFields({ v, set, err, optional }: FieldProps & { optional?: boolean }) {
  const { t } = useI18n();
  const kind = v.doseKind || 'structured';
  return (
    <>
      <RadioGroup
        name="doseKind"
        label={t('ed.doseKind')}
        value={kind}
        onChange={(x) => set('doseKind', x)}
        options={[
          { value: 'structured', label: t('ed.doseStructured') },
          { value: 'text', label: t('ed.doseWords') },
        ]}
      />
      {kind === 'text' ? (
        <TextField label={t('ed.doseText')} name="doseText" optional={optional} value={v.doseText ?? ''} onChange={(x) => set('doseText', x)} error={err('doseText')} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('ed.doseValue')} name="doseValue" optional={optional} inputMode="decimal" value={v.doseValue ?? ''} onChange={(x) => set('doseValue', x)} error={err('doseValue')} />
          <div className="flex flex-col gap-3">
            <ListWithOther name="doseUnit" label={t('ed.doseUnit')} otherLabel={t('ed.doseUnitOther')} items={DOSE_UNITS} v={v} set={set} err={err} optional={optional} />
          </div>
        </div>
      )}
    </>
  );
}

function LabFields({ v, set, err }: FieldProps) {
  const { t } = useI18n();
  const def = ANALYTE_BY_ID.get(v.analyte ?? '');
  const groups = useMemo(() => {
    const g = new Map<string, Option[]>();
    for (const a of ANALYTES) {
      const label = a.group.replace(/_/g, ' ');
      g.set(label, [...(g.get(label) ?? []), { value: a.id, label: a.name }]);
    }
    return [...g.entries()].map(([label, options]) => ({ label, options })).concat([{ label: 'other', options: [{ value: OTHER, label: t('common.other') }] }]);
  }, [t]);
  const kind = v.resultKind || 'numeric';
  return (
    <>
      <SelectField
        label={t('ed.analyte')}
        name="analyte"
        value={v.analyte ?? ''}
        groups={groups}
        error={err('analyte')}
        onChange={(x) => {
          set('analyte', x);
          const d = ANALYTE_BY_ID.get(x);
          // A test with a single accepted unit has no choice to make; otherwise the unit must be chosen explicitly.
          set('unit', d && d.units.length === 1 ? d.units[0]! : '');
        }}
      />
      {v.analyte === OTHER && <TextField label={t('ed.analyteOther')} name="analyteOther" value={v.analyteOther ?? ''} onChange={(x) => set('analyteOther', x)} error={err('analyteOther')} />}
      <RadioGroup
        name="resultKind"
        label={t('ed.resultKind')}
        value={kind}
        onChange={(x) => set('resultKind', x)}
        options={[
          { value: 'numeric', label: t('ed.numeric') },
          { value: 'text', label: t('ed.textResult') },
        ]}
      />
      {kind === 'text' ? (
        <TextField label={t('ed.resultText')} name="resultText" value={v.resultText ?? ''} onChange={(x) => set('resultText', x)} error={err('resultText')} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('ed.value')} name="value" inputMode="decimal" value={v.value ?? ''} onChange={(x) => set('value', x)} error={err('value')} />
          {v.analyte === OTHER ? (
            <TextField label={t('ed.unitOther')} name="unit" dir="ltr" value={v.unit ?? ''} onChange={(x) => set('unit', x)} error={err('unit')} />
          ) : def && def.units.length === 1 ? (
            <p className="self-end pb-3 text-sm text-slate-700" data-testid="fixed-unit">
              {t('ed.unitFixed', { unit: def.units[0]! === 'unitless' ? '—' : def.units[0]! })}
            </p>
          ) : (
            <SelectField
              label={t('ed.unit')}
              name="unit"
              value={v.unit ?? ''}
              onChange={(x) => set('unit', x)}
              options={(def?.units ?? []).map((u) => ({ value: u, label: u }))}
              error={err('unit')}
            />
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t('ed.refLow')} name="refLow" optional inputMode="decimal" value={v.refLow ?? ''} onChange={(x) => set('refLow', x)} error={err('refLow')} />
        <TextField label={t('ed.refHigh')} name="refHigh" optional inputMode="decimal" value={v.refHigh ?? ''} onChange={(x) => set('refHigh', x)} error={err('refHigh')} />
      </div>
      <TextField label={t('ed.refText')} name="refText" optional value={v.refText ?? ''} onChange={(x) => set('refText', x)} />
      <TextField label={t('ed.comment')} name="comment" optional value={v.comment ?? ''} onChange={(x) => set('comment', x)} />
    </>
  );
}

function VitalFields({ v, set, err }: FieldProps) {
  const { t } = useI18n();
  const def = VITAL_BY_ID.get(v.vital ?? '');
  return (
    <>
      <SelectField
        label={t('ed.vital')}
        name="vital"
        value={v.vital ?? ''}
        options={VITALS.map((x) => ({ value: x.id, label: x.name }))}
        error={err('vital')}
        onChange={(x) => {
          set('vital', x);
          const d = VITAL_BY_ID.get(x);
          set('unit', d && d.units.length === 1 ? d.units[0]! : '');
        }}
      />
      {def?.id === 'blood_pressure' ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={`${t('ed.systolic')} (mmHg)`} name="systolic" inputMode="decimal" value={v.systolic ?? ''} onChange={(x) => set('systolic', x)} error={err('systolic')} />
          <TextField label={`${t('ed.diastolic')} (mmHg)`} name="diastolic" inputMode="decimal" value={v.diastolic ?? ''} onChange={(x) => set('diastolic', x)} error={err('diastolic')} />
        </div>
      ) : def ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('ed.value')} name="value" inputMode="decimal" value={v.value ?? ''} onChange={(x) => set('value', x)} error={err('value')} />
          {def.units.length === 1 ? (
            <p className="self-end pb-3 text-sm text-slate-700">{t('ed.unitFixed', { unit: def.units[0]! })}</p>
          ) : (
            <SelectField label={t('ed.unit')} name="unit" value={v.unit ?? ''} onChange={(x) => set('unit', x)} options={def.units.map((u) => ({ value: u, label: u }))} error={err('unit')} />
          )}
        </div>
      ) : null}
      {def?.id === 'urine_output' && (
        <TextField label={t('ed.periodHours')} name="periodHours" inputMode="decimal" value={v.periodHours ?? ''} onChange={(x) => set('periodHours', x)} error={err('periodHours')} />
      )}
      <TextField label={t('ed.comment')} name="comment" optional value={v.comment ?? ''} onChange={(x) => set('comment', x)} />
    </>
  );
}

function NoteFields({ v, set, err, lockCategory }: FieldProps & { lockCategory: boolean }) {
  const { t } = useI18n();
  const o = useOptions();
  const cat = v.category ?? '';
  const habit = o.keyed(HABIT_STATUSES, 'habit');
  return (
    <>
      {!lockCategory && (
        <SelectField label={t('ed.category')} name="category" value={cat} onChange={(x) => set('category', x)} options={o.terms(NOTE_CATEGORIES, 'note')} error={err('category')} />
      )}
      {cat === 'allergy_adr' ? (
        <>
          <RadioGroup name="kind" label={t('ed.allergyKind')} value={v.kind ?? ''} onChange={(x) => set('kind', x)} options={o.keyed(ALLERGY_KINDS, 'allergy')} error={err('kind')} />
          {v.kind && v.kind !== 'nkda' && (
            <>
              <TextField label={t('ed.substance')} name="substance" value={v.substance ?? ''} onChange={(x) => set('substance', x)} error={err('substance')} />
              <TextField label={t('ed.reaction')} name="reaction" optional value={v.reaction ?? ''} onChange={(x) => set('reaction', x)} />
              <SelectField label={t('ed.severity')} name="severity" optional value={v.severity ?? ''} onChange={(x) => set('severity', x)} options={o.keyed(SEVERITIES, 'severity')} />
            </>
          )}
        </>
      ) : cat === 'social_history' ? (
        <>
          <RadioGroup name="khat" label={<Term id="khat" />} value={v.khat ?? ''} onChange={(x) => set('khat', x)} options={habit} error={err('khat')} />
          <TextField label={t('ed.khatDetails')} name="khatDetails" optional value={v.khatDetails ?? ''} onChange={(x) => set('khatDetails', x)} />
          <RadioGroup name="tobacco" label={<Term id="tobacco" />} value={v.tobacco ?? ''} onChange={(x) => set('tobacco', x)} options={habit} error={err('tobacco')} />
          <TextField label={t('ed.tobaccoDetails')} name="tobaccoDetails" optional value={v.tobaccoDetails ?? ''} onChange={(x) => set('tobaccoDetails', x)} />
          <SelectField label={<Term id="alcohol" />} name="alcohol" optional value={v.alcohol ?? ''} onChange={(x) => set('alcohol', x)} options={habit} />
          <TextField label={t('ed.occupation')} name="occupation" optional value={v.occupation ?? ''} onChange={(x) => set('occupation', x)} />
          <TextAreaField label={t('ed.otherSocial')} name="other" optional value={v.other ?? ''} onChange={(x) => set('other', x)} />
        </>
      ) : cat === 'problem' ? (
        <>
          <TextField label={t('ed.problemName')} name="name" value={v.name ?? ''} onChange={(x) => set('name', x)} error={err('name')} />
          <RadioGroup name="acuity" label={t('ed.acuity')} value={v.acuity ?? ''} onChange={(x) => set('acuity', x)} options={o.keyed(['acute', 'chronic'], 'acuity')} error={err('acuity')} />
          <SelectField label={t('ed.problemStatus')} name="status" value={v.status ?? ''} onChange={(x) => set('status', x)} options={o.keyed(PROBLEM_STATUSES, 'pstatus')} error={err('status')} />
          <TextField label={t('ed.stage')} name="stage" optional value={v.stage ?? ''} onChange={(x) => set('stage', x)} />
          <TextField label={t('ed.problemType')} name="problemType" optional value={v.problemType ?? ''} onChange={(x) => set('problemType', x)} />
          <TextField label={t('ed.duration')} name="duration" optional value={v.duration ?? ''} onChange={(x) => set('duration', x)} />
          <CheckboxField label={t('ed.primaryDiagnosis')} name="primaryDiagnosis" checked={v.primaryDiagnosis === 'yes'} onChange={(x) => set('primaryDiagnosis', x ? 'yes' : 'no')} />
        </>
      ) : cat ? (
        <TextAreaField label={t('ed.noteText')} name="text" rows={4} value={v.text ?? ''} onChange={(x) => set('text', x)} error={err('text')} />
      ) : null}
    </>
  );
}

function TypeFields({ type, mode, ...p }: FieldProps & { type: string; mode: EditorMode['kind'] }) {
  const { t } = useI18n();
  const o = useOptions();
  const { v, set, err } = p;
  switch (type) {
    case 'lab':
      return <LabFields {...p} />;
    case 'vital':
      return <VitalFields {...p} />;
    case 'weight':
      return (
        <>
          <TextField label={t('ed.weightKg')} name="value" inputMode="decimal" value={v.value ?? ''} onChange={(x) => set('value', x)} error={err('value')} />
          <RadioGroup name="method" label={t('ed.weightMethod')} value={v.method ?? ''} onChange={(x) => set('method', x)} options={o.keyed(WEIGHT_METHODS, 'weight')} error={err('method')} />
        </>
      );
    case 'med_start':
      return (
        <>
          <TextField label={t('ed.drug')} name="drug" value={v.drug ?? ''} onChange={(x) => set('drug', x)} error={err('drug')} />
          <TextField label={t('ed.brand')} name="brand" optional value={v.brand ?? ''} onChange={(x) => set('brand', x)} />
          <DoseFields {...p} />
          <ListWithOther name="route" label={t('ed.route')} otherLabel={t('ed.routeOther')} items={ROUTES} {...p} />
          <ListWithOther name="frequency" label={t('ed.frequency')} otherLabel={t('ed.frequencyOther')} items={FREQUENCIES} {...p} />
          <TextField label={t('ed.indication')} name="indication" optional hint={t('ed.indicationHelp')} value={v.indication ?? ''} onChange={(x) => set('indication', x)} />
          <TextAreaField label={t('ed.notes')} name="notes" optional value={v.notes ?? ''} onChange={(x) => set('notes', x)} />
        </>
      );
    case 'med_change':
      return (
        <>
          <p className="text-sm text-slate-700">{t('ed.changeHelp')}</p>
          {err('changes') && (
            <Banner tone="danger" role="alert">
              {err('changes')}
            </Banner>
          )}
          <DoseFields {...p} optional />
          <ListWithOther name="route" label={t('ed.route')} otherLabel={t('ed.routeOther')} items={ROUTES} {...p} optional />
          <ListWithOther name="frequency" label={t('ed.frequency')} otherLabel={t('ed.frequencyOther')} items={FREQUENCIES} {...p} optional />
          <TextAreaField label={t('ed.changeReason')} name="reason" optional value={v.reason ?? ''} onChange={(x) => set('reason', x)} />
        </>
      );
    case 'med_stop':
      return <TextAreaField label={t('ed.stopReason')} name="reason" optional value={v.reason ?? ''} onChange={(x) => set('reason', x)} />;
    case 'culture':
      return (
        <>
          <ListWithOther name="specimen" label={t('ed.specimen')} otherLabel={t('ed.specimenOther')} items={CULTURE_SPECIMENS} {...p} />
          <RadioGroup name="status" label={t('ed.cultureStatus')} value={v.status ?? ''} onChange={(x) => set('status', x)} options={o.keyed(CULTURE_STATUSES, 'culture')} error={err('status')} />
          <TextField label={t('ed.organism')} name="organism" optional={v.status !== 'growth'} value={v.organism ?? ''} onChange={(x) => set('organism', x)} error={err('organism')} />
          <TextField label={t('ed.gramStain')} name="gramStain" optional value={v.gramStain ?? ''} onChange={(x) => set('gramStain', x)} />
          <TextAreaField label={t('ed.susceptibility')} name="susceptibility" optional value={v.susceptibility ?? ''} onChange={(x) => set('susceptibility', x)} />
        </>
      );
    case 'imaging':
      return (
        <>
          <Banner tone="info">{t('ed.imagingNotice')}</Banner>
          <ListWithOther name="modality" label={t('ed.modality')} otherLabel={t('ed.modalityOther')} items={IMAGING_MODALITIES} {...p} />
          <TextField label={t('ed.region')} name="region" optional value={v.region ?? ''} onChange={(x) => set('region', x)} />
          <TextAreaField label={t('ed.reportText')} name="reportText" rows={5} value={v.reportText ?? ''} onChange={(x) => set('reportText', x)} error={err('reportText')} />
        </>
      );
    case 'procedure':
      return (
        <>
          <TextField label={t('ed.procedureName')} name="name" value={v.name ?? ''} onChange={(x) => set('name', x)} error={err('name')} />
          <TextAreaField label={t('ed.details')} name="details" optional value={v.details ?? ''} onChange={(x) => set('details', x)} />
        </>
      );
    case 'note':
      return <NoteFields {...p} lockCategory={mode === 'problem_update' || (mode === 'correct' && v.category === 'problem')} />;
    case 'event':
      return (
        <>
          <SelectField label={t('ed.eventCategory')} name="category" value={v.category ?? ''} onChange={(x) => set('category', x)} options={o.keyed(EVENT_CATEGORIES, 'event')} error={err('category')} />
          <TextAreaField label={t('ed.description')} name="description" value={v.description ?? ''} onChange={(x) => set('description', x)} error={err('description')} />
        </>
      );
    default:
      return null;
  }
}

function draftIdFor(caseId: string, mode: EditorMode): string {
  switch (mode.kind) {
    case 'new':
      return `entry:new:${caseId}`;
    case 'correct':
      return `entry:correct:${mode.entryId}`;
    case 'med_change':
      return `med:change:${mode.medId}`;
    case 'med_stop':
      return `med:stop:${mode.medId}`;
    case 'problem_update':
      return `problem:update:${mode.problemId}`;
  }
}

/** Resolves the editor's subject (original entry, course or problem) once the timeline has loaded. */
function EditorBody({ c, entries, mode }: { c: Case; entries: TimelineEntry[]; mode: EditorMode }) {
  const i18n = useI18n();
  const { t, when, date } = i18n;
  const { store } = useSession();
  const errText = useErrorText();
  const idx = useMemo(() => indexTimeline(entries), [entries]);

  const original = mode.kind === 'correct' ? idx.byId.get(mode.entryId) : undefined;
  const course = mode.kind === 'med_change' || mode.kind === 'med_stop' ? deriveMedCourses(idx.current).find((m) => m.medId === mode.medId) : undefined;
  const problem = mode.kind === 'problem_update' ? deriveProblems(idx.current).find((p) => p.problemId === mode.problemId) : undefined;

  const initial = useMemo((): Values => {
    if (original) return { ...entryToValues(original), correctionKind: '', reason: '' };
    if (problem) return { ...entryToValues(problem.latest), hospitalDay: '', timeOfDay: '' };
    if (mode.kind === 'new') return { type: mode.type, category: mode.category, hospitalDay: '' };
    return { hospitalDay: '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const draft = usePersistentDraft<Values>(draftIdFor(c.id, mode), initial);
  const v = draft.values;
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  const type: string =
    mode.kind === 'new' ? v.type ?? '' : mode.kind === 'correct' ? original?.type ?? '' : mode.kind === 'problem_update' ? 'note' : mode.kind;
  const err = (k: string) => errText(errors[k]);
  const todayDay = hospitalDayOf(c.admissionDay0, store.today());
  const dayParsed = parseInteger(v.hospitalDay ?? '');
  const dayDate = dayParsed.ok && isValidHospitalDay(dayParsed.value) ? date(dateOfHospitalDay(c.admissionDay0, dayParsed.value)) : undefined;

  if (mode.kind === 'correct' && (!original || idx.successorOf.has(original.id))) {
    return <Banner tone="warning">{t('tl.superseded')}</Banner>;
  }
  if ((mode.kind === 'med_change' || mode.kind === 'med_stop') && !course) return <Banner tone="warning">{t('tl.noActiveMeds')}</Banner>;
  if (mode.kind === 'problem_update' && !problem) return <Banner tone="warning">{t('tl.noProblems')}</Banner>;
  if (!draft.ready) return <p className="text-slate-600">{t('common.loading')}</p>;

  const retracting = mode.kind === 'correct' && v.correctionKind === 'retract';

  const save = async () => {
    const editorHash = window.location.hash;
    const errs: Errors = {};
    let meta: ReturnType<typeof buildEntryMeta> | undefined;
    if (!retracting) {
      meta = buildEntryMeta(v);
      if (!meta.ok) Object.assign(errs, meta.errors);
    }
    if (mode.kind === 'new' && !type) errs.type = 'required';
    if (mode.kind === 'correct') {
      if (!v.correctionKind) errs.correctionKind = 'required';
      if (!(v.reason ?? '').trim()) errs.reason = 'required';
    }
    let ctx: BuildContext = { newId: () => crypto.randomUUID() };
    if (original) ctx = contextForEntry(original);
    if (course) ctx = { medId: course.medId, drug: course.drug };
    if (problem) ctx = { problemId: problem.problemId };
    const built = type && !retracting ? buildPayload(type as EntryType, v, ctx) : undefined;
    if (built && !built.ok) Object.assign(errs, built.errors);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      let saved: TimelineEntry;
      if (mode.kind === 'correct') {
        saved = retracting
          ? await store.correctEntry(c.id, original!.id, { kind: 'retract', reason: v.reason ?? '' })
          : await store.correctEntry(c.id, original!.id, {
              kind: 'amend',
              reason: v.reason ?? '',
              hospitalDay: (meta as { hospitalDay: number }).hospitalDay,
              timeOfDay: (meta as { timeOfDay?: string }).timeOfDay,
              payload: (built as { payload: TimelineEntry['payload'] }).payload,
            });
      } else {
        const m = meta as { hospitalDay: number; timeOfDay?: string };
        saved = await store.addEntry(c.id, {
          type: type as EntryType,
          hospitalDay: m.hospitalDay,
          timeOfDay: m.timeOfDay,
          payload: (built as { payload: TimelineEntry['payload'] }).payload,
        });
      }
      await draft.clear();
      // Only return to the timeline if the trainee is still on this editor; never pull them off a screen they moved to.
      if (window.location.hash === editorHash) {
        navigate(`/cases/${c.id}/timeline`);
        window.setTimeout(() => document.getElementById(`entry-${saved.id}`)?.scrollIntoView({ block: 'center' }), 300);
      }
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.errors);
      else setFailure(t('err.generic', { message: (e as Error).message }));
      setBusy(false);
    }
  };

  const titleKey: MsgKey =
    mode.kind === 'new' ? 'ed.addTitle' : mode.kind === 'correct' ? 'ed.correctTitle' : mode.kind === 'med_change' ? 'ed.changeTitle' : mode.kind === 'med_stop' ? 'ed.stopTitle' : 'ed.problemTitle';
  const o = (items: readonly string[]): Option[] => items.map((x) => ({ value: x, label: i18n.term(`entry.${x}` as TermId) }));

  const wrap = (children: ReactNode) => <div className="flex flex-col gap-4">{children}</div>;

  return wrap(
    <>
      <PageTitle back={`#/cases/${c.id}/timeline`}>{t(titleKey)}</PageTitle>
      {draft.restored && (
        <Banner tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {t('ed.restored')}
            <Button variant="ghost" onClick={() => void draft.discard()}>
              {t('ed.discard')}
            </Button>
          </div>
        </Banner>
      )}
      {mode.kind === 'correct' && original && (
        <Card>
          <div className="flex flex-col gap-3">
            <Banner tone="warning">{t('ed.correctBanner', { d: original.hospitalDay, when: when(original.recordedAt) })}</Banner>
            {original.type.startsWith('med_') && <p className="text-sm text-slate-700">{t('ed.correctionVsChange')}</p>}
            <RadioGroup
              name="correctionKind"
              label={t('ed.correctionKind')}
              value={v.correctionKind ?? ''}
              onChange={(x) => draft.set('correctionKind', x)}
              error={err('correctionKind')}
              options={[
                { value: 'amend', label: t('ed.amend') },
                { value: 'retract', label: t('ed.retract') },
              ]}
            />
            <TextAreaField label={t('ed.reason')} name="reason" value={v.reason ?? ''} onChange={(x) => draft.set('reason', x)} error={err('reason')} />
          </div>
        </Card>
      )}
      {course && (
        <Banner tone="info">
          <span dir="auto">
            {course.drug}: {t('ed.currentRegimen', { regimen: regimenText(course) })}
          </span>
        </Banner>
      )}
      {!retracting && (
        <Card>
          <div className="flex flex-col gap-4">
            {mode.kind === 'new' && (
              <SelectField
                label={t('ed.type')}
                name="type"
                value={v.type ?? ''}
                options={o(M1_MANUAL_ENTRY_TYPES)}
                error={err('type')}
                onChange={(x) => draft.replace({ type: x, hospitalDay: v.hospitalDay ?? '', timeOfDay: v.timeOfDay ?? '' })}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t('ed.hospitalDay')}
                name="hospitalDay"
                inputMode="numeric"
                value={v.hospitalDay ?? ''}
                onChange={(x) => draft.set('hospitalDay', x)}
                error={err('hospitalDay')}
                hint={dayDate ? t('ed.hospitalDayHelp', { n: dayParsed.ok ? dayParsed.value : '', date: dayDate }) : undefined}
              />
              <TextField label={t('ed.time')} name="timeOfDay" type="time" optional value={v.timeOfDay ?? ''} onChange={(x) => draft.set('timeOfDay', x)} error={err('timeOfDay')} />
            </div>
            {(v.hospitalDay ?? '') === '' && (
              <Button variant="ghost" className="self-start" onClick={() => draft.set('hospitalDay', String(todayDay))}>
                {t('common.day', { n: todayDay })} = {date(store.today())}
              </Button>
            )}
            <TypeFields type={type} mode={mode.kind} v={v} set={draft.set} err={err} />
          </div>
        </Card>
      )}
      {Object.keys(errors).length > 0 && <Banner tone="danger" role="alert">{t('err.fixFields')}</Banner>}
      {failure && <Banner tone="danger" role="alert">{failure}</Banner>}
      <Button variant="primary" onClick={save} disabled={busy}>
        {busy ? t('common.saving') : mode.kind === 'correct' ? t('ed.saveCorrection') : t('ed.save')}
      </Button>
    </>,
  );
}

export function EntryEditor({ caseId, mode }: { caseId: string; mode: EditorMode }) {
  const { t } = useI18n();
  const versions = useCaseVersions(caseId);
  const entries = useEntries(caseId);
  if (versions.status !== 'ready' || entries.status !== 'ready') {
    const e = versions.status === 'error' ? versions.error : entries.status === 'error' ? entries.error : null;
    return e ? <Banner tone="danger">{e.message}</Banner> : <p className="text-slate-600">{t('common.loading')}</p>;
  }
  const c = versions.data.at(-1);
  if (!c) return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  if (c.status === 'archived') return <Banner tone="info">{t('caseView.archived')}</Banner>;
  return <EditorBody key={draftIdFor(caseId, mode)} c={c} entries={entries.data} mode={mode} />;
}
