/**
 * The trainee's reference tables, used by the safety checks in every case
 * (Section 10): the local formulary with brand aliases and the high-alert
 * flag (Decision 11; M2 plan decision 3), the renal and hepatic adjustment
 * table, the laboratory's critical thresholds (decision 4), and the
 * department's vancomycin interval table (owner decision 6). Every record is
 * versioned and audited; removing one is a new version with a reason.
 *
 * Also: how often each check fired and was acknowledged (per-rule counts),
 * and the status of the offline datasets.
 */
import { useEffect, useMemo, useState } from 'react';
import { ANALYTES, ANALYTE_BY_ID } from '../../domain/catalogue';
import { bandRange, type AdjustmentRule, type FormularyItem, type LabThreshold, type RefError, type ReferenceKind, type VancomycinIntervalBand } from '../../domain/reference';
import type { AlertAck, AlertFiring, Versioned } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { matchDrug, type DrugMatch } from '../../drugs/normalize';
import { useVocabulary } from '../../drugs/useVocabulary';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { RULE_IDS } from '../../rules/types';
import { Banner, Button, Card, Chip, LinkButton, Num, PageTitle, RadioGroup, SelectField, TextAreaField, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import { useReference } from '../data';
import { navigate } from '../router';
import { DatasetStatus } from '../rules/DatasetStatus';
import { useL } from '../bilingual';
import { useSession } from '../session-context';

export const REFERENCE_KINDS: readonly ReferenceKind[] = ['formulary', 'adjustment', 'threshold', 'vancomycin_interval'];
export const isReferenceKind = (s: string): s is ReferenceKind => (REFERENCE_KINDS as readonly string[]).includes(s);

type AnyRef = FormularyItem | AdjustmentRule | LabThreshold | VancomycinIntervalBand;

const ERR_KEY: Record<RefError | 'reason', MsgKey> = {
  required: 'err.required',
  invalidChoice: 'err.invalidChoice',
  number: 'err.number',
  date: 'ref.err.date',
  tooLong: 'err.tooLong',
  order: 'err.refOrder',
  unit: 'err.unit',
  range: 'ref.err.intervalRange',
  reason: 'err.required',
};

function rangeText(r: LabThreshold): string {
  const parts = [r.low !== undefined ? `< ${r.low}` : '', r.high !== undefined ? `> ${r.high}` : ''].filter(Boolean);
  return parts.join(' or ');
}

function useMatch(name: string): { state: 'loading' | 'ready' | 'error'; match?: DrugMatch } {
  const vocabulary = useVocabulary();
  return useMemo(() => {
    if (vocabulary.status === 'loading') return { state: 'loading' as const };
    if (vocabulary.status === 'error') return { state: 'error' as const };
    return { state: 'ready' as const, match: name.trim() ? matchDrug(name, vocabulary.vocab) : undefined };
  }, [vocabulary, name]);
}

/** What the offline RxNorm vocabulary recognised in a drug name — the rules use exactly these ingredients. */
function MatchLine({ name }: { name: string }) {
  const { t } = useI18n();
  const m = useMatch(name);
  if (!name.trim()) return null;
  if (m.state === 'loading') return <p className="text-xs text-slate-600">{t('ref.match.loading')}</p>;
  if (m.state === 'error') return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t('alert.vocabularyError')}</p>;
  if (m.match?.status === 'matched')
    return (
      <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-950" role="status" data-testid="rxnorm-match">
        {t('ref.match.matched', { name: m.match.matched, ingredients: m.match.ingredients.map((i) => `${i.name} (RxCUI ${i.rxcui})`).join(', ') })}
      </p>
    );
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status" data-testid="rxnorm-match">
      {t('ref.match.none')}
    </p>
  );
}

// ---------------------------------------------------------------- hub

