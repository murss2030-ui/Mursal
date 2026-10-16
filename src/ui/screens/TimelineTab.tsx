import { useMemo, useState } from 'react';
import { dateOfHospitalDay } from '../../domain/dates';
import { compareEntries, deriveMedCourses, deriveProblems, indexTimeline, regimenText, type TimelineIndex } from '../../domain/timeline';
import type { Case, TimelineEntry } from '../../domain/types';
import { Term, useI18n } from '../../i18n/i18n';
import { Icon } from '../components/Icon';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Banner, Card, DayLabel, LinkButton, Num } from '../components/ui';
import { useEntries } from '../data';
import { ENTRY_ICONS, entryTermId, entryText } from '../format';

type Filter = 'all' | 'labs' | 'vitals' | 'meds' | 'notes' | 'other';
const FILTERS: Filter[] = ['all', 'labs', 'vitals', 'meds', 'notes', 'other'];
function inFilter(e: TimelineEntry, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'labs':
      return e.type === 'lab' || e.type === 'culture';
    case 'vitals':
      return e.type === 'vital' || e.type === 'weight';
    case 'meds':
      return e.type === 'med_start' || e.type === 'med_change' || e.type === 'med_stop';
    case 'notes':
      return e.type === 'note';
    case 'other':
      return e.type === 'imaging' || e.type === 'procedure' || e.type === 'event';
  }
}

