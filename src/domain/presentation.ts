/**
 * The monthly presentation (plan M7; Task 30: "the monthly presentation,
 * assembled from the verified record"). A deck is built from what the
 * department form would accept — the same gate as Sections 8 and 9 — and from
 * nothing else: a Problem Card that is stale, undecided, waiting for evidence
 * or review, or whose drafted claims are not supported is left out (and
 * counted in the builder, never shown on a slide); a value read by the model
 * and not confirmed, or a model suggestion, is never used. It is
 * de-identified like the Teaching copy: ages, hospital days, no names.
 *
 * Nothing in a slide claims more than the record does: a recommendation is
 * "Proposed" unless the trainee recorded it as implemented, and an outcome is
 * "Not measured" unless the trainee measured it. Counts are shown with their
 * denominators. The deck says it is a trainee's presentation and replaces no
 * clinical pharmacist.
 */
import type { FormLabel } from './form/spec';
import type { FormExclusion } from './problem-card';

export interface DeckCard {
  id: string;
  problem: string;
  drugs?: string;
  /** "P2.1 Adverse drug event (possibly) occurring · potential · C3.2 Drug dose of a single active ingredient too high" */
  pcne?: string;
  priority?: string;
  evidence?: string;
  /** Only a final recommendation of a card that passed the gate. */
  recommendation?: string;
  response?: string;
  implemented: boolean;
  outcome: 'not_measured' | 'yes' | 'partly' | 'no';
  outcomeNote?: string;
  discussedWithPreceptor: boolean;
}

export interface DeckCase {
  caseId: string;
  kind: 'teaching' | 'clinical';
  age: string;
  sex: string;
  problems: { name: string; status: string }[];
  labs: { name: string; value: string; day: number }[];
  cards: DeckCard[];
  /** Cards the gate left out, by why: counted in the builder, never on a slide. */
  leftOut: { problem: string; reason: FormExclusion }[];
  monitoring: { parameter: string; target: string; frequency: string }[];
  reflection?: { learning?: string; differently?: string };
}

export type SlideKind = 'title' | 'case' | 'card' | 'monitoring' | 'learning' | 'statistics' | 'references' | 'closing';

export interface Slide {
  kind: SlideKind;
  title: FormLabel;
  /** The case a slide is about (its id, never a name). */
  caseId?: string;
  bullets: string[];
  table?: { columns: string[]; rows: string[][] };
}

export interface Deck {
  title: string;
  slides: Slide[];
  /** What was left out and why, for the builder screen. */
  notIncluded: { caseId: string; problem: string; reason: FormExclusion }[];
  counts: { cases: number; cards: number };
}

const L = (en: string, ar: string): FormLabel => ({ en, ar });

const pct = (n: number, d: number) => (d > 0 ? `${n} of ${d}` : '—');

export interface DeckOptions {
  rotationLabel: string;
  period: string;
  today: string;
  appVersion: string;
  cases: readonly DeckCase[];
}

