/**
 * Manual-entry validation: turns the strings typed into an entry form into a
 * typed, validated payload — or names exactly which fields are wrong.
 *
 * Nothing is defaulted on the trainee's behalf: a missing required value is an
 * error, never a guess.
 */
import {
  ANALYTE_BY_ID,
  CULTURE_SPECIMENS,
  DOSE_UNITS,
  FREQUENCIES,
  IMAGING_MODALITIES,
  OTHER,
  ROUTES,
  VITAL_BY_ID,
} from './catalogue';
import { isValidHospitalDay, isValidTimeOfDay } from './dates';
import { formatNumber, parseDecimal, parseInteger } from './numbers';
import type {
  AllergyKind,
  CultureStatus,
  DoseSpec,
  EntryType,
  EventCategory,
  HabitStatus,
  NotePayload,
  PayloadMap,
  ProblemStatus,
  TextNoteCategory,
  TimelineEntry,
  VitalKind,
  WeightMethod,
} from './types';

export type FieldError =
  | 'required'
  | 'number'
  | 'comma'
  | 'integer'
  | 'unit'
  | 'positive'
  | 'nonNegative'
  | 'range'
  | 'bpOrder'
  | 'refOrder'
  | 'atLeastOneChange'
  | 'notInM1'
  | 'tooLong'
  | 'invalidChoice'
  | 'time'
  | 'hospitalDay';

export type Values = Record<string, string>;
export type Errors = Record<string, FieldError>;
export type BuildResult<K extends EntryType> = { ok: true; payload: PayloadMap[K] } | { ok: false; errors: Errors };

export interface BuildContext {
  /** Existing medication course (med_change / med_stop, or correcting a med_start). */
  medId?: string;
  drug?: string;
  /** Existing problem (problem status update, or correcting a problem entry). */
  problemId?: string;
  /** Generates ids for new medication courses and problems. */
  newId?: () => string;
}

const MAX_SHORT = 200;
const MAX_LONG = 8000;

export const TEXT_NOTE_CATEGORIES: readonly TextNoteCategory[] = [
  'chief_complaint',
  'hpi',
  'pmh',
  'psh',
  'family_history',
  'progress',
  'other',
];
export const NOTE_CATEGORIES = [...TEXT_NOTE_CATEGORIES, 'allergy_adr', 'social_history', 'problem'] as const;
export const HABIT_STATUSES: readonly HabitStatus[] = ['current', 'former', 'never', 'unknown'];
export const ALLERGY_KINDS: readonly AllergyKind[] = ['allergy', 'adr', 'intolerance', 'nkda'];
export const SEVERITIES = ['mild', 'moderate', 'severe', 'unknown'] as const;
export const PROBLEM_STATUSES: readonly ProblemStatus[] = ['active', 'improving', 'worsening', 'resolved', 'inactive'];
export const CULTURE_STATUSES: readonly CultureStatus[] = ['pending', 'no_growth', 'growth', 'contaminant_suspected'];
export const WEIGHT_METHODS: readonly WeightMethod[] = ['measured', 'stated', 'estimated'];
export const EVENT_CATEGORIES: readonly EventCategory[] = [
  'admission',
  'transfer',
  'icu_admission',
  'icu_discharge',
  'surgery',
  'rapid_response',
  'other',
];

// ---------------------------------------------------------------- helpers

class Collector {
  errors: Errors = {};
  constructor(private readonly v: Values) {}

