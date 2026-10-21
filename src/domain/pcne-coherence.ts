/**
 * Whether a Problem Card's PCNE classification agrees with the card's own
 * problem statement, checked in code against the official wording of PCNE
 * V9.1 (owner decision of 21 October 2026). In the live probe of 20 October,
 * 3 of 8 drafted cards contradicted themselves: "Risk of metformin-associated
 * lactic acidosis" with the cause C3.1 Drug dose too low; "Potential
 * nephrotoxicity" classed as a manifest problem; "High risk of digoxin
 * toxicity due to elevated levels" with C3.1 again.
 *
 * The check reads the problem sentence (field 1) — what the classification
 * classifies — and the codes. Each question names the codes and the words
 * that disagree. The trainee corrects the codes or the sentence, or says why
 * both hold (the field classificationReason, which the model never writes);
 * a card is not saved, accepted or entered in the department form with an
 * open question and no reason.
 *
 * The rules are lexical and deliberately narrow. Each fires only on a pairing
 * that PCNE's own definitions exclude — P1 is the (lack of) effect of
 * treatment, P2 an adverse drug event; C3.1 a dose too low, C3.2 too high; a
 * potential problem may occur, a manifest one has — and stays silent when the
 * sentence also carries words that explain the pairing (a subtherapeutic
 * level, a withdrawal effect, a failed treatment).
 */
import { L } from './label';
import { PCNE_CODE } from './pcne';

export const COHERENCE_RULES = [
  /** A cause meaning "too little drug" for a problem of harm from the drug. */
  'low_cause_for_harm',
  /** A cause meaning "too much drug" for a problem of lacking effect. */
  'high_cause_for_no_effect',
  /** P1.1 or P1.2 (effect of treatment) for a problem of harm from the drug. */
  'effect_problem_for_harm',
  /** P2.1 (adverse drug event) for a problem of lacking effect. */
  'safety_problem_for_no_effect',
  'manifest_but_risk',
  'potential_but_occurred',
  /** C1.3 (inappropriate combination) on a card that names one drug. */
  'combination_one_drug',
  /** Two codes that say opposite things. */
  'codes_contradict',
] as const;
export type CoherenceRule = (typeof COHERENCE_RULES)[number];

export interface CoherenceIssue {
  rule: CoherenceRule;
  /** The codes concerned. */
  codes: string[];
  /** The words of the problem sentence that the codes contradict, as written. */
  words: string[];
  message: L;
}

/** Causes that mean too little of the drug reaches the patient. */
const LOW_CAUSES = ['C3.1', 'C3.3', 'C4.1', 'C6.2', 'C7.1'];
/** Causes that mean too much of it. */
const HIGH_CAUSES = ['C3.2', 'C3.4', 'C4.2', 'C6.3', 'C7.2', 'C7.3'];
/** Codes that cannot both hold for one drug, and codes that cannot both hold at all. */
const OPPOSITE_FOR_ONE_DRUG: readonly [string, string][] = [
  ['C3.1', 'C3.2'],
  ['C3.3', 'C3.4'],
  ['C4.1', 'C4.2'],
];
const OPPOSITE: readonly [string, string][] = [
  ['P3.1', 'C1.5'],
  ['P1.3', 'C1.2'],
];

const words = (...parts: string[]) => new RegExp(`\\b(?:${parts.join('|')})\\b`, 'gi');