export function ReferenceHub() {
  const { t } = useI18n();
  const formulary = useReference<FormularyItem>('formulary');
  const adjustments = useReference<AdjustmentRule>('adjustment');
  const thresholds = useReference<LabThreshold>('threshold');
  const vanco = useReference<VancomycinIntervalBand>('vancomycin_interval');
  const count = (s: typeof formulary | typeof adjustments | typeof thresholds | typeof vanco) => (s.status === 'ready' ? s.data.filter((r) => r.status === 'active').length : undefined);
  const counts: Record<ReferenceKind, number | undefined> = {
    formulary: count(formulary),
    adjustment: count(adjustments),
    threshold: count(thresholds),
    vancomycin_interval: count(vanco),
  };
  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/more">{t('ref.title')}</PageTitle>
      <p className="text-sm text-slate-700">{t('ref.lead')}</p>
      {REFERENCE_KINDS.map((k) => (
        <a key={k} href={`#/reference/${k}`} className="surface flex items-center gap-3 p-4 hover:shadow-lift" data-testid={`ref-open-${k}`}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-900">
            <Icon name={k === 'formulary' ? 'pill' : k === 'adjustment' ? 'scale' : k === 'threshold' ? 'flask' : 'function'} className="h-5 w-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold text-slate-900">{t(`ref.kind.${k}`)}</span>
            <span className="text-sm text-slate-600">{counts[k] === undefined ? t('common.loading') : t('ref.count', { n: counts[k] })}</span>
          </span>
          <Icon name="chevron-forward" className="h-5 w-5 text-slate-400" />
        </a>
      ))}
      <RuleActivity />
      <DatasetStatus />
    </div>
  );
}