  raw(k: string): string {
    return (this.v[k] ?? '').trim();
  }
  /** Optional free text; undefined when blank. */
  text(k: string, max = MAX_SHORT): string | undefined {
    const s = this.raw(k);
    if (s === '') return undefined;
    if (s.length > max) this.errors[k] = 'tooLong';
    return s;
  }
  reqText(k: string, max = MAX_SHORT): string {
    const s = this.text(k, max);
    if (s === undefined) this.errors[k] = 'required';
    return s ?? '';
  }
  choice<T extends string>(k: string, options: readonly T[], required = true): T | undefined {
    const s = this.raw(k);
    if (s === '') {
      if (required) this.errors[k] = 'required';
      return undefined;
    }
    if (!(options as readonly string[]).includes(s)) {
      this.errors[k] = 'invalidChoice';
      return undefined;
    }
    return s as T;
  }
  /** A pick-list that also accepts OTHER plus a typed value in `${k}Other`. */
  listOrOther(k: string, options: readonly string[], required = true): string | undefined {
    const s = this.raw(k);
    if (s === '') {
      if (required) this.errors[k] = 'required';
      return undefined;
    }
    if (s === OTHER) {
      const typed = this.text(`${k}Other`);
      if (typed === undefined) this.errors[`${k}Other`] = 'required';
      return typed;
    }
    if (!options.includes(s)) {
      this.errors[k] = 'invalidChoice';
      return undefined;
    }
    return s;
  }
  num(k: string, opts: { required?: boolean; integer?: boolean; min?: number; max?: number; positive?: boolean } = {}):
    | number
    | undefined {
    const s = this.raw(k);
    if (s === '') {
      if (opts.required !== false) this.errors[k] = 'required';
      return undefined;
    }
    const r = opts.integer ? parseInteger(s) : parseDecimal(s);
    if (!r.ok) {
      this.errors[k] = r.reason === 'comma' ? 'comma' : opts.integer ? 'integer' : 'number';
      return undefined;
    }
    if (opts.positive && r.value <= 0) {
      this.errors[k] = 'positive';
      return undefined;
    }
    if ((opts.min !== undefined && r.value < opts.min) || (opts.max !== undefined && r.value > opts.max)) {
      this.errors[k] = opts.min === 0 && opts.max === undefined ? 'nonNegative' : 'range';
      return undefined;
    }
    return r.value;
  }
  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}

