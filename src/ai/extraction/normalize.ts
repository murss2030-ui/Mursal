/**
 * Deterministic normalisation of what the model read (Section 13): the chart's
 * wording is mapped onto the app's vocabulary, and anything that does not map
 * cleanly is kept as written and flagged — never silently guessed.
 *
 * Abbreviations on the ISMP list of error-prone abbreviations (QD, OD, U, IU,
 * HS, SC/SQ, µg) are expanded but flagged, so the trainee looks at them.
 */
import { ANALYTES, DOSE_UNITS, FREQUENCIES, ROUTES } from '../../domain/catalogue';

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ \s]+/g, ' ')
    .replace(/[.:]+$/g, '')
    .trim();

// ---------------------------------------------------------------- laboratory names

const LAB_ALIASES: Record<string, readonly string[]> = {
  scr: ['creatinine', 'serum creatinine', 's.cr', 's cr', 'scr', 's. creatinine', 'creat', 'cr', 's.creat', 'creatinine (serum)'],
  bun: ['bun', 'blood urea nitrogen'],
  urea: ['urea', 'blood urea', 's. urea', 's.urea'],
  na: ['sodium', 'na', 'na+', 's. sodium', 'serum sodium'],
  k: ['potassium', 'k', 'k+', 's. potassium', 'serum potassium'],
  cl: ['chloride', 'cl', 'cl-'],
  hco3: ['bicarbonate', 'hco3', 'hco3-', 'bicarb'],
  ca_total: ['calcium', 'ca', 'total calcium', 'calcium (total)', 's. calcium'],
  ca_ionized: ['ionized calcium', 'ionised calcium', 'ica', 'calcium (ionized)', 'calcium ionized'],
  mg: ['magnesium', 'mg', 'mg++', 's. magnesium'],
  phos: ['phosphate', 'phosphorus', 'po4', 'phos', 'inorganic phosphorus'],
  albumin: ['albumin', 'alb', 's. albumin', 'serum albumin'],
  glucose: ['glucose', 'blood glucose', 'fbs', 'rbs', 'blood sugar', 'fasting blood sugar', 'random blood sugar', 'glu'],
  hba1c: ['hba1c', 'a1c', 'glycated haemoglobin', 'glycated hemoglobin', 'glycosylated hemoglobin'],
  uric: ['uric acid', 'urate'],
  tbil: ['total bilirubin', 'bilirubin total', 't.bil', 'tbil', 't. bilirubin', 'bilirubin (total)', 'bilirubin', 't bil'],
  dbil: ['direct bilirubin', 'd.bil', 'dbil', 'conjugated bilirubin', 'bilirubin (direct)', 'd. bilirubin', 'd bil'],
  alt: ['alt', 'sgpt', 'alanine aminotransferase', 'alt (sgpt)'],
  ast: ['ast', 'sgot', 'aspartate aminotransferase', 'ast (sgot)'],
  alp: ['alp', 'alkaline phosphatase', 'alk phos'],
  ggt: ['ggt', 'gamma gt', 'gamma-glutamyl transferase', 'γgt'],
  inr: ['inr'],
  pt: ['pt', 'prothrombin time'],
  aptt: ['aptt', 'ptt', 'activated partial thromboplastin time'],
  hb: ['hemoglobin', 'haemoglobin', 'hb', 'hgb'],
  wbc: ['wbc', 'white blood cells', 'white cell count', 'tlc', 'total leukocyte count', 'leukocytes', 'total wbc'],
  neut_abs: ['anc', 'absolute neutrophil count', 'neutrophils (absolute)', 'neutrophils absolute', 'abs neutrophils'],
  neut_pct: ['neutrophils %', 'neutrophils', 'neut %', 'neut', 'polymorphs', 'neutrophils (%)', 'segmented neutrophils'],
  bands_pct: ['bands', 'band neutrophils', 'band forms', 'bands %'],
  plt: ['platelets', 'plt', 'platelet count', 'platelet'],
  crp: ['crp', 'c-reactive protein', 'c reactive protein'],
  pct: ['procalcitonin', 'pct'],
  lactate: ['lactate', 'lactic acid'],
  trop: ['troponin', 'trop', 'troponin i', 'troponin t', 'hs-troponin', 'ctni', 'ctnt', 'hs troponin'],
  bnp: ['bnp', 'b-type natriuretic peptide'],
  ntprobnp: ['nt-probnp', 'ntprobnp', 'nt pro bnp'],
  ck: ['ck', 'cpk', 'creatine kinase', 'creatine phosphokinase'],
  tsh: ['tsh', 'thyroid stimulating hormone'],
  lipase: ['lipase'],
  vanco: ['vancomycin', 'vancomycin level', 'vancomycin trough', 'vanco trough', 'vanco level'],
  phenytoin: ['phenytoin', 'phenytoin level'],
  digoxin: ['digoxin', 'digoxin level'],
};

