import { describe, expect, it } from 'vitest';
import { MODULES, TASK_ORDER, TASKS, taskByNumber } from '../../src/domain/workflow/catalogue';
import { DRP_CATEGORIES, normalizeItemFields, REGISTERS } from '../../src/domain/workflow/registers';
import { caseTally, moduleTally, nextTask, normalizeTaskInput, taskProgress } from '../../src/domain/workflow/tasks';
import { DRP_CHECKBOXES } from '../../src/domain/form/spec';
import { REGISTER_IDS } from '../../src/domain/types';
import type { L } from '../../src/domain/label';

/** The owner's list (change request of 15 October 2026), verbatim. */
const OWNER_TITLES_AR: Record<number, string> = {
  1: 'جمع بيانات المريض وتاريخه المرضي والدوائي',
  2: 'مراجعة التاريخ الدوائي عند الدخول',
  3: 'مراجعة الوصفات والأدوية الموصوفة',
  4: 'تقييم ملاءمة العلاج الدوائي للحالة المرضية',
  5: 'تحديد المشكلات المتعلقة بالأدوية',
  6: 'اكتشاف التداخلات الدوائية',
  7: 'اكتشاف الآثار الجانبية للأدوية',
  8: 'ضبط الجرعات وفق وظائف الكلى والكبد',
  9: 'حساب الجرعات ومعدلات التسريب الوريدي',
  10: 'متابعة مستويات الأدوية في الدم',
  11: 'متابعة التحاليل والمؤشرات السريرية',
  12: 'المشاركة في الجولات الطبية',
  13: 'تقديم التوصيات الدوائية للفريق الطبي',
  14: 'تحسين استخدام المضادات الحيوية',
  15: 'متابعة فعالية العلاج وسلامته',
  16: 'تقييم الحاجة إلى بدء الدواء أو إيقافه أو تعديل جرعته',
  17: 'تثقيف المرضى حول أدويتهم',
  18: 'توثيق التدخلات الصيدلانية',
  19: 'الإبلاغ عن الآثار الجانبية والأخطاء الدوائية',
  20: 'مراجعة الأدوية عند خروج المريض',
  21: 'إعداد الخطة الدوائية عند الخروج',
  22: 'متابعة التزام المريض بالعلاج',
  23: 'المشاركة في وضع البروتوكولات والإرشادات العلاجية',
  24: 'المساهمة في ترشيد استهلاك الأدوية وتكاليف العلاج',
  25: 'المشاركة في التعليم والتدريب والبحث العلمي',
  26: 'تعزيز سلامة الدواء ومنع الأخطاء الدوائية',
  27: 'تقييم الحاجة إلى الوقاية الدوائية',
  28: 'مراجعة الأدوية عالية الخطورة',
  29: 'تقييم الاستجابة العلاجية وتعديل الخطة الدوائية بالتعاون مع الفريق الطبي',
  30: 'تقديم الرعاية الصيدلانية المتكاملة للمريض',
};

const filled = (l: L | undefined) => !!l && l.en.trim().length > 0 && l.ar.trim().length > 0;