function result<K extends EntryType>(c: Collector, payload: PayloadMap[K]): BuildResult<K> {
  return c.ok ? { ok: true, payload } : { ok: false, errors: c.errors };
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function buildDose(c: Collector, required: boolean): DoseSpec | undefined {
  const kind = c.raw('doseKind') || 'structured';
  if (kind === 'text') {
    const t = required ? c.reqText('doseText') : c.text('doseText');
    return t === undefined || t === '' ? undefined : { kind: 'text', text: t };
  }
  const hasAny = c.raw('doseValue') !== '' || c.raw('doseUnit') !== '';
  if (!required && !hasAny) return undefined;
  const value = c.num('doseValue', { positive: true });
  const unit = c.listOrOther('doseUnit', DOSE_UNITS);
  if (value === undefined || unit === undefined) return undefined;
  return { kind: 'structured', value, unit };
}

// ---------------------------------------------------------------- per type

function buildLab(v: Values): BuildResult<'lab'> {
  const c = new Collector(v);
  const analyte = c.raw('analyte');
  let analyteName = '';
  let allowedUnits: readonly string[] | null = null;
  let nonNegative = false;
  if (analyte === '') c.errors.analyte = 'required';
  else if (analyte === OTHER) analyteName = c.reqText('analyteOther');
  else {
    const def = ANALYTE_BY_ID.get(analyte);
    if (!def) c.errors.analyte = 'invalidChoice';
    else {
      analyteName = def.name;
      allowedUnits = def.units;
      nonNegative = def.nonNegative;
    }
  }
  const resultKind = c.raw('resultKind') || 'numeric';
  let payloadResult: PayloadMap['lab']['result'] = { kind: 'text', text: '' };
  let unit = '';
  if (resultKind === 'text') {
    payloadResult = { kind: 'text', text: c.reqText('resultText') };
    unit = 'unitless';
  } else {
    const value = c.num('value', nonNegative ? { min: 0 } : {});
    if (value !== undefined) payloadResult = { kind: 'numeric', value };
    unit = c.raw('unit');
    if (unit === '') c.errors.unit = 'required';
    else if (allowedUnits && !allowedUnits.includes(unit)) c.errors.unit = 'unit';
    else if (unit.length > 40) c.errors.unit = 'tooLong';
  }
  const refLow = c.num('refLow', { required: false });
  const refHigh = c.num('refHigh', { required: false });
  if (refLow !== undefined && refHigh !== undefined && refLow > refHigh) c.errors.refHigh = 'refOrder';
  return result(
    c,
    strip({
      analyte,
      analyteName,
      result: payloadResult,
      unit,
      refLow,
      refHigh,
      refText: c.text('refText'),
      comment: c.text('comment', MAX_LONG),
    }),
  );
}

function buildVital(v: Values): BuildResult<'vital'> {
  const c = new Collector(v);
  const kind = c.raw('vital') as VitalKind;
  const def = VITAL_BY_ID.get(kind);
  if (!kind) c.errors.vital = 'required';
  else if (!def) c.errors.vital = 'invalidChoice';
  const payload: PayloadMap['vital'] = { vital: kind, unit: '' };
  if (def) {
    const unit = def.units.length === 1 ? def.units[0]! : c.raw('unit');
    if (unit === '') c.errors.unit = 'required';
    else if (!def.units.includes(unit)) c.errors.unit = 'unit';
    payload.unit = unit;
    const bounds = { min: def.min, max: def.max, integer: def.integer };
    if (kind === 'blood_pressure') {
      payload.systolic = c.num('systolic', bounds);
      payload.diastolic = c.num('diastolic', bounds);
      if (payload.systolic !== undefined && payload.diastolic !== undefined && payload.diastolic >= payload.systolic) {
        c.errors.diastolic = 'bpOrder';
      }
    } else {
      payload.value = c.num('value', bounds);
    }
    if (kind === 'urine_output') payload.periodHours = c.num('periodHours', { positive: true, max: 168 });
  }
  payload.comment = c.text('comment', MAX_LONG);
  return result(c, strip(payload));
}

function buildWeight(v: Values): BuildResult<'weight'> {
  const c = new Collector(v);
  const value = c.num('value', { positive: true });
  const method = c.choice('method', WEIGHT_METHODS);
  return result(c, { value: value ?? 0, unit: 'kg', method: method ?? 'measured' });
}

function buildMedStart(v: Values, ctx: BuildContext): BuildResult<'med_start'> {
  const c = new Collector(v);
  const drug = c.reqText('drug');
  const dose = buildDose(c, true);
  const route = c.listOrOther('route', ROUTES);
  const frequency = c.listOrOther('frequency', FREQUENCIES);
  const medId = ctx.medId ?? ctx.newId?.();
  if (!medId) throw new Error('A medication course id is required.');
  return result(
    c,
    strip({
      medId,
      drug,
      brand: c.text('brand'),
      dose: dose ?? { kind: 'text', text: '' },
      route: route ?? '',
      frequency: frequency ?? '',
      indication: c.text('indication'),
      notes: c.text('notes', MAX_LONG),
    }),
  );
}

function buildMedChange(v: Values, ctx: BuildContext): BuildResult<'med_change'> {
  const c = new Collector(v);
  if (!ctx.medId || !ctx.drug) throw new Error('A medication change must refer to an existing course.');
  const dose = buildDose(c, false);
  const route = c.listOrOther('route', ROUTES, false);
  const frequency = c.listOrOther('frequency', FREQUENCIES, false);
  if (c.ok && !dose && !route && !frequency) c.errors.changes = 'atLeastOneChange';
  return result(c, strip({ medId: ctx.medId, drug: ctx.drug, dose, route, frequency, reason: c.text('reason', MAX_LONG) }));
}

function buildMedStop(v: Values, ctx: BuildContext): BuildResult<'med_stop'> {
  const c = new Collector(v);
  if (!ctx.medId || !ctx.drug) throw new Error('A medication stop must refer to an existing course.');
  return result(c, strip({ medId: ctx.medId, drug: ctx.drug, reason: c.text('reason', MAX_LONG) }));
}

function buildImaging(v: Values): BuildResult<'imaging'> {
  const c = new Collector(v);
  const modality = c.listOrOther('modality', IMAGING_MODALITIES);
  return result(
    c,
    strip({ modality: modality ?? '', region: c.text('region'), reportText: c.reqText('reportText', MAX_LONG) }),
  );
}

function buildProcedure(v: Values): BuildResult<'procedure'> {
  const c = new Collector(v);
  return result(c, strip({ name: c.reqText('name'), details: c.text('details', MAX_LONG) }));
}

function buildCulture(v: Values): BuildResult<'culture'> {
  const c = new Collector(v);
  const specimen = c.listOrOther('specimen', CULTURE_SPECIMENS);
  const status = c.choice('status', CULTURE_STATUSES);
  const organism = status === 'growth' ? c.reqText('organism') : c.text('organism');
  return result(
    c,
    strip({
      specimen: specimen ?? '',
      status: status ?? 'pending',
      organism,
      gramStain: c.text('gramStain'),
      susceptibility: c.text('susceptibility', MAX_LONG),
    }),
  );
}

function buildNote(v: Values, ctx: BuildContext): BuildResult<'note'> {
  const c = new Collector(v);
  const category = c.choice('category', NOTE_CATEGORIES);
  let payload: NotePayload = { category: 'other', text: '' };
  switch (category) {
    case undefined:
      break;
    case 'allergy_adr': {
      const kind = c.choice('kind', ALLERGY_KINDS);
      payload = strip({
        category,
        kind: kind ?? 'allergy',
        substance: kind === 'nkda' ? undefined : c.reqText('substance'),
        reaction: kind === 'nkda' ? undefined : c.text('reaction'),
        severity: kind === 'nkda' ? undefined : c.choice('severity', SEVERITIES, false),
      });
      break;
    }
    case 'social_history': {
      payload = strip({
        category,
        khat: c.choice('khat', HABIT_STATUSES) ?? 'unknown',
        khatDetails: c.text('khatDetails'),
        tobacco: c.choice('tobacco', HABIT_STATUSES) ?? 'unknown',
        tobaccoDetails: c.text('tobaccoDetails'),
        alcohol: c.choice('alcohol', HABIT_STATUSES, false),
        occupation: c.text('occupation'),
        other: c.text('other', MAX_LONG),
      });
      break;
    }
    case 'problem': {
      const problemId = ctx.problemId ?? ctx.newId?.();
      if (!problemId) throw new Error('A problem id is required.');
      payload = strip({
        category,
        problemId,
        name: c.reqText('name'),
        acuity: c.choice('acuity', ['acute', 'chronic'] as const) ?? 'acute',
        status: c.choice('status', PROBLEM_STATUSES) ?? 'active',
        stage: c.text('stage'),
        problemType: c.text('problemType'),
        duration: c.text('duration'),
        primaryDiagnosis: c.raw('primaryDiagnosis') === 'yes',
      });
      break;
    }
    default:
      payload = { category, text: c.reqText('text', MAX_LONG) };
  }
  return result(c, payload);
}

function buildEvent(v: Values): BuildResult<'event'> {
  const c = new Collector(v);
  const category = c.choice('category', EVENT_CATEGORIES);
  return result(c, { category: category ?? 'other', description: c.reqText('description', MAX_LONG) });
}

export function buildPayload<K extends EntryType>(type: K, values: Values, ctx: BuildContext = {}): BuildResult<K> {
  const v = values;
  switch (type) {
    case 'lab':
      return buildLab(v) as BuildResult<K>;
    case 'vital':
      return buildVital(v) as BuildResult<K>;
    case 'weight':
      return buildWeight(v) as BuildResult<K>;
    case 'med_start':
      return buildMedStart(v, ctx) as BuildResult<K>;
    case 'med_change':
      return buildMedChange(v, ctx) as BuildResult<K>;
    case 'med_stop':
      return buildMedStop(v, ctx) as BuildResult<K>;
    case 'imaging':
      return buildImaging(v) as BuildResult<K>;
    case 'procedure':
      return buildProcedure(v) as BuildResult<K>;
    case 'culture':
      return buildCulture(v) as BuildResult<K>;
    case 'note':
      return buildNote(v, ctx) as BuildResult<K>;
    case 'event':
      return buildEvent(v) as BuildResult<K>;
    case 'intervention':
    case 'outcome':
      // Created from Problem Cards (M4) with implementation and outcome recording (M6).
      return { ok: false, errors: { type: 'notInM1' } };
    default:
      return { ok: false, errors: { type: 'invalidChoice' } };
  }
}

/** Validates the hospital day and optional clock time shared by every entry. */
export function buildEntryMeta(values: Values): { ok: true; hospitalDay: number; timeOfDay?: string } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const dayRaw = (values.hospitalDay ?? '').trim();
  let hospitalDay = 0;
  if (dayRaw === '') errors.hospitalDay = 'required';
  else {
    const r = parseInteger(dayRaw);
    if (!r.ok) errors.hospitalDay = r.reason === 'comma' ? 'comma' : 'integer';
    else if (!isValidHospitalDay(r.value)) errors.hospitalDay = 'hospitalDay';
    else hospitalDay = r.value;
  }
  const t = (values.timeOfDay ?? '').trim();
  if (t !== '' && !isValidTimeOfDay(t)) errors.timeOfDay = 'time';
  if (Object.keys(errors).length) return { ok: false, errors };
  return t === '' ? { ok: true, hospitalDay } : { ok: true, hospitalDay, timeOfDay: t };
}