const LAB_INDEX = new Map<string, string>();
for (const [id, names] of Object.entries(LAB_ALIASES)) for (const n of names) LAB_INDEX.set(key(n), id);

/** The catalogue id of a laboratory test name, or undefined when it is not recognised. */
export function matchAnalyte(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const k = key(name)
    .replace(/\s*\((serum|plasma|blood)\)$/, '')
    .replace(/^(serum|plasma|s\.?)\s+/, '');
  return LAB_INDEX.get(k) ?? LAB_INDEX.get(key(name));
}

// ---------------------------------------------------------------- units

const UNIT_ALIASES: Record<string, string> = {
  'mg/dl': 'mg/dL',
  'mg%': 'mg/dL',
  'umol/l': 'µmol/L',
  'µmol/l': 'µmol/L',
  'μmol/l': 'µmol/L',
  'micromol/l': 'µmol/L',
  'mmol/l': 'mmol/L',
  'meq/l': 'mEq/L',
  'g/dl': 'g/dL',
  'gm/dl': 'g/dL',
  'g/l': 'g/L',
  'u/l': 'U/L',
  'iu/l': 'U/L',
  'x10^9/l': '×10⁹/L',
  '×10^9/l': '×10⁹/L',
  'x10⁹/l': '×10⁹/L',
  '×10⁹/l': '×10⁹/L',
  '10^9/l': '×10⁹/L',
  'x 10^9/l': '×10⁹/L',
  'x10*9/l': '×10⁹/L',
  '10*9/l': '×10⁹/L',
  'x10^3/ul': '×10³/µL',
  'x10^3/µl': '×10³/µL',
  '×10^3/µl': '×10³/µL',
  'x10³/µl': '×10³/µL',
  '×10³/µl': '×10³/µL',
  '10^3/ul': '×10³/µL',
  '10^3/µl': '×10³/µL',
  'k/ul': '×10³/µL',
  'k/µl': '×10³/µL',
  'thou/ul': '×10³/µL',
  '%': '%',
  'mmol/mol': 'mmol/mol',
  'ng/ml': 'ng/mL',
  'pg/ml': 'pg/mL',
  'mg/l': 'mg/L',
  'mcg/ml': 'mcg/mL',
  'µg/ml': 'mcg/mL',
  'ug/ml': 'mcg/mL',
  'mcg/l': 'mcg/L',
  'µg/l': 'mcg/L',
  'ug/l': 'mcg/L',
  'nmol/l': 'nmol/L',
  'ng/l': 'ng/L',
  'miu/l': 'mIU/L',
  'uiu/ml': 'mIU/L',
  'µiu/ml': 'mIU/L',
  'μiu/ml': 'mIU/L',
  's': 's',
  'sec': 's',
  'secs': 's',
  'seconds': 's',
  'ratio': 'unitless',
  '': 'unitless',
};

/** A laboratory unit in the catalogue's spelling, or undefined when it is not recognised. */
export function normalizeLabUnit(unit: string | null | undefined, analyte?: string): string | undefined {
  const raw = key(unit ?? '').replace(/\s+/g, '');
  if (analyte === 'inr' && (raw === '' || raw === 'ratio' || raw === 'unitless')) return 'unitless';
  if (raw === '') return undefined;
  const u = UNIT_ALIASES[raw];
  if (!u || u === 'unitless') return undefined;
  if (analyte) {
    const def = ANALYTES.find((a) => a.id === analyte);
    if (def && !def.units.includes(u)) return undefined;
  }
  return u;
}

// ---------------------------------------------------------------- routes and frequencies

export interface Mapped {
  value: string;
  /** The chart used an error-prone abbreviation (ISMP); the expansion needs a look. */
  abbreviation?: boolean;
}

