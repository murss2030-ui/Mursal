import { choiceLabel, REGISTERS } from '../../domain/workflow/registers';
import type { RegisterId, RegisterItem } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { useL } from '../bilingual';
import type { CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { DayLabel, LinkButton } from '../components/ui';
import { CausalityChips } from '../rules/Causality';
import { CardSummary } from './ProblemsTab';

const CHIP_TONE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-900 border-rose-300',
  important: 'bg-amber-100 text-amber-900 border-amber-300',
  informational: 'bg-slate-100 text-slate-800 border-slate-300',
  contraindicated: 'bg-rose-100 text-rose-900 border-rose-300',
  major: 'bg-rose-50 text-rose-900 border-rose-200',
  moderate: 'bg-amber-50 text-amber-900 border-amber-200',
  unintentional: 'bg-rose-50 text-rose-900 border-rose-200',
  declined: 'bg-slate-100 text-slate-800 border-slate-300',
  accepted: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  modified: 'bg-emerald-50 text-emerald-900 border-emerald-200',
};

/** The heading of a row, in clinical English as entered. */
export function itemTitle(i: RegisterItem): string {
  const f = i.fields;
  if (i.register === 'interaction') return `${f.drugA} + ${f.drugB}`;
  return f[REGISTERS[i.register].titleField] ?? '';
}

function MonitoringDue({ i, today }: { i: RegisterItem; today: number | null }) {
  const { t } = useI18n();
  const day = i.fields.nextDay !== undefined ? Number(i.fields.nextDay) : undefined;
  if (day === undefined || today === null || i.fields.status !== 'active') return null;
  const cls = day < today ? 'bg-rose-100 text-rose-900 border-rose-300' : day === today ? 'bg-saffron-100 text-saffron-900 border-saffron-300' : 'bg-white text-slate-700 border-slate-300';
  const text = day < today ? t('monitor.overdue') : day === today ? t('monitor.dueToday') : t('monitor.upcoming');
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`} data-due={day < today ? 'overdue' : day === today ? 'today' : 'upcoming'}>
      {text} · <DayLabel day={day} />
    </span>
  );
}

export function ItemCard({ i, b, taskId }: { i: RegisterItem; b: CaseBundle; taskId?: string }) {
  const tl = useL();
  const { t } = useI18n();
  const def = REGISTERS[i.register];
  // A drug-related problem is a Problem Card: one view of it everywhere (Section 14).
  const card = i.register === 'drp' ? b.cards.find((c) => c.item.id === i.id) : undefined;
  if (card) return <CardSummary b={b} card={card} taskId={taskId} />;
  const href = `#/cases/${b.case.id}/item/${i.id}${taskId ? `?task=${taskId}` : ''}`;
  const subtitle = def.subtitleFields
    .filter((k) => !(i.register === 'interaction' && k === 'drugB'))
    .map((k) => i.fields[k])
    .filter(Boolean);
  const day = i.fields.day !== undefined ? Number(i.fields.day) : undefined;
  return (
    <a href={href} className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 hover:border-teal-600" data-testid={`item-${i.register}`} data-item={i.id}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-slate-900" dir="auto">
          {day !== undefined && (
            <span className="me-1 font-normal text-slate-600">
              <DayLabel day={day} /> ·
            </span>
          )}
          {itemTitle(i)}
        </span>
        <Icon name="pencil" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      </div>
      {subtitle.length > 0 && (
        <p className="line-clamp-2 text-sm text-slate-700" dir="auto">
          {subtitle.join(' · ')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {def.chipFields.map((k) => {
          const v = i.fields[k];
          if (!v) return null;
          const l = choiceLabel(i.register, k, v);
          return (
            <span key={k} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP_TONE[v] ?? 'border-slate-300 bg-slate-50 text-slate-800'}`}>
              {l ? tl(l) : v}
            </span>
          );
        })}
        {i.register === 'monitoring' && <MonitoringDue i={i} today={b.today} />}
        {i.register === 'adr' && <CausalityChips b={b} item={i} />}
        {i.register === 'home_med' && i.fields.sources && i.fields.sources.split('|').length < 2 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
            <Icon name="alert-triangle" className="h-3.5 w-3.5" />
            {t('item.oneSource')}
          </span>
        )}
      </div>
    </a>
  );
}

export function RegisterList({ b, register, taskId, readOnly }: { b: CaseBundle; register: RegisterId; taskId?: string; readOnly: boolean }) {
  const { t } = useI18n();
  const tl = useL();
  const def = REGISTERS[register];
  // Problem Cards in their rank (owner decision D5), the other lists in the order recorded.
  const active = register === 'drp' ? b.cards.map((c) => c.item) : b.itemsOf(register);
  const retracted = b.allItems.filter((i) => i.register === register && i.status === 'retracted');
  return (
    <section className="surface flex flex-col gap-3 p-4" data-testid={`register-${register}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          {tl(def.title)} <span className="text-sm font-normal text-slate-600">({active.length})</span>
        </h2>
        {!readOnly && (
          <LinkButton href={`#/cases/${b.case.id}/item/new/${register}${taskId ? `?task=${taskId}` : ''}`} icon="plus" variant="secondary">
            {t('item.add', { noun: tl(def.noun) })}
          </LinkButton>
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-slate-600">{t('item.none')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {active.map((i) => (
            <ItemCard key={i.id} i={i} b={b} taskId={taskId} />
          ))}
        </div>
      )}
      {retracted.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-touch cursor-pointer py-2 text-slate-700">{t('item.retractedN', { n: retracted.length })}</summary>
          <ul className="flex flex-col gap-1">
            {retracted.map((i) => (
              <li key={i.id}>
                <a href={`#/cases/${b.case.id}/${register === 'drp' ? 'card' : 'item'}/${i.id}${taskId ? `?task=${taskId}` : ''}`} className="text-slate-600 line-through" dir="auto">
                  {itemTitle(i)}
                </a>
                {i.changeReason && <span className="ms-2 text-xs text-slate-600">— {i.changeReason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