// ---------------------------------------------------------------- inverse, for corrections

function listValue(value: string | undefined, options: readonly string[], key: string, out: Values): void {
  if (value === undefined || value === '') return;
  if (options.includes(value)) out[key] = value;
  else {
    out[key] = OTHER;
    out[`${key}Other`] = value;
  }
}

function doseValues(dose: DoseSpec | undefined, out: Values): void {
  if (!dose) return;
  if (dose.kind === 'text') {
    out.doseKind = 'text';
    out.doseText = dose.text;
  } else {
    out.doseKind = 'structured';
    out.doseValue = formatNumber(dose.value);
    listValue(dose.unit, DOSE_UNITS, 'doseUnit', out);
  }
}

const n = (x: number | undefined): string | undefined => (x === undefined ? undefined : formatNumber(x));

/** Turns a stored entry back into form values, so a correction starts from what was recorded. */
export function entryToValues(e: TimelineEntry): Values {
  const out: Values = { hospitalDay: String(e.hospitalDay) };
  if (e.timeOfDay) out.timeOfDay = e.timeOfDay;
  const put = (k: string, val: string | undefined) => {
    if (val !== undefined) out[k] = val;
  };
  switch (e.type) {
    case 'lab': {
      const p = e.payload;
      if (p.analyte === OTHER || !ANALYTE_BY_ID.has(p.analyte)) {
        out.analyte = OTHER;
        out.analyteOther = p.analyteName;
      } else out.analyte = p.analyte;
      if (p.result.kind === 'numeric') {
        out.resultKind = 'numeric';
        out.value = formatNumber(p.result.value);
        out.unit = p.unit;
      } else {
        out.resultKind = 'text';
        out.resultText = p.result.text;
      }
      put('refLow', n(p.refLow));
      put('refHigh', n(p.refHigh));
      put('refText', p.refText);
      put('comment', p.comment);
      break;
    }
    case 'vital': {
      const p = e.payload;
      out.vital = p.vital;
      out.unit = p.unit;
      put('value', n(p.value));
      put('systolic', n(p.systolic));
      put('diastolic', n(p.diastolic));
      put('periodHours', n(p.periodHours));
      put('comment', p.comment);
      break;
    }
    case 'weight':
      out.value = formatNumber(e.payload.value);
      out.method = e.payload.method;
      break;
    case 'med_start': {
      const p = e.payload;
      out.drug = p.drug;
      put('brand', p.brand);
      doseValues(p.dose, out);
      listValue(p.route, ROUTES, 'route', out);
      listValue(p.frequency, FREQUENCIES, 'frequency', out);
      put('indication', p.indication);
      put('notes', p.notes);
      break;
    }
    case 'med_change': {
      const p = e.payload;
      doseValues(p.dose, out);
      listValue(p.route, ROUTES, 'route', out);
      listValue(p.frequency, FREQUENCIES, 'frequency', out);
      put('reason', p.reason);
      break;
    }
    case 'med_stop':
      put('reason', e.payload.reason);
      break;
    case 'imaging':
      listValue(e.payload.modality, IMAGING_MODALITIES, 'modality', out);
      put('region', e.payload.region);
      out.reportText = e.payload.reportText;
      break;
    case 'procedure':
      out.name = e.payload.name;
      put('details', e.payload.details);
      break;
    case 'culture': {
      const p = e.payload;
      listValue(p.specimen, CULTURE_SPECIMENS, 'specimen', out);
      out.status = p.status;
      put('organism', p.organism);
      put('gramStain', p.gramStain);
      put('susceptibility', p.susceptibility);
      break;
    }
    case 'note': {
      const p = e.payload;
      out.category = p.category;
      if (p.category === 'allergy_adr') {
        out.kind = p.kind;
        put('substance', p.substance);
        put('reaction', p.reaction);
        put('severity', p.severity);
      } else if (p.category === 'social_history') {
        out.khat = p.khat;
        put('khatDetails', p.khatDetails);
        out.tobacco = p.tobacco;
        put('tobaccoDetails', p.tobaccoDetails);
        put('alcohol', p.alcohol);
        put('occupation', p.occupation);
        put('other', p.other);
      } else if (p.category === 'problem') {
        out.name = p.name;
        out.acuity = p.acuity;
        out.status = p.status;
        put('stage', p.stage);
        put('problemType', p.problemType);
        put('duration', p.duration);
        out.primaryDiagnosis = p.primaryDiagnosis ? 'yes' : 'no';
      } else {
        out.text = p.text;
      }
      break;
    }
    case 'event':
      out.category = e.payload.category;
      out.description = e.payload.description;
      break;
    case 'intervention':
    case 'outcome':
      break;
  }
  return out;
}

/** The BuildContext needed to rebuild an entry of this kind (ids that must be carried over). */
export function contextForEntry(e: TimelineEntry): BuildContext {
  switch (e.type) {
    case 'med_start':
    case 'med_change':
    case 'med_stop':
      return { medId: e.payload.medId, drug: e.payload.drug };
    case 'note':
      return e.payload.category === 'problem' ? { problemId: e.payload.problemId } : {};
    default:
      return {};
  }
}
