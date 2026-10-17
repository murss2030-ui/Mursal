import { describe, expect, it } from 'vitest';
import { analysisSchema, type RawAnalysis } from '../../src/ai/analysis/contract';
import { FIELD_LIMITS, TRAINEE_ONLY_CHECKS, TRAINEE_ONLY_REGISTERS, UNDRAFTED_TASKS } from '../../src/ai/analysis/limits';
import { buildCasePayload } from '../../src/ai/analysis/payload';
import { analyseModule } from '../../src/ai/analysis/run';
import { cleanStatement, verifyAnalysis } from '../../src/ai/analysis/verify';
import type { ModelResponse } from '../../src/ai/protocol';
import { validateOutput } from '../../src/ai/schema';
import { MODULE_BY_ID, TASKS } from '../../src/domain/workflow/catalogue';
import { REGISTERS } from '../../src/domain/workflow/registers';
import { ValidationError } from '../../src/domain/validation';
import { IntegrityError } from '../../src/store/store';
import { newCase, newSession } from './helpers';

async function caseWithData(kind: 'teaching' | 'clinical' = 'clinical', age = 64) {
  const ctx = await newSession();
  const c = await newCase(ctx.store, { kind, ageYears: age, admissionDay0: '2026-10-13', ...(kind === 'clinical' ? { identifiers: { patientName: 'Saleh Qaid', mrn: 'MRN-77120', roomBed: 'Bed 14', consultantName: 'Dr Hamdan Saif' } } : {}) } as never);
  const s = ctx.store;
  const scr = await s.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.1 }, unit: 'mg/dL' } });
  const med = await s.addEntry(c.id, {
    type: 'med_start',
    hospitalDay: 0,
    payload: { medId: 'med-vanc', drug: 'vancomycin', dose: { kind: 'structured', value: 1000, unit: 'mg' }, route: 'IV', frequency: 'every 12 hours', indication: 'MRSA pneumonia' },
  });
  await s.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'problem', problemId: 'prob-1', name: 'Pneumonia', acuity: 'acute', status: 'active', primaryDiagnosis: true } });
  await s.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'hpi', text: 'Fever and cough for 3 days. Seen by Dr Hamdan Saif.' } });
  await s.updateAiSettings({ models: { extract: 'model-x', analyse: 'model-y' } });
  return { ...ctx, c, scr, med };
}

/** The reference given to the creatinine result in a payload. */
const scrRef = (p: Awaited<ReturnType<typeof payloadFor>>) => [...p.refs].find(([, t]) => t.label.startsWith('Serum creatinine'))![0];

async function payloadFor(ctx: Awaited<ReturnType<typeof caseWithData>>, moduleId: string) {
  return buildCasePayload({
    case: (await ctx.store.getCase(ctx.c.id))!,
    entries: await ctx.store.listEntries(ctx.c.id),
    items: await ctx.store.listItems(ctx.c.id),
    tasks: await ctx.store.listTasks(ctx.c.id),
    module: MODULE_BY_ID.get(moduleId as never)!,
    today: '2026-10-16',
  });
}

describe('the case as sent for analysis', () => {
  it('holds no stored identifier, bands ages over 89, and gives every item a reference', async () => {
    const ctx = await caseWithData('clinical', 93);
    const p = await payloadFor(ctx, 'dosing');
    expect(p.text).not.toMatch(/MRN-77120|Bed 14|Saleh/);
    expect(p.text).toContain('"age":"90 or older"');
    expect(p.text).toContain('Serum creatinine: 2.1 mg/dL');
    expect([...p.refs.keys()].sort()).toEqual(expect.arrayContaining(['E1', 'M1', 'P1']));
    expect(p.refs.get('M1')).toMatchObject({ kind: 'medication', id: 'med-vanc' });
    expect(p.tasks.map((t) => t.id)).toEqual(['t08', 't09', 't10']);
    // The consultant's name typed into a note is in the record; it is masked before sending (see analyseModule).
    expect(p.text).toContain('Dr Hamdan Saif');
  });
});

