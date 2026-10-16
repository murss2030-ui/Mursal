/**
 * From what the model read to a draft the trainee can confirm (Section 13).
 * Each item becomes the same form values a typed entry would have, so it goes
 * through exactly the same validation; whatever does not map cleanly is kept
 * as written and flagged. Nothing here is stored or used until confirmed.
 */
import { CULTURE_SPECIMENS, IMAGING_MODALITIES, OTHER, VITALS } from '../../domain/catalogue';
import { buildEntryMeta, buildPayload, type Errors, type Values } from '../../domain/entries';
import { isValidTimeOfDay } from '../../domain/dates';
import type { ExtractedField, ExtractionFlag, ExtractionTarget, SourceDocType } from '../../domain/types';
import type { KnownIdentifiers } from '../../domain/workflow/deidentify';
import { findIdentifiers, REDACTION_MARK } from '../../domain/workflow/deidentify';
import { normalizeItemFields } from '../../domain/workflow/registers';
import type { RawItem } from './contract';
import { dateTextToHospitalDay } from './deid';
import { mapDoseUnit, mapFrequency, mapRoute, matchAnalyte, normalizeLabUnit, parseBloodPressure, parsePrintedNumber } from './normalize';
import { labPlausible, vitalPlausible, weightPlausible } from './plausibility';

export type Flag = ExtractionFlag;

/** Flags that only inform; every other flag means "check this against the source". */
export const INFO_FLAGS: ReadonlySet<Flag> = new Set(['day_from_document', 'handwritten']);

export type Target = ExtractionTarget;

/** A field as read and checked, before any decision. */
export type Candidate = Omit<ExtractedField, 'decision'>;

export interface CandidateContext {
  admissionDay0: string;
  docType: SourceDocType;
  docDay?: number;
  known: KnownIdentifiers;
}

const clean = (s: string | null | undefined): string => (s ?? '').trim();
const add = (flags: Flag[], f: Flag) => {
  if (!flags.includes(f)) flags.push(f);
};

const VITAL_NAMES: Record<string, (typeof VITALS)[number]['id']> = {
  'heart rate': 'heart_rate', hr: 'heart_rate', pulse: 'heart_rate', 'pulse rate': 'heart_rate', pr: 'heart_rate',
  'blood pressure': 'blood_pressure', bp: 'blood_pressure',
  'respiratory rate': 'respiratory_rate', rr: 'respiratory_rate', resp: 'respiratory_rate', 'respiration rate': 'respiratory_rate',
  temperature: 'temperature', temp: 'temperature', t: 'temperature',
  spo2: 'spo2', 'o2 sat': 'spo2', 'oxygen saturation': 'spo2', sat: 'spo2', sao2: 'spo2', 'spo₂': 'spo2',
  gcs: 'gcs', 'glasgow coma scale': 'gcs',
  'urine output': 'urine_output', uop: 'urine_output', 'u/o': 'urine_output',
};

const VITAL_UNITS: Record<string, string> = {
  bpm: 'beats/min', '/min': 'beats/min', 'beats/min': 'beats/min', 'b/min': 'beats/min',
  'breaths/min': 'breaths/min', 'br/min': 'breaths/min',
  mmhg: 'mmHg',
  c: '°C', '°c': '°C', 'º c': '°C', celsius: '°C', 'ºc': '°C',
  f: '°F', '°f': '°F', fahrenheit: '°F',
  '%': '%',
  ml: 'mL',
  '/15': 'points', points: 'points',
};

const SPECIMENS: Record<string, string> = { 'blood culture': 'blood', blood: 'blood', urine: 'urine', 'urine culture': 'urine', sputum: 'sputum', 'tracheal aspirate': 'tracheal aspirate', eta: 'tracheal aspirate', wound: 'wound', 'wound swab': 'wound', csf: 'CSF', stool: 'stool', 'pleural fluid': 'pleural fluid', 'peritoneal fluid': 'peritoneal fluid', 'catheter tip': 'catheter tip' };
const MODALITIES: Record<string, string> = { 'x-ray': 'X-ray', xray: 'X-ray', cxr: 'X-ray', 'chest x-ray': 'X-ray', ct: 'CT', 'ct scan': 'CT', mri: 'MRI', us: 'Ultrasound', ultrasound: 'Ultrasound', echo: 'Echocardiography', echocardiography: 'Echocardiography', echocardiogram: 'Echocardiography' };

/** The home-medication register's "sources" choice for a document type (the trainee can change it). */
const SOURCE_OF: Partial<Record<SourceDocType, string>> = {
  prescription: 'prescription',
  referral_letter: 'prescription',
  discharge_summary: 'previous_discharge',
};