describe('the thirty clinical pharmacist tasks', () => {
  it('has exactly tasks 1–30, each in exactly one module, with the owner’s Arabic titles', () => {
    expect(TASKS.size).toBe(30);
    expect(TASK_ORDER).toHaveLength(30);
    for (let n = 1; n <= 30; n++) {
      const t = taskByNumber(n);
      expect(t, `task ${n}`).toBeDefined();
      expect(t!.id).toBe(`t${String(n).padStart(2, '0')}`);
      expect(t!.title.ar).toBe(OWNER_TITLES_AR[n]);
      expect(MODULES.filter((m) => m.tasks.includes(t!.id))).toHaveLength(1);
      expect(MODULES.find((m) => m.tasks.includes(t!.id))!.id).toBe(t!.module);
    }
    expect(new Set(MODULES.flatMap((m) => m.tasks)).size).toBe(30);
  });

  it('gives every task bilingual teaching content and well-formed checklists', () => {
    for (const t of TASKS.values()) {
      expect(filled(t.title) && filled(t.purpose), t.id).toBe(true);
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(3);
      for (const s of t.steps) expect(filled(s), t.id).toBe(true);
      for (const sec of [t.case, t.perMedication, t.perProblem]) {
        if (!sec) continue;
        const ids = [...sec.checks.map((c) => c.id), ...(sec.fields ?? []).map((f) => f.id)];
        expect(new Set(ids).size, `${t.id} duplicate ids`).toBe(ids.length);
        expect(ids.every((id) => /^[a-z][a-zA-Z0-9_]*$/.test(id) && id !== 'applies'), t.id).toBe(true);
        for (const c of sec.checks) expect(filled(c.label), `${t.id}.${c.id}`).toBe(true);
        for (const f of sec.fields ?? []) {
          expect(filled(f.label), `${t.id}.${f.id}`).toBe(true);
          if (f.kind === 'choice' || f.kind === 'multi') expect(f.options?.length, `${t.id}.${f.id}`).toBeGreaterThan(1);
          for (const o of f.options ?? []) expect(filled(o.label), `${t.id}.${f.id}.${o.value}`).toBe(true);
        }
      }
      if (t.perMedication?.applies) expect(filled(t.perMedication.applies)).toBe(true);
      for (const r of t.registers ?? []) expect(REGISTER_IDS).toContain(r);
      for (const l of t.later ?? []) expect(filled(l.what), t.id).toBe(true);
      // Something to do in every task: a checklist, a register, or a tracked field.
      const work =
        (t.case?.checks.length ?? 0) +
        (t.perMedication ? 1 : 0) +
        (t.perProblem ? 1 : 0) +
        (t.registers?.length ?? 0) +
        (t.case?.fields?.length ?? 0);
      expect(work, t.id).toBeGreaterThan(0);
    }
  });

  it('keeps the modules in the working order of the care process', () => {
    expect(MODULES.map((m) => m.id)).toEqual(['collect', 'review', 'dosing', 'safety', 'plan', 'followup', 'discharge', 'document']);
    expect(TASK_ORDER[0]!.number).toBe(1);
    for (const m of MODULES) expect(filled(m.title) && filled(m.subtitle)).toBe(true);
  });
});

