/**
 * Pieces of the Clinical Problem Card shared by the card view, the Problems
 * list, the task worksheets and the editor: the linked values of field 2,
 * the claims of field 7, the form boxes of field 5, the stage, the staleness
 * badge and the review state.
 */
import { useMemo } from 'react';
import { CLAIM_SOURCES, linksValue, MAX_CLAIM_ALSO, parseLinks, type CardLink, type ClaimSource } from '../../domain/card-data';
import { PCNE_MAPS_APPROVED, PCNE_MAPS_DRAFT } from '../../domain/pcne-maps';
import type { CoherenceIssue } from '../../domain/pcne-coherence';
import { CARD_STAGES, cardBoxes, type CardModel, type ReviewState, type StageInfo } from '../../domain/problem-card';
import { DRP_CATEGORIES } from '../../domain/workflow/registers';
import type { CalcResult } from '../../calc/types';
import { show } from '../../calc/units';
import { CALC_BY_ID } from '../../calc/registry';
import type { TimelineEntry } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { Button, Chip, SelectField, TextAreaField, TextField } from '../components/ui';
import { entryText } from '../format';
import { useCaseRules } from '../rules/useCaseRules';
import { MultiPills } from './choice-controls';

type T = ReturnType<typeof useI18n>['t'];

// ---------------------------------------------------------------- field 5: the questions PRECEPTOR asks of a classification (M5)

