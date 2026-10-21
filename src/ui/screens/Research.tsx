/**
 * "Research this question" (plan M5d), from a Problem Card: the question in
 * PICO form for the trainee to edit, what will leave the device said before
 * anything is sent, then the answer — what the sources say to do, what
 * supports it, what conflicts with it, what is missing and the limits of
 * confidence — with every statement beside its verdict and its quote, and
 * every source as a link that opens it. Statements are added to the card one
 * at a time.
 */
import { useMemo, useState } from 'react';
import { AiError } from '../../ai/client';
import { ConnectorError } from '../../ai/connectors/http';
import { checkedQuestion, researchCard } from '../../ai/research/run';
import { verifyResearch } from '../../ai/research/verify';
import { namedDrugs } from '../../domain/pcne-coherence';
import { maySend } from '../../domain/library';
import {
  addable,
  confidenceFactors,
  defaultPico,
  researchKey,
  researchStaleness,
  type Pico,
  type ResearchRole,
  type ResearchRun,
  type ResearchStatement,
  type RetrievalNote,
} from '../../domain/research';
import { isLiterature, LITERATURE_LABEL, sourceCitation, type SourceRecord } from '../../domain/sources';
import type { ClaimVerification } from '../../domain/verdicts';
import type { MsgKey } from '../../i18n/en';
import { useI18n } from '../../i18n/i18n';
import { Icon } from '../components/Icon';
import { Banner, Button, Card, CheckboxField, Chip, PageTitle, TextAreaField } from '../components/ui';
import { useDocuments, useResearchRuns } from '../data';
import { useSession } from '../session-context';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { CheckButton, VerdictLine } from './verdict-parts';

/** Only a link that opens a page over HTTPS is made clickable. */
const safeUrl = (u: string | undefined): string | undefined => (u && /^https:\/\/[^\s]+$/i.test(u) ? u : undefined);

function useErrorMessage() {
  const { t } = useI18n();
  return (e: unknown): string => {
    if (e instanceof AiError) return t(`ai.err.${e.code}` as MsgKey) === `ai.err.${e.code}` ? e.message : t(`ai.err.${e.code}` as MsgKey);
    if (e instanceof ConnectorError) return e.message;
    return e instanceof Error ? e.message : String(e);
  };
}

// ---------------------------------------------------------------- the card's research: the question, then the answers

