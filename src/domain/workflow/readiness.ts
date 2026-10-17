/**
 * Data readiness: what a task depends on, found or missing in the record.
 *
 * This is the M1 face of the Verify gate (Section 8): it names missing data
 * explicitly instead of letting a polished worksheet hide it. It reads the
 * record only — it never estimates, defaults or infers a value.
 */
import type { Milestone } from '../../config/release';
import { ANALYTE_BY_ID } from '../catalogue';
import { L } from '../label';
import { formatNumber } from '../numbers';
import { compareEntries, deriveMedCourses, deriveProblems, unitText } from '../timeline';
import type { Attachment, Case, EntryOf, EntryType, NoteCategory, RegisterId, RegisterItem, RrtStatus, TimelineEntry } from '../types';
import type { ReadinessId } from './catalogue';

export type AddTarget =
  | { kind: 'entry'; type: EntryType; category?: NoteCategory }
  | { kind: 'register'; register: RegisterId }
  | { kind: 'case_details' }
  | { kind: 'sources' };

export interface ReadinessItem {
  id: ReadinessId;
  label: L;
  state: 'ok' | 'missing' | 'not_yet';
  /** What was found, in clinical English (values with units). */
  value?: string;
  /** Hospital day of the latest supporting record. */
  day?: number;
  milestone?: Milestone;
  add?: AddTarget;
}

export interface ReadinessContext {
  case: Case;
  /** The effective timeline (current entries). */
  current: readonly TimelineEntry[];
  attachments: readonly Attachment[];
  items: readonly RegisterItem[];
}

const LABELS: Record<ReadinessId, L> = {
  demographics: L('Age and sex', 'العمر والجنس'),
  weight: L('Weight', 'الوزن'),
  height: L('Height', 'الطول'),
  cc: L('Chief complaint', 'الشكوى الرئيسية'),
  hpi: L('History of present illness', 'تاريخ المرض الحالي'),
  pmh: L('Past medical history', 'التاريخ المرضي السابق'),
  allergy: L('Allergy status (or NKDA)', 'حالة الحساسية (أو لا حساسية معروفة)'),
  social: L('Social history, including khat', 'التاريخ الاجتماعي بما فيه القات'),
  vitals: L('Vital signs', 'العلامات الحيوية'),
  scr: L('Serum creatinine', 'الكرياتينين في الدم'),
  electrolytes: L('Sodium and potassium', 'الصوديوم والبوتاسيوم'),
  cbc: L('Blood count (Hb, WBC, platelets)', 'تعداد الدم (الهيموغلوبين، الكريات البيض، الصفائح)'),
  lft: L('Liver enzymes (ALT or AST)', 'إنزيمات الكبد (ALT أو AST)'),
  bilirubin: L('Bilirubin', 'البيليروبين'),
  albumin: L('Albumin', 'الألبومين'),
  inr: L('INR', 'INR'),
  problems: L('Problem list', 'قائمة المشكلات'),
  primary_dx: L('Primary diagnosis', 'التشخيص الرئيسي'),
  meds: L('Current medications', 'الأدوية الحالية'),
  home_meds: L('Pre-admission medication list', 'قائمة أدوية ما قبل الدخول'),
  cultures: L('Cultures', 'المزارع'),
  drug_levels: L('Drug levels', 'مستويات الأدوية'),
  sources: L('Patient file (source documents)', 'ملف المريض (المستندات المصدرية)'),
  dialysis: L('Dialysis / renal replacement status', 'حالة الغسيل الكلوي / بدائل الكلى'),
};

const latest = <T extends TimelineEntry>(xs: T[]): T | undefined => [...xs].sort(compareEntries).pop();

const RRT_TEXT: Record<RrtStatus, string> = {
  none: 'not on dialysis',
  intermittent_hd: 'intermittent haemodialysis',
  peritoneal: 'peritoneal dialysis',
  crrt: 'CRRT',
};