function regimenText(v: Values): string {
  const dose = v.doseKind === 'text' ? v.doseText : [v.doseValue, v.doseUnit === OTHER ? v.doseUnitOther : v.doseUnit].filter(Boolean).join(' ');
  const route = v.route === OTHER ? v.routeOther : v.route;
  const freq = v.frequency === OTHER ? v.frequencyOther : v.frequency;
  return [dose, route, freq].filter(Boolean).join(' ');
}

/** Masks identifiers that came back in the model's output (defence in depth). */
function scrub(s: string, known: KnownIdentifiers, flags: Flag[]): string {
  const hits = findIdentifiers(s, known).filter((h) => h.kind !== 'long_number' && h.kind !== 'labelled');
  if (!hits.length) return s;
  add(flags, 'identifier_in_output');
  let out = '';
  let pos = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < pos) continue;
    out += s.slice(pos, h.start) + REDACTION_MARK;
    pos = h.end;
  }
  return out + s.slice(pos);
}

function medicationValues(raw: RawItem, flags: Flag[]): Values {
  const v: Values = { drug: clean(raw.name) };
  const dose = parsePrintedNumber(raw.dose);
  const unit = mapDoseUnit(raw.doseUnit);
  if (dose.ok && unit) {
    v.doseKind = 'structured';
    v.doseValue = String(dose.value);
    v.doseUnit = unit.value;
    if (unit.abbreviation) add(flags, 'abbreviation');
  } else if (clean(raw.dose)) {
    // Never a dose made of a unit alone: without an amount the dose stays empty and must be entered.
    v.doseKind = 'text';
    v.doseText = [clean(raw.dose), clean(raw.doseUnit)].filter(Boolean).join(' ');
    add(flags, 'dose_unparsed');
  }
  const route = mapRoute(raw.route);
  if (route) {
    v.route = route.value;
    if (route.abbreviation) add(flags, 'abbreviation');
  } else if (clean(raw.route)) {
    v.route = OTHER;
    v.routeOther = clean(raw.route);
    add(flags, 'route_unmatched');
  }
  const freq = mapFrequency(raw.frequency);
  if (freq) {
    v.frequency = freq.value;
    if (freq.abbreviation) add(flags, 'abbreviation');
  } else if (clean(raw.frequency)) {
    v.frequency = OTHER;
    v.frequencyOther = clean(raw.frequency);
    add(flags, 'frequency_unmatched');
  }
  if (clean(raw.indication)) v.indication = clean(raw.indication);
  if (raw.handwritten) add(flags, 'handwritten_dose');
  return v;
}

