import { describe, expect, it } from 'vitest';
import { ALLERGY_KINDS, CULTURE_STATUSES, EVENT_CATEGORIES, HABIT_STATUSES, NOTE_CATEGORIES, PROBLEM_STATUSES, SEVERITIES, WEIGHT_METHODS, type FieldError } from '../../src/domain/entries';
import type { FormNote, MissingCode } from '../../src/domain/form/derive';
import { CARD_DECISIONS, COMPETENCY_AREAS, DECISIONS_NEEDING_REASON, DEPARTMENTS, ENTRY_TYPES } from '../../src/domain/types';
import { CLAIM_SOURCES } from '../../src/domain/card-data';
import { RESEARCH_FLAGS, RESEARCH_ROLES } from '../../src/domain/research';
import { SOURCE_KINDS } from '../../src/domain/sources';
import { CARD_STAGES, type FormExclusion } from '../../src/domain/problem-card';
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
      // M4: the Problem Card.
      ...CARD_STAGES.map((x) => `card.stage.${x}`),
      ...['calc_or_dataset', 'case_data', 'no_source'].map((x) => `card.evidence.${x}`),
      ...CARD_DECISIONS.map((x) => `cardReview.decision.${x}`),
      ...[...DECISIONS_NEEDING_REASON].map((x) => `cardReview.reason.${x}`),
      ...CLAIM_SOURCES.flatMap((x) => [`claims.kind.${x}`, `claims.from.${x}`]),
      ...['numbers_found', 'numbers_not_found', 'source_changed', 'source_missing'].map((x) => `claims.check.${x}`),
      ...['reading', 'none', 'dataset', 'research'].map((x) => `claims.check.not_checked.${x}`),
      ...(['stale', 'rejected', 'needs_evidence', 'needs_senior_review', 'undecided', 'no_recommendation', 'not_final', 'untraced_dose'] satisfies FormExclusion[]).map((x) => `form.excluded.${x}`),
      ...(['pcne_map_draft', 'boxes_adjusted'] satisfies FormNote[]).map((x) => `form.note.${x}`),
      ...(['drp_excluded', 'no_final_recommendation'] satisfies MissingCode[]).map((x) => `form.missing.${x}`),
      'caseView.tab.problems',
      // M5: the research screen.
      ...RESEARCH_ROLES.map((x) => `research.role.${x}`),
      ...RESEARCH_FLAGS.map((x) => `research.flag.${x}`),
      ...SOURCE_KINDS.map((x) => `research.source.kind.${x}`),
      ...['population', 'intervention', 'comparison', 'outcome'].flatMap((x) => [`research.p.${x}`, `research.p.${x}Hint`]),
      ...['library_empty', 'library_local_only', 'open_sources_offline', 'open_sources_failed', 'identifier_refused'].map((x) => `research.notes.${x}`),
      ...['good', 'caution', 'limit'].flatMap((l) => [`research.f.sources.${l}`, `research.f.verification.${l}`]),
      ...['abstracts', 'age', 'conflict', 'missing', 'local_only', 'offline', 'calculation'].map((x) => `research.f.${x}`),
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
