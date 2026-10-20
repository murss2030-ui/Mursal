/**
 * The two mappings derived from a card's PCNE codes (Section 14). They are
 * never stored as the record: the PCNE codes are.
 *
 * 1. The department form's Section 8 checkboxes (Section 15): a fixed map
 *    from each PCNE problem and cause code to one box. A code with no clean
 *    box maps to "other", and its PCNE wording is written in the form's
 *    free-text field. The card's boxes are its causes' boxes; the problem's
 *    box is added when the causes give none but "other" — so "effect not
 *    optimal" caused by a low dose ticks "dose too low", not also
 *    "ineffective therapy". The trainee can adjust the boxes before export.
 * 2. Cipolle, Strand and Morley's seven categories: a teaching view only,
 *    labelled as a mapping — the two systems are not equivalent. A cause may
 *    map differently by problem domain (an interaction that lowers the
 *    effect is "dosage too low"; one that harms is "adverse drug
 *    reaction"); several candidates resolve in Cipolle's own order of
 *    assessment (indication, effectiveness, safety, adherence).
 *
 * Both tables are a DRAFT for the owner's review (20 October 2026).
 */
import { L } from './label';
import { PCNE_CODE } from './pcne';
import type { DrpCategory } from './workflow/registers';

/** Until the owner approves the tables, every screen showing a mapped result says it is a draft. */
export const PCNE_MAPS_APPROVED = false;
export const PCNE_MAPS_DRAFT = L(
  'Draft mapping (20 October 2026), waiting for the department’s approval: check the boxes yourself.',
  'ربط مبدئي (20 أكتوبر 2026) بانتظار اعتماد القسم: تحقّق من المربعات بنفسك.',
);

// ---------------------------------------------------------------- 1. the form's Section 8 checkboxes

/** `problem`: this cause names no kind of problem of its own; the problem's box is used (C9.3, no obvious cause). */
export type BoxTarget = DrpCategory | 'problem';

export interface BoxRule {
  box: BoxTarget;
  /** Why, where the choice is a judgement, for the reviewer. */
  why?: string;
  /** A choice the owner is asked to confirm explicitly. */
  decide?: true;
}

export const PCNE_TO_FORM_BOX: Readonly<Record<string, BoxRule>> = {
  'P1.1': { box: 'ineffective' },
  'P1.2': { box: 'ineffective', why: 'Effect not optimal. Used only when no cause gives a more specific box (a low dose ticks "dose too low" instead).' },
  'P1.3': { box: 'additional_therapy' },
  'P2.1': { box: 'adr', why: 'Used only when no cause gives a more specific box (a dose too high or an interaction is ticked instead).' },
  'P3.1': { box: 'unnecessary' },
  'P3.2': { box: 'other', why: 'An unclear problem has no box.' },
  'C1.1': { box: 'other', why: 'Says the drug is inappropriate, not what kind of problem follows: the problem’s box is ticked too, and this wording goes under "other".' },
  'C1.2': { box: 'unnecessary' },
  'C1.3': { box: 'interaction' },
  'C1.4': { box: 'unnecessary', why: 'A duplicate drug is an unnecessary one.' },
  'C1.5': { box: 'additional_therapy' },
  'C1.6': { box: 'unnecessary', why: 'More drugs than the indication needs.' },
  'C2.1': { box: 'other', why: 'The form has no box for the drug form.' },
  'C3.1': { box: 'dose_low' },
  'C3.2': { box: 'dose_high' },
  'C3.3': { box: 'dose_low', why: 'Not frequent enough: too little drug over the day.' },
  'C3.4': { box: 'dose_high', why: 'Too frequent: too much drug over the day.' },
  'C3.5': { box: 'other', why: 'Timing instructions have no box.' },
  'C4.1': { box: 'dose_low', why: 'Cipolle counts a wrong duration under dosage. The alternative is "other".', decide: true },
  'C4.2': { box: 'dose_high', why: 'As C4.1. The alternative is "other".', decide: true },
  'C5.1': { box: 'other', why: 'Unavailability is not the patient’s non-adherence.' },
  'C5.2': { box: 'other' },
  'C5.3': { box: 'other' },
  'C5.4': { box: 'other' },
  'C6.1': { box: 'other' },
  'C6.2': { box: 'dose_low', why: 'Under-administered: the patient received less than prescribed.', decide: true },
  'C6.3': { box: 'dose_high', why: 'Over-administered: the patient received more than prescribed.', decide: true },
  'C6.4': { box: 'other', why: 'An administration error; no box.' },
  'C6.5': { box: 'other' },
  'C6.6': { box: 'other' },
  'C7.1': { box: 'nonadherence' },
  'C7.2': { box: 'nonadherence', why: 'Taking more than prescribed. The alternative is "dose too high".', decide: true },
  'C7.3': { box: 'unnecessary', why: 'Cipolle files addiction and recreational use under unnecessary drug therapy. The alternative is "non-adherence".', decide: true },
  'C7.4': { box: 'unnecessary' },
  'C7.5': { box: 'interaction', why: 'A food–drug interaction.', decide: true },
  'C7.6': { box: 'other' },
  'C7.7': { box: 'nonadherence' },
  'C7.8': { box: 'nonadherence' },
  'C7.9': { box: 'nonadherence', why: 'Cipolle counts inability to use the drug under non-adherence.', decide: true },
  'C7.10': { box: 'nonadherence', why: 'As C7.9.', decide: true },
  'C8.1': { box: 'other', why: 'Medication reconciliation has no box.' },
  'C9.1': { box: 'monitoring' },
  'C9.2': { box: 'other' },
  'C9.3': { box: 'problem', why: 'No obvious cause: the problem’s box only.' },
};