/** Harm from the drug, or too much of it. */
const HARM = words(
  '\\w*toxic\\w*',
  'overdos\\w*',
  'supra-?therapeutic',
  'accumulat\\w*',
  'lactic acidosis',
  'bleed\\w*',
  'ha?emorrhag\\w*',
  'adverse(?: drug)? (?:event|reaction|effect)s?',
  'side[- ]effects?',
  'hypoglyc\\w*',
  'hyperkal\\w*',
  'qtc?[- ](?:interval )?prolong\\w*',
  'prolonged qtc?',
  'serotonin syndrome',
  'respiratory depression',
  'over-?sedat\\w*',
  '\\w+-induced',
  'too high',
  'excessive\\w*',
  'elevated (?:\\w+ )?(?:levels?|concentrations?|troughs?|inr)',
  'high (?:\\w+ )?(?:levels?|concentrations?|troughs?)',
  'above (?:the )?(?:target|therapeutic|reference|goal) (?:range|level)',
);
/** Too much of the drug, said without naming a harm. */
const HIGH = words('over-?us\\w*', 'misus\\w*', 'abus\\w*', 'too (?:frequent\\w*|often|long)', 'prolonged (?:course|duration|use|therapy)');
/** Too little of the drug. */
const LOW = words(
  'too low',
  'sub-?therapeutic',
  'under-?dos\\w*',
  'insufficient\\w*',
  'inadequate (?:\\w+ )?(?:dose|doses|dosing|levels?|troughs?|concentrations?|coverage|anticoagulation|prophylaxis)',
  'low(?:-| )(?:\\w+ )?(?:dose|doses|dosing|levels?|troughs?|concentrations?)',
  'below (?:the )?(?:target|therapeutic|reference|goal)',
  '(?:missed|omitted) doses?',
  'omission',
  'not (?:been )?(?:given|administered|taken)',
  'non-?adheren\\w*',
  'not adherent',
  'stopped taking',
);
/** Harm from stopping or lowering a drug. */
const WITHDRAWAL = words('withdrawal', 'rebound', 'discontinuation syndrome', 'abrupt\\w*');
/** A lack of effect, said plainly: these turn a rule on. */
const NO_EFFECT = words(
  'ineffective\\w*',
  'not effective',
  'no (?:\\w+ )?(?:effect|response|improvement)',
  'lack of (?:\\w+ )?(?:effect|response|efficacy|control|improvement)',
  'uncontrolled',
  '(?:poorly|inadequately|not) controlled',
  'inadequate control',
  'treatment failure',
  'failure of (?:\\w+ )?(?:therapy|treatment)',
  'refractory',
  'resistant',
  'not (?:at|achieving|reaching) (?:the )?(?:goal|target)',
  'sub-?optimal\\w*',
  'not optimal',
  'sub-?therapeutic',
  'unresponsive',
  'not responding',
  'non-?respon\\w*',
);
/** A treatment that failed to prevent something: it keeps the effect rule off ("bleeding despite tranexamic acid"). */
const EFFECT_HINT = words('despite', 'in spite of');
/** The sentence leads with a risk: what it describes has not happened. */
const RISK_LEAD =
  /^\s*(?:(?:the\s+)?(?:patient|pt)\s+(?:is\s+)?)?(?:(?:a|an|the)\s+)?(?:(?:very\s+)?(?:high|higher|increased|elevated|significant|substantial|moderate|serious)\s+)?(?:risk\s+(?:of|for)|potential(?:ly)?|at\s+(?:\w+\s+)?risk(?:\s+(?:of|for))?)\b/i;
/** What has happened. */
const OCCURRED = words('has developed', 'developed', 'has occurred', 'occurred', 'experienced', 'experiencing', 'presented with', 'presents with', 'has had', 'suffered', 'episodes? of', 'documented', 'confirmed', 'observed');
/** A combination said in words, beside the codes. */
const COMBINATION = words('interact\\w*', 'combin\\w*', 'concomitant\\w*', 'co-?administ\\w*', 'together', 'herbal', 'supplements?', 'food', 'grapefruit', 'alcohol');

/** "no bleeding", "without signs of toxicity": a negated word is not an assertion. */
const NEGATED = /\b(?:no|not|without|denies|denied|absence of|negative for|free of|resolved)\s+(?:\S+\s+){0,2}$/i;

