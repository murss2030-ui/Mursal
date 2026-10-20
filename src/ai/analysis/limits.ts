/**
 * What the model never drafts (Section 24), enforced in code: the payload
 * does not ask for these, and verify.ts removes them if the model offers
 * them anyway.
 *
 * - Something a person did or that happened: interviews, communication,
 *   discussions with the preceptor, double-checks, reports, decisions taken
 *   on rounds or at discharge. A draft must never render a proposed
 *   intervention as implemented, or an unmeasured outcome as documented.
 * - Sources and references: the model never names, cites or vouches for one.
 * - Results and targets that must come from a calculation or a reference.
 * - The trainee's own work: the reflection, teaching points and sign-offs.
 */
import type { RegisterId } from '../../domain/types';

/** Tasks the model does not draft at all: naming guidelines (t23) would be citing; the reflection (t25) is the trainee's own. */
export const UNDRAFTED_TASKS: ReadonlySet<string> = new Set(['t23', 't25']);

/** Checklist items only the trainee can answer, as `taskId:checkId`. */
export const TRAINEE_ONLY_CHECKS: ReadonlySet<string> = new Set([
  't01:verified',
  't01:unclear',
  't01:interview',
  't02:otc_herbal',
  't02:allergies_confirmed',
  't02:discrepancies_resolved',
  't22:asked_each',
  't22:barriers_explored',
  't22:plan_agreed',
  't28:double_check',
  't28:pump',
  't28:informed',
  't09:rate',
  't09:pump',
  't07:history_updated',
  't26:allergy_visible',
  't26:iv_prep',
  't26:high_alert',
  't19:adrs_reported',
  't19:errors_reported',
  't19:lessons',
  't13:sbar',
  't13:preceptor',
  't13:responses',
  't24:availability',
  't24:affordability',
  't12:prepared',
  't12:contributed',
  't12:logged',
  't29:reassessed',
  't20:availability',
  't21:reviewed',
  't17:needs_assessed',
  't17:caregiver',
  't17:teach_back',
  't18:form',
  't18:preceptor',
  't30:preceptor',
]);

/** Registers whose rows record only what the trainee did or read: rounds, counselling, their calculations, their references. */
export const TRAINEE_ONLY_REGISTERS: ReadonlySet<RegisterId> = new Set<RegisterId>(['reference', 'rounds', 'counseling', 'calc_check']);

/** 'never', or the only values the model may propose for a choice. */
export type FieldLimit = 'never' | readonly string[];

export const FIELD_LIMITS: Partial<Record<RegisterId, Readonly<Record<string, FieldLimit>>>> = {
  home_med: { lastDose: 'never', adherence: 'never', resolution: 'never', action: 'never', dischargeDecision: 'never', dischargeNote: 'never' },
  drp: {
    recStatus: ['draft'],
    // M4: the department category before PCNE (kept only to read old rows), and the trainee's adjustment of the form boxes.
    category: 'never',
    boxes: 'never',
    boxesReason: 'never',
    // M4: links and claims are drafted with their own checks (M4f); until then the model does not propose them.
    supporting: 'never',
    claims: 'never',
    references: 'never',
    response: 'never',
    communicatedTo: 'never',
    communicatedDay: 'never',
    declineReason: 'never',
    implemented: 'never',
    implementedBy: 'never',
    implementedDay: 'never',
    goalMet: 'never',
    outcome: 'never',
    outcomeDay: 'never',
    teaching: 'never',
    preceptorReviewed: 'never',
  },
  // The trainee looks up and writes everything about an interaction but the drugs (owner decision, 19 October 2026).
  interaction: { severity: 'never', source: 'never', mechanism: 'never', effect: 'never', management: 'never' },
  adr: { action: 'never', dechallenge: 'never', outcome: 'never', causality: 'never', preventable: 'never', reported: 'never', reportDay: 'never' },
  med_error: { reached: 'never', reported: 'never' },
  tdm: { target: 'never' },
  monitoring: { target: 'never', status: ['active'] },
  discharge_med: { available: 'never' },
};

export const modelMayAnswer = (taskId: string, checkId: string): boolean => !UNDRAFTED_TASKS.has(taskId) && !TRAINEE_ONLY_CHECKS.has(`${taskId}:${checkId}`);

export const modelMayAddTo = (register: RegisterId): boolean => !TRAINEE_ONLY_REGISTERS.has(register);

/** The limit on one field, or undefined when the model may propose any valid value. */
export const fieldLimit = (register: RegisterId, field: string): FieldLimit | undefined => FIELD_LIMITS[register]?.[field];