const ROUTE_ALIASES: Record<string, Mapped> = {
  po: { value: 'PO' },
  oral: { value: 'PO' },
  orally: { value: 'PO' },
  'per os': { value: 'PO' },
  'by mouth': { value: 'PO' },
  iv: { value: 'IV' },
  intravenous: { value: 'IV' },
  intravenously: { value: 'IV' },
  'iv infusion': { value: 'IV' },
  'iv bolus': { value: 'IV' },
  im: { value: 'IM' },
  intramuscular: { value: 'IM' },
  sc: { value: 'subcut', abbreviation: true },
  's/c': { value: 'subcut', abbreviation: true },
  sq: { value: 'subcut', abbreviation: true },
  subcut: { value: 'subcut' },
  subcutaneous: { value: 'subcut' },
  sl: { value: 'sublingual' },
  sublingual: { value: 'sublingual' },
  pr: { value: 'PR' },
  rectal: { value: 'PR' },
  inh: { value: 'inhaled' },
  inhaled: { value: 'inhaled' },
  inhalation: { value: 'inhaled' },
  neb: { value: 'nebulised' },
  nebulised: { value: 'nebulised' },
  nebulized: { value: 'nebulised' },
  topical: { value: 'topical' },
  top: { value: 'topical' },
  td: { value: 'transdermal' },
  transdermal: { value: 'transdermal' },
  patch: { value: 'transdermal' },
  ng: { value: 'NG tube' },
  ngt: { value: 'NG tube' },
  'ng tube': { value: 'NG tube' },
  'via ngt': { value: 'NG tube' },
  intrathecal: { value: 'intrathecal' },
  it: { value: 'intrathecal', abbreviation: true },
  io: { value: 'intraosseous' },
  intraosseous: { value: 'intraosseous' },
  ophthalmic: { value: 'ophthalmic' },
  eye: { value: 'ophthalmic' },
  'eye drops': { value: 'ophthalmic' },
  otic: { value: 'otic' },
  ear: { value: 'otic' },
  nasal: { value: 'nasal' },
  intranasal: { value: 'nasal' },
  vaginal: { value: 'vaginal' },
  pv: { value: 'vaginal' },
};

const FREQ_ALIASES: Record<string, Mapped> = {
  once: { value: 'once' },
  'single dose': { value: 'once' },
  stat: { value: 'STAT' },
  od: { value: 'once daily', abbreviation: true },
  qd: { value: 'once daily', abbreviation: true },
  daily: { value: 'once daily' },
  'once daily': { value: 'once daily' },
  'once a day': { value: 'once daily' },
  'every day': { value: 'once daily' },
  bd: { value: 'twice daily' },
  bid: { value: 'twice daily' },
  'b.i.d': { value: 'twice daily' },
  'twice daily': { value: 'twice daily' },
  'twice a day': { value: 'twice daily' },
  tds: { value: 'three times daily' },
  tid: { value: 'three times daily' },
  't.i.d': { value: 'three times daily' },
  'three times daily': { value: 'three times daily' },
  'three times a day': { value: 'three times daily' },
  qds: { value: 'four times daily' },
  qid: { value: 'four times daily' },
  'q.i.d': { value: 'four times daily' },
  'four times daily': { value: 'four times daily' },
  'four times a day': { value: 'four times daily' },
  q4h: { value: 'every 4 hours' },
  'every 4 hours': { value: 'every 4 hours' },
  '4 hourly': { value: 'every 4 hours' },
  q6h: { value: 'every 6 hours' },
  'every 6 hours': { value: 'every 6 hours' },
  '6 hourly': { value: 'every 6 hours' },
  q8h: { value: 'every 8 hours' },
  'every 8 hours': { value: 'every 8 hours' },
  '8 hourly': { value: 'every 8 hours' },
  q12h: { value: 'every 12 hours' },
  'every 12 hours': { value: 'every 12 hours' },
  '12 hourly': { value: 'every 12 hours' },
  q24h: { value: 'every 24 hours' },
  'every 24 hours': { value: 'every 24 hours' },
  q36h: { value: 'every 36 hours' },
  q48h: { value: 'every 48 hours' },
  'every 48 hours': { value: 'every 48 hours' },
  weekly: { value: 'once weekly' },
  'once weekly': { value: 'once weekly' },
  'once a week': { value: 'once weekly' },
  hs: { value: 'at bedtime', abbreviation: true },
  nocte: { value: 'at bedtime' },
  'at night': { value: 'at bedtime' },
  'at bedtime': { value: 'at bedtime' },
  prn: { value: 'as needed (PRN)' },
  'as needed': { value: 'as needed (PRN)' },
  'when required': { value: 'as needed (PRN)' },
  'as needed (prn)': { value: 'as needed (PRN)' },
  infusion: { value: 'continuous infusion' },
  'continuous infusion': { value: 'continuous infusion' },
  continuous: { value: 'continuous infusion' },
};

