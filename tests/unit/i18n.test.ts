import { describe, expect, it } from 'vitest';
import { ALLERGY_KINDS, CULTURE_STATUSES, EVENT_CATEGORIES, HABIT_STATUSES, NOTE_CATEGORIES, PROBLEM_STATUSES, SEVERITIES, WEIGHT_METHODS, type FieldError } from '../../src/domain/entries';
import type { FormNote, MissingCode } from '../../src/domain/form/derive';
import { COMPETENCY_AREAS, DEPARTMENTS, ENTRY_TYPES } from '../../src/domain/types';
import { ar } from '../../src/i18n/ar';
import { en, type MsgKey } from '../../src/i18n/en';
import { TERMS } from '../../src/i18n/terms';

const ARABIC = /[؀-ۿ]/;
/** Values that are legitimately identical in both languages (brand name, language switch label). */
const SAME_IN_BOTH = new Set<MsgKey>(['app.name']);

describe('bilingual completeness', () => {
  it('defines every English key in Arabic, and nothing else', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no untranslated Arabic strings', () => {
    const untranslated = (Object.keys(en) as MsgKey[]).filter(
      (k) => !SAME_IN_BOTH.has(k) && k !== 'shell.switchLanguage' && (!ARABIC.test(ar[k]) || ar[k] === en[k]),
    );
    expect(untranslated).toEqual([]);
  });

  it('keeps every interpolation placeholder in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en) as MsgKey[]) expect(vars(ar[k]), k).toEqual(vars(en[k]));
  });

  it('defines every dynamically built key', () => {
    const fieldErrors: FieldError[] = [
      'required', 'number', 'comma', 'integer', 'unit', 'positive', 'nonNegative', 'range', 'bpOrder',
      'refOrder', 'atLeastOneChange', 'notInM1', 'tooLong', 'invalidChoice', 'time', 'hospitalDay',
    ];
    const missingCodes: MissingCode[] = ['family_history', 'social_history', 'khat_use', 'no_indication', 'room_bed', 'ward'];
    const notes: FormNote[] = ['case_id_replaces_identifier', 'room_withheld', 'nkda_conflict', 'interpretation_needs_rereview'];
    const keys = [
      ...fieldErrors.map((x) => `err.${x}`),
      ...missingCodes.map((x) => `form.missing.${x}`),
      ...notes.map((x) => `form.note.${x}`),
      ...CULTURE_STATUSES.map((x) => `culture.${x}`),
      ...WEIGHT_METHODS.map((x) => `weight.${x}`),
      ...ALLERGY_KINDS.map((x) => `allergy.${x}`),
      ...SEVERITIES.map((x) => `severity.${x}`),
      ...HABIT_STATUSES.map((x) => `habit.${x}`),
      ...PROBLEM_STATUSES.map((x) => `pstatus.${x}`),
      ...['acute', 'chronic'].map((x) => `acuity.${x}`),
      ...EVENT_CATEGORIES.map((x) => `event.${x}`),
      ...['active', 'discharged', 'archived'].map((x) => `case.status.${x}`),
      ...['active', 'discharged', 'archived', 'all'].map((x) => `cases.filter.${x}`),
      ...['all', 'labs', 'vitals', 'meds', 'notes', 'other'].map((x) => `tl.filter.${x}`),
      ...['timeline', 'form', 'details', 'audit'].map((x) => `caseView.tab.${x}`),
      ...['user', 'system', 'model'].map((x) => `audit.actor.${x}`),
      ...['M', 'F'].map((x) => `sex.${x}`),
    ];
    const absent = keys.filter((k) => !(k in en));
    expect(absent).toEqual([]);
  });

  it('defines every clinical term used by the interface, with an Arabic explanation', () => {
    const ids = [
      ...ENTRY_TYPES.map((x) => `entry.${x}`),
      ...NOTE_CATEGORIES.map((x) => `note.${x}`),
      ...DEPARTMENTS.map((x) => `dept.${x}`),
      ...COMPETENCY_AREAS.map((x) => `comp.${x}`),
    ];
    expect(ids.filter((id) => !(id in TERMS))).toEqual([]);
    for (const [id, term] of Object.entries(TERMS)) {
      expect(term.ar, id).toMatch(ARABIC);
      expect(term.en, id).not.toMatch(ARABIC); // the clinical term itself stays English
    }
  });
});