export function ResearchScreen({ caseId, itemId }: { caseId: string; itemId: string }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  const runs = useResearchRuns(caseId);
  if (state.status === 'loading' || runs.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (runs.status === 'error') return <Banner tone="danger">{runs.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const item = b.allItems.find((i) => i.id === itemId && i.register === 'drp');
  if (!item) return <Banner tone="warning">{t('card.notFound')}</Banner>;
  const mine = runs.data.filter((r) => r.itemId === itemId).sort((a, c) => (a.createdAt < c.createdAt ? 1 : -1));
  const readOnly = b.case.status === 'archived' || item.status === 'retracted';
  return (
    <div className="flex flex-col gap-4" data-testid="research-screen">
      <PageTitle back={`#/cases/${caseId}/card/${itemId}`}>{t('research.title')}</PageTitle>
      <p className="-mt-3 text-sm text-slate-700" dir="auto">
        {item.fields.problem}
      </p>
      <Banner tone="info">{t('research.intro')}</Banner>
      {!readOnly && <QuestionForm b={b} itemId={itemId} problem={item.fields.problem ?? ''} drugs={item.fields.drugs ?? ''} />}
      {mine.length === 0 && <p className="text-sm text-slate-600">{t('research.noRuns')}</p>}
      {mine[0] && <RunView b={b} run={mine[0]} readOnly={readOnly} />}
      {mine.length > 1 && (
        <Card title={t('research.earlier')}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {mine.slice(1).map((r) => (
              <li key={r.id}>
                <a href={`#/cases/${caseId}/research/${r.id}`} className="text-teal-800 underline">
                  {r.question}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** One run on its own (an earlier research, or a link from a card's claim). */
export function ResearchRunScreen({ caseId, runId }: { caseId: string; runId: string }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  const runs = useResearchRuns(caseId);
  if (state.status === 'loading' || runs.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (runs.status === 'error') return <Banner tone="danger">{runs.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const run = runs.data.find((r) => r.id === runId);
  if (!run) return <Banner tone="warning">{t('research.notFound')}</Banner>;
  const readOnly = state.b.case.status === 'archived';
  return (
    <div className="flex flex-col gap-4" data-testid="research-run-screen">
      <PageTitle back={`#/cases/${caseId}/card/${run.itemId}/research`}>{t('research.title')}</PageTitle>
      <RunView b={state.b} run={run} readOnly={readOnly} />
    </div>
  );
}

// ---------------------------------------------------------------- the question

const PARTS = ['population', 'intervention', 'comparison', 'outcome'] as const;

function QuestionForm({ b, itemId, problem, drugs }: { b: CaseBundle; itemId: string; problem: string; drugs: string }) {
  const { t } = useI18n();
  const { store } = useSession();
  const docs = useDocuments();
  const message = useErrorMessage();
  const [pico, setPico] = useState<Pico>(() => defaultPico({ problem, drugs, ageYears: b.case.demographics.ageYears, sex: b.case.demographics.sex }));
  const [libraryOnly, setLibraryOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [warn, setWarn] = useState<string>();
  const active = docs.status === 'ready' ? docs.data.filter((d) => d.status === 'active') : [];
  const may = active.filter(maySend).length;
  const [preview, setPreview] = useState<{ question: string; query: string } | { error: string }>();
  const refresh = (p: Pico) => {
    void checkedQuestion(store, b.case.id, p).then(setPreview, (e: unknown) => setPreview({ error: message(e) }));
  };
  const set = (k: keyof Pico) => (v: string) => {
    const next = { ...pico, [k]: v };
    setPico(next);
    refresh(next);
  };
  const go = async () => {
    setBusy(true);
    setError(undefined);
    setWarn(undefined);
    try {
      const r = await researchCard(store, b.case.id, itemId, pico, libraryOnly ? { online: () => true } : {});
      if (r.verifyError) setWarn(t('research.verifyFailed', { reason: r.verifyError }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const drugList = namedDrugs(pico.intervention) ?? [];
  return (
    <Card title={t('research.pico')}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        {PARTS.map((k) => (
          <TextAreaField key={k} label={t(`research.p.${k}` as MsgKey)} hint={t(`research.p.${k}Hint` as MsgKey)} value={pico[k]} onChange={set(k)} rows={2} name={`pico-${k}`} optional={k === 'comparison'} />
        ))}
        {preview && 'question' in preview && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800" dir="auto" data-testid="pico-question">
            <span className="font-medium">{t('research.preview')} </span>
            {preview.question}
          </p>
        )}
        {preview && 'error' in preview && (
          <Banner tone="danger" role="alert">
            {preview.error}
          </Banner>
        )}
        <Banner tone="warning">
          <p>{t('research.sendNote')}</p>
          <p className="mt-1">{t('research.libraryNote', { may, local: active.length - may })}</p>
          {drugList.length > 0 && <p className="mt-1 text-xs">{t('research.drugsSent', { drugs: drugList.join(', ') })}</p>}
        </Banner>
        <CheckboxField name="library-only" label={t('research.libraryOnly')} checked={libraryOnly} onChange={setLibraryOnly} />
        {error && (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        )}
        {warn && (
          <Banner tone="warning" role="status">
            {warn}
          </Banner>
        )}
        <div>
          <Button type="submit" variant="primary" icon="search" disabled={busy} data-testid="research-go">
            {busy ? t('research.running') : t('research.go')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- the answer

export function RunView({ b, run, readOnly }: { b: CaseBundle; run: ResearchRun; readOnly: boolean }) {
  const { t, when } = useI18n();
  const item = b.allItems.find((i) => i.id === run.itemId);
  const stale = useMemo(() => researchStaleness(run, item, b.cardContext), [run, item, b.cardContext]);
  const verdicts = b.cardContext.verdicts ?? new Map<string, ClaimVerification>();
  const { store } = useSession();
  const factors = confidenceFactors(run, verdicts, store.today());
  const unchecked = run.statements.some((s) => !verdicts.get(researchKey(run.id, s)) || verdicts.get(researchKey(run.id, s))!.verdict === 'not_checked');
  return (
    <div className="flex flex-col gap-4" data-testid="research-run" data-status={run.status}>
      <Card>
        <p className="font-medium text-slate-900" dir="auto">
          {run.question}
        </p>
        <p className="mt-1 text-xs text-slate-600">{run.model ? t('research.drafted', { model: run.model, when: when(run.createdAt) }) : t('research.notDrafted', { when: when(run.createdAt) })}</p>
        {stale.stale && (
          <Banner tone="warning" className="mt-3">
            <p className="font-medium">{t('research.stale')}</p>
            <ul className="mt-1 list-disc ps-5 text-xs">
              {stale.reasons.map((r, i) => (
                <li key={i}>{r.en}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">{t('research.staleHelp')}</p>
          </Banner>
        )}
        {run.notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-slate-800" data-testid="research-notes">
            {run.notes.map((n: RetrievalNote) => (
              <li key={n} className="flex items-start gap-1.5">
                <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
                {t(`research.notes.${n}` as MsgKey)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {run.status === 'insufficient' ? (
        <Banner tone="warning" role="status">
          <p className="font-medium" data-testid="research-insufficient">
            {t('research.insufficient')}
          </p>
          <p className="mt-1">{t('research.insufficientHelp')}</p>
          {run.openQuestion && (
            <p className="mt-2 rounded border border-amber-300 bg-white/70 px-2 py-1.5 text-sm" dir="auto" data-testid="research-open-question">
              <span className="font-medium">{t('research.openQuestion')}: </span>
              {run.question}
            </p>
          )}
          {run.missingData.length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-sm">
              {run.missingData.map((m, i) => (
                <li key={i} dir="auto">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </Banner>
      ) : (
        <>
          {unchecked && !readOnly && <CheckButton label={t('research.recheck')} testId="research-recheck" run={() => verifyResearch(store, run.caseId, run.id)} />}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              {(['recommendation', 'supporting'] as const).map((role) => (
                <StatementGroup key={role} b={b} run={run} role={role} readOnly={readOnly || stale.stale} verdicts={verdicts} />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <StatementGroup b={b} run={run} role="conflicting" readOnly={readOnly || stale.stale} verdicts={verdicts} />
            </div>
          </div>
          {run.missingData.length > 0 && (
            <Card title={t('research.missing')}>
              <ul className="list-disc ps-5 text-sm" data-testid="research-missing">
                {run.missingData.map((m, i) => (
                  <li key={i} dir="auto">
                    {m}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={t('research.limits')}>
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="research-factors">
              {factors.map((f) => (
                <li key={f.id} className="flex items-start gap-1.5" data-factor={f.id} data-level={f.level}>
                  <Icon name={f.level === 'good' ? 'check-circle' : 'alert-triangle'} className={`mt-0.5 h-4 w-4 shrink-0 ${f.level === 'good' ? 'text-emerald-700' : f.level === 'limit' ? 'text-red-700' : 'text-amber-700'}`} />
                  {t((f.id === 'sources' || f.id === 'verification' ? `research.f.${f.id}.${f.level}` : `research.f.${f.id}`) as MsgKey, { n: f.n ?? 0, years: f.years ?? 0 })}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <SourcesList run={run} />
    </div>
  );
}

function StatementGroup({ b, run, role, readOnly, verdicts }: { b: CaseBundle; run: ResearchRun; role: ResearchRole; readOnly: boolean; verdicts: ReadonlyMap<string, ClaimVerification> }) {
  const { t } = useI18n();
  const list = run.statements.filter((s) => s.role === role);
  if (!list.length && role !== 'conflicting') return null;
  return (
    <section className="flex flex-col gap-2" data-testid={`research-${role}`}>
      <h3 className="text-base font-semibold text-slate-900">{t(`research.role.${role}` as MsgKey)}</h3>
      {list.length === 0 && <p className="text-sm text-slate-600">{t('research.noConflict')}</p>}
      {list.map((s) => (
        <StatementCard key={s.n} b={b} run={run} s={s} readOnly={readOnly} verdict={verdicts.get(researchKey(run.id, s))} />
      ))}
    </section>
  );
}

function StatementCard({ b, run, s, readOnly, verdict }: { b: CaseBundle; run: ResearchRun; s: ResearchStatement; readOnly: boolean; verdict: ClaimVerification | undefined }) {
  const { t } = useI18n();
  const { store } = useSession();
  const message = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const source = run.sources.find((x) => x.id === s.sourceId);
  const item = b.allItems.find((i) => i.id === run.itemId);
  const inCard = item?.fields.claims?.includes(`"ref":"${run.id}:${s.n}"`) ?? false;
  const ok = addable(s, verdict);
  const add = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await store.addResearchClaim(run.caseId, run.itemId, run.id, s.n);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`rounded-xl border bg-white p-3 ${s.flags.some((f) => f === 'differs_from_calculation') ? 'border-red-400' : 'border-line'}`} data-testid="research-statement" data-statement={s.n} data-verdict={verdict?.verdict ?? 'none'}>
      <p dir="auto" className="text-slate-900">
        {s.text}
      </p>
      {s.asDrafted && (
        <p className="mt-1 text-xs text-slate-600" dir="auto">
          {t('research.asDrafted')} <span className="line-through decoration-slate-400">{s.asDrafted}</span>
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1" data-testid="research-flags">
        {s.flags.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-xs font-medium text-red-800" data-flag={f}>
            <Icon name="alert-triangle" className="mt-px h-3.5 w-3.5 shrink-0" />
            {f === 'differs_from_calculation'
              ? t('research.flag.differs_from_calculation', { calc: (s.differsFrom ?? []).map((d) => `${d.label}: ${d.result}`).join('; ') })
              : t(`research.flag.${f}` as MsgKey)}
          </li>
        ))}
      </ul>
      <blockquote className="mt-2 border-s-4 border-slate-300 ps-3 text-sm text-slate-800" dir="auto">
        <q className="font-mono text-[12px]">{s.quote}</q>
        <footer className="mt-1 text-xs text-slate-600">
          {source ? <SourceLink source={source} section={s.section} /> : t('research.sourceMissing')}
        </footer>
      </blockquote>
      <div className="mt-2">
        <VerdictLine v={verdict} />
      </div>
      {!readOnly && (
        <div className="mt-2 flex flex-col items-start gap-1">
          {inCard ? (
            <p className="text-xs text-emerald-900" data-testid="research-in-card">
              <Icon name="check-circle" className="me-1 inline h-3.5 w-3.5" />
              {t('research.inCard')}
            </p>
          ) : (
            <Button icon="plus" disabled={!ok || busy} onClick={() => void add()} data-testid="research-add">
              {t('research.add')}
            </Button>
          )}
          {!ok && !inCard && <p className="text-xs text-slate-700">{t('research.cannotAdd')}</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- the sources, each a link that opens it

function SourceLink({ source, section }: { source: SourceRecord; section?: string }) {
  const { t } = useI18n();
  const url = source.kind === 'library' ? source.url : safeUrl(source.url);
  const label = `${sourceCitation(source)}${section ? ` [${section}]` : ''}`;
  if (!url) return <span dir="auto">{label}</span>;
  return source.kind === 'library' ? (
    <a href={url} className="text-teal-800 underline" dir="auto" data-testid="source-link">
      {source.citation ?? label}
      {section ? ` [${section}]` : ''}
    </a>
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-teal-800 underline" dir="auto" data-testid="source-link" title={t('research.source.open')}>
      {sourceTitle(source)}
      {section ? ` [${section}]` : ''}
    </a>
  );
}

const sourceTitle = (s: SourceRecord): string => `${s.authors ? `${s.authors}. ` : ''}${s.title} — ${s.publisher}${s.date ? `, ${s.date}` : ''}`;

function SourcesList({ run }: { run: ResearchRun }) {
  const { t, when } = useI18n();
  return (
    <Card title={t('research.sources', { n: run.sources.length })}>
      {run.sources.length === 0 && <p className="text-sm text-slate-600">{t('research.noSources')}</p>}
      <ul className="flex flex-col gap-3" data-testid="research-sources">
        {run.sources.map((s) => {
          const read = run.sent.some((p) => p.recordId === s.id);
          const full = safeUrl(s.fullTextUrl);
          return (
            <li key={s.id} className="rounded-lg border border-line p-2.5 text-sm" data-source={s.kind}>
              <p className="font-medium">
                <SourceLink source={s} />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1">
                <Chip>{t(`research.source.kind.${s.kind}` as MsgKey)}</Chip>
                {isLiterature(s) && <Chip tone="amber">{LITERATURE_LABEL}</Chip>}
                {s.scope === 'abstract_only' && <Chip>{t('research.source.abstractOnly')}</Chip>}
                {s.role === 'reference' && <Chip>{t('research.source.reference')}</Chip>}
                {s.old && <Chip tone="amber">{t('research.source.old')}</Chip>}
                {s.localOnly ? <Chip tone="violet">{t('research.source.localOnly')}</Chip> : <Chip tone={read ? 'teal' : 'slate'}>{read ? t('research.source.read') : t('research.source.notRead')}</Chip>}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {t('research.source.retrieved', { when: when(s.retrievedAt) })}
                {full && (
                  <>
                    {' · '}
                    <a href={full} target="_blank" rel="noopener noreferrer" className="text-teal-800 underline">
                      {t('research.source.fullText')}
                    </a>
                  </>
                )}
              </p>
              {s.localOnly && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700" dir="auto" data-testid="local-passage">
                  {s.sections[0]?.text.slice(0, 600)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

