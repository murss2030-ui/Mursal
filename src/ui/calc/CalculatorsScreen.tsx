/**
 * The calculators of a case: those that passed their tests, grouped, each
 * opening its panel; and, separately, those that did not — hidden, with the
 * reason, and unusable (Section 9).
 */
import { CALCULATORS, CALC_BY_ID } from '../../calc/registry';
import type { Calculator, CalculatorId } from '../../calc/types';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { Bi, useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { Banner, Card, Num, PageTitle } from '../components/ui';
import { CalcPanel, latestOf } from './CalcPanel';
import { resultText } from './CalcResultView';
import { resultCurrency } from '../../calc/currency';

export const CALC_GROUPS: { key: string; ids: CalculatorId[] }[] = [
  { key: 'kidney', ids: ['crcl_cg', 'egfr_ckdepi2021', 'ibw_adjbw', 'bsa_mosteller', 'bmi'] },
  { key: 'levels', ids: ['vancomycin_auc', 'vancomycin_empiric', 'phenytoin_corrected'] },
  { key: 'liver', ids: ['child_pugh'] },
  { key: 'heart', ids: ['qtc_bazett'] },
  { key: 'blood', ids: ['anion_gap', 'corrected_calcium', 'anc'] },
  { key: 'scores', ids: ['curb65', 'qsofa', 'cha2ds2vasc', 'has_bled'] },
  { key: 'infusion', ids: ['infusion_rate_weight', 'infusion_rate_volume'] },
];

/** A pair (QTc) is usable only when both of its calculators passed their tests. */
export function usable(c: Calculator): boolean {
  if (!c.validated) return false;
  return !c.pairedWith || CALC_BY_ID.get(c.pairedWith)?.validated === true;
}

function hiddenReason(c: Calculator): MsgKey {
  const own = c.validation.validated ? undefined : c.validation.reason;
  const partner = c.pairedWith ? CALC_BY_ID.get(c.pairedWith) : undefined;
  const reason = own ?? (partner && !partner.validation.validated ? partner.validation.reason : 'not_tested');
  return `calc.hidden.${reason}` as MsgKey;
}

export function CalcSummaryRow({ b, calc, href }: { b: CaseBundle; calc: Calculator; href: string }) {
  const { t } = useI18n();
  const latest = latestOf(b.calcResults, calc);
  const outOfDate = latest.some((r) => !resultCurrency(r, CALC_BY_ID.get(r.calc) ?? calc, b.calcContext).current);
  return (
    <a href={href} className="flex min-h-touch items-center gap-3 py-2.5" data-testid={`calc-row-${calc.id}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-900">
        <Icon name="function" className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-slate-900">
          <Bi l={{ en: calc.pairedWith ? 'QTc (Bazett and Fridericia)' : calc.name, ar: calc.pairedWith ? 'فترة QT المصححة (Bazett وFridericia)' : calc.nameAr }} />
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-sm">
        {latest.length > 0 ? (
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
      <Icon name="chevron-forward" className="h-5 w-5 shrink-0 text-slate-400 rtl:rotate-180" />
    </a>
  );
}

export function CalculatorsScreen({ caseId }: { caseId: string }) {
  const { t } = useI18n();
  const tl = useL();
  const state = useCaseBundle(caseId);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const hidden = CALCULATORS.filter((c) => !usable(c) && c.id !== 'qtc_fridericia');
  return (
    <div className="flex flex-col gap-4" data-testid="calculators">
      <PageTitle back={`#/cases/${caseId}/modules`}>{t('calc.title')}</PageTitle>
      <p className="-mt-2 text-sm text-slate-700">{t('calc.subtitle')}</p>
      {CALC_GROUPS.map((g) => {
        const list = g.ids.map((id) => CALC_BY_ID.get(id)!).filter(usable);
        if (!list.length) return null;
        return (
          <Card key={g.key} title={t(`calc.group.${g.key}` as MsgKey)}>
            <div className="flex flex-col divide-y divide-line">
              {list.map((c) => (
                <CalcSummaryRow key={c.id} b={b} calc={c} href={`#/cases/${caseId}/calc/${c.id}`} />
              ))}
            </div>
          </Card>
        );
      })}
      {hidden.length > 0 && (
        <Card title={t('calc.unavailable')}>
          <p className="mb-2 text-sm text-slate-700">{t('calc.unavailableHelp')}</p>
          <ul className="flex flex-col divide-y divide-line" data-testid="calc-hidden">
            {hidden.map((c) => (
              <li key={c.id} className="flex flex-col py-2" data-hidden={c.id}>
                <span className="font-medium text-slate-700">{c.pairedWith ? 'QTc (Bazett and Fridericia)' : c.name}</span>
                <span className="text-xs text-slate-600">{t(hiddenReason(c))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-slate-500">{tl({ en: 'Calculators never produce a dose recommendation.', ar: 'لا تنتج الحاسبات أي توصية بجرعة.' })}</p>
    </div>
  );
}

export function CalculatorScreen({ caseId, calcId }: { caseId: string; calcId: string }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  const calc = CALC_BY_ID.get(calcId as CalculatorId);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  if (!calc || !usable(calc)) {
    return (
      <div className="flex flex-col gap-3">
        <PageTitle back={`#/cases/${caseId}/calc`}>{t('calc.title')}</PageTitle>
        <Banner tone="warning">{calc ? t(hiddenReason(calc)) : t('calc.hidden.not_tested')}</Banner>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <PageTitle back={`#/cases/${caseId}/calc`}>{t('calc.title')}</PageTitle>
      <section className="surface p-4">
        <CalcPanel b={state.b} calc={calc} />
      </section>
    </div>
  );
}
