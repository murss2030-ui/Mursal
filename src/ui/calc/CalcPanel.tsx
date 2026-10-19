/**
 * One calculator inside a case: every input with where it comes from, the
 * Verify gate's problems named in plain words, confirmation of implausible
 * values, and the results (newest first). The calculation itself always runs
 * in the store, on the stored record (store.calculate).
 */
import { useMemo, useState } from 'react';
import { prepare } from '../../calc/engine';
import { applies, candidates, confirmationKey, type Answer, type GatherRequest } from '../../calc/gather';
import type { CalcResult, Calculator, InputSpec, Problem } from '../../calc/types';
import { acceptedUnits, show, type QuantityId } from '../../calc/units';
import { parseDecimal } from '../../domain/numbers';
import type { TimelineEntry } from '../../domain/types';
import { isValidTimeOfDay } from '../../domain/dates';
import { useI18n } from '../../i18n/i18n';
import { Bi, useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Button, CheckboxField, SelectField, TextField } from '../components/ui';
import { useSession } from '../session-context';
import { ChoicePills } from '../screens/choice-controls';
import { CalcResultView } from './CalcResultView';
import { CALC_BY_ID } from '../../calc/registry';

interface Draft {
  value?: string;
  unit?: string;
  choice?: string;
  day?: string;
  time?: string;
}

const NON_NUMERIC = new Set(['boolean', 'choice', 'sex', 'time']);

function initialDrafts(calc: Calculator): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  for (const s of [...calc.requiredInputs, ...calc.optionalInputs]) {
    if (s.source.kind !== 'answer' || NON_NUMERIC.has(s.kind)) continue;
    const units = acceptedUnits(s.kind as QuantityId);
    out[s.key] = { ...(units.length === 1 ? { unit: units[0] } : {}), ...(s.key === 'adjFactor' ? { value: '0.4' } : {}) };
  }
  return out;
}

function toAnswers(calc: Calculator, drafts: Record<string, Draft>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const s of [...calc.requiredInputs, ...calc.optionalInputs]) {
    if (s.source.kind !== 'answer') continue;
    const d = drafts[s.key];
    if (!d) continue;
    if (s.kind === 'boolean' && d.choice) out[s.key] = { kind: 'boolean', value: d.choice === 'yes' };
    else if (s.kind === 'choice' && d.choice) out[s.key] = { kind: 'choice', value: d.choice };
    else if (s.kind === 'time') {
      const day = parseDecimal(d.day ?? '');
      if (day.ok && Number.isInteger(day.value) && d.time && isValidTimeOfDay(d.time)) out[s.key] = { kind: 'time', day: day.value, time: d.time };
    } else if (!NON_NUMERIC.has(s.kind)) {
      const n = parseDecimal(d.value ?? '');
      if (n.ok && d.unit) out[s.key] = { kind: 'number', value: n.value, unit: d.unit };
    }
  }
  return out;
}

function entryText(e: TimelineEntry, spec: InputSpec): string {
  let v = '';
  if (e.type === 'lab') v = e.payload.result.kind === 'numeric' ? `${e.payload.result.value} ${e.payload.unit}` : e.payload.result.text;
  else if (e.type === 'weight') v = `${e.payload.value} kg (${e.payload.method})`;
  else if (e.type === 'vital') {
    const part = spec.source.kind === 'vital' ? spec.source.part : undefined;
    v = part === 'systolic' || part === 'diastolic' ? `${e.payload.systolic}/${e.payload.diastolic} ${e.payload.unit}` : `${e.payload.value} ${e.payload.unit}`;
  }
  return `${v} · Day ${e.hospitalDay}${e.timeOfDay ? ` ${e.timeOfDay}` : ''}${e.provenance === 'extracted_unverified' ? ' · unverified' : ''}`;
}

function addHref(caseId: string, spec: InputSpec): string | undefined {
  const s = spec.source;
  if (s.kind === 'lab') return `#/cases/${caseId}/entry/new?type=lab`;
  if (s.kind === 'vital') return `#/cases/${caseId}/entry/new?type=vital`;
  if (s.kind === 'weight') return `#/cases/${caseId}/entry/new?type=weight`;
  if (s.kind === 'case') return `#/cases/${caseId}/details`;
  return undefined;
}