function EntryCard({ e, idx, c }: { e: TimelineEntry; idx: TimelineIndex; c: Case }) {
  const i18n = useI18n();
  const { t, when } = i18n;
  const [showVersions, setShowVersions] = useState(false);
  const successor = idx.successorOf.get(e.id);
  const chain = idx.chainOf(e.id);
  const isHead = !successor;
  const text = entryText(e, i18n);
  const readOnly = c.status === 'archived';

  return (
    <article
      id={`entry-${e.id}`}
      data-testid="timeline-entry"
      data-entry-id={e.id}
      data-superseded={successor ? 'true' : 'false'}
      className={`rounded-xl border p-3 ${successor ? 'border-dashed border-slate-300 bg-slate-100 text-slate-500' : 'border-line bg-white shadow-card'}`}
    >
      <div className="flex items-start gap-2">
        <Icon name={ENTRY_ICONS[e.type]} className="mt-0.5 h-5 w-5 text-teal-800" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <Term id={entryTermId(e)} className="font-medium text-slate-700" />
            {e.timeOfDay && (
              <Num>
                <Icon name="clock" className="inline h-3 w-3" /> {e.timeOfDay}
              </Num>
            )}
          </div>
          <p dir="auto" className={`mt-0.5 break-words text-base ${successor ? 'line-through' : 'font-medium text-slate-900'}`} data-testid="entry-main">
            {text.main}
          </p>
          {text.details.map((d, i) => (
            <p key={i} dir="auto" className={`break-words text-sm ${successor ? 'line-through' : 'text-slate-700'}`}>
              {d}
            </p>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ProvenanceBadge state={e.provenance} />
            {e.sourceAttachmentId && (
              <a
                href={`#/cases/${c.id}/sources/${e.sourceAttachmentId}`}
                className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
                data-testid="entry-source-link"
              >
                <Icon name="file-text" className="h-3.5 w-3.5" />
                {t('tl.fromSource')}
              </a>
            )}
            <span className="text-xs text-slate-600">{t('tl.recorded', { when: when(e.recordedAt) })}</span>
          </div>
          {e.correction && (
            <p className="mt-1 text-sm text-slate-800" data-testid="correction-note">
              <Icon name="history" className="me-1 inline h-4 w-4" />
              {e.correction.kind === 'retract' ? t('tl.correctionRetract') : t('tl.correctionAmend')} —{' '}
              {t('tl.reason', { reason: e.correction.reason })}
            </p>
          )}
          {successor && (
            <p className="mt-1 text-sm font-medium text-slate-700" data-testid="superseded-note">
              {t('tl.superseded')} ·{' '}
              <a className="underline" href={`#/cases/${c.id}/timeline`} onClick={(ev) => {
                ev.preventDefault();
                document.getElementById(`entry-${successor.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}>
                {t('tl.goToCorrection')}
              </a>
            </p>
          )}
          {chain.length > 1 && isHead && (
            <button type="button" className="mt-1 min-h-touch text-sm font-medium text-teal-900 underline" onClick={() => setShowVersions((v) => !v)}>
              {showVersions ? t('tl.hideVersions') : t('tl.showVersions', { n: chain.length })}
            </button>
          )}
          {showVersions && (
            <ol className="mt-2 flex flex-col gap-2 border-s-2 border-slate-300 ps-3" data-testid="version-history">
              {chain.map((v, i) => (
                <li key={v.id} className="text-sm">
                  <span className="text-xs text-slate-600">
                    {t('tl.version', { n: i + 1, total: chain.length })} · {when(v.recordedAt)} · <DayLabel day={v.hospitalDay} />
                  </span>
                  <p dir="auto" className={i < chain.length - 1 ? 'text-slate-500 line-through' : 'text-slate-900'}>
                    {entryText(v, i18n).main}
                  </p>
                  {v.correction && <p className="text-xs text-slate-700">{t('tl.reason', { reason: v.correction.reason })}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
        {isHead && !readOnly && (
          <LinkButton href={`#/cases/${c.id}/entry/${e.id}/correct`} variant="ghost" className="!px-2 text-sm">
            <Icon name="pencil" className="h-4 w-4" />
            {t('tl.correct')}
          </LinkButton>
        )}
      </div>
    </article>
  );
}

export function TimelineTab({ c }: { c: Case }) {
  const { t, date } = useI18n();
  const entries = useEntries(c.id);
  const [filter, setFilter] = useState<Filter>('all');
  const [showSuperseded, setShowSuperseded] = useState(true);
  const readOnly = c.status === 'archived';

  const idx = useMemo(() => (entries.status === 'ready' ? indexTimeline(entries.data) : null), [entries]);
  if (entries.status === 'loading' || !idx) return <p className="text-slate-600">{t('common.loading')}</p>;
  if (entries.status === 'error') return <Banner tone="danger">{entries.error.message}</Banner>;

  const courses = deriveMedCourses(idx.current).filter((m) => m.status === 'active');
  const problems = deriveProblems(idx.current);
  const visible = entries.data
    .filter((e) => (showSuperseded ? true : !idx.successorOf.has(e.id)))
    .filter((e) => inFilter(e, filter))
    .sort(compareEntries)
    .reverse();
  const days = [...new Set(visible.map((e) => e.hospitalDay))];

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && (
        <LinkButton href={`#/cases/${c.id}/entry/new`} variant="primary" icon="plus" className="w-full">
          {t('tl.add')}
        </LinkButton>
      )}

      <Card title={t('tl.currentMeds')}>
        {courses.length === 0 ? (
          <p className="text-sm text-slate-600">{t('tl.noActiveMeds')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {courses.map((m) => (
              <li key={m.medId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2" data-testid="active-med">
                <div className="min-w-0">
                  <p className="font-medium" dir="auto">
                    {m.drug} — {regimenText(m)}
                  </p>
                  <p className="text-xs text-slate-600">
                    {t('tl.since', { d: m.startDay })}
                    {m.indication ? ` · ${m.indication}` : ''}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex gap-1">
                    <LinkButton href={`#/cases/${c.id}/med/${m.medId}/change`} variant="ghost" className="!px-2 text-sm">
                      {t('tl.change')}
                    </LinkButton>
                    <LinkButton href={`#/cases/${c.id}/med/${m.medId}/stop`} variant="ghost" className="!px-2 text-sm">
                      {t('tl.stop')}
                    </LinkButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('tl.problems')}>
        {problems.length === 0 ? (
          <p className="text-sm text-slate-600">{t('tl.noProblems')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {problems.map((p) => (
              <li key={p.problemId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
                <span dir="auto">
                  <span className="font-medium">{p.latest.payload.name}</span> — {t(`acuity.${p.latest.payload.acuity}`)} ·{' '}
                  {t(`pstatus.${p.latest.payload.status}`)}
                </span>
                {!readOnly && (
                  <LinkButton href={`#/cases/${c.id}/problem/${p.problemId}/update`} variant="ghost" className="!px-2 text-sm">
                    {t('tl.updateStatus')}
                  </LinkButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-1" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-touch rounded-full border px-3 text-sm ${filter === f ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
          >
            {t(`tl.filter.${f}`)}
          </button>
        ))}
      </div>
      <label className="flex min-h-touch items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} />
        {t('tl.showSuperseded')}
      </label>

      {visible.length === 0 ? (
        <p className="text-slate-600">{t('tl.empty')}</p>
      ) : (
        days.map((d) => (
          <section key={d} className="flex flex-col gap-2" data-testid="timeline-day">
            <h3 className="sticky top-[124px] z-[5] bg-slate-50 py-1 text-sm font-semibold text-slate-800">
              <DayLabel day={d} /> · <Num>{date(dateOfHospitalDay(c.admissionDay0, d))}</Num>
            </h3>
            {visible
              .filter((e) => e.hospitalDay === d)
              .map((e) => (
                <EntryCard key={e.id} e={e} idx={idx} c={c} />
              ))}
          </section>
        ))
      )}
    </div>
  );
}