describe('checks in code — the hostile fixtures (Section 21, adapted)', () => {
  it('removes a reference to data that was never sent, and then treats the claim as having no source', async () => {
    const p = await payloadFor(await caseWithData(), 'dosing');
    const raw: RawAnalysis = {
      tasks: [{ taskId: 't08', summary: '', checks: [{ checkId: p.tasks[0]!.case!.checks[0]!.id, scopeRef: null, answer: 'issue', reason: 'Renal function is reduced.', basis: 'case_data', refs: ['E99'] }], items: [], missingData: [], questions: [] }],
    };
    const { suggestions } = verifyAnalysis(raw, p);
    expect(suggestions[0]!.checks).toEqual(expect.arrayContaining(['unknown_ref_removed', 'no_valid_ref']));
    expect(suggestions[0]!.basis).toBe('general_knowledge');
    expect(suggestions[0]!.refs).toEqual([]);
  });

  it('removes numbers that are not in the referenced data, and withholds doses', () => {
    const allowed = new Set(['2.1', '1000', '12']);
    const a = cleanStatement('Creatinine 2.1 mg/dL suggests a clearance near 35 mL/min.', allowed);
    expect(a.text).toBe('Creatinine 2.1 mg/dL suggests a clearance near [number removed] mL/min.');
    expect([...a.checks]).toEqual(['number_removed']);
    const b = cleanStatement('Reduce vancomycin to 750 mg every 24 hours.', allowed);
    expect(b.text).toBe('Reduce vancomycin to [dose withheld — to be calculated] every [number removed] hours.');
    expect([...b.checks].sort()).toEqual(['dose_withheld', 'number_removed']);
    // Numbers that are in the referenced data stay.
    expect(cleanStatement('Vancomycin 1000 mg every 12 hours is running.', allowed).text).toBe('Vancomycin 1000 mg every 12 hours is running.');
    // Words with digits are not numbers: vitamin B12, COVID-19.
    expect(cleanStatement('Check vitamin B12; COVID-19 history.', new Set()).checks.size).toBe(0);
  });

  it('leaves no stray brackets where a citation was', () => {
    expect(cleanStatement('Review kidney function daily (Smith et al., 2019).', new Set()).text).toBe('Review kidney function daily.');
    expect(cleanStatement('Avoid NSAIDs (Jones, 2021) in AKI [4].', new Set()).text).toBe('Avoid NSAIDs in AKI.');
  });

  it('removes citations and commercial references, and labels a named source', () => {
    const c = cleanStatement('Per IDSA guidelines (Smith et al., 2019) https://example.org/x doi:10.1000/xyz [3] Grade A. UpToDate suggests this.', new Set());
    expect(c.text).not.toMatch(/Smith|2019|https|doi|\[3\]|Grade A|UpToDate/);
    expect(c.text).toContain('[source name removed]');
    expect([...c.checks].sort()).toEqual(['citation_removed', 'source_named']);
  });

  it('keeps general-knowledge statements, labelled as such (owner decision D3)', async () => {
    const p = await payloadFor(await caseWithData(), 'dosing');
    const check = p.tasks[0]!.case!.checks[0]!.id;
    const raw: RawAnalysis = {
      tasks: [{ taskId: 't08', summary: 'Vancomycin is cleared by the kidney.', checks: [{ checkId: check, scopeRef: null, answer: 'issue', reason: 'Vancomycin is renally cleared and creatinine is 2.1 mg/dL.', basis: 'case_data', refs: [scrRef(p), 'M1'] }], items: [], missingData: ['Weight'], questions: ['Is a level planned?'] }],
    };
    const { suggestions, dropped } = verifyAnalysis(raw, p);
    expect(dropped).toBe(0);
    const ck = suggestions.find((x) => x.kind === 'check')!;
    expect(ck.basis).toBe('case_data');
    expect(ck.refs.map((r) => r.kind).sort()).toEqual(['entry', 'medication']);
    expect(ck.checks).toEqual([]);
    expect(suggestions.filter((x) => x.kind === 'note').map((x) => x.noteKind)).toEqual(['summary', 'missing', 'question']);
  });

  it('drops tasks, checks, scopes and registers that do not exist, and invalid values', async () => {
    const p = await payloadFor(await caseWithData(), 'safety');
    const t06 = p.tasks.find((t) => t.id === 't06')!;
    const raw: RawAnalysis = {
      tasks: [
        { taskId: 't99', summary: 'x', checks: [], items: [], missingData: [], questions: [] },
        {
          taskId: 't06',
          summary: '',
          checks: [{ checkId: 'not_a_check', scopeRef: null, answer: 'ok', reason: '', basis: 'case_data', refs: [] }],
          items: [
            { register: 'drp', fields: [{ field: 'problem', value: 'x' }], reason: '', basis: 'general_knowledge', refs: [] },
            {
              register: 'interaction',
              fields: [
                { field: 'kind', value: 'drug_drug' },
                { field: 'drugA', value: 'vancomycin' },
                { field: 'drugB', value: 'piperacillin' },
                { field: 'severity', value: 'catastrophic' },
                { field: 'invented_field', value: 'y' },
              ],
              reason: 'Combination noted.',
              basis: 'general_knowledge',
              refs: ['M1'],
            },
          ],
          missingData: [],
          questions: [],
        },
      ],
    };
    const { suggestions, dropped } = verifyAnalysis(raw, p);
    expect(t06.registers).toContain('interaction');
    expect(dropped).toBe(3); // the unknown task, the unknown check, the register that is not this task's
    const item = suggestions.find((x) => x.kind === 'item')!;
    expect(item.fields).not.toHaveProperty('severity');
    expect(item.fields).not.toHaveProperty('invented_field');
    expect(item.checks).toEqual(expect.arrayContaining(['invalid_value_removed', 'incomplete']));
  });

  it('keeps numbers from the case header and from the checklist item being answered (live run)', async () => {
    const ctx = await caseWithData('clinical', 64);
    const p = await payloadFor(ctx, 'plan');
    const t14 = p.tasks.find((t) => t.id === 't14')!;
    const timeout = t14.perMedication!.checks.find((c) => c.id === 'timeout')!;
    const raw: RawAnalysis = {
      tasks: [
        {
          taskId: 't14',
          summary: 'A 64-year-old on hospital day 3 with pneumonia.',
          checks: [{ checkId: timeout.id, scopeRef: 'M1', answer: 'issue', reason: 'On hospital day 3, no 48 to 72 hour review is documented; repeat it every 12 hours.', basis: 'case_data', refs: ['M1'] }],
          items: [],
          missingData: [],
          questions: [],
        },
      ],
    };
    const { suggestions } = verifyAnalysis(raw, p);
    expect(suggestions.find((x) => x.noteKind === 'summary')!.text).toBe('A 64-year-old on hospital day 3 with pneumonia.');
    const ck = suggestions.find((x) => x.kind === 'check')!;
    // 12 is in the referenced order ("every 12 hours"); 3 is today's hospital day; 48 and 72 are the checklist item's.
    expect(ck.reason).toBe('On hospital day 3, no 48 to 72 hour review is documented; repeat it every 12 hours.');
    expect(ck.checks).toEqual([]);
    // A number found nowhere is still removed.
    expect(verifyAnalysis({ tasks: [{ ...raw.tasks[0]!, summary: 'Give it for 10 days.', checks: [] }] }, p).suggestions[0]!.text).toBe('Give it for [number removed] days.');
    // A dose may use only the cited data — never a number that merely matches the header (day 3) or the item's wording (48).
    const dose = verifyAnalysis({ tasks: [{ ...raw.tasks[0]!, summary: '', checks: [{ ...raw.tasks[0]!.checks[0]!, reason: 'Give 3 mg now, then 48 mg; keep 1000 mg every 12 hours.' }] }] }, p);
    expect(dose.suggestions[0]!.reason).toBe('Give [dose withheld — to be calculated] now, then [dose withheld — to be calculated]; keep 1000 mg every 12 hours.');
  });

  it('the schema given to the model lists only this module’s tasks', async () => {
    const p = await payloadFor(await caseWithData(), 'dosing');
    const schema = analysisSchema(p.tasks);
    expect(validateOutput({ tasks: [{ taskId: 't08', summary: '', checks: [], items: [], missingData: [], questions: [] }] }, schema)).toEqual([]);
    expect(validateOutput({ tasks: [{ taskId: 't01', summary: '', checks: [], items: [], missingData: [], questions: [] }] }, schema).length).toBeGreaterThan(0);
  });
});