function labs(current: readonly TimelineEntry[], analyte: string): EntryOf<'lab'>[] {
  return current.filter((e): e is EntryOf<'lab'> => e.type === 'lab' && e.payload.analyte === analyte);
}

function labText(e: EntryOf<'lab'>): string {
  const p = e.payload;
  const v = p.result.kind === 'numeric' ? `${formatNumber(p.result.value)} ${unitText(p.unit)}`.trim() : p.result.text;
  return `${p.analyteName} ${v}${e.timeOfDay ? ` at ${e.timeOfDay}` : ''}`;
}

function notesOf(current: readonly TimelineEntry[], category: NoteCategory): EntryOf<'note'>[] {
  return current.filter((e): e is EntryOf<'note'> => e.type === 'note' && e.payload.category === category);
}

function labItem(id: ReadinessId, current: readonly TimelineEntry[], analytes: readonly string[], mode: 'any' | 'all'): ReadinessItem {
  const found = analytes.map((a) => latest(labs(current, a))).filter((e): e is EntryOf<'lab'> => !!e);
  const ok = mode === 'all' ? found.length === analytes.length : found.length > 0;
  const last = latest(found);
  return {
    id,
    label: LABELS[id],
    state: ok ? 'ok' : 'missing',
    ...(found.length ? { value: found.map(labText).join(' · '), day: last!.hospitalDay } : {}),
    ...(ok ? {} : { add: { kind: 'entry', type: 'lab' } }),
  };
}

function noteItem(id: ReadinessId, current: readonly TimelineEntry[], category: NoteCategory): ReadinessItem {
  const last = latest(notesOf(current, category));
  return last
    ? { id, label: LABELS[id], state: 'ok', day: last.hospitalDay }
    : { id, label: LABELS[id], state: 'missing', add: { kind: 'entry', type: 'note', category } };
}

