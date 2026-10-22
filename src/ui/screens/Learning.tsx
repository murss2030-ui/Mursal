/**
 * The learning modes (plan M8) on one case: Teach me, Assessment mode and
 * Argue with me. All three are built from the trainee's own record and the
 * app's tested knowledge — no model writes anything here. What the trainee
 * does is kept in their own words, tagged with competency areas.
 */
import { useMemo, useState } from 'react';
import { calcInputsText } from '../../ai/analysis/payload';
import { CALC_BY_ID } from '../../calc/registry';
import { assessmentQuestions, challengesFor, markAnswer, MODE_COMPETENCIES, teachSections, type LearningMode, type LearningRecord } from '../../domain/learning';
import { namedDrugs } from '../../domain/pcne-coherence';
import { buildCard } from '../../domain/problem-card';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { TERMS } from '../../i18n/terms';
import { searchLibrary, type LibrarySearch } from '../../library/run';
import { Banner, Button, Card, PageTitle, SelectField, TextAreaField, TextField } from '../components/ui';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { useCases } from '../data';
import { useCaseRules } from '../rules/useCaseRules';
import { useSession } from '../session-context';
import { useLearning } from './learning-data';
import { Passage } from './Library';

export function LearningHub() {
  const { t } = useI18n();
  const cases = useCases();
  return (
    <div className="flex flex-col gap-4" data-testid="learning-hub">
      <PageTitle back="#/more">{t('learn.title')}</PageTitle>
      <Banner tone="info">{t('learn.intro')}</Banner>
      {cases.status === 'ready' && cases.data.length === 0 && <p className="text-slate-600">{t('reports.empty')}</p>}
      {cases.status === 'ready' &&
        cases.data.map((c) => (
          <a key={c.id} href={`#/cases/${c.id}/learn`} className="flex min-h-touch items-center justify-between rounded-xl border border-line bg-white px-3 py-3 hover:border-teal-600">
            <span className="font-mono font-semibold">{c.id}</span>
            <span className="text-sm text-slate-600">{t('learn.open')}</span>
          </a>
        ))}
    </div>
  );
}