describe('registers (lists shared between tasks)', () => {
  it('are well-formed: unique fields, valid references between fields, labels in both languages', () => {
    for (const id of REGISTER_IDS) {
      const r = REGISTERS[id];
      expect(r.id).toBe(id);
      expect(filled(r.title) && filled(r.noun)).toBe(true);
      const byId = new Map(r.fields.map((f) => [f.id, f]));
      expect(byId.size, id).toBe(r.fields.length);
      expect(byId.has(r.titleField), `${id} titleField`).toBe(true);
      for (const s of r.subtitleFields) expect(byId.has(s), `${id}.${s}`).toBe(true);
      for (const c of r.chipFields) expect(byId.get(c)?.kind, `${id}.${c}`).toBe('choice');
      for (const f of r.fields) {
        expect(filled(f.label), `${id}.${f.id}`).toBe(true);
        for (const cond of [f.showIf, f.requiredIf]) {
          if (!cond) continue;
          const target = byId.get(cond.field);
          expect(target?.options, `${id}.${f.id} condition`).toBeDefined();
          for (const v of cond.in) expect(target!.options!.map((o) => o.value), `${id}.${f.id}`).toContain(v);
        }
        if (f.kind === 'choice' || f.kind === 'multi') {
          expect(f.options!.length).toBeGreaterThan(1);
          expect(new Set(f.options!.map((o) => o.value)).size).toBe(f.options!.length);
        }
      }
    }
  });

  it('uses the department form’s Section 8 boxes as the DRP categories, in order', () => {
    expect(DRP_CATEGORIES.map((c) => c.label)).toEqual(DRP_CHECKBOXES);
  });

  it('validates required fields, choices, days and conditional requirements', () => {
    expect(normalizeItemFields('home_med', { drug: 'amlodipine' })).toEqual({
      ok: false,
      errors: { regimen: 'required', sources: 'required' },
    });
    const ok = normalizeItemFields('home_med', { drug: ' amlodipine ', regimen: '5 mg PO once daily', sources: 'patient|containers', brand: '  ' });
    expect(ok).toEqual({ ok: true, fields: { drug: 'amlodipine', regimen: '5 mg PO once daily', sources: 'patient|containers' } });
    expect(normalizeItemFields('home_med', { drug: 'x', regimen: 'y', sources: 'patient|telepathy' })).toMatchObject({ ok: false, errors: { sources: 'invalidChoice' } });
    expect(normalizeItemFields('home_med', { drug: 'x', regimen: 'y', sources: 'patient', bogus: 'z' })).toMatchObject({ ok: false, errors: { bogus: 'unknownField' } });

    // An unintentional discrepancy needs its type; a hidden field is dropped.
    expect(normalizeItemFields('home_med', { drug: 'x', regimen: 'y', sources: 'patient', discrepancy: 'unintentional' })).toMatchObject({
      ok: false,
      errors: { discrepancyType: 'required' },
    });
    expect(normalizeItemFields('home_med', { drug: 'x', regimen: 'y', sources: 'patient', discrepancy: 'none', discrepancyType: 'dose' })).toEqual({
      ok: true,
      fields: { drug: 'x', regimen: 'y', sources: 'patient', discrepancy: 'none' },
    });

    const drp = { problem: 'Dose too high for renal function', category: 'dose_high', evidence: 'SCr 2.1 mg/dL on Day 3', priority: 'important' };
    expect(normalizeItemFields('drp', drp).ok).toBe(true);
    // "Implemented" requires who and when; a measured outcome requires the measurement and its day.
    expect(normalizeItemFields('drp', { ...drp, implemented: 'yes' })).toMatchObject({ ok: false, errors: { implementedBy: 'required', implementedDay: 'required' } });
    expect(normalizeItemFields('drp', { ...drp, goalMet: 'yes' })).toMatchObject({ ok: false, errors: { outcome: 'required', outcomeDay: 'required' } });
    expect(normalizeItemFields('drp', { ...drp, goalMet: 'not_measured', outcome: 'stale text' })).toEqual({ ok: true, fields: { ...drp, goalMet: 'not_measured' } });
    expect(normalizeItemFields('drp', { ...drp, response: 'declined' })).toMatchObject({ ok: false, errors: { declineReason: 'required' } });
    expect(normalizeItemFields('drp', { ...drp, implemented: 'yes', implementedBy: 'Resident', implementedDay: '1.5' })).toMatchObject({
      ok: false,
      errors: { implementedDay: 'hospitalDay' },
    });
    expect(normalizeItemFields('drp', { ...drp, implemented: 'yes', implementedBy: 'Resident', implementedDay: '-3' }).ok).toBe(true);

    // A reference must be confirmed as read by the trainee.
    expect(normalizeItemFields('reference', { title: 'Hospital CAP protocol', type: 'protocol' })).toMatchObject({ ok: false, errors: { verified: 'confirm' } });
    expect(normalizeItemFields('reference', { title: 'Hospital CAP protocol', type: 'protocol', verified: 'yes' }).ok).toBe(true);

    // The no-level path is required when no level can be measured.
    expect(normalizeItemFields('tdm', { drug: 'vancomycin', levelAvailable: 'no' })).toMatchObject({ ok: false, errors: { noLevelPlan: 'required' } });
    expect(normalizeItemFields('tdm', { drug: 'vancomycin', levelAvailable: 'yes' })).toMatchObject({
      ok: false,
      errors: { timing: 'required', target: 'required', interpretation: 'required' },
    });
    expect(normalizeItemFields('drp', { ...drp, problem: 'x'.repeat(301) })).toMatchObject({ ok: false, errors: { problem: 'tooLong' } });
  });
});