function mapItem(raw: RawItem, ctx: CandidateContext, flags: Flag[]): { target: Target; values: Values } {
  switch (raw.kind) {
    case 'lab': {
      const analyte = matchAnalyte(raw.name);
      const v: Values = { analyte: analyte ?? OTHER };
      if (!analyte) {
        v.analyteOther = clean(raw.name) || clean(raw.rawText);
        add(flags, 'name_unmatched');
      }
      const n = parsePrintedNumber(raw.valueText);
      if (n.ok) {
        v.resultKind = 'numeric';
        v.value = String(n.value);
        const unit = normalizeLabUnit(raw.unit, analyte);
        if (unit) v.unit = unit;
        else {
          v.unit = clean(raw.unit);
          add(flags, 'unit_unknown');
        }
        if (analyte && unit && labPlausible(analyte, unit, n.value) === false) add(flags, 'out_of_range');
      } else if (clean(raw.valueText)) {
        v.resultKind = 'text';
        v.resultText = clean(raw.valueText);
        add(flags, 'value_not_number');
      }
      return { target: { kind: 'entry', type: 'lab' }, values: v };
    }
    case 'vital': {
      const kind = VITAL_NAMES[clean(raw.name).toLowerCase()];
      const v: Values = { vital: kind ?? '' };
      if (!kind) add(flags, 'name_unmatched');
      const def = VITALS.find((x) => x.id === kind);
      const rawUnit = clean(raw.unit).toLowerCase();
      const unit = def && def.units.length === 1 ? def.units[0]! : VITAL_UNITS[rawUnit];
      if (unit) v.unit = unit;
      else if (def) add(flags, 'unit_unknown');
      if (kind === 'blood_pressure') {
        const bp = parseBloodPressure(raw.valueText);
        if (bp) {
          v.systolic = String(bp.systolic);
          v.diastolic = String(bp.diastolic);
          if (vitalPlausible('systolic', 'mmHg', bp.systolic) === false || vitalPlausible('diastolic', 'mmHg', bp.diastolic) === false) add(flags, 'out_of_range');
        } else if (clean(raw.valueText)) add(flags, 'value_not_number');
      } else {
        const n = parsePrintedNumber(raw.valueText);
        if (n.ok) {
          v.value = String(n.value);
          if (kind && unit && vitalPlausible(kind, unit, n.value) === false) add(flags, 'out_of_range');
        } else if (clean(raw.valueText)) add(flags, 'value_not_number');
      }
      return { target: { kind: 'entry', type: 'vital' }, values: v };
    }
    case 'weight': {
      const v: Values = {};
      const n = parsePrintedNumber(raw.valueText);
      const unit = clean(raw.unit).toLowerCase();
      if (n.ok && (unit === 'kg' || unit === 'kgs' || unit === 'kilograms' || unit === '')) {
        v.value = String(n.value);
        if (unit === '') add(flags, 'unit_unknown');
        if (!weightPlausible(n.value)) add(flags, 'out_of_range');
      } else if (n.ok) add(flags, 'unit_unknown'); // e.g. pounds: no conversion before M2
      else if (clean(raw.valueText)) add(flags, 'value_not_number');
      const m = clean(raw.status).toLowerCase();
      if (m === 'measured' || m === 'stated' || m === 'estimated') v.method = m;
      else add(flags, 'needs_choice');
      return { target: { kind: 'entry', type: 'weight' }, values: v };
    }
    case 'medication': {
      const v = medicationValues(raw, flags);
      const context = raw.medContext ?? 'unknown';
      if (context === 'home') {
        return {
          target: { kind: 'register', register: 'home_med' },
          values: { drug: v.drug ?? '', regimen: regimenText(v), ...(v.indication ? { indication: v.indication } : {}), sources: SOURCE_OF[ctx.docType] ?? 'record', admissionStatus: 'not_reviewed' },
        };
      }
      if (context === 'discharge') {
        add(flags, 'needs_choice'); // new, changed or unchanged is the trainee's call
        return { target: { kind: 'register', register: 'discharge_med' }, values: { drug: v.drug ?? '', regimen: regimenText(v), change: '' } };
      }
      return { target: { kind: 'entry', type: 'med_start' }, values: v };
    }
    case 'allergy': {
      const s = clean(raw.status).toLowerCase();
      const nkda = /no known|nkda|nka\b|none known/.test(s) || /no known|nkda/.test(clean(raw.name).toLowerCase());
      const kind = nkda ? 'nkda' : /intoleran/.test(s) ? 'intolerance' : /adverse|side effect|adr/.test(s) ? 'adr' : 'allergy';
      return {
        target: { kind: 'entry', type: 'note' },
        values: nkda ? { category: 'allergy_adr', kind } : { category: 'allergy_adr', kind, substance: clean(raw.name), ...(clean(raw.detail) ? { reaction: clean(raw.detail) } : {}) },
      };
    }
    case 'problem': {
      const v: Values = { category: 'problem', name: clean(raw.name), primaryDiagnosis: 'no' };
      if (raw.acuity) v.acuity = raw.acuity;
      const st = clean(raw.status).toLowerCase();
      const status = ['active', 'improving', 'worsening', 'resolved', 'inactive'].find((x) => st.includes(x));
      if (status) v.status = status;
      if (!raw.acuity || !status) add(flags, 'needs_choice');
      return { target: { kind: 'entry', type: 'note' }, values: v };
    }
    case 'history': {
      if (!raw.category) add(flags, 'needs_choice');
      return { target: { kind: 'entry', type: 'note' }, values: { category: raw.category ?? '', text: clean(raw.detail) || clean(raw.rawText) } };
    }
    case 'social': {
      if (!raw.khat || !raw.tobacco) add(flags, 'needs_choice');
      return {
        target: { kind: 'entry', type: 'note' },
        values: { category: 'social_history', khat: raw.khat ?? '', tobacco: raw.tobacco ?? '', ...(clean(raw.detail) ? { other: clean(raw.detail) } : {}) },
      };
    }
    case 'culture': {
      const sp = SPECIMENS[clean(raw.name).toLowerCase()];
      const v: Values = sp ? { specimen: sp } : { specimen: OTHER, specimenOther: clean(raw.name) };
      if (!sp && !(CULTURE_SPECIMENS as readonly string[]).includes(clean(raw.name))) add(flags, 'name_unmatched');
      const st = clean(raw.status).toLowerCase();
      const status = /no growth|sterile|negative/.test(st) ? 'no_growth' : /pending|awaited|in progress/.test(st) ? 'pending' : /contamina/.test(st) ? 'contaminant_suspected' : /growth|grew|isolated|positive/.test(st) ? 'growth' : '';
      if (status) v.status = status;
      else add(flags, 'needs_choice');
      if (clean(raw.organism)) v.organism = clean(raw.organism);
      if (clean(raw.susceptibility)) v.susceptibility = clean(raw.susceptibility);
      return { target: { kind: 'entry', type: 'culture' }, values: v };
    }
    case 'imaging': {
      const mod = MODALITIES[clean(raw.name).toLowerCase()];
      const v: Values = mod ? { modality: mod } : { modality: OTHER, modalityOther: clean(raw.name) };
      if (!mod && !(IMAGING_MODALITIES as readonly string[]).includes(clean(raw.name))) add(flags, 'name_unmatched');
      v.reportText = clean(raw.detail) || clean(raw.rawText);
      return { target: { kind: 'entry', type: 'imaging' }, values: v };
    }
    case 'procedure':
      return { target: { kind: 'entry', type: 'procedure' }, values: { name: clean(raw.name), ...(clean(raw.detail) ? { details: clean(raw.detail) } : {}) } };
    case 'event': {
      const n = `${clean(raw.name)} ${clean(raw.detail)}`.toLowerCase();
      const category = /icu discharge|discharged from icu/.test(n)
        ? 'icu_discharge'
        : /icu|intensive care/.test(n)
          ? 'icu_admission'
          : /transfer/.test(n)
            ? 'transfer'
            : /surgery|operation|operated/.test(n)
              ? 'surgery'
              : /rapid response|code blue|cardiac arrest/.test(n)
                ? 'rapid_response'
                : /admi/.test(n)
                  ? 'admission'
                  : 'other';
      return { target: { kind: 'entry', type: 'event' }, values: { category, description: [clean(raw.name), clean(raw.detail)].filter(Boolean).join(' — ') || clean(raw.rawText) } };
    }
  }
}