/** The form's boxes, in the form's order. */
const BOX_ORDER: readonly DrpCategory[] = ['unnecessary', 'additional_therapy', 'ineffective', 'dose_low', 'dose_high', 'adr', 'interaction', 'nonadherence', 'monitoring', 'other'];

export interface FormBoxes {
  boxes: DrpCategory[];
  /** The PCNE wording written under "other", one line per code that mapped there. */
  otherText: string[];
}

/** The boxes a card's PCNE codes pre-tick (Section 15: the trainee may adjust them before export). */
export function formBoxesFor(problem: string | undefined, causes: readonly string[]): FormBoxes {
  const boxes = new Set<DrpCategory>();
  const other: string[] = [];
  const add = (code: string) => {
    const box = PCNE_TO_FORM_BOX[code]?.box;
    if (!box || box === 'problem') return;
    boxes.add(box);
    if (box === 'other') other.push(`${code} ${PCNE_CODE.get(code)!.label.en}`);
  };
  for (const code of causes) add(code);
  // The problem's box when the causes name no specific kind of problem.
  if (problem && ![...boxes].some((b) => b !== 'other')) add(problem);
  return { boxes: BOX_ORDER.filter((b) => boxes.has(b)), otherText: other };
}

// ---------------------------------------------------------------- 2. Cipolle, Strand and Morley (teaching view)

export const CIPOLLE_CITATION =
  'Cipolle RJ, Strand LM, Morley PC. Pharmaceutical Care Practice: The Patient-Centered Approach to Medication Management. 3rd ed. New York: McGraw-Hill; 2012.';

export const CIPOLLE_NOT_EQUIVALENT = L(
  'A mapping, for teaching: PCNE and Cipolle, Strand and Morley classify drug-related problems differently, and the two are not equivalent. The PCNE code is the record.',
  'ربط لأغراض التعليم فقط: يصنّف PCNE ونظام Cipolle وStrand وMorley المشكلات الدوائية بطريقتين مختلفتين، والنظامان غير متكافئين. رمز PCNE هو السجل المعتمد.',
);

export type CipolleNeed = 'indication' | 'effectiveness' | 'safety' | 'adherence';
export type CipolleId = 'unnecessary' | 'additional' | 'ineffective' | 'dose_low' | 'adr' | 'dose_high' | 'nonadherence';

export interface CipolleCategory {
  id: CipolleId;
  need: CipolleNeed;
  label: L;
}

/** The seven categories, in Cipolle's order of assessment. */
export const CIPOLLE_CATEGORIES: readonly CipolleCategory[] = [
  { id: 'unnecessary', need: 'indication', label: L('Unnecessary drug therapy', 'علاج دوائي غير ضروري') },
  { id: 'additional', need: 'indication', label: L('Needs additional drug therapy', 'الحاجة إلى علاج دوائي إضافي') },
  { id: 'ineffective', need: 'effectiveness', label: L('Ineffective drug', 'دواء غير فعّال') },
  { id: 'dose_low', need: 'effectiveness', label: L('Dosage too low', 'جرعة منخفضة جداً') },
  { id: 'adr', need: 'safety', label: L('Adverse drug reaction', 'تفاعل دوائي ضار') },
  { id: 'dose_high', need: 'safety', label: L('Dosage too high', 'جرعة مرتفعة جداً') },
  { id: 'nonadherence', need: 'adherence', label: L('Nonadherence', 'عدم الالتزام') },
];

/** `none`: no Cipolle equivalent. `problem`: this cause decides nothing; the problem's category is used. */
type CipolleTarget = CipolleId | 'none' | 'problem';
export type CipolleRuleTo = CipolleTarget | { P1: CipolleTarget; P2: CipolleTarget; P3: CipolleTarget };

export interface CipolleRule {
  to: CipolleRuleTo;
  why?: string;
}