describe('what only the trainee can record (Section 24) — never drafted by the model', () => {
  it('names only checklist items, registers and fields that exist', () => {
    for (const key of TRAINEE_ONLY_CHECKS) {
      const [taskId, checkId] = key.split(':') as [string, string];
      const def = TASKS.get(taskId);
      expect(def, key).toBeDefined();
      const all = [...(def!.case?.checks ?? []), ...(def!.perMedication?.checks ?? []), ...(def!.perProblem?.checks ?? [])];
      expect(all.some((c) => c.id === checkId), key).toBe(true);
    }
    for (const id of UNDRAFTED_TASKS) expect(TASKS.has(id), id).toBe(true);
    for (const r of TRAINEE_ONLY_REGISTERS) expect(REGISTERS[r], r).toBeDefined();
    for (const [r, limits] of Object.entries(FIELD_LIMITS)) {
      const def = REGISTERS[r as keyof typeof REGISTERS];
      for (const [field, limit] of Object.entries(limits!)) {
        const f = def.fields.find((x) => x.id === field);
        expect(f, `${r}.${field}`).toBeDefined();
        if (Array.isArray(limit)) for (const v of limit) expect(f!.options?.some((o) => o.value === v), `${r}.${field}=${v}`).toBe(true);
      }
    }
  });

  it('does not ask for them: the payload and the schema leave them out', async () => {
    const ctx = await caseWithData();
    const collect = JSON.parse((await payloadFor(ctx, 'collect')).text) as { tasks: { taskId: string; checks: { id: string }[]; registers: { register: string; fields: { id: string }[] }[] }[] };
    const t01 = collect.tasks.find((t) => t.taskId === 't01')!;
    expect(t01.checks).toEqual([]); // verified, unclear and interview are all the trainee's own
    const t02 = collect.tasks.find((t) => t.taskId === 't02')!;
    expect(t02.checks.map((c) => c.id)).toEqual(['two_sources', 'all_compared', 'new_orders']);
    const homeFields = t02.registers.find((r) => r.register === 'home_med')!.fields.map((f) => f.id);
    expect(homeFields).toEqual(expect.arrayContaining(['drug', 'regimen', 'admissionStatus', 'discrepancy']));
    for (const f of ['lastDose', 'adherence', 'resolution', 'action', 'dischargeDecision', 'dischargeNote']) expect(homeFields).not.toContain(f);

    const dosing = await payloadFor(ctx, 'dosing');
    const spec = JSON.parse(dosing.text) as typeof collect;
    expect(spec.tasks.find((t) => t.taskId === 't08')!.registers).toEqual([]); // the trainee's own calculations
    expect(spec.tasks.find((t) => t.taskId === 't10')!.registers[0]!.fields.map((f) => f.id)).not.toContain('target');
    const schema = analysisSchema(dosing.tasks);
    const item = (register: string) => ({ tasks: [{ taskId: 't08', summary: '', checks: [], items: [{ register, fields: [], reason: '', basis: 'case_data', refs: [] }], missingData: [], questions: [] }] });
    expect(validateOutput(item('tdm'), schema)).toEqual([]);
    expect(validateOutput(item('calc_check'), schema).length).toBeGreaterThan(0);

    const doc = await payloadFor(ctx, 'document');
    expect(doc.tasks.map((t) => t.id)).toEqual(['t18', 't30']); // no draft of the protocols (citing) or of the reflection
  });

  it('removes them when the model offers them anyway', async () => {
    const ctx = await caseWithData();
    const p = await payloadFor(ctx, 'plan');
    const raw: RawAnalysis = {
      tasks: [
        {
          taskId: 't13',
          summary: '',
          checks: [
            { checkId: 'preceptor', scopeRef: null, answer: 'ok', reason: 'Discussed with the preceptor.', basis: 'general_knowledge', refs: [] },
            { checkId: 'responses', scopeRef: null, answer: 'ok', reason: 'The team accepted.', basis: 'general_knowledge', refs: [] },
          ],
          items: [],
          missingData: [],
          questions: [],
        },
        {
          taskId: 't05',
          summary: '',
          checks: [],
          items: [
            {
              register: 'drp',
              fields: [
                { field: 'problem', value: 'Vancomycin with rising creatinine' },
                { field: 'category', value: 'monitoring' },
                { field: 'evidence', value: 'Creatinine 2.1 mg/dL on Day 1.' },
                { field: 'priority', value: 'important' },
                { field: 'recStatus', value: 'final' },
                { field: 'response', value: 'accepted' },
                { field: 'implemented', value: 'yes' },
                { field: 'goalMet', value: 'yes' },
                { field: 'references', value: 'A guideline' },
                { field: 'teaching', value: 'Always check levels.' },
              ],
              reason: '',
              basis: 'case_data',
              refs: [scrRef(p), 'M1'],
            },
            {
              register: 'drp',
              fields: [
                { field: 'problem', value: 'Vancomycin needs a monitoring plan' },
                { field: 'category', value: 'monitoring' },
                { field: 'evidence', value: 'Creatinine 2.1 mg/dL on Day 1.' },
                { field: 'priority', value: 'important' },
                { field: 'recStatus', value: 'draft' },
              ],
              reason: '',
              basis: 'case_data',
              refs: [scrRef(p), 'M1'],
            },
          ],
          missingData: [],
          questions: [],
        },
        // A task the model never drafts.
        { taskId: 't25', summary: 'My reflection.', checks: [], items: [], missingData: [], questions: [] },
      ],
    };
    const { suggestions, dropped } = verifyAnalysis(raw, p);
    expect(dropped).toBe(3); // both checks of t13, and the whole of t25
    const [first, second] = suggestions.filter((x) => x.kind === 'item');
    expect(Object.keys(first!.fields ?? {}).sort()).toEqual(['category', 'evidence', 'priority', 'problem']);
    expect(first!.checks).toContain('trainee_only_removed');
    expect(first!.checks).not.toContain('incomplete');
    expect(second!.fields?.recStatus).toBe('draft');
    expect(second!.checks).not.toContain('trainee_only_removed');
    expect(suggestions.some((x) => x.taskId === 't25' || x.taskId === 't13')).toBe(false);
  });
});