function RuleActivity() {
  const { t } = useI18n();
  const { store } = useSession();
  const [records, setRecords] = useState<{ firings: AlertFiring[]; acks: AlertAck[] }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    store.allAlertRecords().then(
      (r) => live && setRecords(r),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [store]);
  const rows = RULE_IDS.map((id) => ({
    id,
    fired: records?.firings.filter((f) => f.ruleId === id).length ?? 0,
    acked: records?.acks.filter((a) => a.ruleId === id).length ?? 0,
  })).filter((r) => r.fired || r.acked);
  return (
    <Card title={t('ref.rules.title')}>
      <div className="flex flex-col gap-2" data-testid="rule-activity">
        <p className="text-xs text-slate-600">{t('ref.rules.lead')}</p>
        {error && <Banner tone="danger">{error}</Banner>}
        {!records && !error && <p className="text-sm text-slate-600">{t('common.loading')}</p>}
        {records && rows.length === 0 && <p className="text-sm text-slate-700">{t('ref.rules.none')}</p>}
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-slate-600">
                <th className="py-1 text-start font-medium">{t('ref.rules.rule')}</th>
                <th className="py-1 text-end font-medium">{t('ref.rules.fired')}</th>
                <th className="py-1 text-end font-medium">{t('ref.rules.acked')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100" data-rule={r.id}>
                  <td className="py-1.5">{t(`rule.${r.id}`)}</td>
                  <td className="py-1.5 text-end">
                    <Num>{r.fired}</Num>
                  </td>
                  <td className="py-1.5 text-end">
                    <Num>{r.acked}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- list

function RefSummary({ kind, r }: { kind: ReferenceKind; r: AnyRef }) {
  const { t, date } = useI18n();
  const tl = useL();
  const chips: JSX.Element[] = [];
  let title = '';
  let detail = '';
  if (kind === 'formulary') {
    const f = r as FormularyItem;
    title = f.genericName;
    detail = [f.brandNames.join(', '), [...f.strengths, ...f.dosageForms].join(', ')].filter(Boolean).join(' · ');
    chips.push(<Chip key="h" tone={f.availableInHospital ? 'teal' : 'slate'}>{t(f.availableInHospital ? 'ref.chip.inHospital' : 'ref.chip.notInHospital')}</Chip>);
    if (f.highAlert) chips.push(<Chip key="a" tone="red">{t('ref.chip.highAlert')}</Chip>);
    if (!f.ingredients.length) chips.push(<Chip key="u" tone="amber">{t('ref.chip.unmatched')}</Chip>);
  } else if (kind === 'adjustment') {
    const a = r as AdjustmentRule;
    title = a.drugName;
    detail =
      a.organ === 'renal'
        ? t('ref.adjust.renal', { measure: t(`ref.measure.${a.measure}`), below: a.below ?? '' })
        : t('ref.adjust.hepatic', { cls: a.fromClass === 'B' ? 'B / C' : 'C' });
    chips.push(<Chip key="o">{t(`ref.organ.${a.organ}`)}</Chip>);
    if (!a.ingredients.length) chips.push(<Chip key="u" tone="amber">{t('ref.chip.unmatched')}</Chip>);
  } else if (kind === 'threshold') {
    const l = r as LabThreshold;
    title = ANALYTE_BY_ID.get(l.analyte)?.name ?? l.analyte;
    detail = t('ref.threshold.range', { range: rangeText(l), unit: l.unit });
  } else {
    const b = r as VancomycinIntervalBand;
    title = t('ref.vanco.band', { range: tl(bandRange(b)) });
    detail = b.action === 'interval' && b.intervalHours !== undefined ? t('ref.vanco.every', { h: b.intervalHours }) : t('ref.vanco.levels');
    detail = `${detail} · ${b.source}`;
  }
  if (r.status === 'retracted') chips.push(<Chip key="r" tone="slate">{t('ref.removed')}</Chip>);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900" dir="auto">
          {title}
        </span>
        {chips}
      </div>
      {detail && (
        <span className="text-sm text-slate-700" dir="auto">
          {detail}
        </span>
      )}
      <span className="text-xs text-slate-600">{t('ref.verified', { by: r.verifiedBy, at: date(r.verifiedAt) })}</span>
      {r.status === 'retracted' && r.changeReason && <span className="text-xs text-slate-600">{t('ref.removedReason', { reason: r.changeReason })}</span>}
    </div>
  );
}

export function ReferenceList({ kind }: { kind: ReferenceKind }) {
  const { t } = useI18n();
  const records = useReference<AnyRef>(kind);
  const [showRemoved, setShowRemoved] = useState(false);
  const all = records.status === 'ready' ? records.data : [];
  const active = all.filter((r) => r.status === 'active');
  const removed = all.filter((r) => r.status === 'retracted');
  const sortKey = (r: AnyRef) =>
    'genericName' in r ? r.genericName : 'drugName' in r ? r.drugName : 'analyte' in r ? (ANALYTE_BY_ID.get(r.analyte)?.name ?? r.analyte) : '';
  // Bands in creatinine clearance order (lowest first); the others by name.
  const bandKey = (r: AnyRef) => ('action' in r ? (r.crclFrom ?? -1) : 0);
  const sorted = (rs: AnyRef[]) =>
    [...rs].sort((a, b) => bandKey(a) - bandKey(b) || (sortKey(a).toLowerCase() < sortKey(b).toLowerCase() ? -1 : sortKey(a).toLowerCase() > sortKey(b).toLowerCase() ? 1 : 0));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle back="#/reference">{t(`ref.kind.${kind}`)}</PageTitle>
        <LinkButton href={`#/reference/${kind}/new`} variant="primary" icon="plus">
          {t('ref.add')}
        </LinkButton>
      </div>
      <p className="text-sm text-slate-700">{t(`ref.help.${kind}`)}</p>
      {records.status === 'loading' && <p className="text-slate-600">{t('common.loading')}</p>}
      {records.status === 'error' && <Banner tone="danger">{records.error.message}</Banner>}
      {records.status === 'ready' && active.length === 0 && <p className="text-slate-600">{t('ref.empty')}</p>}
      <ul className="flex flex-col gap-2" data-testid="ref-list">
        {sorted(active).map((r) => (
          <li key={r.id}>
            <a href={`#/reference/${kind}/${r.id}`} className="surface flex items-start gap-3 p-3 hover:shadow-lift" data-testid="ref-row">
              <span className="min-w-0 flex-1">
                <RefSummary kind={kind} r={r} />
              </span>
              <Icon name="chevron-forward" className="mt-1 h-5 w-5 text-slate-400" />
            </a>
          </li>
        ))}
      </ul>
      {removed.length > 0 && (
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
          {t('ref.showRemoved', { n: removed.length })}
        </label>
      )}
      {showRemoved && (
        <ul className="flex flex-col gap-2">
          {sorted(removed).map((r) => (
            <li key={r.id} className="rounded-xl border border-dashed border-slate-300 p-3">
              <RefSummary kind={kind} r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- editor

function valuesOf(kind: ReferenceKind, r: AnyRef | undefined, today: string, query?: URLSearchParams): Record<string, string> {
  if (!r) {
    // From "add it to your formulary" on an unrecognised medication name: usually a local brand.
    const prefill = kind === 'formulary' ? { ...(query?.get('brand') ? { brandNames: query.get('brand')! } : {}), ...(query?.get('generic') ? { genericName: query.get('generic')! } : {}) } : {};
    return { verifiedAt: today, ...(kind === 'formulary' ? { availableInHospital: 'yes', highAlert: 'no' } : {}), ...prefill };
  }
  const base = { verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt };
  if (kind === 'formulary') {
    const f = r as FormularyItem;
    return {
      ...base,
      genericName: f.genericName,
      brandNames: f.brandNames.join(', '),
      strengths: f.strengths.join(', '),
      dosageForms: f.dosageForms.join(', '),
      availableInHospital: f.availableInHospital ? 'yes' : 'no',
      highAlert: f.highAlert ? 'yes' : 'no',
      highAlertSource: f.highAlertSource ?? '',
      sourceNote: f.sourceNote,
    };
  }
  if (kind === 'adjustment') {
    const a = r as AdjustmentRule;
    return {
      ...base,
      drugName: a.drugName,
      organ: a.organ,
      measure: a.measure,
      below: a.below !== undefined ? String(a.below) : '',
      fromClass: a.fromClass ?? '',
      sourceText: a.sourceText,
      source: a.source,
    };
  }
  if (kind === 'threshold') {
    const l = r as LabThreshold;
    return { ...base, analyte: l.analyte, unit: l.unit, low: l.low !== undefined ? String(l.low) : '', high: l.high !== undefined ? String(l.high) : '', source: l.source };
  }
  const b = r as VancomycinIntervalBand;
  return {
    ...base,
    crclFrom: b.crclFrom !== undefined ? String(b.crclFrom) : '',
    crclBelow: b.crclBelow !== undefined ? String(b.crclBelow) : '',
    action: b.action,
    intervalHours: b.intervalHours !== undefined ? String(b.intervalHours) : '',
    source: b.source,
  };
}

export function ReferenceEditor({ kind, id, query }: { kind: ReferenceKind; id?: string; query?: URLSearchParams }) {
  const { t, when } = useI18n();
  const { store } = useSession();
  const records = useReference<AnyRef>(kind);
  const existing = id && records.status === 'ready' ? records.data.find((r) => r.id === id) : undefined;
  if (records.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (records.status === 'error') return <Banner tone="danger">{records.error.message}</Banner>;
  if (id && !existing) return <Banner tone="warning">{t('ref.notFound')}</Banner>;
  return <EditorForm key={`${id ?? 'new'}@${existing?.version ?? 0}`} kind={kind} existing={existing} today={store.today()} when={when} query={query} />;
}

function EditorForm({ kind, existing, today, when, query }: { kind: ReferenceKind; existing: AnyRef | undefined; today: string; when: (iso: string) => string; query?: URLSearchParams }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [v, setV] = useState<Record<string, string>>(() => valuesOf(kind, existing, today, query));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [history, setHistory] = useState<AnyRef[]>([]);
  const drugField = kind === 'formulary' ? 'genericName' : kind === 'adjustment' ? 'drugName' : undefined;
  const match = useMatch(drugField ? (v[drugField] ?? '') : '');
  const readOnly = existing?.status === 'retracted';

  useEffect(() => {
    if (!existing) return;
    let live = true;
    void store.referenceHistory<AnyRef & Versioned>(kind, existing.id).then((h) => live && setHistory(h));
    return () => {
      live = false;
    };
  }, [store, kind, existing]);

  const set = (k: string) => (x: string) => setV((p) => ({ ...p, [k]: x }));
  const err = (k: string) => errors[k];
  const showErrors = (e: unknown) => {
    if (e instanceof ValidationError) setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, c]) => [k, t(ERR_KEY[c as RefError] ?? 'err.invalidChoice')])));
    else setErrors({ save: (e as Error).message });
  };

  const save = async () => {
    setErrors({});
    if (drugField && match.state === 'loading') return;
    const m = match.match?.status === 'matched' ? match.match : undefined;
    const ingredients = m ? m.ingredients.map((i) => i.rxcui) : [];
    const rxcui = m && m.ingredients.length === 1 ? m.ingredients[0]!.rxcui : undefined;
    setBusy(true);
    try {
      await store.saveReference(kind, existing?.id, v, { ...(rxcui ? { rxcui } : {}), ingredients }, existing ? v.reason : undefined);
      navigate(`/reference/${kind}`);
    } catch (e) {
      showErrors(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setErrors({});
    if (!(v.removeReason ?? '').trim()) {
      setErrors({ removeReason: t('err.required') });
      return;
    }
    setBusy(true);
    try {
      await store.retractReference(kind, existing!.id, v.removeReason!);
      navigate(`/reference/${kind}`);
    } catch (e) {
      showErrors(e);
    } finally {
      setBusy(false);
    }
  };

  const yesNo = [
    { value: 'yes', label: t('common.yes') },
    { value: 'no', label: t('common.no') },
  ];
  const analyte = ANALYTE_BY_ID.get(v.analyte ?? '');

  return (
    <div className="flex flex-col gap-4">
      <PageTitle back={`#/reference/${kind}`}>{existing ? t('ref.editRecord') : t('ref.newRecord')}</PageTitle>
      <p className="-mt-3 text-sm font-medium text-slate-700">{t(`ref.kind.${kind}`)}</p>
      {readOnly && <Banner tone="info">{t('ref.removedReason', { reason: existing?.changeReason ?? '' })}</Banner>}
      <Card>
        <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
          {kind === 'formulary' && (
            <>
              <TextField label={t('ref.f.genericName')} name="genericName" value={v.genericName ?? ''} onChange={set('genericName')} error={err('genericName')} />
              <MatchLine name={v.genericName ?? ''} />
              <TextField label={t('ref.f.brandNames')} name="brandNames" hint={t('ref.h.list')} optional value={v.brandNames ?? ''} onChange={set('brandNames')} error={err('brandNames')} />
              <TextField label={t('ref.f.strengths')} name="strengths" hint={t('ref.h.list')} optional value={v.strengths ?? ''} onChange={set('strengths')} />
              <TextField label={t('ref.f.dosageForms')} name="dosageForms" hint={t('ref.h.list')} optional value={v.dosageForms ?? ''} onChange={set('dosageForms')} />
              <RadioGroup name="availableInHospital" label={t('ref.f.availableInHospital')} value={v.availableInHospital ?? ''} onChange={set('availableInHospital')} options={yesNo} error={err('availableInHospital')} />
              <RadioGroup name="highAlert" label={t('ref.f.highAlert')} value={v.highAlert ?? ''} onChange={set('highAlert')} options={yesNo} error={err('highAlert')} hint={t('ref.h.highAlert')} />
              {v.highAlert === 'yes' && (
                <TextField label={t('ref.f.highAlertSource')} name="highAlertSource" value={v.highAlertSource ?? ''} onChange={set('highAlertSource')} error={err('highAlertSource')} />
              )}
              <TextAreaField label={t('ref.f.sourceNote')} name="sourceNote" hint={t('ref.h.sourceNote')} value={v.sourceNote ?? ''} onChange={set('sourceNote')} error={err('sourceNote')} />
            </>
          )}
          {kind === 'adjustment' && (
            <>
              <TextField label={t('ref.f.drugName')} name="drugName" value={v.drugName ?? ''} onChange={set('drugName')} error={err('drugName')} />
              <MatchLine name={v.drugName ?? ''} />
              <RadioGroup
                name="organ"
                label={t('ref.f.organ')}
                value={v.organ ?? ''}
                onChange={(x) => setV((p) => ({ ...p, organ: x, measure: x === 'hepatic' ? 'child_pugh' : p.measure === 'child_pugh' ? '' : (p.measure ?? '') }))}
                options={[
                  { value: 'renal', label: t('ref.organ.renal') },
                  { value: 'hepatic', label: t('ref.organ.hepatic') },
                ]}
                error={err('organ')}
              />
              {v.organ === 'renal' && (
                <>
                  <RadioGroup
                    name="measure"
                    label={t('ref.f.measure')}
                    value={v.measure ?? ''}
                    onChange={set('measure')}
                    options={[
                      { value: 'crcl_cg', label: t('ref.measure.crcl_cg') },
                      { value: 'egfr_ckdepi2021', label: t('ref.measure.egfr_ckdepi2021'), help: t('ref.h.egfr') },
                    ]}
                    error={err('measure')}
                  />
                  <TextField label={t('ref.f.below')} name="below" inputMode="decimal" value={v.below ?? ''} onChange={set('below')} error={err('below')} />
                </>
              )}
              {v.organ === 'hepatic' && (
                <RadioGroup
                  name="fromClass"
                  label={t('ref.f.fromClass')}
                  value={v.fromClass ?? ''}
                  onChange={set('fromClass')}
                  options={[
                    { value: 'B', label: t('ref.class.B') },
                    { value: 'C', label: t('ref.class.C') },
                  ]}
                  error={err('fromClass')}
                />
              )}
              <TextAreaField label={t('ref.f.sourceText')} name="sourceText" hint={t('ref.h.sourceText')} value={v.sourceText ?? ''} onChange={set('sourceText')} error={err('sourceText')} />
              <TextField label={t('ref.f.source')} name="source" value={v.source ?? ''} onChange={set('source')} error={err('source')} />
            </>
          )}
          {kind === 'threshold' && (
            <>
              <SelectField
                label={t('ref.f.analyte')}
                name="analyte"
                value={v.analyte ?? ''}
                onChange={(x) => setV((p) => ({ ...p, analyte: x, unit: ANALYTE_BY_ID.get(x)?.units[0] ?? '' }))}
                options={ANALYTES.map((a) => ({ value: a.id, label: a.name }))}
                error={err('analyte')}
              />
              {analyte && (
                <SelectField label={t('ref.f.unit')} name="unit" value={v.unit ?? ''} onChange={set('unit')} options={analyte.units.map((u) => ({ value: u, label: u }))} error={err('unit')} />
              )}
              <TextField label={t('ref.f.low')} name="low" inputMode="decimal" optional hint={t('ref.h.lowHigh')} value={v.low ?? ''} onChange={set('low')} error={err('low')} />
              <TextField label={t('ref.f.high')} name="high" inputMode="decimal" optional value={v.high ?? ''} onChange={set('high')} error={err('high')} />
              <TextField label={t('ref.f.source')} name="source" value={v.source ?? ''} onChange={set('source')} error={err('source')} />
            </>
          )}
          {kind === 'vancomycin_interval' && (
            <>
              <TextField label={t('ref.f.crclFrom')} name="crclFrom" inputMode="decimal" optional value={v.crclFrom ?? ''} onChange={set('crclFrom')} error={err('crclFrom')} />
              <TextField label={t('ref.f.crclBelow')} name="crclBelow" inputMode="decimal" optional hint={t('ref.h.crclBand')} value={v.crclBelow ?? ''} onChange={set('crclBelow')} error={err('crclBelow')} />
              <RadioGroup
                name="action"
                label={t('ref.f.action')}
                value={v.action ?? ''}
                onChange={set('action')}
                options={[
                  { value: 'interval', label: t('ref.action.interval') },
                  { value: 'levels', label: t('ref.action.levels') },
                ]}
                error={err('action')}
              />
              {v.action === 'interval' && (
                <TextField label={t('ref.f.intervalHours')} name="intervalHours" inputMode="decimal" value={v.intervalHours ?? ''} onChange={set('intervalHours')} error={err('intervalHours')} />
              )}
              <TextField label={t('ref.f.source')} name="source" value={v.source ?? ''} onChange={set('source')} error={err('source')} />
            </>
          )}
          <TextField label={t('ref.f.verifiedBy')} name="verifiedBy" value={v.verifiedBy ?? ''} onChange={set('verifiedBy')} error={err('verifiedBy')} />
          <TextField label={t('ref.f.verifiedAt')} name="verifiedAt" type="date" value={v.verifiedAt ?? ''} onChange={set('verifiedAt')} error={err('verifiedAt')} />
          {existing && <TextField label={t('ref.f.reason')} name="reason" value={v.reason ?? ''} onChange={set('reason')} error={err('reason')} />}
          {errors.save && <Banner tone="danger">{errors.save}</Banner>}
          {Object.keys(errors).length > 0 && !errors.save && <p className="text-sm font-medium text-red-700">{t('err.fixFields')}</p>}
          <Button variant="primary" onClick={() => void save()} disabled={readOnly || busy} className="self-start" data-testid="ref-save">
            {t('common.save')}
          </Button>
        </fieldset>
      </Card>

      {existing && !readOnly && (
        <Card>
          {!removing ? (
            <Button variant="ghost" icon="trash" onClick={() => setRemoving(true)}>
              {t('ref.remove')}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <TextField label={t('ref.removeReason')} name="removeReason" value={v.removeReason ?? ''} onChange={set('removeReason')} error={err('removeReason')} />
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => void remove()} disabled={busy}>
                  {t('ref.removeConfirm')}
                </Button>
                <Button variant="ghost" onClick={() => setRemoving(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {history.length > 0 && (
        <details className="surface p-3" data-testid="ref-history">
          <summary className="min-h-touch cursor-pointer py-2 text-sm font-medium text-teal-900">{t('ref.history', { n: history.length })}</summary>
          <ol className="flex flex-col gap-2 pt-2">
            {[...history].reverse().map((h) => (
              <li key={h.version} className="rounded-lg border border-slate-200 p-2 text-sm">
                <p className="font-medium text-slate-900">{t('ref.version', { n: h.version, when: when(h.versionCreatedAt) })}</p>
                {h.changeReason && <p className="text-slate-700">{h.changeReason}</p>}
                <div className="mt-1">
                  <RefSummary kind={kind} r={h} />
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
