import { daysBetween } from './dates';
import type { Rotation } from './types';

/** The rotation whose dates include `today`; if several overlap, the one that started last. */
export function currentRotation(rotations: readonly Rotation[], today: string): Rotation | undefined {
  return rotations
    .filter((r) => r.startDate <= today && today <= r.endDate)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0];
}

/** 1-based day of the rotation and its total length in days. */
export function rotationProgress(r: Rotation, today: string): { day: number; total: number } {
  return { day: daysBetween(r.startDate, today) + 1, total: daysBetween(r.startDate, r.endDate) + 1 };
}