/** One item read by the model → a draft with its flags. */
export function toCandidate(raw: RawItem, index: number, ctx: CandidateContext): Candidate {
  const flags: Flag[] = [];
  // Identifiers that came back in the output are masked before anything is shown or kept.
  const item: RawItem = { ...raw };
  for (const k of ['name', 'detail', 'indication', 'organism', 'susceptibility', 'rawText', 'note'] as const) {
    const val = item[k];
    if (typeof val === 'string' && val) item[k] = scrub(val, ctx.known, flags) as never;
  }
  // Section 13: an illegible value is null, never a guess — enforced here whatever the model returned.
  if (item.legibility === 'illegible') {
    item.valueText = null;
    item.dose = null;
    add(flags, 'illegible');
  } else if (item.legibility === 'uncertain') add(flags, 'uncertain_reading');
  if (item.handwritten) add(flags, 'handwritten');

  const { target, values } = mapItem(item, ctx, flags);

  let day = dateTextToHospitalDay(item.dateText, ctx.admissionDay0);
  if (day === undefined && ctx.docDay !== undefined) {
    day = ctx.docDay;
    add(flags, 'day_from_document');
  }
  if (day === undefined && target.kind === 'entry') add(flags, 'no_day');
  const time = clean(item.timeText);
  const box = Array.isArray(item.box) && item.box.length === 4 && item.box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000) ? (item.box as [number, number, number, number]) : undefined;

  return {
    id: `f${index + 1}`,
    kind: item.kind,
    ...(item.kind === 'medication' ? { medContext: item.medContext ?? 'unknown' } : {}),
    target,
    values,
    ...(day !== undefined ? { day } : {}),
    ...(isValidTimeOfDay(time) ? { timeOfDay: time } : {}),
    rawText: clean(item.rawText),
    legibility: item.legibility,
    handwritten: item.handwritten,
    ...(box ? { box } : {}),
    flags,
    ...(clean(item.note) ? { note: clean(item.note) } : {}),
  };
}

/** Whether a draft would pass the same validation as a typed entry, and why not. */
export function checkCandidate(c: Pick<Candidate, 'target' | 'values' | 'day' | 'timeOfDay'>): Errors {
  if (c.target.kind === 'register') {
    const r = normalizeItemFields(c.target.register, c.values);
    return r.ok ? {} : (r.errors as Errors);
  }
  const meta = buildEntryMeta({ hospitalDay: c.day === undefined ? '' : String(c.day), timeOfDay: c.timeOfDay ?? '' });
  const built = buildPayload(c.target.type, c.values, { newId: () => 'draft' });
  return { ...(meta.ok ? {} : meta.errors), ...(built.ok ? {} : built.errors) };
}

/** Flags that ask the trainee to look at the source before confirming. */
export const needsLook = (c: Pick<Candidate, 'flags'>): boolean => c.flags.some((f) => !INFO_FLAGS.has(f));