function found(re: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    if (NEGATED.test(text.slice(Math.max(0, m.index! - 40), m.index!))) continue;
    if (!out.some((x) => x.toLowerCase() === m[0].toLowerCase())) out.push(m[0]);
  }
  return out;
}

/** The drugs a card names in "Medication(s) involved"; undefined when it names none. */
export function namedDrugs(drugs: string | undefined): string[] | undefined {
  const parts = (drugs ?? '')
    .split(/\s*(?:,|;|\/|\+|&|\band\b|\bwith\b|\bplus\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

const codeText = (code: string): string => `${code} ${PCNE_CODE.get(code)?.label.en ?? ''}`.trim();
const codeList = (codes: readonly string[]): string => codes.map(codeText).join('; ');
const quoted = (ws: readonly string[]): string => ws.map((w) => `"${w}"`).join(', ');

/**
 * The questions PRECEPTOR asks of a card's classification, from its fields
 * (problem, drugs, pcneProblem, pcneType, pcneCauses). None when the card has
 * no PCNE problem code.
 */
export function pcneCoherence(fields: Readonly<Record<string, string>>): CoherenceIssue[] {
  const problem = fields.pcneProblem && PCNE_CODE.has(fields.pcneProblem) ? fields.pcneProblem : undefined;
  if (!problem) return [];
  const causes = (fields.pcneCauses ?? '').split('|').filter((c) => PCNE_CODE.has(c));
  const type = fields.pcneType;
  const text = (fields.problem ?? '').replace(/\s+/g, ' ').trim();
  const harm = found(HARM, text);
  const high = found(HIGH, text);
  const low = found(LOW, text);
  const withdrawal = found(WITHDRAWAL, text);
  const noEffect = found(NO_EFFECT, text);
  const effectHint = found(EFFECT_HINT, text);
  const drugs = namedDrugs(fields.drugs);
  const oneDrug = (drugs?.length ?? 0) <= 1;
  const issues: CoherenceIssue[] = [];
  const add = (rule: CoherenceRule, codes: string[], ws: string[], en: string, ar: string) => issues.push({ rule, codes, words: ws, message: L(en, ar) });

  const lowCauses = causes.filter((c) => LOW_CAUSES.includes(c));
  if (lowCauses.length && harm.length && !low.length && !withdrawal.length)
    add(
      'low_cause_for_harm',
      lowCauses,
      harm,
      `The cause ${codeList(lowCauses)} says the patient gets too little of the drug, but the problem describes harm from the drug (${quoted(harm)}). Check the cause, or say why both apply.`,
      `السبب ${codeList(lowCauses)} يعني أن المريض يحصل على أقل من اللازم من الدواء، لكن المشكلة تصف ضرراً من الدواء (${quoted(harm)}). راجع السبب، أو اذكر لماذا ينطبق الأمران معاً.`,
    );

  const highCauses = causes.filter((c) => HIGH_CAUSES.includes(c));
  if (highCauses.length && (problem === 'P1.1' || noEffect.length) && !harm.length && !high.length) {
    const what = noEffect.length ? quoted(noEffect) : codeText(problem);
    add(
      'high_cause_for_no_effect',
      [...highCauses, ...(noEffect.length ? [] : [problem])],
      noEffect,
      `The cause ${codeList(highCauses)} says the patient gets too much of the drug, but the problem describes a lack of effect (${what}). Check the cause, or say why both apply.`,
      `السبب ${codeList(highCauses)} يعني أن المريض يحصل على أكثر من اللازم من الدواء، لكن المشكلة تصف نقصاً في الأثر (${what}). راجع السبب، أو اذكر لماذا ينطبق الأمران معاً.`,
    );
  }

  if ((problem === 'P1.1' || problem === 'P1.2') && harm.length && !noEffect.length && !effectHint.length && !low.length)
    add(
      'effect_problem_for_harm',
      [problem],
      harm,
      `${codeText(problem)} is about the effect of treatment, but the problem describes harm from the drug (${quoted(harm)}); in PCNE an adverse drug event is P2.1. Check the problem code, or say why.`,
      `${codeText(problem)} يتعلق بأثر العلاج، لكن المشكلة تصف ضرراً من الدواء (${quoted(harm)})؛ والحدث الدوائي الضار في PCNE هو P2.1. راجع رمز المشكلة، أو اذكر السبب.`,
    );

  if (problem === 'P2.1' && noEffect.length && !harm.length && !withdrawal.length)
    add(
      'safety_problem_for_no_effect',
      [problem],
      noEffect,
      `${codeText(problem)} is about harm from a drug, but the problem describes a lack of effect (${quoted(noEffect)}); in PCNE that is P1, Treatment effectiveness. Check the problem code, or say why.`,
      `${codeText(problem)} يتعلق بضرر من الدواء، لكن المشكلة تصف نقصاً في الأثر (${quoted(noEffect)})؛ وهذا في PCNE ضمن P1 فعالية العلاج. راجع رمز المشكلة، أو اذكر السبب.`,
    );

  const risk = RISK_LEAD.exec(text)?.[0].trim();
  const occurred = found(OCCURRED, text);
  if (type === 'manifest' && risk && !occurred.length)
    add(
      'manifest_but_risk',
      [problem],
      [risk],
      `The problem is classed as manifest, but it is written as a risk (${quoted([risk])}); in PCNE a potential problem is one that may occur. Check potential or manifest, or say why.`,
      `صُنّفت المشكلة كقائمة، لكنها مكتوبة كخطر (${quoted([risk])})؛ والمشكلة المحتملة في PCNE هي ما قد يحدث. راجع «محتملة أم قائمة»، أو اذكر السبب.`,
    );
  if (type === 'potential' && occurred.length && !risk)
    add(
      'potential_but_occurred',
      [problem],
      occurred,
      `The problem is classed as potential, but it is written as having happened (${quoted(occurred)}). Check potential or manifest, or say why.`,
      `صُنّفت المشكلة كمحتملة، لكنها مكتوبة كأمر حدث فعلاً (${quoted(occurred)}). راجع «محتملة أم قائمة»، أو اذكر السبب.`,
    );

  if (causes.includes('C1.3') && drugs && oneDrug && !found(COMBINATION, text).length)
    add(
      'combination_one_drug',
      ['C1.3'],
      [],
      `${codeText('C1.3')}: the card names one drug. Name the other in "Medication(s) involved", or check the cause.`,
      `${codeText('C1.3')}: تذكر البطاقة دواءً واحداً. اذكر الآخر في «الدواء أو الأدوية المعنية»، أو راجع السبب.`,
    );

  const codes = new Set([problem, ...causes]);
  for (const [a, b] of OPPOSITE)
    if (codes.has(a) && codes.has(b))
      add('codes_contradict', [a, b], [], `${codeText(a)} and ${codeText(b)} say opposite things. Check the codes, or say why both apply.`, `${codeText(a)} و${codeText(b)} متعارضان. راجع الرموز، أو اذكر لماذا ينطبقان معاً.`);
  if (oneDrug)
    for (const [a, b] of OPPOSITE_FOR_ONE_DRUG)
      if (codes.has(a) && codes.has(b))
        add(
          'codes_contradict',
          [a, b],
          [],
          `${codeText(a)} and ${codeText(b)} say opposite things for one drug. Check the codes, or say why both apply (for example, a loading dose and a maintenance dose).`,
          `${codeText(a)} و${codeText(b)} متعارضان لدواء واحد. راجع الرموز، أو اذكر لماذا ينطبقان معاً (مثل جرعة تحميل وجرعة صيانة).`,
        );
  return issues;
}

/** Whether the card's classification has a question that its classificationReason does not answer. */
export const classificationUnanswered = (fields: Readonly<Record<string, string>>): boolean => !fields.classificationReason?.trim() && pcneCoherence(fields).length > 0;