describe('task worksheets', () => {
  it('accepts only the items a task defines, scoped correctly', () => {
    const base = { status: 'in_progress' as const, checks: {}, fields: {} };
    expect(normalizeTaskInput('t99', base)).toEqual({ ok: false, errors: { task: 'unknownTask' } });
    expect(normalizeTaskInput('t02', { ...base, checks: { two_sources: 'ok', all_compared: 'issue' } })).toEqual({
      ok: true,
      value: { status: 'in_progress', checks: { two_sources: 'ok', all_compared: 'issue' }, fields: {} },
    });
    expect(normalizeTaskInput('t02', { ...base, checks: { made_up: 'ok' } })).toMatchObject({ ok: false, errors: { made_up: 'unknownField' } });
    expect(normalizeTaskInput('t02', { ...base, checks: { two_sources: 'yes' as never } })).toMatchObject({ ok: false, errors: { two_sources: 'invalidChoice' } });
    // Per-medication items must carry a scope; case items must not.
    expect(normalizeTaskInput('t03', { ...base, checks: { 'dose@med-1': 'ok' } }).ok).toBe(true);
    expect(normalizeTaskInput('t03', { ...base, checks: { dose: 'ok' } })).toMatchObject({ ok: false });
    expect(normalizeTaskInput('t02', { ...base, checks: { 'two_sources@x': 'ok' } })).toMatchObject({ ok: false });
    // "Does this apply?" exists only where the task asks it.
    expect(normalizeTaskInput('t14', { ...base, fields: { 'applies@med-1': 'yes' }, checks: { 'cultures@med-1': 'issue' } }).ok).toBe(true);
    expect(normalizeTaskInput('t14', { ...base, fields: { 'applies@med-1': 'maybe' } })).toMatchObject({ ok: false });
    expect(normalizeTaskInput('t03', { ...base, fields: { 'applies@med-1': 'yes' } })).toMatchObject({ ok: false });
    // Choices and multi-choices are checked; empty values are dropped.
    expect(normalizeTaskInput('t27', { ...base, fields: { vte: 'indicated_missing', vte_note: '  ', sup: 'sometimes' } })).toMatchObject({
      ok: false,
      errors: { sup: 'invalidChoice' },
    });
    expect(normalizeTaskInput('t22', { ...base, fields: { barriers: 'cost|khat', overall: 'partial' } }).ok).toBe(true);
    // Not applicable needs a reason.
    expect(normalizeTaskInput('t21', { ...base, status: 'not_applicable' })).toMatchObject({ ok: false, errors: { naReason: 'required' } });
    expect(normalizeTaskInput('t21', { ...base, status: 'not_applicable', naReason: ' Patient died before discharge planning ' })).toEqual({
      ok: true,
      value: { status: 'not_applicable', naReason: 'Patient died before discharge planning', checks: {}, fields: {} },
    });
  });

  it('measures progress over checklist items and tracked fields, per medication and per problem', () => {
    const scope = { medIds: ['m1', 'm2'], problemIds: ['p1'] };
    const t03 = TASKS.get('t03')!;
    expect(taskProgress(t03, undefined, scope)).toEqual({ answered: 0, total: 20, issues: 0 });
    expect(taskProgress(t03, { checks: { 'dose@m1': 'issue', 'route@m1': 'ok', 'dose@m3': 'ok' }, fields: {} }, scope)).toEqual({
      answered: 2,
      total: 20,
      issues: 1,
    });
    // Antimicrobial stewardship: the per-drug checklist counts only for drugs marked as antimicrobials.
    const t14 = TASKS.get('t14')!;
    expect(taskProgress(t14, undefined, scope)).toEqual({ answered: 0, total: 2, issues: 0 });
    expect(taskProgress(t14, { checks: { 'cultures@m1': 'ok' }, fields: { 'applies@m1': 'yes', 'applies@m2': 'no' } }, scope)).toEqual({
      answered: 3,
      total: 10,
      issues: 0,
    });
    // Tracked choice fields count like checklist items.
    const t27 = TASKS.get('t27')!;
    expect(taskProgress(t27, { checks: {}, fields: { vte: 'indicated_given', vte_note: 'Padua 5' } }, scope)).toEqual({ answered: 1, total: 3, issues: 0 });
    const t04 = TASKS.get('t04')!;
    expect(taskProgress(t04, undefined, scope).total).toBe(4);
  });

  it('tallies the case and suggests the next task in working order', () => {
    expect(caseTally([])).toEqual({ complete: 0, inProgress: 0, notStarted: 30, total: 30 });
    expect(nextTask([])?.number).toBe(1);
    const recs = [
      { taskId: 't01', status: 'done' as const },
      { taskId: 't02', status: 'not_applicable' as const },
      { taskId: 't06', status: 'in_progress' as const },
    ];
    expect(caseTally(recs)).toEqual({ complete: 2, inProgress: 1, notStarted: 27, total: 30 });
    expect(moduleTally('collect', recs)).toEqual({ complete: 2, inProgress: 0, notStarted: 1, total: 3 });
    // A task already started comes first; otherwise the first unfinished task in working order.
    expect(nextTask(recs)?.id).toBe('t06');
    expect(nextTask(recs.slice(0, 2))?.id).toBe('t22');
  });
});