export const PCNE_TO_CIPOLLE: Readonly<Record<string, CipolleRule>> = {
  'P1.1': { to: 'ineffective' },
  'P1.2': { to: 'ineffective', why: 'Used when no cause decides (a low dose makes it "dosage too low").' },
  'P1.3': { to: 'additional' },
  'P2.1': { to: 'adr', why: 'Used when no cause decides (a dose too high makes it "dosage too high").' },
  'P3.1': { to: 'unnecessary' },
  'P3.2': { to: 'none' },
  'C1.1': {
    to: { P1: 'ineffective', P2: 'adr', P3: 'unnecessary' },
    why: 'A more effective drug exists → ineffective drug; a drug unsafe for this patient → adverse drug reaction; a drug without a place in the guidelines → unnecessary drug therapy.',
  },
  'C1.2': { to: 'unnecessary' },
  'C1.3': {
    to: { P1: 'dose_low', P2: 'adr', P3: 'none' },
    why: 'An interaction that lowers the effect → dosage too low; one that harms → adverse drug reaction (Cipolle files a level raised by an interaction under dosage too high, which the codes cannot tell apart).',
  },
  'C1.4': { to: 'unnecessary' },
  'C1.5': { to: 'additional' },
  'C1.6': { to: 'unnecessary' },
  'C2.1': { to: { P1: 'ineffective', P2: 'adr', P3: 'none' }, why: 'An inappropriate dosage form.' },
  'C3.1': { to: 'dose_low' },
  'C3.2': { to: 'dose_high' },
  'C3.3': { to: 'dose_low' },
  'C3.4': { to: 'dose_high' },
  'C3.5': { to: 'problem' },
  'C4.1': { to: 'dose_low', why: 'Cipolle counts a duration too short under dosage too low.' },
  'C4.2': { to: 'dose_high', why: 'Cipolle counts a duration too long under dosage too high.' },
  'C5.1': { to: 'nonadherence', why: 'Cipolle lists a drug product that is not available among the causes of nonadherence.' },
  'C5.2': { to: 'problem' },
  'C5.3': { to: 'problem' },
  'C5.4': { to: 'problem' },
  'C6.1': { to: 'problem' },
  'C6.2': { to: 'dose_low' },
  'C6.3': { to: 'dose_high' },
  'C6.4': { to: 'problem' },
  'C6.5': { to: 'problem' },
  'C6.6': { to: 'problem' },
  'C7.1': { to: 'nonadherence' },
  'C7.2': { to: 'nonadherence' },
  'C7.3': { to: 'unnecessary', why: 'Cipolle files addiction and recreational use under unnecessary drug therapy.' },
  'C7.4': { to: 'unnecessary' },
  'C7.5': { to: { P1: 'dose_low', P2: 'adr', P3: 'none' }, why: 'As C1.3, for food.' },
  'C7.6': { to: 'problem' },
  'C7.7': { to: 'nonadherence' },
  'C7.8': { to: 'nonadherence' },
  'C7.9': { to: 'nonadherence' },
  'C7.10': { to: 'nonadherence' },
  'C8.1': { to: 'problem', why: 'Cipolle has no category for transitions of care.' },
  'C9.1': { to: 'problem', why: 'Cipolle has no category for monitoring.' },
  'C9.2': { to: 'problem' },
  'C9.3': { to: 'problem' },
};

const ORDER: readonly CipolleId[] = CIPOLLE_CATEGORIES.map((x) => x.id);

export type CipolleView = { category: CipolleCategory; from: string } | { category: undefined; from?: string };

/** The Cipolle category a card's PCNE codes map to, and the code that decided it (or none). */
export function cipolleFor(problem: string | undefined, causes: readonly string[]): CipolleView {
  const domain = problem?.slice(0, 2) as 'P1' | 'P2' | 'P3' | undefined;
  const resolve = (to: CipolleRuleTo | undefined): CipolleTarget | undefined =>
    to === undefined ? undefined : typeof to === 'string' ? to : domain ? to[domain] : undefined;
  const candidates = causes.flatMap((code) => {
    const t = resolve(PCNE_TO_CIPOLLE[code]?.to);
    return t && t !== 'none' && t !== 'problem' ? [{ id: t, from: code }] : [];
  });
  const fromProblem = problem ? resolve(PCNE_TO_CIPOLLE[problem]?.to) : undefined;
  if (!candidates.length && fromProblem && fromProblem !== 'none' && fromProblem !== 'problem') candidates.push({ id: fromProblem, from: problem! });
  candidates.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const first = candidates[0];
  return first ? { category: CIPOLLE_CATEGORIES.find((x) => x.id === first.id)!, from: first.from } : { category: undefined, ...(problem ? { from: problem } : {}) };
}
