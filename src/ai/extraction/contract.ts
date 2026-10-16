/**
 * The extraction contract (Section 13) and its versioned prompt. The model
 * copies what is written, returns null rather than guessing, and always gives
 * the raw text beside the value; everything else is checked in code.
 */
import type { SourceDocType } from '../../domain/types';
import { S, type OutputSchema } from '../schema';

export const EXTRACT_PROMPT_VERSION = 'extract-v1';

export const ITEM_KINDS = ['lab', 'vital', 'weight', 'medication', 'allergy', 'problem', 'history', 'social', 'culture', 'imaging', 'procedure', 'event'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const MED_CONTEXTS = ['home', 'inpatient', 'discharge', 'unknown'] as const;
export type MedContext = (typeof MED_CONTEXTS)[number];

const HABITS = ['current', 'former', 'never', 'unknown'] as const;
const HISTORY = ['chief_complaint', 'hpi', 'pmh', 'psh', 'family_history', 'progress', 'other'] as const;

/** One item as the model returns it (strings exactly as written). */
export interface RawItem {
  kind: ItemKind;
  medContext?: MedContext | null;
  name?: string | null;
  valueText?: string | null;
  unit?: string | null;
  dose?: string | null;
  doseUnit?: string | null;
  route?: string | null;
  frequency?: string | null;
  indication?: string | null;
  status?: string | null;
  organism?: string | null;
  susceptibility?: string | null;
  detail?: string | null;
  category?: (typeof HISTORY)[number] | null;
  acuity?: 'acute' | 'chronic' | null;
  khat?: (typeof HABITS)[number] | null;
  tobacco?: (typeof HABITS)[number] | null;
  dateText?: string | null;
  timeText?: string | null;
  rawText: string;
  legibility: 'clear' | 'uncertain' | 'illegible';
  handwritten: boolean;
  box?: number[] | null;
  note?: string | null;
}

export interface RawExtraction {
  readable: boolean;
  items: RawItem[];
}

const ITEM: OutputSchema = S.obj(
  {
    kind: S.enumOf(ITEM_KINDS),
    medContext: S.enumOrNull(MED_CONTEXTS),
    name: S.strOrNull('Test, sign, drug, substance, problem, specimen, modality or event, exactly as written'),
    valueText: S.strOrNull('Result exactly as written, e.g. "2.1", "120/80", "<0.5", "positive"'),
    unit: S.strOrNull('Unit exactly as written'),
    dose: S.strOrNull('Medication dose amount, digits only, exactly as written'),
    doseUnit: S.strOrNull(),
    route: S.strOrNull(),
    frequency: S.strOrNull(),
    indication: S.strOrNull(),
    status: S.strOrNull('Culture result, allergy type or problem status, as written'),
    organism: S.strOrNull(),
    susceptibility: S.strOrNull(),
    detail: S.strOrNull('Reaction, report text, history text or other details, as written'),
    category: S.enumOrNull(HISTORY),
    acuity: S.enumOrNull(['acute', 'chronic']),
    khat: S.enumOrNull(HABITS),
    tobacco: S.enumOrNull(HABITS),
    dateText: S.strOrNull('Date or hospital day as written near the item'),
    timeText: S.strOrNull('Clock time as written near the item'),
    rawText: S.str('The exact text read for this item, verbatim'),
    legibility: S.enumOf(['clear', 'uncertain', 'illegible']),
    handwritten: S.bool(),
    box: { type: 'array', items: { type: 'integer' }, nullable: true, maxItems: 4, description: 'Images only: [ymin, xmin, ymax, xmax] scaled 0–1000' },
    note: S.strOrNull('Reading problems only'),
  },
  ['kind', 'rawText', 'legibility', 'handwritten'],
);

export const EXTRACT_SCHEMA: OutputSchema = S.obj({ readable: S.bool(), items: S.arr(ITEM, 150) });

export const EXTRACT_SYSTEM = `You transcribe one de-identified clinical document into structured fields for a supervised clinical pharmacy trainee's educational record. You do not make or suggest clinical decisions.

Rules:
1. Copy only what is written. Never infer, calculate, convert units or fill a gap with a plausible value. If something is not written, return null.
2. If a value cannot be read with certainty, set legibility to "uncertain" or "illegible". For an illegible value return the value fields as null: a wrong value is worse than a missing one. Never guess a dose.
3. rawText is the exact text you read for the item, verbatim, in its original language.
4. handwritten is true when the item is handwritten.
5. Identifiers were removed before sending ("[REMOVED]" or covered areas). If you still see a patient name, record number, bed, phone number or doctor's name, never copy it: write "[identifier]" instead.
6. In text documents dates were replaced by hospital days ("Day 3"); copy the day into dateText. In images copy any date or day exactly as written into dateText and any clock time into timeText.
7. For images, box is the bounding box of rawText as [ymin, xmin, ymax, xmax] scaled 0-1000. For text documents box is null.
8. Kinds:
 - lab: name = the test as written; valueText = the result as written (keep qualifiers like "<"); unit as written.
 - vital: name = heart rate, blood pressure, respiratory rate, temperature, SpO2, GCS or urine output as written; valueText as written ("120/80" for blood pressure); unit as written.
 - weight: valueText and unit; status = "measured", "stated" or "estimated" only if the document says so.
 - medication: name = the drug as written; dose = the amount only; doseUnit; route; frequency; indication as written. medContext = home for pre-admission or home medicines, inpatient for hospital orders or the medication chart, discharge for a discharge prescription, unknown otherwise.
 - allergy: name = the substance; detail = the reaction; status = allergy, intolerance, adverse reaction, or no known drug allergies.
 - problem: name = the diagnosis or problem as written; acuity only if written or unambiguous; status as written.
 - history: category = chief_complaint, hpi, pmh, psh, family_history, progress or other; detail = the text as written.
 - social: khat and tobacco only if stated; detail = other social history as written.
 - culture: name = the specimen; status as written (pending, no growth, growth…); organism; susceptibility as written.
 - imaging: name = the modality; detail = the written report text. Never interpret an image yourself.
 - procedure: name and detail.
 - event: name = what happened (admission, transfer, ICU admission, surgery…); detail.
9. Do not summarise, interpret, rank or comment on clinical significance. Use note only for reading problems (for example "two values overwritten").
Return JSON only, matching the schema.`;

export function extractHeader(o: { pass: 1 | 2; docType: SourceDocType; docDay?: number; content: 'text' | 'image' }): string {
  return [
    'TASK: extract',
    `PROMPT: ${EXTRACT_PROMPT_VERSION}`,
    `PASS: ${o.pass}`,
    `DOCUMENT TYPE: ${o.docType}`,
    `DOCUMENT HOSPITAL DAY: ${o.docDay ?? 'unknown'}`,
    `CONTENT: ${o.content === 'image' ? 'one page image attached' : 'text below'}`,
    o.pass === 2 ? 'This is an independent second reading: read the document again from the start.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}