/** Where the codes and the problem as written disagree (pcne-coherence.ts), with the trainee's reason when given. */
export function CoherenceQuestions({ issues, reason, editing }: { issues: readonly CoherenceIssue[]; reason?: string; editing?: boolean }) {
  const { t } = useI18n();
  const tl = useL();
  if (!issues.length) return null;
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-2 text-xs ${reason ? 'border-slate-300 bg-slate-50 text-slate-800' : 'border-red-300 bg-red-50 text-red-950'}`} data-testid="pcne-questions" data-answered={!!reason} role={editing ? 'note' : undefined}>
      <p className="flex items-center gap-1.5 font-semibold">
        <Icon name="alert-triangle" className="h-3.5 w-3.5 shrink-0" />
        {t('coherence.title')}
      </p>
      <ul className="flex flex-col gap-1 ps-5">
        {issues.map((x, i) => (
          <li key={i} className="list-disc" data-rule={x.rule}>
            {tl(x.message)}
          </li>
        ))}
      </ul>
      {editing ? null : reason ? (
        <p dir="auto" data-testid="pcne-reason">
          <span className="font-medium">{t('coherence.reason')} </span>
          {reason}
        </p>
      ) : (
        <p className="font-medium">{t('coherence.unanswered')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- what a link or a claim points to, as the trainee reads it

export function entryLabel(e: TimelineEntry, t: T): string {
  return `${entryText(e, { t }).main} — ${t('common.day', { n: e.hospitalDay })}${e.timeOfDay ? ` ${e.timeOfDay}` : ''}`;
}

export function calcLabel(r: CalcResult, lang: 'en' | 'ar', t: T): string {
  const c = CALC_BY_ID.get(r.calc);
  const name = c ? (lang === 'ar' ? c.nameAr : c.name) : r.calc;
  return `${name}: ${show(r.value, r.unit, r.decimals)}${r.day !== undefined ? ` — ${t('common.day', { n: r.day })}` : ''}`;
}

/** What can be linked or cited now: current timeline entries and calculation results that are not out of date. */
function useSources(b: CaseBundle) {
  const { t, lang } = useI18n();
  return useMemo(() => {
    const entries = [...b.current].reverse().map((e) => ({ value: `e:${e.id}`, label: entryLabel(e, t) }));
    const calcs = [...b.calcResults]
      .reverse()
      .filter((r) => !b.calcOutOfDate.has(r.id))
      .map((r) => ({ value: `c:${r.id}`, label: calcLabel(r, lang, t) }));
    return { entries, calcs };
  }, [b.current, b.calcResults, b.calcOutOfDate, t, lang]);
}

export function LinkLine({ b, link }: { b: CaseBundle; link: CardLink }) {
  const { t, lang } = useI18n();
  if (link.kind === 'entry') {
    const e = b.entries.find((x) => x.id === link.id);
    const current = b.current.some((x) => x.id === link.id);
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5" data-link={`e:${link.id}`} data-current={current}>
        <Icon name="file-text" className="h-3.5 w-3.5 shrink-0 text-teal-800" />
        <span dir="auto">{e ? entryLabel(e, t) : t('links.unknown')}</span>
        {!current && <Chip tone="amber">{t('links.changedSince')}</Chip>}
      </span>
    );
  }
  const r = b.calcResults.find((x) => x.id === link.id);
  const current = !!r && !b.calcOutOfDate.has(link.id);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-link={`c:${link.id}`} data-current={current}>
      <Icon name="function" className="h-3.5 w-3.5 shrink-0 text-teal-800" />
      <span dir="auto">{r ? calcLabel(r, lang, t) : t('links.unknown')}</span>
      {!current && <Chip tone="amber">{t('links.outOfDate')}</Chip>}
    </span>
  );
}

/** Field 2: the values this problem rests on, each linked to its timeline entry or calculation result. */
export function LinksPicker({ b, label, hint, value, onChange, error }: { b: CaseBundle; label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useI18n();
  const links = parseLinks(value);
  const chosen = new Set(links.map((l) => `${l.kind === 'entry' ? 'e' : 'c'}:${l.id}`));
  const src = useSources(b);
  const add = (v: string) => {
    if (!v || chosen.has(v)) return;
    onChange(linksValue([...links, ...parseLinks(v)]));
  };
  return (
    <div className="flex flex-col gap-2" data-testid="links-picker">
      {links.length === 0 ? (
        <p className="text-sm text-slate-600">{t('links.none')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((l) => (
            <li key={`${l.kind}:${l.id}`} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-white px-2 py-1.5 text-sm">
              <LinkLine b={b} link={l} />
              <button
                type="button"
                className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                aria-label={t('links.remove')}
                onClick={() => onChange(linksValue(links.filter((x) => !(x.kind === l.kind && x.id === l.id))))}
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SelectField
        label={label}
        hint={hint}
        value=""
        onChange={add}
        error={error}
        optional
        name="supporting-add"
        groups={[
          { label: t('links.entries'), options: src.entries.filter((o) => !chosen.has(o.value)) },
          { label: t('links.calcs'), options: src.calcs.filter((o) => !chosen.has(o.value)) },
        ].filter((g) => g.options.length)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- claims

interface DraftClaim {
  text: string;
  source: ClaimSource;
  ref?: string;
  /** M5: the other values the claim rests on (`e:<id>` or `c:<id>`). */
  also?: string[];
  title?: string;
  /** research only. */
  quote?: string;
  by?: 'model';
}

/** Claims as typed so far, incomplete ones included (they are checked when the card is saved). */
function draftClaims(v: string): DraftClaim[] {
  if (!v) return [];
  try {
    const raw: unknown = JSON.parse(v);
    if (!Array.isArray(raw)) return [];
    return raw.map((x: Record<string, unknown>) => ({
      text: typeof x.text === 'string' ? x.text : '',
      source: (CLAIM_SOURCES as readonly string[]).includes(x.source as string) ? (x.source as ClaimSource) : 'none',
      ...(typeof x.ref === 'string' ? { ref: x.ref } : {}),
      ...(Array.isArray(x.also) && x.also.length ? { also: x.also.filter((y): y is string => typeof y === 'string') } : {}),
      ...(typeof x.title === 'string' ? { title: x.title } : {}),
      ...(typeof x.quote === 'string' ? { quote: x.quote } : {}),
      ...(x.by === 'model' ? { by: 'model' as const } : {}),
    }));
  } catch {
    return [];
  }
}

/** M5: the other values one claim rests on — a change cites both of its values. */
function ClaimAlso({ b, claim, index, sources, onChange }: { b: CaseBundle; claim: DraftClaim; index: number; sources: ReturnType<typeof useSources>; onChange: (also: string[]) => void }) {
  const { t } = useI18n();
  const also = claim.also ?? [];
  const own = `${claim.source === 'entry' ? 'e' : 'c'}:${claim.ref}`;
  const taken = new Set([own, ...also]);
  return (
    <div className="flex flex-col gap-1.5" data-testid="claim-also">
      {also.length > 0 && (
        <ul className="flex flex-col gap-1">
          {parseLinks(also.join('|')).map((l) => (
            <li key={`${l.kind}:${l.id}`} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-white px-2 py-1 text-sm">
              <LinkLine b={b} link={l} />
              <button
                type="button"
                className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                aria-label={t('links.remove')}
                onClick={() => onChange(also.filter((x) => x !== `${l.kind === 'entry' ? 'e' : 'c'}:${l.id}`))}
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {also.length < MAX_CLAIM_ALSO && (
        <SelectField
          label={t('claims.also')}
          hint={t('claims.alsoHint')}
          value=""
          onChange={(x) => x && onChange([...also, x])}
          optional
          name={`claim-${index}-also`}
          groups={[
            { label: t('links.entries'), options: sources.entries.filter((o) => !taken.has(o.value)) },
            { label: t('links.calcs'), options: sources.calcs.filter((o) => !taken.has(o.value)) },
          ].filter((g) => g.options.length)}
        />
      )}
    </div>
  );
}

/** Field 7: each claim with its source. PRECEPTOR checks what it can in code; the rest is labelled as unverified. */
export function ClaimsEditor({ b, label, hint, value, onChange, error }: { b: CaseBundle; label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useI18n();
  const claims = draftClaims(value);
  const src = useSources(b);
  const rules = useCaseRules(b);
  const alerts = rules.alerts.filter((a) => a.interaction);
  const set = (next: DraftClaim[]) => onChange(next.length ? JSON.stringify(next) : '');
  const update = (i: number, patch: Partial<DraftClaim>) => set(claims.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <fieldset className="flex flex-col gap-2" data-testid="claims-editor">
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {hint && <p className="-mt-1 text-xs text-slate-600">{hint}</p>}
      {claims.length === 0 && <p className="text-sm text-slate-600">{t('claims.none')}</p>}
      {claims.map((c, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-white/70 p-3" data-claim={i}>
          <TextAreaField label={t('claims.text', { n: i + 1 })} value={c.text} onChange={(x) => update(i, { text: x })} rows={2} name={`claim-${i}-text`} />
          {c.source === 'research' ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800" dir="auto" data-testid={`claim-${i}-research`}>
              <span className="font-medium">{t('claims.kind.research')}: </span>
              {c.title}
              {c.quote && (
                <>
                  <br />
                  <q className="font-mono text-[11px]">{c.quote}</q>
                </>
              )}
              <br />
              {t('claims.research.fixed')}
            </p>
          ) : (
            <SelectField
              label={t('claims.source')}
              value={c.source}
              onChange={(x) => update(i, { source: (x || 'none') as ClaimSource, ref: undefined, also: undefined, title: undefined })}
              name={`claim-${i}-source`}
              options={CLAIM_SOURCES.filter((s) => s !== 'research').map((s) => ({ value: s, label: t(`claims.kind.${s}` as MsgKey) }))}
            />
          )}
          {c.source === 'entry' && (
            <SelectField label={t('claims.ref')} value={c.ref ? `e:${c.ref}` : ''} onChange={(x) => update(i, { ref: x.slice(2) || undefined })} name={`claim-${i}-ref`} options={src.entries} />
          )}
          {c.source === 'calc' && (
            <SelectField label={t('claims.ref')} value={c.ref ? `c:${c.ref}` : ''} onChange={(x) => update(i, { ref: x.slice(2) || undefined })} name={`claim-${i}-ref`} options={src.calcs} />
          )}
          {(c.source === 'entry' || c.source === 'calc') && c.ref && (
            <ClaimAlso b={b} claim={c} index={i} sources={src} onChange={(also) => update(i, { also: also.length ? also : undefined })} />
          )}
          {c.source === 'dataset' && (
            <SelectField
              label={t('claims.ref')}
              hint={alerts.length ? undefined : t('claims.noAlerts')}
              value={c.ref ?? ''}
              onChange={(x) => {
                const a = alerts.find((y) => y.key === x);
                update(i, a ? { ref: a.key, title: `${a.interaction!.drugA} + ${a.interaction!.drugB}: ${a.interaction!.severity} — ${a.source.en}` } : { ref: undefined, title: undefined });
              }}
              name={`claim-${i}-ref`}
              options={alerts.map((a) => ({ value: a.key, label: `${a.interaction!.drugA} + ${a.interaction!.drugB}: ${a.interaction!.severity}` }))}
            />
          )}
          {c.source === 'reading' && <TextField label={t('claims.title')} value={c.title ?? ''} onChange={(x) => update(i, { title: x })} name={`claim-${i}-title`} />}
          <div>
            <Button variant="ghost" icon="trash" onClick={() => set(claims.filter((_, j) => j !== i))}>
              {t('claims.remove')}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button icon="plus" onClick={() => set([...claims, { text: '', source: 'none' }])}>
          {t('claims.add')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------- field 5: the department form's boxes, derived from the PCNE codes

export function BoxList({ boxes, testId }: { boxes: readonly string[]; testId?: string }) {
  const tl = useL();
  const on = new Set(boxes);
  return (
    <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2" data-testid={testId}>
      {DRP_CATEGORIES.map((c) => (
        <li key={c.value} className={`flex items-center gap-2 ${on.has(c.value) ? 'text-slate-900' : 'text-slate-500'}`} data-box={c.value} data-checked={on.has(c.value)}>
          <span aria-hidden="true" className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] font-bold ${on.has(c.value) ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-400'}`}>
            {on.has(c.value) ? '✓' : ''}
          </span>
          <span className="sr-only">{on.has(c.value) ? '☑' : '☐'}</span>
          {tl(c.label)}
        </li>
      ))}
    </ul>
  );
}

