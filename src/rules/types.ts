/**
 * Clinical rules and safety (Section 10): deterministic rules over the case
 * record, with no model involvement. A rule answers a question with a defined
 * right answer and flags it with its source; it never gives a therapeutic
 * verdict — the trainee judges.
 *
 * Exactly three levels (alert-fatigue control):
 * - critical: interruptive, acknowledged with a reason (documented allergy
 *   match; a contraindicated interaction pair; a laboratory value in the
 *   hospital's critical range);
 * - important: an inline badge on the item, no interruption;
 * - informational: a collapsed group, opened on demand.
 */
import type { L } from '../domain/label';

export const RULE_IDS = [
  'allergy',
  'interaction',
  'duplication',
  'high_alert',
  'lab_critical',
  'creatinine_rise',
  'renal_adjustment',
  'hepatic_adjustment',
  'dose_blocked',
  'aware',
  'antibiotic_timeout',
  'deescalation',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type AlertLevel = 'critical' | 'important' | 'informational';

export interface Alert {
  /** Stable for one case and one cause: `${ruleId}:${cause}`. Duplicates of a key collapse into one alert. */
  key: string;
  ruleId: RuleId;
  level: AlertLevel;
  title: L;
  detail: L;
  /** Where the rule's knowledge comes from (dataset, citation, the trainee's own table). */
  source: L;
  /** Changes when the data behind the alert changes; an acknowledgement covers one key and one data hash. */
  dataHash: string;
  /** Medication courses, register rows and timeline entries the alert is about (for inline badges and links). */
  medIds?: string[];
  itemIds?: string[];
  entryIds?: string[];
  /** The task worksheet where it is acted on. */
  taskId?: string;
}

/** Something the engine could not check — reported, never treated as safe. */
export interface NotChecked {
  key: string;
  what: 'drug_name' | 'allergen' | 'interactions' | 'aware' | 'lab_unit';
  /** The name or item concerned, as written. */
  subject?: string;
  reason: L;
}

export interface RulesOutcome {
  alerts: Alert[];
  notChecked: NotChecked[];
}

/** One drug-drug interaction from a dataset (DDInter 2.0, raised by the ONC high-priority list). */
export interface InteractionHit {
  severity: 'major' | 'moderate' | 'minor' | 'unknown';
  /** On the ONC high-priority list (Phansalkar et al., JAMIA 2012). */
  onc: boolean;
  mechanism?: string;
  management?: string;
  sourceId?: string;
}

export interface InteractionDataset {
  version: string;
  citation: string;
  lookup(ingredientA: string, ingredientB: string): InteractionHit[];
}

export interface AwareDataset {
  version: string;
  citation: string;
  categoryOf(ingredient: string): 'access' | 'watch' | 'reserve' | undefined;
}