export function buildDeck(o: DeckOptions): Deck {
  const slides: Slide[] = [];
  const cards = o.cases.flatMap((c) => c.cards.map((card) => ({ c, card })));
  slides.push({
    kind: 'title',
    title: L('Monthly clinical pharmacy presentation', 'العرض الشهري للصيدلة السريرية'),
    bullets: [o.rotationLabel, o.period, `${o.cases.length} case(s) · ${cards.length} Problem Card(s) that passed every check`, `Prepared by a clinical pharmacy trainee under supervision — ${o.today}`],
  });

  for (const c of o.cases) {
    slides.push({
      kind: 'case',
      caseId: c.caseId,
      title: L(`Case ${c.caseId}`, `الحالة ${c.caseId}`),
      bullets: [
        `${c.age}, ${c.sex === 'F' ? 'female' : 'male'}${c.kind === 'teaching' ? ' · Teaching Case' : ''}`,
        ...(c.problems.length ? [`Problems: ${c.problems.map((p) => `${p.name} (${p.status})`).join('; ')}`] : ['No problem recorded']),
        ...(c.labs.length ? [`Latest verified values: ${c.labs.map((l) => `${l.name} ${l.value} (Day ${l.day})`).join('; ')}`] : []),
      ],
    });
    for (const card of c.cards) {
      slides.push({
        kind: 'card',
        caseId: c.caseId,
        title: L(card.problem, card.problem),
        bullets: [
          ...(card.drugs ? [`Medication(s): ${card.drugs}`] : []),
          ...(card.pcne ? [`PCNE V9.1: ${card.pcne}`] : []),
          ...(card.priority ? [`Priority: ${card.priority}`] : []),
          ...(card.evidence ? [`Evidence: ${card.evidence}`] : []),
          card.recommendation ? `${card.implemented ? 'Recommendation (implemented)' : 'Recommendation (proposed)'}: ${card.recommendation}` : 'No final recommendation yet',
          `Team response: ${card.response ?? 'Not communicated yet'}`,
          `Outcome: ${card.outcome === 'not_measured' ? 'Not measured yet' : card.outcome === 'yes' ? 'Goal met' : card.outcome === 'partly' ? 'Goal partly met' : 'Goal not met'}${card.outcomeNote ? ` — ${card.outcomeNote}` : ''}`,
          card.discussedWithPreceptor ? 'Discussed with my preceptor' : 'Not yet discussed with my preceptor',
        ],
      });
    }
    if (c.monitoring.length) {
      slides.push({ kind: 'monitoring', caseId: c.caseId, title: L(`Monitoring plan — ${c.caseId}`, `خطة المراقبة — ${c.caseId}`), bullets: [], table: { columns: ['Parameter', 'Target', 'Frequency'], rows: c.monitoring.map((m) => [m.parameter, m.target, m.frequency]) } });
    }
    if (c.reflection?.learning || c.reflection?.differently) {
      slides.push({
        kind: 'learning',
        caseId: c.caseId,
        title: L(`What I learned — ${c.caseId}`, `ما تعلّمته — ${c.caseId}`),
        bullets: [...(c.reflection.learning ? [`Learning: ${c.reflection.learning}`] : []), ...(c.reflection.differently ? [`I would do differently: ${c.reflection.differently}`] : [])],
      });
    }
  }

  // Counts only of what was recorded, each with its denominator.
  const n = cards.length;
  const by = <K extends string>(f: (x: DeckCard) => K) => {
    const m = new Map<K, number>();
    for (const { card } of cards) m.set(f(card), (m.get(f(card)) ?? 0) + 1);
    return m;
  };
  const answered = cards.filter(({ card }) => card.response && card.response !== 'Not communicated yet');
  const measured = cards.filter(({ card }) => card.outcome !== 'not_measured');
  slides.push({
    kind: 'statistics',
    title: L('The month in numbers', 'الشهر بالأرقام'),
    bullets: [
      `Cases presented: ${o.cases.length}`,
      `Problem Cards that passed every check: ${n}`,
      `Recommendations communicated and answered by the team: ${pct(answered.length, n)}`,
      `Recommendations recorded as implemented: ${pct(cards.filter(({ card }) => card.implemented).length, n)}`,
      `Outcome measured: ${pct(measured.length, n)} (goal met ${measured.filter(({ card }) => card.outcome === 'yes').length}, partly ${measured.filter(({ card }) => card.outcome === 'partly').length}, not met ${measured.filter(({ card }) => card.outcome === 'no').length})`,
    ],
    table: n
      ? {
          columns: ['Priority', 'Cards'],
          rows: [...by((c) => (c.priority ?? 'Not set') as string)].map(([k, v]) => [k, String(v)]),
        }
      : undefined,
  });
  slides.push({
    kind: 'closing',
    title: L('About this presentation', 'عن هذا العرض'),
    bullets: [
      'Assembled only from the verified record: nothing unverified, stale or undecided is shown.',
      'A recommendation is proposed until the trainee records it as implemented; an outcome is not measured until the trainee measures it.',
      'Prepared by a trainee under supervision. It does not replace a clinical pharmacist and is not for clinical decisions.',
      `Generated by PRECEPTOR ${o.appVersion}. Nothing was sent to the care team.`,
    ],
  });
  return {
    title: `${o.rotationLabel} — ${o.period}`,
    slides,
    notIncluded: o.cases.flatMap((c) => c.leftOut.map((x) => ({ caseId: c.caseId, ...x }))),
    counts: { cases: o.cases.length, cards: n },
  };
}

export function deckText(d: Deck): string {
  return d.slides
    .map((s, i) => [`${i + 1}. ${s.title.en}`, ...s.bullets.map((b) => `  - ${b}`), ...(s.table ? [`  | ${s.table.columns.join(' | ')} |`, ...s.table.rows.map((r) => `  | ${r.join(' | ')} |`)] : [])].join('\n'))
    .join('\n\n');
}

export async function hashDeck(d: Deck): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deckText(d))));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
