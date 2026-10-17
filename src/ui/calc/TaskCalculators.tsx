/**
 * Calculators inside a task worksheet (Dosing tasks 8–10 and others). Each
 * opens in place; the trainee's own calculation checks (the calc_check
 * register) stay separate and are never overwritten by a result.
 */
import { CALC_BY_ID } from '../../calc/registry';
import type { CalculatorId } from '../../calc/types';
import { useI18n } from '../../i18n/i18n';
import { Bi } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { Card, Num } from '../components/ui';
import { CalcPanel, latestOf } from './CalcPanel';
import { resultText } from './CalcResultView';
import { usable } from './CalculatorsScreen';
import { resultCurrency } from '../../calc/currency';

export function TaskCalculators({ b, ids }: { b: CaseBundle; ids: readonly CalculatorId[] }) {
  const { t } = useI18n();
  const list = ids.map((id) => CALC_BY_ID.get(id)).filter((c): c is NonNullable<typeof c> => !!c && usable(c));
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="function" className="h-5 w-5 text-blue-800" />
          {t('calc.inTask')}
        </span>
      }
      actions={
        <a href={`#/cases/${b.case.id}/calc`} className="text-sm font-medium text-teal-900 underline">
          {t('calc.openAll')}
        </a>
      }
    >
      <p className="mb-2 text-xs text-slate-600">{t('calc.inTaskHelp')}</p>
      <div className="flex flex-col gap-2" data-testid="task-calculators">
        {list.map((c) => {
          const latest = latestOf(b.calcResults, c);
          const outOfDate = latest.some((r) => !resultCurrency(r, CALC_BY_ID.get(r.calc) ?? c, b.calcContext).current);
          return (
            <details key={c.id} className="group rounded-xl border border-line bg-white" data-testid={`task-calc-${c.id}`}>
              <summary className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold text-slate-900">
                    <Bi l={{ en: c.pairedWith ? 'QTc (Bazett and Fridericia)' : c.name, ar: c.pairedWith ? 'فترة QT المصححة (Bazett وFridericia)' : c.nameAr }} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-sm">
                  {latest.length ? (
                    <>
                      <span className="font-semibold text-blue-950">
                        <Num>{latest.map(resultText).join(' · ')}</Num>
                      </span>
                      {outOfDate && <span className="text-xs font-medium text-saffron-800">{t('calc.form.outOfDate')}</span>}
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">{t('calc.none')}</span>
                  )}
                </span>
                <Icon name="chevron-down" className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-line p-3">
                <CalcPanel b={b} calc={c} heading={false} />
              </div>
            </details>
          );
        })}
      </div>
    </Card>
  );
}
