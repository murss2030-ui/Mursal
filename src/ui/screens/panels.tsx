/**
 * Read-only panels assembled from the case record for the task worksheets.
 * They select, sort and count what is already recorded; they never interpret
 * a value, rank a risk or suggest a treatment.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ANALYTE_BY_ID } from '../../domain/catalogue';
import { formatNumber } from '../../domain/numbers';
import { compareEntries, regimenText, unitText } from '../../domain/timeline';
import type { Attachment, EntryOf } from '../../domain/types';
import { MODULES, TASKS, type PanelId, type TaskDef } from '../../domain/workflow/catalogue';
import { choiceLabel } from '../../domain/workflow/registers';
import { caseTally, statusOf } from '../../domain/workflow/tasks';
import { useI18n } from '../../i18n/i18n';
import { useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon, type IconName } from '../components/Icon';
import { Card, Chip, DayLabel, Num } from '../components/ui';
import { useSession } from '../session-context';
import { ItemCard, itemTitle } from './RegisterList';

// ---------------------------------------------------------------- shared

export function useAttachmentUrl(a: Attachment | undefined, which: 'content' | 'thumb'): string | undefined {
  const { store } = useSession();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!a || a.kind !== 'image' || a.status !== 'active') return;
    let revoked = false;
    let made: string | undefined;
    void store.attachmentBytes(a.caseId, a.id, which).then((bytes) => {
      if (!bytes || revoked) return;
      made = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      setUrl(made);
    });
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [a, which, store]);
  return url;
}

export function SourceThumb({ a, className = 'h-14 w-14' }: { a: Attachment; className?: string }) {
  const url = useAttachmentUrl(a, 'thumb');
  if (a.kind === 'text') {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-800 ${className}`}>
        <Icon name="type" className="h-6 w-6" />
      </span>
    );
  }
  return url ? (
    <img src={url} alt="" className={`shrink-0 rounded-lg border border-line object-cover ${className}`} />
  ) : (
    <span className={`flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 ${className}`}>
      <Icon name="image" className="h-6 w-6" />
    </span>
  );
}

function Panel({ icon, title, children, testId }: { icon: IconName; title: ReactNode; children: ReactNode; testId: string }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name={icon} className="h-5 w-5 text-teal-800" />
          {title}
        </span>
      }
    >
      <div data-testid={testId}>{children}</div>
    </Card>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-slate-600">{children}</p>;

function labValue(e: EntryOf<'lab'>): string {
  const p = e.payload;
  return p.result.kind === 'numeric' ? `${formatNumber(p.result.value)} ${unitText(p.unit)}`.trim() : p.result.text;
}

// ---------------------------------------------------------------- panels

function Sources({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  return (
    <Panel icon="folder" title={t('panel.sources')} testId="panel-sources">
      {b.activeAttachments.length === 0 ? (
        <Empty>{t('panel.sourcesNone')}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {b.activeAttachments.map((a) => (
            <li key={a.id}>
              <a href={`#/cases/${b.case.id}/sources/${a.id}`} className="flex items-center gap-3 rounded-xl border border-line p-2 hover:border-teal-600">
                <SourceThumb a={a} className="h-12 w-12" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-slate-900">{t(`source.docType.${a.docType}`)}</span>
                  <span className="text-xs text-slate-600">
                    {a.title ? `${a.title} · ` : ''}
                    {a.hospitalDay !== undefined ? <DayLabel day={a.hospitalDay} /> : t('source.noDay')}
                  </span>
                </span>
                <span className="ms-auto text-xs font-medium text-teal-900">{t('panel.transcribe')}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <a href={`#/cases/${b.case.id}/intake`} className="mt-3 inline-flex min-h-touch items-center gap-1 text-sm font-medium text-teal-900 underline">
        <Icon name="plus" className="h-4 w-4" />
        {t('panel.addSources')}
      </a>
    </Panel>
  );
}

function InpatientMeds({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const linked = new Set(b.itemsOf('home_med').map((h) => h.fields.linkedMedId).filter(Boolean));
  return (
    <Panel icon="pill" title={t('panel.inpatientMeds')} testId="panel-inpatient-meds">
      {b.courses.length === 0 ? (
        <Empty>{t('panel.noMeds')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {b.courses.map((c) => (
            <li key={c.medId} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium text-slate-900">{c.drug}</span>
              <span className="text-sm text-slate-700" dir="ltr">
                {regimenText(c)}
              </span>
              <span className="text-xs text-slate-600">
                <Num>{c.stopDay === undefined ? t('common.dayOngoing', { a: c.startDay }) : t('common.dayRange', { a: c.startDay, b: c.stopDay })}</Num>
              </span>
              {!linked.has(c.medId) && b.itemsOf('home_med').length > 0 && <Chip tone="amber">{t('panel.notOnHomeList')}</Chip>}
              {c.status === 'stopped' && <Chip>{t('item.stopped')}</Chip>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Allergies({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const notes = b.current.filter((e): e is EntryOf<'note'> => e.type === 'note' && e.payload.category === 'allergy_adr');
  return (
    <Panel icon="alert-triangle" title={t('panel.allergies')} testId="panel-allergies">
      {notes.length === 0 ? (
        <Empty>{t('panel.allergiesNone')}</Empty>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {notes.map((e) => {
            const p = e.payload;
            if (p.category !== 'allergy_adr') return null;
            return (
              <li key={e.id} dir="auto">
                {p.kind === 'nkda' ? 'NKDA' : `${p.substance ?? ''}${p.reaction ? ` — ${p.reaction}` : ''} (${p.kind})`}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function NoIndication({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const list = b.activeCourses.filter((c) => !c.indication);
  return (
    <Panel icon="flag" title={t('panel.noIndication')} testId="panel-no-indication">
      {list.length === 0 ? (
        <Empty>{b.activeCourses.length ? t('panel.allIndicated') : t('panel.noMeds')}</Empty>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.map((c) => (
            <li key={c.medId} className="flex items-center gap-2">
              <Icon name="alert-triangle" className="h-4 w-4 text-amber-700" />
              <span className="font-medium">{c.drug}</span>
              <span className="text-slate-600" dir="ltr">
                {regimenText(c)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Cultures({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const list = b.current.filter((e): e is EntryOf<'culture'> => e.type === 'culture').sort(compareEntries);
  return (
    <Panel icon="microscope" title={t('panel.cultures')} testId="panel-cultures">
      {list.length === 0 ? (
        <Empty>{t('panel.culturesNone')}</Empty>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2">
              <DayLabel day={e.hospitalDay} />
              <span className="font-medium">{e.payload.specimen}</span>
              <span>{e.payload.status.replace(/_/g, ' ')}</span>
              {e.payload.organism && <span className="italic">{e.payload.organism}</span>}
              {e.payload.susceptibility && <span className="text-slate-600">{e.payload.susceptibility}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AntimicrobialDays({ b, fields }: { b: CaseBundle; fields: Record<string, string> }) {
  const { t } = useI18n();
  const abx = b.courses.filter((c) => fields[`applies@${c.medId}`] === 'yes');
  return (
    <Panel icon="clock" title={t('panel.abxDays')} testId="panel-abx-days">
      {abx.length === 0 ? (
        <Empty>{t('panel.abxNone')}</Empty>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {abx.map((c) => {
            const end = c.stopDay ?? b.today;
            const days = end === null || end === undefined ? undefined : end - c.startDay + 1;
            return (
              <li key={c.medId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.drug}</span>
                {days !== undefined && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                    <Num>{c.status === 'active' ? t('panel.dayOfTherapy', { n: days }) : t('panel.daysGiven', { n: days })}</Num>
                  </span>
                )}
                <span className="text-xs text-slate-600">
                  <Num>{c.stopDay === undefined ? t('common.dayOngoing', { a: c.startDay }) : t('common.dayRange', { a: c.startDay, b: c.stopDay })}</Num>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">{t('panel.abxHow')}</p>
    </Panel>
  );
}

function DrugLevels({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const list = b.current
    .filter((e): e is EntryOf<'lab'> => e.type === 'lab' && ANALYTE_BY_ID.get(e.payload.analyte)?.group === 'drug_level')
    .sort(compareEntries);
  return (
    <Panel icon="flask" title={t('panel.drugLevels')} testId="panel-drug-levels">
      {list.length === 0 ? (
        <Empty>{t('panel.levelsNone')}</Empty>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {list.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2">
              <DayLabel day={e.hospitalDay} />
              {e.timeOfDay && <Num>{e.timeOfDay}</Num>}
              <span className="font-medium">{e.payload.analyteName}</span>
              <Num>{labValue(e)}</Num>
            </li>
          ))}
        </ul>
      )}
      <a href={`#/cases/${b.case.id}/entry/new?type=lab`} className="mt-2 inline-flex min-h-touch items-center text-sm font-medium text-teal-900 underline">
        {t('panel.addLevel')}
      </a>
    </Panel>
  );
}

function LabTrends({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const byAnalyte = new Map<string, EntryOf<'lab'>[]>();
  for (const e of [...b.current].sort(compareEntries)) {
    if (e.type !== 'lab' || e.payload.result.kind !== 'numeric') continue;
    const list = byAnalyte.get(e.payload.analyteName) ?? [];
    list.push(e);
    byAnalyte.set(e.payload.analyteName, list);
  }
  return (
    <Panel icon="activity" title={t('panel.labTrends')} testId="panel-lab-trends">
      {byAnalyte.size === 0 ? (
        <Empty>{t('panel.labsNone')}</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {[...byAnalyte.entries()].map(([name, list]) => {
            const last = list.slice(-5);
            return (
              <li key={name} className="flex flex-col gap-1 py-2">
                <span className="text-sm font-medium text-slate-900">{name}</span>
                <span className="flex flex-wrap items-center gap-1 text-xs text-slate-700" dir="ltr">
                  {last.map((e, i) => {
                    const prev = last[i - 1];
                    const a = prev?.payload.result.kind === 'numeric' ? prev.payload.result.value : undefined;
                    const v = e.payload.result.kind === 'numeric' ? e.payload.result.value : undefined;
                    // Direction only — not a judgement of whether the change matters.
                    const arrow = a === undefined || v === undefined ? '' : v > a ? '↑' : v < a ? '↓' : '→';
                    return (
                      <span key={e.id} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5">
                        {arrow && <span aria-hidden="true">{arrow}</span>}
                        <span className="font-medium tabular">{labValue(e)}</span>
                        <span className="text-slate-500">D{e.hospitalDay}</span>
                      </span>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">{t('panel.trendNote')}</p>
    </Panel>
  );
}

function MonitoringDue({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const items = b.itemsOf('monitoring').filter((i) => i.fields.status === 'active');
  const withDay = items.filter((i) => i.fields.nextDay !== undefined);
  const today = b.today;
  const overdue = today === null ? [] : withDay.filter((i) => Number(i.fields.nextDay) < today);
  const due = today === null ? [] : withDay.filter((i) => Number(i.fields.nextDay) === today);
  return (
    <Panel icon="calendar" title={t('panel.monitoringDue')} testId="panel-monitoring-due">
      {items.length === 0 ? (
        <Empty>{t('panel.monitoringNone')}</Empty>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-medium text-rose-800">{t('panel.overdueN', { n: overdue.length })}</span>
            {' · '}
            <span className="font-medium text-saffron-800">{t('panel.dueTodayN', { n: due.length })}</span>
            {' · '}
            <span className="text-slate-700">{t('panel.activeN', { n: items.length })}</span>
          </p>
          {[...overdue, ...due].map((i) => (
            <ItemCard key={i.id} i={i} b={b} taskId="t11" />
          ))}
        </div>
      )}
    </Panel>
  );
}

function RoundsBrief({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const KEY = ['scr', 'k', 'na', 'hb', 'wbc', 'plt', 'crp', 'inr', 'glucose'];
  const latest = KEY.map((id) => b.current.filter((e): e is EntryOf<'lab'> => e.type === 'lab' && e.payload.analyte === id).sort(compareEntries).pop()).filter(
    (e): e is EntryOf<'lab'> => !!e,
  );
  const openDrps = b.itemsOf('drp').filter((d) => d.fields.implemented !== 'yes' && d.fields.response !== 'declined');
  const due = b.itemsOf('monitoring').filter((m) => m.fields.status === 'active' && b.today !== null && m.fields.nextDay !== undefined && Number(m.fields.nextDay) <= b.today);
  return (
    <Panel icon="file-text" title={t('panel.roundsBrief')} testId="panel-rounds-brief">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-semibold text-slate-800">{t('panel.brief.problems')}</dt>
          <dd className="text-slate-700">{b.problems.filter((p) => p.latest.payload.status !== 'resolved').map((p) => `${p.latest.payload.name} (${p.latest.payload.status})`).join(' · ') || '—'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-800">{t('panel.brief.meds')}</dt>
          <dd className="text-slate-700" dir="ltr">
            {b.activeCourses.map((c) => `${c.drug} ${regimenText(c)} (D${b.today !== null ? b.today - c.startDay + 1 : '?'})`).join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-800">{t('panel.brief.labs')}</dt>
          <dd className="text-slate-700" dir="ltr">
            {latest.map((e) => `${e.payload.analyteName} ${labValue(e)} (D${e.hospitalDay})`).join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-800">{t('panel.brief.openDrps', { n: openDrps.length })}</dt>
          <dd className="text-slate-700" dir="auto">
            {openDrps.map((d) => itemTitle(d)).join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-800">{t('panel.brief.due', { n: due.length })}</dt>
          <dd className="text-slate-700" dir="auto">
            {due.map((m) => m.fields.parameter).join(' · ') || '—'}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function Interventions({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const tl = useL();
  const drps = b.itemsOf('drp');
  const communicated = drps.filter((d) => d.fields.response && d.fields.response !== 'not_communicated');
  const accepted = communicated.filter((d) => d.fields.response === 'accepted' || d.fields.response === 'modified');
  const answered = communicated.filter((d) => d.fields.response !== 'awaiting');
  return (
    <Panel icon="briefcase" title={t('panel.interventions')} testId="panel-interventions">
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        {[
          [t('panel.drpCount'), drps.length],
          [t('panel.communicated'), communicated.length],
          [t('panel.accepted'), answered.length ? `${accepted.length}/${answered.length}` : '—'],
        ].map(([k, val]) => (
          <div key={String(k)} className="rounded-xl bg-paper p-2">
            <div className="text-lg font-semibold tabular">{val}</div>
            <div className="text-xs text-slate-600">{k}</div>
          </div>
        ))}
      </div>
      {drps.length === 0 ? (
        <Empty>{t('panel.interventionsNone')}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {drps.map((d) => (
            <ItemCard key={d.id} i={d} b={b} taskId="t18" />
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-600">
        {t('panel.responseLegend')}{' '}
        {[...new Set(drps.map((d) => d.fields.response).filter(Boolean))]
          .map((r) => tl(choiceLabel('drp', 'response', r!)!))
          .join(' · ')}
      </p>
    </Panel>
  );
}

function CarePlan({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const tl = useL();
  const tally = caseTally(b.tasks);
  const open = TASKS.size - tally.complete;
  const openTasks = MODULES.flatMap((m) => m.tasks).filter((id) => {
    const s = statusOf(b.taskById.get(id));
    return s !== 'done' && s !== 'not_applicable';
  });
  const drps = b.itemsOf('drp');
  return (
    <Panel icon="layers" title={t('panel.carePlan')} testId="panel-care-plan">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t('panel.tasksDone'), `${tally.complete}/${tally.total}`],
          [t('panel.problemsActive'), b.problems.filter((p) => p.latest.payload.status !== 'resolved').length],
          [t('panel.drpOpen'), drps.filter((d) => d.fields.implemented !== 'yes' && d.fields.response !== 'declined').length],
          [t('panel.monitoringActive'), b.itemsOf('monitoring').filter((m) => m.fields.status === 'active').length],
        ].map(([k, val]) => (
          <div key={String(k)} className="rounded-xl bg-paper p-2 text-center">
            <div className="text-lg font-semibold tabular">{val}</div>
            <div className="text-xs text-slate-600">{k}</div>
          </div>
        ))}
      </div>
      {open > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-800">{t('panel.openTasks', { n: open })}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {openTasks.map((id) => (
              <li key={id}>
                <a href={`#/cases/${b.case.id}/task/${id}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-xs hover:border-teal-600">
                  <span className="font-semibold tabular">{TASKS.get(id)!.number}</span>
                  <span>{tl(TASKS.get(id)!.title)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <a href={`#/cases/${b.case.id}/form`} className="mt-3 inline-flex min-h-touch items-center gap-1 text-sm font-medium text-teal-900 underline">
        <Icon name="file-text" className="h-4 w-4" />
        {t('panel.openForm')}
      </a>
    </Panel>
  );
}

export function TaskPanels({ def, b, draftFields }: { def: TaskDef; b: CaseBundle; draftFields: Record<string, string> }) {
  const render = (p: PanelId): ReactNode => {
    switch (p) {
      case 'sources':
        return <Sources b={b} />;
      case 'inpatient_meds':
        return <InpatientMeds b={b} />;
      case 'allergies':
        return <Allergies b={b} />;
      case 'no_indication':
        return <NoIndication b={b} />;
      case 'cultures':
        return <Cultures b={b} />;
      case 'antimicrobial_days':
        return <AntimicrobialDays b={b} fields={draftFields} />;
      case 'drug_levels':
        return <DrugLevels b={b} />;
      case 'lab_trends':
        return <LabTrends b={b} />;
      case 'monitoring_due':
        return <MonitoringDue b={b} />;
      case 'rounds_brief':
        return <RoundsBrief b={b} />;
      case 'interventions':
        return <Interventions b={b} />;
      case 'care_plan':
        return <CarePlan b={b} />;
    }
  };
  return (
    <>
      {(def.panels ?? []).map((p) => (
        <div key={p}>{render(p)}</div>
      ))}
    </>
  );
}

