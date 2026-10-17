/**
 * Naranjo (Clin Pharmacol Ther 1981;30:239–245) and WHO-UMC causality, scored
 * deterministically. Expected scores are sums of the published item points,
 * by hand.
 */
import { describe, expect, it } from 'vitest';
import { assessUmc, NARANJO_QUESTIONS, scoreNaranjo } from '../../src/rules/causality';

const all = (a: string) => Object.fromEntries(NARANJO_QUESTIONS.map((q) => [q.id, a]));

describe('Naranjo', () => {
  it('has the ten published questions with their points', () => {
    expect(NARANJO_QUESTIONS.map((q) => [q.id, q.points.yes, q.points.no, q.points.unknown])).toEqual([
      ['previous', 1, 0, 0],
      ['after', 2, -1, 0],
      ['dechallenge', 1, 0, 0],
      ['rechallenge', 2, -1, 0],
      ['alternative', -1, 2, 0],
      ['placebo', -1, 1, 0],
      ['toxic', 1, 0, 0],
      ['dose', 1, 0, 0],
      ['similar', 1, 0, 0],
      ['objective', 1, 0, 0],
    ]);
  });

  it('all "do not know" → 0, doubtful', () => {
    expect(scoreNaranjo(all('unknown'))).toMatchObject({ ok: true, score: 0, category: 'doubtful' });
  });

  it('every answer pointing to the drug → 1+2+1+2+2+1+1+1+1+1 = 13, definite', () => {
    const a = { ...all('yes'), alternative: 'no', placebo: 'no' };
    expect(scoreNaranjo(a)).toMatchObject({ ok: true, score: 13, category: 'definite' });
  });

  it('every answer pointing away → −1−1−1−1 = −4, doubtful', () => {
    const a = { ...all('no'), alternative: 'yes', placebo: 'yes' };
    expect(scoreNaranjo(a)).toMatchObject({ ok: true, score: -4, category: 'doubtful' });
  });

  it('band boundaries: 9 definite, 8 and 5 probable, 4 and 1 possible', () => {
    const base = all('unknown');
    // after +2, alternative no +2, rechallenge +2, previous +1, dechallenge +1, objective +1 = 9
    expect(scoreNaranjo({ ...base, after: 'yes', alternative: 'no', rechallenge: 'yes', previous: 'yes', dechallenge: 'yes', objective: 'yes' })).toMatchObject({ score: 9, category: 'definite' });
    expect(scoreNaranjo({ ...base, after: 'yes', alternative: 'no', rechallenge: 'yes', previous: 'yes', dechallenge: 'yes' })).toMatchObject({ score: 8, category: 'probable' });
    expect(scoreNaranjo({ ...base, after: 'yes', alternative: 'no', dechallenge: 'yes' })).toMatchObject({ score: 5, category: 'probable' });
    expect(scoreNaranjo({ ...base, after: 'yes', alternative: 'no' })).toMatchObject({ score: 4, category: 'possible' });
    expect(scoreNaranjo({ ...base, objective: 'yes' })).toMatchObject({ score: 1, category: 'possible' });
  });

  it('refuses an incomplete questionnaire and names the unanswered questions', () => {
    const a = all('unknown');
    delete a.placebo;
    delete a.dose;
    expect(scoreNaranjo(a)).toEqual({ ok: false, unanswered: ['placebo', 'dose'] });
  });
});

describe('WHO-UMC', () => {
  const base = { information: 'sufficient', time: 'reasonable', alternative: 'no', dechallenge: 'reasonable', rechallenge: 'not_done', definitive: 'yes' };

  it('certain: plausible timing, no other explanation, response to withdrawal, definitive event', () => {
    expect(assessUmc(base)).toMatchObject({ ok: true, category: 'certain' });
    expect(assessUmc({ ...base, rechallenge: 'positive' })).toMatchObject({ category: 'certain' });
  });

  it('probable: the same without a definitive event', () => {
    expect(assessUmc({ ...base, definitive: 'no' })).toMatchObject({ category: 'probable' });
  });

  it('possible: another explanation is possible, or the withdrawal response is unclear, or a negative rechallenge', () => {
    expect(assessUmc({ ...base, alternative: 'could' })).toMatchObject({ category: 'possible' });
    expect(assessUmc({ ...base, dechallenge: 'unclear' })).toMatchObject({ category: 'possible' });
    expect(assessUmc({ ...base, rechallenge: 'negative' })).toMatchObject({ category: 'possible' });
  });

  it('unlikely: improbable timing with another explanation', () => {
    expect(assessUmc({ ...base, time: 'improbable', alternative: 'plausible' })).toMatchObject({ category: 'unlikely' });
  });

  it('conditional or unassessable come from the information question first', () => {
    expect(assessUmc({ information: 'pending' })).toMatchObject({ category: 'conditional' });
    expect(assessUmc({ information: 'insufficient' })).toMatchObject({ category: 'unassessable' });
    expect(assessUmc({ ...base, time: 'improbable', alternative: 'no' })).toMatchObject({ category: 'conditional' });
  });

  it('refuses unanswered criteria', () => {
    expect(assessUmc({ information: 'sufficient', time: 'reasonable' })).toEqual({ ok: false, unanswered: ['alternative', 'dechallenge', 'rechallenge', 'definitive'] });
    expect(assessUmc({})).toEqual({ ok: false, unanswered: ['information'] });
  });
});