export function useProblemText(calc: Calculator): (p: Problem) => string {
  const { t } = useI18n();
  const tl = useL();
  const labels = new Map([...calc.requiredInputs, ...calc.optionalInputs].map((s) => [s.key, s.label]));
  const label = (k: string) => tl(labels.get(k) ?? { en: k, ar: k });
  return (p) => {
    switch (p.kind) {
      case 'missing':
        return p.detail ? t('calc.problem.missingDetail', { label: label(p.key), detail: tl(p.detail) }) : t('calc.problem.missing', { label: label(p.key) });
      case 'unverified':
        return t('calc.problem.unverified', { label: label(p.key) });
      case 'unit':
        return t('calc.problem.unit', { label: label(p.key), unit: p.unit, accepted: p.accepted.join(', ') });
      case 'invalid':
        return t('calc.problem.invalid', { label: label(p.key), reason: tl(p.reason) });
      case 'out_of_range':
        return t('calc.outOfRange', { label: label(p.key), value: show(p.value, p.unit, 4), range: `${p.range[0]}–${p.range[1]} ${p.unit}` });
      case 'refused':
        return tl(p.reason);
    }
  };
}

function InputRow({
  spec,
  required,
  b,
  pickId,
  setPick,
  draft,
  setDraft,
  readOnly,
}: {
  spec: InputSpec;
  required: boolean;
  b: CaseBundle;
  pickId: string | undefined;
  setPick: (id: string) => void;
  draft: Draft;
  setDraft: (d: Draft) => void;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const tl = useL();
  const label = (
    <span className="flex flex-wrap items-baseline gap-1">
      <span>{tl(spec.label)}</span>
      {!required && <span className="text-xs font-normal text-slate-500">({t('calc.optional')})</span>}
    </span>
  );
  const s = spec.source;
  const caseId = b.case.id;

  if (s.kind === 'case') {
    const d = b.case.demographics;
    const v = s.field === 'ageYears' ? `${d.ageYears} years` : s.field === 'sex' ? (d.sex === 'F' ? 'female' : 'male') : d.heightCm !== undefined ? `${d.heightCm} cm` : undefined;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 py-2" data-input={spec.key}>
        <span className="text-sm font-medium text-slate-800">{label}</span>
        {v ? (
          <span className="text-sm text-slate-900" dir="ltr">
            {v} <span className="text-xs text-slate-500">· {t('calc.fromCase')}</span>
          </span>
        ) : (
          <a href={addHref(caseId, spec)} className="text-sm font-medium text-teal-900 underline">
            {t('calc.addInDetails')}
          </a>
        )}
      </div>
    );
  }

  if (s.kind !== 'answer') {
    const list = candidates(spec, b.calcContext.current);
    const chosen = list.find((e) => e.id === pickId);
    if (!list.length) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 py-2" data-input={spec.key}>
          <span className="text-sm font-medium text-slate-800">{label}</span>
          <span className="flex items-center gap-2 text-sm">
            <span className="text-rose-800">{t('calc.notRecorded')}</span>
            {!readOnly && (
              <a href={addHref(caseId, spec)} className="font-medium text-teal-900 underline">
                {t('calc.addEntry')}
              </a>
            )}
          </span>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1 py-2" data-input={spec.key}>
        <SelectField
          label={label}
          value={pickId ?? ''}
          onChange={setPick}
          options={list.map((e) => ({ value: e.id, label: entryText(e, spec) }))}
          hint={spec.pickRequired ? t('calc.choose') : undefined}
        />
        {chosen && (
          <span className="self-start">
            <ProvenanceBadge state={chosen.provenance} />
          </span>
        )}
      </div>
    );
  }

  if (spec.kind === 'boolean') {
    return (
      <div className="py-2" data-input={spec.key}>
        <ChoicePills
          label={tl(spec.label)}
          hint={spec.hint ? tl(spec.hint) : undefined}
          options={[
            { value: 'yes', label: { en: 'Yes', ar: 'نعم' } },
            { value: 'no', label: { en: 'No', ar: 'لا' } },
          ]}
          value={draft.choice ?? ''}
          onChange={(x) => setDraft({ ...draft, choice: x })}
          disabled={readOnly}
          testId={`answer-${spec.key}`}
        />
      </div>
    );
  }
  if (spec.kind === 'choice') {
    return (
      <div className="py-2" data-input={spec.key}>
        <ChoicePills
          label={tl(spec.label)}
          hint={spec.hint ? tl(spec.hint) : undefined}
          options={(spec.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          value={draft.choice ?? ''}
          onChange={(x) => setDraft({ ...draft, choice: x })}
          disabled={readOnly}
          testId={`answer-${spec.key}`}
        />
      </div>
    );
  }
  if (spec.kind === 'time') {
    return (
      <fieldset className="flex flex-col gap-1 py-2" data-input={spec.key}>
        <legend className="mb-1 text-sm font-medium text-slate-800">{tl(spec.label)}</legend>
        {spec.hint && <p className="text-xs text-slate-600">{tl(spec.hint)}</p>}
        <div className="grid grid-cols-2 gap-2">
          <TextField label={t('calc.answer.day')} name={`${spec.key}-day`} inputMode="numeric" value={draft.day ?? ''} onChange={(x) => setDraft({ ...draft, day: x })} />
          <TextField label={t('calc.answer.time')} name={`${spec.key}-time`} inputMode="numeric" placeholder="08:30" value={draft.time ?? ''} onChange={(x) => setDraft({ ...draft, time: x })} />
        </div>
      </fieldset>
    );
  }
  const units = acceptedUnits(spec.kind as QuantityId);
  return (
    <fieldset className="flex flex-col gap-1 py-2" data-input={spec.key}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {spec.hint && <p className="text-xs text-slate-600">{tl(spec.hint)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <TextField label={t('calc.answer.number')} name={`${spec.key}-value`} inputMode="decimal" value={draft.value ?? ''} onChange={(x) => setDraft({ ...draft, value: x })} />
        {units.length === 1 ? (
          <div className="flex flex-col justify-end pb-3 text-sm text-slate-700" dir="ltr">
            {units[0] === 'unitless' ? '' : units[0]}
          </div>
        ) : (
          <SelectField label={t('calc.answer.unit')} name={`${spec.key}-unit`} value={draft.unit ?? ''} onChange={(x) => setDraft({ ...draft, unit: x })} options={units.map((u) => ({ value: u, label: u }))} />
        )}
      </div>
    </fieldset>
  );
}

/** Latest result of a calculator, and for a pair the partner result computed with it. */
export function latestOf(results: readonly CalcResult[], calc: Calculator): CalcResult[] {
  const mine = results.filter((r) => r.calc === calc.id);
  const last = mine.at(-1);
  if (!last) return [];
  if (!calc.pairedWith) return [last];
  const partner = results.find((r) => r.calc === calc.pairedWith && r.groupId !== undefined && r.groupId === last.groupId);
  return partner ? [last, partner] : [last];
}

export function CalcPanel({ b, calc, heading = true }: { b: CaseBundle; calc: Calculator; heading?: boolean }) {
  const { t, when } = useI18n();
  const tl = useL();
  const { store } = useSession();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => initialDrafts(calc));
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const problemText = useProblemText(calc);
  const readOnly = b.case.status === 'archived';

  const req: GatherRequest = useMemo(() => ({ picks, answers: toAnswers(calc, drafts), confirmed }), [picks, drafts, confirmed, calc]);
  const prep = useMemo(() => prepare(calc, b.calcContext, req), [calc, b.calcContext, req]);
  const blocking = prep.problems.filter((p) => p.kind !== 'out_of_range');
  const ranges = prep.problems.filter((p): p is Extract<Problem, { kind: 'out_of_range' }> => p.kind === 'out_of_range');
  const confirmedNow = new Set(confirmed);
  const canRun = !readOnly && blocking.length === 0 && ranges.length === 0;

  const pickFor = (spec: InputSpec): string | undefined => {
    if (picks[spec.key]) return picks[spec.key];
    if (spec.pickRequired) return undefined;
    return candidates(spec, b.calcContext.current)[0]?.id;
  };

  const results = b.calcResults.filter((r) => r.calc === calc.id);
  const latest = latestOf(b.calcResults, calc);
  const earlier = results.slice(0, -1).reverse();

  const calculate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const out = await store.calculate(b.case.id, calc.id, req);
      if (!out.ok) setError(out.problems.map(problemText).join(' '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const outOfRangeFor = (key: string) => ranges.find((r) => r.key === key);

  return (
    <div className="flex flex-col gap-3" data-testid={`calc-panel-${calc.id}`}>
      <header className="flex flex-col gap-1">
        {heading && (
          <h3 className="text-base font-semibold text-slate-900">
            <Bi l={{ en: calc.name, ar: calc.nameAr }} />
          </h3>
        )}
        <p className="text-sm text-slate-700">{tl(calc.purpose)}</p>
        {calc.pairedWith && <p className="text-xs text-slate-600">{t('calc.paired')}</p>}
        {calc.highRisk && (
          <p className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900">
            <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
            {t('calc.highRisk')}
          </p>
        )}
      </header>

      {latest.map((r) => (
        <CalcResultView key={r.id} r={r} calc={CALC_BY_ID.get(r.calc) ?? calc} b={b} title={calc.pairedWith ? CALC_BY_ID.get(r.calc)?.name : undefined} />
      ))}
      {latest.length === 0 && <p className="text-sm text-slate-600">{t('calc.none')}</p>}

      <section className="rounded-xl border border-line bg-white px-3">
        <h4 className="pt-3 text-sm font-semibold text-slate-900">{t('calc.inputs')}</h4>
        <div className="flex flex-col divide-y divide-line">
          {[...calc.requiredInputs.map((s) => [s, true] as const), ...calc.optionalInputs.map((s) => [s, false] as const)]
            .filter(([spec]) => applies(spec, req.answers, [...calc.requiredInputs, ...calc.optionalInputs]))
            .map(([spec, required]) => {
            const range = outOfRangeFor(spec.key);
            const v = prep.inputs[spec.key];
            return (
              <div key={spec.key}>
                <InputRow
                  spec={spec}
                  required={required}
                  b={b}
                  pickId={pickFor(spec)}
                  setPick={(id) => setPicks({ ...picks, [spec.key]: id })}
                  draft={drafts[spec.key] ?? {}}
                  setDraft={(d) => setDrafts({ ...drafts, [spec.key]: d })}
                  readOnly={readOnly}
                />
                {range && v && (
                  <div className="mb-2 flex flex-col gap-1 rounded-lg bg-saffron-50 p-2" data-testid={`out-of-range-${spec.key}`}>
                    <p className="text-sm text-saffron-900">{problemText(range)}</p>
                    <CheckboxField
                      label={t('calc.confirmValue')}
                      checked={confirmedNow.has(confirmationKey(v))}
                      onChange={(on) => {
                        const k = confirmationKey(v);
                        setConfirmed(on ? [...confirmed, k] : confirmed.filter((x) => x !== k));
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {blocking.length > 0 && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-900" role="status" data-testid="calc-problems">
          <p className="font-medium">{t('calc.cannot')}</p>
          <ul className="list-disc ps-5">
            {blocking.map((p, i) => (
              <li key={i}>{problemText(p)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <Button variant="primary" icon="function" onClick={calculate} disabled={!canRun || busy} data-testid="calc-run">
          {busy ? t('calc.calculating') : latest.length ? t('calc.calculateAgain') : t('calc.calculate')}
        </Button>
      )}

      {earlier.length > 0 && (
        <details className="group">
          <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-700">
            <Icon name="history" className="h-4 w-4" />
            {t('calc.history', { n: earlier.length })}
          </summary>
          <ul className="flex flex-col gap-1 ps-6 text-sm text-slate-700" dir="ltr">
            {earlier.map((r) => (
              <li key={r.id}>
                {show(r.value, r.unit, r.decimals)} · {when(r.computedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
