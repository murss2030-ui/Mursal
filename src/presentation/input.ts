/**
 * Reads one case from the store into what the monthly presentation may use:
 * confirmed or typed values only, the Problem Cards that pass the department
 * form's gate, and the trainee's own reflection. De-identified like the
 * Teaching copy.
 */
import type { DeckCard, DeckCase } from '../domain/presentation';
import { cardFormStatus, cardPcne } from '../domain/problem-card';
import { indexTimeline, deriveProblems } from '../domain/timeline';
import { ANALYTE_BY_ID } from '../domain/catalogue';
import { choiceLabel } from '../domain/workflow/registers';
import type { Store } from '../store/store';

const KEY_LABS = ['scr', 'k', 'na', 'hb', 'wbc', 'plt', 'crp', 'inr', 'glucose'];
const VERIFIED = new Set(['user_entered', 'confirmed', 'calculated', 'trainee_decision', 'implemented', 'outcome_documented']);

export async function deckCase(store: Store, caseId: string): Promise<DeckCase | undefined> {
  const c = await store.getCase(caseId);
  if (!c) return undefined;
  const [entries, items, tasks, ctx] = await Promise.all([store.listEntries(caseId), store.listItems(caseId), store.listTasks(caseId), store.cardContext(caseId)]);
  const current = indexTimeline(entries).current.filter((e) => VERIFIED.has(e.provenance));
  const labs = KEY_LABS.flatMap((id) => {
    const e = current.filter((x) => x.type === 'lab' && x.payload.analyte === id).sort((a, b) => a.hospitalDay - b.hospitalDay).at(-1);
    if (!e || e.type !== 'lab' || e.payload.result.kind !== 'numeric') return [];
    return [{ name: ANALYTE_BY_ID.get(id)?.name ?? e.payload.analyteName, value: `${e.payload.result.value} ${e.payload.unit}`, day: e.hospitalDay }];
  });
  const cards: DeckCard[] = [];
  const leftOut: DeckCase['leftOut'] = [];
  for (const item of items.filter((i) => i.register === 'drp' && i.status === 'active')) {
    const f = item.fields;
    const status = cardFormStatus(item, ctx);
    if (status.section8) {
      leftOut.push({ problem: f.problem ?? '', reason: status.section8 });
      continue;
    }
    const p = cardPcne(f);
    cards.push({
      id: item.id,
      problem: f.problem ?? '',
      ...(f.drugs ? { drugs: f.drugs } : {}),
      ...(p.problem ? { pcne: [`${p.problem.code} ${p.problem.label.en}`, p.type, ...p.causes.map((x) => `${x.code} ${x.label.en}`)].filter(Boolean).join(' · ') } : {}),
      ...(f.priority ? { priority: choiceLabel('drp', 'priority', f.priority)?.en ?? f.priority } : {}),
      ...(f.evidence ? { evidence: f.evidence } : {}),
      // A recommendation appears only when the form would take it (final, and every check passed).
      ...(!status.section9 && f.recommendation ? { recommendation: f.recommendation } : {}),
      ...(f.response && f.response !== 'not_communicated' ? { response: choiceLabel('drp', 'response', f.response)?.en ?? f.response } : {}),
      implemented: f.implemented === 'yes',
      outcome: f.goalMet === 'yes' || f.goalMet === 'partly' || f.goalMet === 'no' ? f.goalMet : 'not_measured',
      ...(f.outcome && f.goalMet && f.goalMet !== 'not_measured' ? { outcomeNote: f.outcome } : {}),
      discussedWithPreceptor: f.preceptorReviewed === 'yes',
    });
  }
  const t25 = tasks.find((t) => t.taskId === 't25');
  const learning = t25?.fields.learning?.trim();
  const differently = t25?.fields.differently?.trim();
  return {
    caseId,
    kind: c.kind,
    age: c.demographics.ageYears >= 90 ? '90 or older' : `${c.demographics.ageYears} years`,
    sex: c.demographics.sex,
    problems: deriveProblems(current).filter((p) => p.latest.payload.status !== 'resolved').map((p) => ({ name: p.latest.payload.name, status: p.latest.payload.status })),
    labs,
    cards,
    leftOut,
    monitoring: items
      .filter((i) => i.register === 'monitoring' && i.status === 'active' && i.fields.status === 'active')
      .map((i) => ({ parameter: i.fields.parameter ?? '', target: i.fields.target ?? '', frequency: i.fields.frequency ?? '' })),
    ...(learning || differently ? { reflection: { ...(learning ? { learning } : {}), ...(differently ? { differently } : {}) } } : {}),
  };
}