export function MapDraftNote() {
  const tl = useL();
  if (PCNE_MAPS_APPROVED) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-900" data-testid="pcne-map-draft">
      <Icon name="alert-triangle" className="mt-px h-3.5 w-3.5 shrink-0" />
      {tl(PCNE_MAPS_DRAFT)}
    </p>
  );
}

/** The boxes the PCNE codes tick, and the trainee's adjustment (Section 15: adjustable before export, with a reason). */
export function BoxesControl({ values, label, hint, value, onChange, error }: { values: Record<string, string>; label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useI18n();
  const derived = cardBoxes({ ...values, boxes: '' }).boxes;
  const same = (v: string) => [...v.split('|').filter(Boolean)].sort().join('|') === [...derived].sort().join('|');
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white/70 p-3" data-testid="boxes-control" data-adjusted={!!value}>
      <p className="text-sm font-medium text-slate-800">{label}</p>
      {!values.pcneProblem ? (
        <p className="text-sm text-slate-600">{t('boxes.pickCodes')}</p>
      ) : value ? (
        <>
          <MultiPills label={t('boxes.adjusted')} hint={hint} options={DRP_CATEGORIES} value={value} onChange={(v) => onChange(same(v) ? '' : v)} error={error} testId="boxes-adjust" />
          <p className="text-xs text-slate-600">{t('boxes.derived')}</p>
          <BoxList boxes={derived} />
          <div>
            <Button variant="ghost" onClick={() => onChange('')}>
              {t('boxes.keep')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-600">{t('boxes.derived')}</p>
          <BoxList boxes={derived} testId="boxes-derived" />
          <div>
            <Button variant="ghost" icon="pencil" onClick={() => onChange(derived.join('|'))} disabled={!derived.length}>
              {t('boxes.adjust')}
            </Button>
          </div>
        </>
      )}
      <MapDraftNote />
    </div>
  );
}

// ---------------------------------------------------------------- stage, staleness, review

export function StageStepper({ stage, compact }: { stage: StageInfo; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <ol className="flex flex-wrap items-center gap-1" data-testid="card-stage" data-stage={stage.current} aria-label={t('card.stage.label')}>
      {CARD_STAGES.map((s, i) => {
        const done = stage.reached.has(s);
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className={`h-px w-2 ${done ? 'bg-teal-700' : 'bg-slate-300'}`} />}
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${done ? 'border-teal-700 bg-teal-50 text-teal-900' : 'border-dashed border-slate-300 text-slate-500'}`}
              data-reached={done}
            >
              {compact && !done ? '·' : t(`card.stage.${s}` as MsgKey)}
            </span>
          </li>
        );
      })}
      {stage.declined && <Chip tone="red">{t('card.stage.declined')}</Chip>}
    </ol>
  );
}

export function StaleBadge({ card }: { card: CardModel }) {
  const { t } = useI18n();
  if (!card.staleness.stale) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-950" data-testid="card-stale-badge">
      <Icon name="rotate" className="h-3.5 w-3.5" />
      {card.staleness.day !== undefined ? t('card.stale.badge', { n: card.staleness.day }) : t('card.stale.badgeNoDay')}
    </span>
  );
}

const DECISION_TONE: Record<string, 'teal' | 'red' | 'amber' | 'violet' | 'slate'> = {
  accepted: 'teal',
  edited: 'teal',
  rejected: 'red',
  needs_evidence: 'amber',
  needs_senior_review: 'violet',
};

export function ReviewChip({ review }: { review: ReviewState }) {
  const { t } = useI18n();
  if (review.kind === 'written_by_you') {
    return (
      <span data-review="written_by_you">
        <Chip>{t('card.writtenByYou')}</Chip>
      </span>
    );
  }
  if (review.kind === 'undecided') {
    return (
      <span data-review="undecided">
        <Chip tone="violet">{t('cardReview.undecided')}</Chip>
      </span>
    );
  }
  return (
    <span data-review={review.decision}>
      <Chip tone={DECISION_TONE[review.decision]}>{t(`cardReview.decision.${review.decision}` as MsgKey)}</Chip>
    </span>
  );
}
