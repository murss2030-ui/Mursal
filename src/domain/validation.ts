/**
 * Validation of case and rotation records. Used by the forms for inline
 * messages and again by the store before anything is written.
 */
import { RELEASE_GATE_MET } from '../config/release';
import { daysBetween, isValidISODate } from './dates';
import type { Errors } from './entries';
import { COMPETENCY_AREAS, DEPARTMENTS } from './types';
import type { CaseKind, CaseStatus, CompetencyArea, DepartmentId, Sex } from './types';

export class ValidationError extends Error {
  constructor(readonly errors: Errors) {
    super(`Invalid input: ${Object.entries(errors).map(([k, v]) => `${k} (${v})`).join(', ')}`);
    this.name = 'ValidationError';
  }
}

export const MAX_AGE_YEARS = 120;
export const MAX_HEIGHT_CM = 250;

export interface CaseIdentifiersInput {
  patientName?: string;
  mrn?: string;
  roomBed?: string;
  consultantName?: string;
}

export interface NewCaseInput {
  kind: CaseKind;
  rotationId: string;
  ageYears: number;
  sex: Sex;
  heightCm?: number;
  admissionDay0: string;
  ward?: string;
  /** Required while the release gate is not met (Section 23). */
  syntheticDataAttested: boolean;
  /** Clinical cases only. */
  identifiers?: CaseIdentifiersInput;
}

export interface CasePatch {
  rotationId?: string;
  ageYears?: number;
  sex?: Sex;
  heightCm?: number | null;
  admissionDay0?: string;
  ward?: string | null;
  status?: CaseStatus;
  dischargeDate?: string | null;
}

export function validateDemographics(
  d: { ageYears?: number; sex?: string; heightCm?: number | null; admissionDay0?: string },
  today: string,
): Errors {
  const e: Errors = {};
  if (d.ageYears !== undefined) {
    if (!Number.isFinite(d.ageYears)) e.ageYears = 'number';
    else if (d.ageYears < 0 || d.ageYears > MAX_AGE_YEARS) e.ageYears = 'range';
  }
  if (d.sex !== undefined && d.sex !== 'M' && d.sex !== 'F') e.sex = 'required';
  if (d.heightCm !== undefined && d.heightCm !== null) {
    if (!Number.isFinite(d.heightCm) || d.heightCm <= 0 || d.heightCm > MAX_HEIGHT_CM) e.heightCm = 'range';
  }
  if (d.admissionDay0 !== undefined) {
    if (!isValidISODate(d.admissionDay0)) e.admissionDay0 = 'required';
    else if (daysBetween(today, d.admissionDay0) > 0) e.admissionDay0 = 'range'; // not in the future
  }
  return e;
}

export function validateNewCase(input: Partial<NewCaseInput>, today: string): Errors {
  const e: Errors = {};
  if (input.kind !== 'teaching' && input.kind !== 'clinical') e.kind = 'required';
  if (!input.rotationId) e.rotationId = 'required';
  if (input.ageYears === undefined) e.ageYears = 'required';
  if (input.sex === undefined) e.sex = 'required';
  if (input.admissionDay0 === undefined || input.admissionDay0 === '') e.admissionDay0 = 'required';
  Object.assign(
    e,
    validateDemographics(
      { ageYears: input.ageYears, sex: input.sex, heightCm: input.heightCm, admissionDay0: input.admissionDay0 || undefined },
      today,
    ),
  );
  if (!RELEASE_GATE_MET && !input.syntheticDataAttested) e.syntheticDataAttested = 'required';
  if (input.kind === 'teaching' && input.identifiers && Object.values(input.identifiers).some((v) => v && v.trim())) {
    e.identifiers = 'invalidChoice'; // a Teaching Case never has name or MRN fields
  }
  if ((input.ward ?? '').length > 200) e.ward = 'tooLong';
  return e;
}

export interface RotationInput {
  department: DepartmentId;
  departmentOther?: string;
  startDate: string;
  endDate: string;
  competencies: CompetencyArea[];
  goals?: string;
}

export function validateRotation(r: Partial<RotationInput>): Errors {
  const e: Errors = {};
  if (!r.department) e.department = 'required';
  else if (!(DEPARTMENTS as readonly string[]).includes(r.department)) e.department = 'invalidChoice';
  if (r.department === 'other' && !(r.departmentOther ?? '').trim()) e.departmentOther = 'required';
  if (!r.startDate || !isValidISODate(r.startDate)) e.startDate = 'required';
  if (!r.endDate || !isValidISODate(r.endDate)) e.endDate = 'required';
  if (!e.startDate && !e.endDate && daysBetween(r.startDate!, r.endDate!) < 0) e.endDate = 'range';
  if (r.competencies?.some((c) => !(COMPETENCY_AREAS as readonly string[]).includes(c))) e.competencies = 'invalidChoice';
  if ((r.goals ?? '').length > 4000) e.goals = 'tooLong';
  return e;
}