export function readiness(ids: readonly ReadinessId[], ctx: ReadinessContext): ReadinessItem[] {
  const { current } = ctx;
  return ids.map((id): ReadinessItem => {
    const label = LABELS[id];
    switch (id) {
      case 'demographics':
        return { id, label, state: 'ok', value: `${formatNumber(ctx.case.demographics.ageYears)} y · ${ctx.case.demographics.sex}` };
      case 'height':
        return ctx.case.demographics.heightCm !== undefined
          ? { id, label, state: 'ok', value: `${formatNumber(ctx.case.demographics.heightCm)} cm` }
          : { id, label, state: 'missing', add: { kind: 'case_details' } };
      case 'weight': {
        const w = latest(current.filter((e): e is EntryOf<'weight'> => e.type === 'weight'));
        return w
          ? { id, label, state: 'ok', value: `${formatNumber(w.payload.value)} kg (${w.payload.method})`, day: w.hospitalDay }
          : { id, label, state: 'missing', add: { kind: 'entry', type: 'weight' } };
      }
      case 'cc':
        return noteItem(id, current, 'chief_complaint');
      case 'hpi':
        return noteItem(id, current, 'hpi');
      case 'pmh':
        return noteItem(id, current, 'pmh');
      case 'allergy': {
        const all = notesOf(current, 'allergy_adr');
        if (!all.length) return { id, label, state: 'missing', add: { kind: 'entry', type: 'note', category: 'allergy_adr' } };
        const parts = all.map((e) => (e.payload.category === 'allergy_adr' && e.payload.kind !== 'nkda' ? e.payload.substance ?? '' : 'NKDA'));
        return { id, label, state: 'ok', value: parts.filter(Boolean).join(', '), day: latest(all)!.hospitalDay };
      }
      case 'social': {
        const s = latest(notesOf(current, 'social_history'));
        if (!s || s.payload.category !== 'social_history') return { id, label, state: 'missing', add: { kind: 'entry', type: 'note', category: 'social_history' } };
        return { id, label, state: 'ok', value: `khat: ${s.payload.khat}`, day: s.hospitalDay };
      }
      case 'vitals': {
        const v = latest(current.filter((e): e is EntryOf<'vital'> => e.type === 'vital'));
        return v ? { id, label, state: 'ok', day: v.hospitalDay } : { id, label, state: 'missing', add: { kind: 'entry', type: 'vital' } };
      }
      case 'scr':
        return labItem(id, current, ['scr'], 'all');
      case 'electrolytes':
        return labItem(id, current, ['na', 'k'], 'all');
      case 'cbc':
        return labItem(id, current, ['hb', 'wbc', 'plt'], 'all');
      case 'lft':
        return labItem(id, current, ['alt', 'ast'], 'any');
      case 'bilirubin':
        return labItem(id, current, ['tbil'], 'all');
      case 'albumin':
        return labItem(id, current, ['albumin'], 'all');
      case 'inr':
        return labItem(id, current, ['inr'], 'all');
      case 'problems': {
        const p = deriveProblems(current);
        return p.length
          ? { id, label, state: 'ok', value: p.map((x) => x.latest.payload.name).join(', ') }
          : { id, label, state: 'missing', add: { kind: 'entry', type: 'note', category: 'problem' } };
      }
      case 'primary_dx': {
        const p = deriveProblems(current).filter((x) => x.latest.payload.primaryDiagnosis);
        return p.length
          ? { id, label, state: 'ok', value: p.map((x) => x.latest.payload.name).join(', ') }
          : { id, label, state: 'missing', add: { kind: 'entry', type: 'note', category: 'problem' } };
      }
      case 'meds': {
        const active = deriveMedCourses(current).filter((m) => m.status === 'active');
        return active.length
          ? { id, label, state: 'ok', value: active.map((m) => m.drug).join(', ') }
          : { id, label, state: 'missing', add: { kind: 'entry', type: 'med_start' } };
      }
      case 'home_meds': {
        const home = ctx.items.filter((i) => i.register === 'home_med' && i.status === 'active');
        return home.length
          ? { id, label, state: 'ok', value: home.map((h) => h.fields.drug).join(', ') }
          : { id, label, state: 'missing', add: { kind: 'register', register: 'home_med' } };
      }
      case 'cultures': {
        const c = current.filter((e): e is EntryOf<'culture'> => e.type === 'culture');
        return c.length
          ? { id, label, state: 'ok', value: c.map((x) => `${x.payload.specimen}: ${x.payload.status.replace(/_/g, ' ')}`).join(' · '), day: latest(c)!.hospitalDay }
          : { id, label, state: 'missing', add: { kind: 'entry', type: 'culture' } };
      }
      case 'drug_levels': {
        const lv = current.filter((e): e is EntryOf<'lab'> => e.type === 'lab' && ANALYTE_BY_ID.get(e.payload.analyte)?.group === 'drug_level');
        return lv.length
          ? { id, label, state: 'ok', value: lv.map(labText).join(' · '), day: latest(lv)!.hospitalDay }
          : { id, label, state: 'missing', add: { kind: 'entry', type: 'lab' } };
      }
      case 'sources': {
        const a = ctx.attachments.filter((x) => x.status === 'active');
        return a.length ? { id, label, state: 'ok', value: String(a.length) } : { id, label, state: 'missing', add: { kind: 'sources' } };
      }
      case 'dialysis': {
        // M2 plan decision 7 (proposed default): a structured renal-replacement-therapy note.
        const r = latest(notesOf(current, 'renal_replacement'));
        if (!r || r.payload.category !== 'renal_replacement') {
          return { id, label, state: 'missing', add: { kind: 'entry', type: 'note', category: 'renal_replacement' } };
        }
        return { id, label, state: 'ok', value: RRT_TEXT[r.payload.status], day: r.hospitalDay };
      }
    }
  });
}