// ---------------------------------------------------------------- end to end with a recorded answer

function relay(output: unknown) {
  const bodies: Record<string, any>[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ output, usage: { inputTokens: 3000, outputTokens: 900, costUsd: 0.006 }, model: 'model-y', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 1 } } satisfies ModelResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, bodies };
}

describe('analysing a module and deciding its suggestions', () => {
  async function analysed() {
    const ctx = await caseWithData();
    const p = await payloadFor(ctx, 'dosing');
    const check = p.tasks[0]!.case!.checks[0]!.id;
    const raw: RawAnalysis = {
      tasks: [
        {
          taskId: 't08',
          summary: 'Creatinine 2.1 mg/dL on Day 1 while on vancomycin.',
          checks: [{ checkId: check, scopeRef: null, answer: 'issue', reason: 'Creatinine is 2.1 mg/dL.', basis: 'case_data', refs: [scrRef(p)] }],
          items: [],
          missingData: ['Current weight'],
          questions: [],
        },
        {
          taskId: 't10',
          summary: '',
          checks: [],
          items: [
            {
              register: 'tdm',
              fields: [
                { field: 'drug', value: 'vancomycin' },
                { field: 'levelAvailable', value: 'yes' },
                { field: 'timing', value: 'Trough before the next dose' },
                // A target range needs a reference the trainee read: removed, so the row is incomplete.
                { field: 'target', value: 'Trough 15-20 mg/L' },
                { field: 'interpretation', value: 'No level has been measured yet.' },
              ],
              reason: 'Vancomycin is monitored with levels.',
              basis: 'general_knowledge',
              refs: ['M1'],
            },
          ],
          missingData: [],
          questions: [],
        },
      ],
    };
    const { f, bodies } = relay(raw);
    const a = await analyseModule(ctx.store, ctx.c.id, 'dosing', { fetch: f, online: () => true });
    return { ...ctx, a, bodies };
  }

  it('sends no identifier, audits the call and stores the checked suggestions', async () => {
    const { a, bodies, store, c } = await analysed();
    const sent = JSON.stringify(bodies[0]!.parts);
    expect(sent).not.toMatch(/Hamdan|Saleh|MRN-77120|Bed 14/);
    expect(bodies[0]!.task).toBe('analyse');
    expect(a.moduleId).toBe('dosing');
    expect(a.retrievedChunkIds).toEqual([]);
    expect(a.suggestions.map((x) => x.kind)).toEqual(['note', 'check', 'note', 'item']);
    const audit = await store.listAudit(c.id);
    expect(audit.some((e) => e.entity === 'model_call' && (e.diff as { task: string }).task === 'analyse')).toBe(true);
    expect(audit.some((e) => e.entity === 'analysis' && e.action === 'create')).toBe(true);
  });

  it('applies one accepted suggestion at a time, and records a rejection only with its reason', async () => {
    const { a, store, c } = await analysed();
    const check = a.suggestions.find((x) => x.kind === 'check')!;
    const after = await store.decideSuggestion(c.id, a.id, check.id, { kind: 'accept' });
    const task = (await store.listTasks(c.id)).find((t) => t.taskId === 't08')!;
    expect(task.checks[check.checkId!]).toBe('issue');
    expect(task.status).toBe('in_progress');
    expect(after.suggestions.find((x) => x.id === check.id)!.decision).toMatchObject({ kind: 'accepted', appliedTo: { kind: 'task', taskId: 't08', version: 1 } });
    await expect(store.decideSuggestion(c.id, a.id, check.id, { kind: 'reject', reason: 'x' })).rejects.toBeInstanceOf(IntegrityError);

    const item = a.suggestions.find((x) => x.kind === 'item')!;
    expect(item.fields).not.toHaveProperty('target');
    expect(item.checks).toEqual(expect.arrayContaining(['trainee_only_removed', 'incomplete']));
    await expect(store.decideSuggestion(c.id, a.id, item.id, { kind: 'accept' })).rejects.toBeInstanceOf(ValidationError); // incomplete: the target is missing
    const edited = await store.decideSuggestion(c.id, a.id, item.id, { kind: 'edit', fields: { ...item.fields, target: 'From the reference I read' } });
    const row = (await store.listItems(c.id)).find((r) => r.register === 'tdm')!;
    expect(row.origin).toEqual({ kind: 'suggestion', analysisId: a.id, suggestionId: item.id });
    expect(edited.suggestions.find((x) => x.id === item.id)!.decision?.kind).toBe('edited');

    const note = a.suggestions.find((x) => x.noteKind === 'missing')!;
    await expect(store.decideSuggestion(c.id, a.id, note.id, { kind: 'reject', reason: '  ' })).rejects.toBeInstanceOf(ValidationError);
    const rejected = await store.decideSuggestion(c.id, a.id, note.id, { kind: 'reject', reason: 'Weight is on the chart' });
    expect(rejected.suggestions.find((x) => x.id === note.id)!.decision).toMatchObject({ kind: 'rejected', reason: 'Weight is on the chart' });

    // The rows its own accepted suggestions created do not make the analysis stale.
    expect(await store.isAnalysisStale(rejected)).toBe(false);
  });

  it('refuses to accept from an analysis the record has moved past', async () => {
    const { a, store, c } = await analysed();
    await store.addEntry(c.id, { type: 'weight', hospitalDay: 2, payload: { value: 70, unit: 'kg', method: 'measured' } });
    expect(await store.isAnalysisStale(a)).toBe(true);
    const summary = a.suggestions.find((x) => x.noteKind === 'summary')!;
    await expect(store.decideSuggestion(c.id, a.id, summary.id, { kind: 'accept' })).rejects.toThrow(/Re-analyse/);
    // Rejecting is still possible.
    await expect(store.decideSuggestion(c.id, a.id, summary.id, { kind: 'reject', reason: 'Outdated' })).resolves.toBeDefined();
  });
});