const strip = (s: string) => key(s).replace(/\.$/, '').replace(/\s+/g, ' ');

export function mapRoute(raw: string | null | undefined): Mapped | undefined {
  if (!raw) return undefined;
  const k = strip(raw);
  if ((ROUTES as readonly string[]).includes(raw.trim())) return { value: raw.trim() };
  return ROUTE_ALIASES[k] ?? ROUTE_ALIASES[k.replace(/\./g, '')];
}

export function mapFrequency(raw: string | null | undefined): Mapped | undefined {
  if (!raw) return undefined;
  const k = strip(raw);
  if ((FREQUENCIES as readonly string[]).includes(raw.trim())) return { value: raw.trim() };
  return FREQ_ALIASES[k] ?? FREQ_ALIASES[k.replace(/\./g, '')] ?? FREQ_ALIASES[k.replace(/[\s.]/g, '')];
}

// ---------------------------------------------------------------- doses

const DOSE_UNIT_ALIASES: Record<string, Mapped> = {
  mg: { value: 'mg' },
  g: { value: 'g' },
  gm: { value: 'g' },
  gram: { value: 'g' },
  grams: { value: 'g' },
  mcg: { value: 'mcg' },
  µg: { value: 'mcg', abbreviation: true },
  μg: { value: 'mcg', abbreviation: true },
  ug: { value: 'mcg', abbreviation: true },
  units: { value: 'units' },
  unit: { value: 'units' },
  u: { value: 'units', abbreviation: true },
  iu: { value: 'units', abbreviation: true },
  ml: { value: 'mL' },
  mmol: { value: 'mmol' },
  meq: { value: 'mEq' },
  'mg/kg': { value: 'mg/kg' },
  'mcg/kg': { value: 'mcg/kg' },
  'units/kg': { value: 'units/kg' },
  'mg/h': { value: 'mg/h' },
  'mg/hr': { value: 'mg/h' },
  'mg/kg/h': { value: 'mg/kg/h' },
  'mcg/min': { value: 'mcg/min' },
  'mcg/kg/min': { value: 'mcg/kg/min' },
  'units/h': { value: 'units/h' },
  'units/hr': { value: 'units/h' },
  'units/kg/h': { value: 'units/kg/h' },
  'ml/h': { value: 'mL/h' },
  'ml/hr': { value: 'mL/h' },
  puff: { value: 'puff' },
  puffs: { value: 'puff' },
  drop: { value: 'drop' },
  drops: { value: 'drop' },
  tab: { value: 'tablet' },
  tabs: { value: 'tablet' },
  tablet: { value: 'tablet' },
  tablets: { value: 'tablet' },
  cap: { value: 'capsule' },
  caps: { value: 'capsule' },
  capsule: { value: 'capsule' },
  capsules: { value: 'capsule' },
  sachet: { value: 'sachet' },
  sachets: { value: 'sachet' },
  application: { value: 'application' },
};

export function mapDoseUnit(raw: string | null | undefined): Mapped | undefined {
  if (!raw) return undefined;
  const k = strip(raw).replace(/\s+/g, '');
  if ((DOSE_UNITS as readonly string[]).includes(raw.trim())) return { value: raw.trim() };
  return DOSE_UNIT_ALIASES[k];
}

/**
 * A number as printed. A comma is never taken as a decimal mark (it may be a
 * thousands separator), and a qualified value such as "<0.5" is not a number:
 * both are refused, and the value is kept as text instead.
 */
export function parsePrintedNumber(raw: string | null | undefined): { ok: true; value: number } | { ok: false; reason: 'empty' | 'comma' | 'invalid' } {
  const s = (raw ?? '').trim();
  if (s === '') return { ok: false, reason: 'empty' };
  if (s.includes(',')) return { ok: false, reason: 'comma' };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: Number(s) };
}

/** "120/80" → systolic and diastolic. */
export function parseBloodPressure(raw: string | null | undefined): { systolic: number; diastolic: number } | undefined {
  const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(raw ?? '');
  return m ? { systolic: Number(m[1]), diastolic: Number(m[2]) } : undefined;
}
