/**
 * A calculation result with its "calculated" provenance. No result is ever
 * shown without the formula used, the values substituted, their units and
 * every assumption (Section 9): one tap opens them.
 */
import { resultCurrency } from '../../calc/currency';
import type { CalcResult, Calculator, InputSpec, InputValue } from '../../calc/types';
import type { L } from '../../domain/label';
import { show } from '../../calc/units';
import { useI18n } from '../../i18n/i18n';
import { useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Num } from '../components/ui';

export function resultText(r: Pick<CalcResult, 'value' | 'unit' | 'decimals'>): string {
  return show(r.value, r.unit === 'points' ? 'points' : r.unit, r.decimals);
}

function inputText(v: InputValue, spec: InputSpec | undefined, tl: (l: L) => string): string {
  if (v.unit === 'yes/no') return v.choice === 'yes' ? tl({ en: 'yes', ar: 'نعم' }) : tl({ en: 'no', ar: 'لا' });
  if (v.unit === 'points') {
    const o = spec?.options?.find((x) => x.value === v.choice);
    const label = o ? tl(o.label) : v.choice ?? '';
    return spec?.showPoints ? `${label} → ${v.value}` : label;
  }
  if (v.unit === 'sex') return v.choice === 'F' ? 'female' : 'male';
  if (v.unit === 'min') {
    const day = Math.floor(v.value / 1440);
    const rest = v.value - day * 1440;
    return `Day ${day} ${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
  }
  const main = show(v.value, v.unit, 4);
  return v.recorded && v.recorded.unit !== v.unit ? `${main} (recorded ${show(v.recorded.value, v.recorded.unit, 4)})` : main;
}

export function CalcResultView({ r, calc, b, title }: { r: CalcResult; calc: Calculator; b: CaseBundle; title?: string }) {
  const { t, when } = useI18n();
  const tl = useL();
  const currency = resultCurrency(r, calc, b.calcContext);
  const specs = new Map([...calc.requiredInputs, ...calc.optionalInputs].map((s) => [s.key, s]));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3" data-testid={`calc-result-${r.calc}`} data-current={currency.current ? 'yes' : 'no'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{title ?? t('calc.result')}</span>
        <ProvenanceBadge state="calculated" />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold text-blue-950" data-testid="calc-value">
          <Num>{resultText(r)}</Num>
        </span>
        {r.category && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-900 ring-1 ring-blue-200" data-testid="calc-category">
            {tl(r.category.label)}
          </span>
        )}
      </div>
      {r.secondary && r.secondary.length > 0 && (
        <ul className="grid grid-cols-1 gap-1 text-sm text-slate-800 sm:grid-cols-2">
          {r.secondary.map((s) => (
            <li key={s.key} className="flex justify-between gap-2 border-b border-blue-100 py-0.5">
              <span>{tl(s.label)}</span>
              <Num>{show(s.value, s.unit, s.decimals)}</Num>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-600">
        {t('calc.computedAt', { when: when(r.computedAt) })}
        {r.day !== undefined && <> · {t('calc.inputsDay', { n: r.day })}</>}
      </p>
      {!currency.current && (
        <div className="rounded-lg bg-saffron-50 px-3 py-2 text-sm text-saffron-900" role="status" data-testid="calc-out-of-date">
          <p className="font-medium">{t('calc.outOfDate')}</p>
          <ul className="list-disc ps-5">
            {currency.reasons.map((x, i) => (
              <li key={i}>{tl(x)}</li>
            ))}
          </ul>
        </div>
      )}
      {r.warnings.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="calc-warnings">
          {r.warnings.map((w, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{tl(w)}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="group rounded-lg bg-white ring-1 ring-blue-100" data-testid="calc-basis">
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-blue-950">
          <span className="flex items-center gap-2">
            <Icon name="function" className="h-4 w-4" />
            {t('calc.basis')}
          </span>
          <Icon name="chevron-down" className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t border-blue-100 px-3 py-3 text-sm text-slate-800">
          <section>
            <h4 className="font-semibold text-slate-900">{t('calc.formula')}</h4>
            <p className="font-mono text-xs leading-relaxed" dir="ltr">
              {calc.formula}
            </p>
          </section>
          <section>
            <h4 className="font-semibold text-slate-900">{t('calc.valuesUsed')}</h4>
            <ul className="flex flex-col divide-y divide-line" dir="ltr">
              {Object.values(r.inputs.detail).map((v) => {
                const s = v.source;
                return (
                  <li key={v.key} className="flex flex-wrap items-center justify-between gap-2 py-1">
                    <span>{tl(specs.get(v.key)?.label ?? { en: v.key, ar: v.key })}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Num>{inputText(v, specs.get(v.key), tl)}</Num>
                      <span className="text-xs text-slate-600">
                        {s.kind === 'entry' ? `${t('calc.source.entry', { day: s.day })}${s.time ? ` ${s.time}` : ''}` : s.kind === 'case' ? t('calc.source.case') : t('calc.source.answer')}
                      </span>
                      {s.kind === 'entry' && <ProvenanceBadge state={s.provenance} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h4 className="font-semibold text-slate-900">{t('calc.steps')}</h4>
            <ol className="flex flex-col gap-0.5 font-mono text-xs leading-relaxed" dir="ltr" data-testid="calc-steps">
              {r.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>
          {r.assumptions.length > 0 && (
            <section>
              <h4 className="font-semibold text-slate-900">{t('calc.assumptions')}</h4>
              <ul className="list-disc ps-5">
                {r.assumptions.map((a, i) => (
                  <li key={i}>{tl(a)}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h4 className="font-semibold text-slate-900">{t('calc.limitations')}</h4>
            <ul className="list-disc ps-5">
              {calc.limitations.map((l, i) => (
                <li key={i}>{tl(l)}</li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className="font-semibold text-slate-900">{t('calc.citation')}</h4>
            <p className="text-xs" dir="ltr">
              {calc.citation}
            </p>
          </section>
        </div>
      </details>
    </div>
  );
}
