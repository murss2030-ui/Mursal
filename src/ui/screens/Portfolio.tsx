/**
 * The portfolio (plan M8): the trainee's own record gathered by competency
 * area — cards worked and what became of them, reflections, what they
 * practised in the learning modes, counselling, rounds, monitoring and
 * reconciliation — as evidence to discuss with the preceptor. Counts and the
 * trainee's own words; the app grades nothing. Printed or saved as text, it
 * is recorded in the audit log by counts and hash only.
 */
import { useEffect, useState } from 'react';
import { buildPortfolio, type Portfolio as PortfolioData } from '../../domain/learning';
import { COMPETENCY_AREAS, type CompetencyArea } from '../../domain/types';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { TERMS } from '../../i18n/terms';
import { portfolioCases } from '../../learning/portfolio-input';
import { Banner, Button, Card, PageTitle, SelectField } from '../components/ui';
import { useCases, useRotations } from '../data';
import { useSession } from '../session-context';

async function sha(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function portfolioText(p: PortfolioData, targets: readonly CompetencyArea[]): string {
  return COMPETENCY_AREAS.map((a) => [`${TERMS[`comp.${a}`]!.en}${targets.includes(a) ? ' (a goal of this rotation)' : ''} — ${p[a].length} item(s)`, ...p[a].map((e) => `  - [${e.kind}] ${e.caseId}: ${e.text}${e.detail ? ` (${e.detail})` : ''}`)].join('\n')).join('\n\n');
}

export function PortfolioScreen() {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const rotations = useRotations();
  const cases = useCases();
  const [rotationId, setRotationId] = useState('');
  const [data, setData] = useState<PortfolioData | undefined>();
  const [done, setDone] = useState<string>();
  const rot = rotations.status === 'ready' ? rotations.data.find((r) => r.id === rotationId) : undefined;
  const version = cases.status === 'ready' ? cases.data.map((c) => `${c.id}@${c.version}`).join(',') : '';
  useEffect(() => {
    let live = true;
    void portfolioCases(store, rotationId || undefined).then((all) => live && setData(buildPortfolio(all)));
    return () => {
      live = false;
    };
  }, [store, rotationId, version]);
  const total = data ? COMPETENCY_AREAS.reduce((n, a) => n + data[a].length, 0) : 0;
  const targets = rot?.competencies ?? [];
  const record = async (as: 'pdf' | 'text') => {
    if (!data) return;
    const hash = await sha(portfolioText(data, targets));
    await store.recordPortfolioExport({ entries: total, hash, as });
    setDone(t('pres.audited', { hash: hash.slice(0, 12) }));
  };
  return (
    <div className="flex flex-col gap-4" data-testid="portfolio">
      <div data-print="hide">
        <PageTitle back="#/more">{t('portfolio.title')}</PageTitle>
        <div className="mt-3 flex flex-col gap-3">
          <Banner tone="info">{t('portfolio.intro')}</Banner>
          {rotations.status === 'ready' && (
            <SelectField
              label={t('pres.rotation')}
              name="portfolio-rotation"
              optional
              value={rotationId}
              onChange={setRotationId}
              options={[{ value: '', label: t('portfolio.allRotations') }, ...rotations.data.map((r) => ({ value: r.id, label: `${TERMS[`dept.${r.department}`]?.en ?? r.department} · ${r.startDate} – ${r.endDate}` }))]}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon="download"
              disabled={!data}
              data-testid="portfolio-print"
              onClick={async () => {
                await record('pdf');
                window.print();
              }}
            >
              {t('pres.print')}
            </Button>
            <Button
              icon="file-text"
              disabled={!data}
              data-testid="portfolio-text"
              onClick={async () => {
                if (!data) return;
                await record('text');
                const url = URL.createObjectURL(new Blob([portfolioText(data, targets)], { type: 'text/plain;charset=utf-8' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'portfolio.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              {t('pres.text')}
            </Button>
            {done && (
              <span className="text-xs text-emerald-900" role="status" data-testid="portfolio-audited">
                {done}
              </span>
            )}
          </div>
        </div>
      </div>
      {data &&
        COMPETENCY_AREAS.map((a) => (
          <Card key={a} title={TERMS[`comp.${a}`]![lang]}>
            <div className="flex flex-col gap-2" data-testid="competency" data-area={a} data-count={data[a].length}>
              <p className="text-xs text-slate-600">
                {t('portfolio.count', { n: data[a].length })}
                {targets.includes(a) ? ` · ${t('portfolio.goal')}` : ''}
              </p>
              {data[a].length === 0 ? (
                <p className="text-sm text-slate-600">{targets.includes(a) ? t('portfolio.noneGoal') : t('portfolio.none')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data[a].map((e, i) => (
                    <li key={i} className="rounded-lg border border-line px-2 py-1.5" dir="auto" data-kind={e.kind}>
                      <span className="text-xs font-medium text-teal-900">{t(`portfolio.kind.${e.kind}` as MsgKey)}</span> · <span className="font-mono text-xs">{e.caseId}</span>
                      <p>{e.text}</p>
                      {e.detail && <p className="text-xs text-slate-600">{e.detail}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ))}
    </div>
  );
}
