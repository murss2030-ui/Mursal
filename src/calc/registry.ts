/**
 * Every calculator, with whether it passed its tests.
 *
 * `validated` comes from the validation manifest that the test run writes
 * (scripts/calc-manifest-reporter.ts) and the build reads: a calculator
 * without a passing record — or whose engine changed after the last passing
 * run — is not validated, and the interface hides it with the reason.
 */
import { engineHash, manifest } from 'virtual:preceptor-calc-validation';
import { anc } from './calculators/anc';
import { infusionRateVolume, infusionRateWeight } from './calculators/infusion';
import { bmi, bsaMosteller, ibwAdjbw } from './calculators/body';
import { anionGap, correctedCalcium } from './calculators/electrolytes';
import { childPugh } from './calculators/liver';
import { phenytoinCorrected } from './calculators/phenytoin';
import { qtcBazett, qtcFridericia } from './calculators/qtc';
import { crclCg, egfrCkdEpi2021 } from './calculators/renal';
import { cha2ds2vasc, curb65, hasBled, qsofa } from './calculators/scores';
import { vancomycinAuc } from './calculators/vancomycin';
import { vancomycinEmpiric } from './calculators/vancomycin-empiric';
import { makeCalculator } from './engine';
import type { CalcValidationStatus, Calculator, CalculatorDef, CalculatorId } from './types';

/** In the order the interface lists them. */
export const CALCULATOR_DEFS: readonly CalculatorDef[] = [
  crclCg,
  egfrCkdEpi2021,
  ibwAdjbw,
  bsaMosteller,
  bmi,
  vancomycinAuc,
  vancomycinEmpiric,
  phenytoinCorrected,
  childPugh,
  qtcBazett,
  qtcFridericia,
  anionGap,
  correctedCalcium,
  anc,
  curb65,
  qsofa,
  cha2ds2vasc,
  hasBled,
  infusionRateWeight,
  infusionRateVolume,
];

export type Manifest = typeof manifest;

export function statusOf(def: Pick<CalculatorDef, 'id' | 'formulaVersion'>, m: Manifest, hash: string): CalcValidationStatus {
  if (!m) return { validated: false, reason: 'not_tested' };
  if (m.engineHash !== hash) return { validated: false, reason: 'engine_changed' };
  if (m.engineTests.failed > 0 || m.engineTests.passed === 0) return { validated: false, reason: 'engine_tests_failed' };
  const e = m.calculators[def.id];
  if (!e) return { validated: false, reason: 'not_tested' };
  if (e.formulaVersion !== def.formulaVersion) return { validated: false, reason: 'formula_changed' };
  if (e.failed > 0 || e.passed === 0) return { validated: false, reason: 'tests_failed' };
  return { validated: true, passed: e.passed, at: m.generatedAt };
}

export function buildRegistry(m: Manifest, hash: string): Calculator[] {
  return CALCULATOR_DEFS.map((d) => makeCalculator(d, statusOf(d, m, hash)));
}

export const CALCULATORS: readonly Calculator[] = buildRegistry(manifest, engineHash);
export const CALC_BY_ID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATORS.map((c) => [c.id, c]));