export function CaseLearning({ caseId }: { caseId: string }) {
  const { t, lang } = useI18n();
  const state = useCaseBundle(caseId);
  const rules = useCaseRules(state.status === 'ready' ? state.b : undefined);
  const [mode, setMode] = useState<LearningMode>('teach');
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const readOnly = b.case.status === 'archived';
  return (
    <div className="flex flex-col gap-4" data-testid="case-learning">
      <PageTitle back="#/learning">{t('learn.caseTitle', { id: b.case.id })}</PageTitle>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('learn.title')}>
        {(['teach', 'assess', 'argue'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            data-testid={`learn-tab-${m}`}
            className={`min-h-touch rounded-full border px-4 text-sm ${mode === m ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
          >
            {t(`learn.mode.${m}` as MsgKey)}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-700">{t(`learn.help.${mode}` as MsgKey)}</p>
      <p className="text-xs text-slate-600">{t('learn.tags', { areas: MODE_COMPETENCIES[mode].map((a) => TERMS[`comp.${a}`]![lang]).join(', ') })}</p>
      {mode === 'assess' ? <Assess b={b} readOnly={readOnly} /> : <CardMode b={b} mode={mode} readOnly={readOnly} alerts={rules.ready ? rules.alerts.map((a) => ({ key: a.key, title: a.title.en })) : []} />}
    </div>
  );
}

// ---------------------------------------------------------------- Assessment mode

function Assess({ b, readOnly }: { b: CaseBundle; readOnly: boolean }) {
  const { t } = useI18n();
  const { store } = useSession();
  const learning = useLearning(b.case.id);
  const done = learning.filter((r) => r.mode === 'assess');
  const questions = useMemo(
    () =>
      assessmentQuestions(
        b.calcResults,
        b.cardContext.calcOutOfDate,
        (r) => CALC_BY_ID.get(r.calc)?.name ?? r.calc,
        calcInputsText,
        (r) => CALC_BY_ID.get(r.calc)?.formula,
      ),
    [b.calcResults, b.cardContext.calcOutOfDate],
  );
  if (!questions.length) return <p className="text-sm text-slate-600" data-testid="assess-none">{t('learn.assess.none')}</p>;
  return (
    <div className="flex flex-col gap-3">
      {questions.map((q) => (
        <AssessQuestionCard key={q.resultId} q={q} previous={done.filter((r) => r.itemId === q.resultId).at(-1)} readOnly={readOnly} onSave={(answer, correct) => store.recordLearning(b.case.id, { mode: 'assess', itemId: q.resultId, competencies: [...MODE_COMPETENCIES.assess], prompt: q.text, answer, score: { correct, expected: `${q.expected} ${q.unit}` } })} />
      ))}
    </div>
  );
}

function AssessQuestionCard({ q, previous, readOnly, onSave }: { q: ReturnType<typeof assessmentQuestions>[number]; previous?: LearningRecord; readOnly: boolean; onSave: (answer: string, correct: boolean) => Promise<unknown> }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [result, setResult] = useState<{ correct: boolean } | undefined>();
  const [error, setError] = useState<string>();
  const check = async () => {
    const m = markAnswer(q, value);
    if (!m.ok) {
      setError(t('learn.assess.number'));
      return;
    }
    setError(undefined);
    setResult({ correct: m.correct });
    await onSave(value, m.correct);
  };
  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid="assess-question">
        <p dir="auto">{q.text}</p>
        <TextField label={t('learn.assess.answer', { unit: q.unit })} inputMode="decimal" value={value} onChange={setValue} error={error} name={`assess-${q.resultId}`} />
        {!readOnly && !result && (
          <div>
            <Button variant="primary" onClick={() => void check()} disabled={!value.trim()} data-testid="assess-check">
              {t('learn.assess.check')}
            </Button>
          </div>
        )}
        {result && (
          <Banner tone={result.correct ? 'success' : 'warning'} role="status">
            <p className="font-medium" data-testid="assess-result" data-correct={String(result.correct)}>
              {result.correct ? t('learn.assess.correct') : t('learn.assess.wrong', { expected: `${q.expected} ${q.unit}` })}
            </p>
            <ul className="mt-1 list-disc ps-5 text-xs" dir="auto">
              {q.feedback.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </Banner>
        )}
        {!result && previous?.score && <p className="text-xs text-slate-600">{t('learn.assess.before', { r: previous.score.correct ? t('learn.assess.correct') : t('learn.assess.wrong', { expected: previous.score.expected }) })}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Teach me and Argue with me: about one Problem Card

function CardMode({ b, mode, readOnly, alerts }: { b: CaseBundle; mode: 'teach' | 'argue'; readOnly: boolean; alerts: { key: string; title: string }[] }) {
  const { t, lang } = useI18n();
  const cards = b.itemsOf('drp');
  const [itemId, setItemId] = useState(cards[0]?.id ?? '');
  const item = cards.find((c) => c.id === itemId) ?? cards[0];
  if (!item) return <p className="text-sm text-slate-600" data-testid="learn-no-card">{t('learn.noCard')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <SelectField label={t('learn.card')} name="learn-card" value={item.id} onChange={setItemId} options={cards.map((c) => ({ value: c.id, label: c.fields.problem ?? c.id }))} />
      {mode === 'teach' ? <Teach b={b} itemId={item.id} problem={item.fields.problem ?? ''} fields={item.fields} readOnly={readOnly} lang={lang} /> : <Argue b={b} item={item} alerts={alerts} readOnly={readOnly} />}
    </div>
  );
}

function Teach({ b, itemId, problem, fields, readOnly, lang }: { b: CaseBundle; itemId: string; problem: string; fields: Record<string, string>; readOnly: boolean; lang: 'en' | 'ar' }) {
  const { t } = useI18n();
  const { store } = useSession();
  const learning = useLearning(b.case.id);
  const sections = teachSections(fields);
  const [found, setFound] = useState<LibrarySearch | undefined>();
  const studied = learning.some((r) => r.mode === 'teach' && r.itemId === itemId);
  const words = [...(namedDrugs(fields.drugs) ?? []), problem].join(' ');
  const search = async () => setFound(await searchLibrary(store, words, { caseKind: 'teaching', byMeaning: false, limit: 3 }));
  return (
    <div className="flex flex-col gap-3" data-testid="teach">
      {sections.map((s, i) => (
        <Card key={i} title={lang === 'ar' ? s.title.ar : s.title.en}>
          <ul className="flex flex-col gap-1 text-sm" dir="auto">
            {s.items.map((x, j) => (
              <li key={j}>{lang === 'ar' ? x.ar : x.en}</li>
            ))}
          </ul>
        </Card>
      ))}
      <Card title={t('learn.teach.read')}>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-700">{t('learn.teach.readHelp')}</p>
          <div>
            <Button icon="search" onClick={() => void search()} data-testid="teach-search">
              {t('learn.teach.search')}
            </Button>
          </div>
          {found && found.hits.length === 0 && <p className="text-sm text-slate-600">{t('lib.noHits', { q: words })}</p>}
          {found?.hits.map((h) => (
            <Passage key={h.chunk.id} chunk={h.chunk} citation={h.citation} old={h.old} docId={h.doc.id} />
          ))}
          <div className="flex flex-wrap gap-2">
            <a className="text-sm text-teal-800 underline" href={`#/cases/${b.case.id}/card/${itemId}/research`}>
              {t('research.link')}
            </a>
            <a className="text-sm text-teal-800 underline" href={`#/cases/${b.case.id}/calc`}>
              {t('learn.teach.calcs')}
            </a>
          </div>
        </div>
      </Card>
      {!readOnly && (
        <div>
          <Button
            icon="check"
            disabled={studied}
            data-testid="teach-done"
            onClick={() => void store.recordLearning(b.case.id, { mode: 'teach', itemId, competencies: [...MODE_COMPETENCIES.teach], prompt: `Studied: ${problem}`.slice(0, 1000) })}
          >
            {studied ? t('learn.teach.studied') : t('learn.teach.markStudied')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Argue({ b, item, alerts, readOnly }: { b: CaseBundle; item: { id: string; fields: Record<string, string> } & Parameters<typeof buildCard>[0]; alerts: { key: string; title: string }[]; readOnly: boolean }) {
  const { t } = useI18n();
  const { store } = useSession();
  const learning = useLearning(b.case.id);
  const card = buildCard(item, b.cardContext);
  const missing = card.fields.filter((f) => f.missing).map((f) => f.label.en);
  const drugs = (namedDrugs(item.fields.drugs) ?? []).map((d) => d.toLowerCase());
  const related = alerts.filter((a) => drugs.some((d) => a.title.toLowerCase().includes(d)));
  const list = challengesFor(item.fields, related, missing);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-3" data-testid="argue">
      {list.map((c) => {
        const saved = learning.filter((r) => r.mode === 'argue' && r.itemId === item.id && r.prompt === c.text).at(-1);
        return (
          <Card key={c.id}>
            <div className="flex flex-col gap-2" data-testid="challenge" data-from={c.from}>
              <p className="font-medium" dir="auto">
                {c.text}
              </p>
              {saved && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950" dir="auto" data-testid="challenge-saved">
                  {t('learn.argue.saved')} {saved.answer}
                </p>
              )}
              {!readOnly && (
                <>
                  <TextAreaField label={t('learn.argue.answer')} value={drafts[c.id] ?? ''} onChange={(v) => setDrafts((d) => ({ ...d, [c.id]: v }))} rows={3} name={`argue-${c.id}`} />
                  <div>
                    <Button
                      icon="check"
                      disabled={!(drafts[c.id] ?? '').trim()}
                      data-testid="challenge-save"
                      onClick={async () => {
                        await store.recordLearning(b.case.id, { mode: 'argue', itemId: item.id, competencies: [...MODE_COMPETENCIES.argue], prompt: c.text, answer: drafts[c.id]!.trim() });
                        setDrafts((d) => ({ ...d, [c.id]: '' }));
                      }}
                    >
                      {t('learn.argue.save')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
