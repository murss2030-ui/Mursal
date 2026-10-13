/**
 * Visual treatment of the eight provenance states (Section 7, Section 20).
 *
 * This table is the single source of truth: the badge component renders
 * directly from it, and the unit tests check that every state is distinct in
 * icon, label and border/fill — never colour alone — and that text contrast
 * meets WCAG AA.
 */
import type { ProvenanceState } from './types';

export type ProvenanceIcon =
  | 'alert-triangle'
  | 'pencil'
  | 'check-circle'
  | 'function'
  | 'cpu'
  | 'scale'
  | 'flag'
  | 'target';

export interface ProvenanceVisual {
  state: ProvenanceState;
  icon: ProvenanceIcon;
  /** English label (clinical vocabulary stays English) and the Arabic explanation shown beside it. */
  label: string;
  labelAr: string;
  fg: string;
  bg: string;
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'double';
  borderWidth: number;
  italic: boolean;
  /** What the specification requires wherever this state is shown. */
  rule: string;
  /** Whether a value in this state may be used as a calculator input (M2). */
  mayFeedCalculator: boolean;
}

export const PROVENANCE_VISUALS: Readonly<Record<ProvenanceState, ProvenanceVisual>> = {
  extracted_unverified: {
    state: 'extracted_unverified',
    icon: 'alert-triangle',
    label: 'Extracted — unverified',
    labelAr: 'مستخرج آلياً — لم يُتحقَّق منه',
    fg: '#92400e',
    bg: '#fffbeb',
    borderColor: '#d97706',
    borderStyle: 'dashed',
    borderWidth: 2,
    italic: true,
    rule: 'Read by a model from an image or PDF; nobody has confirmed it. Cannot feed a calculator.',
    mayFeedCalculator: false,
  },
  user_entered: {
    state: 'user_entered',
    icon: 'pencil',
    label: 'Entered by trainee',
    labelAr: 'أدخله المتدرب من الملف',
    fg: '#1e293b',
    bg: '#ffffff',
    borderColor: '#64748b',
    borderStyle: 'solid',
    borderWidth: 1,
    italic: false,
    rule: 'Typed by the trainee from the chart.',
    mayFeedCalculator: true,
  },
  confirmed: {
    state: 'confirmed',
    icon: 'check-circle',
    label: 'Confirmed against source',
    labelAr: 'مؤكَّد مقابل المصدر',
    fg: '#14532d',
    bg: '#f0fdf4',
    borderColor: '#15803d',
    borderStyle: 'solid',
    borderWidth: 1,
    italic: false,
    rule: 'Extracted, then confirmed by the trainee against the source. Links to the source image.',
    mayFeedCalculator: true,
  },
  calculated: {
    state: 'calculated',
    icon: 'function',
    label: 'Calculated',
    labelAr: 'محسوب بمحرّك الحساب',
    fg: '#1e3a8a',
    bg: '#eff6ff',
    borderColor: '#2563eb',
    borderStyle: 'double',
    borderWidth: 3,
    italic: false,
    rule: 'Produced by the calculation engine. Shows formula, inputs and units on tap.',
    mayFeedCalculator: true,
  },
  ai_suggestion: {
    state: 'ai_suggestion',
    icon: 'cpu',
    label: 'AI suggestion — no decision yet',
    labelAr: 'اقتراح آلي — لم يُتخذ قرار بعد',
    fg: '#4c1d95',
    bg: '#f5f3ff',
    borderColor: '#7c3aed',
    borderStyle: 'dotted',
    borderWidth: 2,
    italic: false,
    rule: 'Proposed by the model; the trainee has not decided. Never styled like an implemented change.',
    mayFeedCalculator: false,
  },
  trainee_decision: {
    state: 'trainee_decision',
    icon: 'scale',
    label: 'Trainee decision',
    labelAr: 'قرار المتدرب',
    fg: '#164e63',
    bg: '#ecfeff',
    borderColor: '#0e7490',
    borderStyle: 'solid',
    borderWidth: 3,
    italic: false,
    rule: 'Accepted, edited or rejected by the trainee. Shows the decision and its timestamp.',
    mayFeedCalculator: false,
  },
  implemented: {
    state: 'implemented',
    icon: 'flag',
    label: 'Implemented',
    labelAr: 'نُفِّذ فعلياً',
    fg: '#ffffff',
    bg: '#14532d',
    borderColor: '#14532d',
    borderStyle: 'solid',
    borderWidth: 1,
    italic: false,
    rule: 'The intervention was actually carried out. Requires who and when.',
    mayFeedCalculator: false,
  },
  outcome_documented: {
    state: 'outcome_documented',
    icon: 'target',
    label: 'Outcome documented',
    labelAr: 'النتيجة موثّقة بالقياس',
    fg: '#ffffff',
    bg: '#1e3a8a',
    borderColor: '#1e3a8a',
    borderStyle: 'solid',
    borderWidth: 1,
    italic: false,
    rule: 'A measured result after the intervention. Requires the measurement.',
    mayFeedCalculator: false,
  },
};

// ---------------------------------------------------------------- WCAG contrast

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
