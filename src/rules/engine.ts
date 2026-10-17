/**
 * The rules engine (Section 10), fully offline. Every rule reads the case
 * record, the trainee's reference tables and the local datasets, and returns
 * alerts with their source — or names what it could not check.
 *
 * Levels follow Section 10 exactly: a documented allergy match, a
 * contraindicated interaction pair and a laboratory value in the critical
 * range are critical; major interactions, required dose adjustments and
 * prompts that need action are important; moderate and minor interactions and
 * class-level notes are informational.
 */
import type { CalcResult } from '../calc/types';
import { renalDoseReviewGate } from '../calc/gate';
import type { GatherContext } from '../calc/gather';
import { creatinineChanges, KDIGO_CITATION, scrSeries } from '../calc/kdigo';
import { show, toCanonical, type QuantityId } from '../calc/units';
import { ANALYTE_BY_ID } from '../domain/catalogue';
import { L } from '../domain/label';
import type { AdjustmentRule, FormularyItem, LabThreshold } from '../domain/reference';
import { compareEntries, deriveMedCourses, type MedCourse } from '../domain/timeline';
import type { EntryOf, RegisterItem, TaskRecord, TimelineEntry } from '../domain/types';
import { appliesKey, scopedKey } from '../domain/workflow/tasks';
import { aliasesFrom, matchDrug, type DrugMatch } from '../drugs/normalize';
import { normaliseName, type DrugClass, type DrugVocabulary } from '../drugs/vocabulary';
import { allergenTerm, classesForAllergen } from './allergy-terms';
import type { Alert, AlertLevel, AwareDataset, InteractionDataset, NotChecked, RulesOutcome } from './types';

export interface RulesContext {
  /** Today's hospital day (null when the case is not active: prompts that depend on time are not raised). */
  today: number | null;
  current: readonly TimelineEntry[];
  /** Active register rows. */
  items: readonly RegisterItem[];
  tasks: readonly TaskRecord[];
  calcResults: readonly CalcResult[];
  isCurrent: (r: CalcResult) => boolean;
  formulary: readonly FormularyItem[];
  adjustments: readonly AdjustmentRule[];
  thresholds: readonly LabThreshold[];
  /** What the calculators read, for the Verify gate of dose assessments. */
  gather: GatherContext;
  vocab?: DrugVocabulary;
  interactions?: InteractionDataset;
  aware?: AwareDataset;
}

/** A drug the patient takes or is proposed: an inpatient order, a home medication or a discharge medication. */
interface DrugRef {
  ref: string;
  kind: 'course' | 'home' | 'discharge';
  label: string;
  medId?: string;
  itemId?: string;
  match: DrugMatch;
  ingredients: string[];
}

/** FNV-1a, for change detection only. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const RANK: Record<AlertLevel, number> = { critical: 3, important: 2, informational: 1 };

function drugs(ctx: RulesContext, courses: readonly MedCourse[]): DrugRef[] {
  const aliases = aliasesFrom(ctx.formulary);
  const resolve = (name: string, brand?: string): DrugMatch => {
    const m = matchDrug(name, ctx.vocab, aliases);
    if (m.status === 'matched' || !brand) return m;
    return matchDrug(brand, ctx.vocab, aliases);
  };
  const out: DrugRef[] = [];
  for (const c of courses.filter((x) => x.status === 'active')) {
    const match = resolve(c.drug, c.brand);
    out.push({ ref: `course:${c.medId}`, kind: 'course', label: c.drug, medId: c.medId, match, ingredients: match.status === 'matched' ? match.ingredients.map((i) => i.rxcui) : [] });
  }
  for (const it of ctx.items) {
    if (it.register !== 'home_med' && it.register !== 'discharge_med') continue;
    const name = it.fields.drug ?? '';
    const match = resolve(name, it.fields.brand);
    out.push({
      ref: `${it.register === 'home_med' ? 'home' : 'discharge'}:${it.id}`,
      kind: it.register === 'home_med' ? 'home' : 'discharge',
      label: name,
      itemId: it.id,
      match,
      ingredients: match.status === 'matched' ? match.ingredients.map((i) => i.rxcui) : [],
    });
  }
  return out;
}

const where = (d: DrugRef) =>
  d.kind === 'course' ? L(`${d.label} (inpatient order)`, `${d.label} (طلب أثناء الإقامة)`) : d.kind === 'home' ? L(`${d.label} (home medication)`, `${d.label} (دواء منزلي)`) : L(`${d.label} (discharge medication)`, `${d.label} (دواء خروج)`);

const refsOf = (d: DrugRef) => ({ ...(d.medId ? { medIds: [d.medId] } : {}), ...(d.itemId ? { itemIds: [d.itemId] } : {}) });

// ---------------------------------------------------------------- 1. documented allergy or previous ADR

function allergyRule(ctx: RulesContext, ds: readonly DrugRef[], add: (a: Alert) => void, skip: (n: NotChecked) => void) {
  const notes = ctx.current.filter(
    (e): e is EntryOf<'note'> & { payload: Extract<EntryOf<'note'>['payload'], { category: 'allergy_adr' }> } =>
      e.type === 'note' && e.payload.category === 'allergy_adr' && e.payload.kind !== 'nkda' && !!e.payload.substance,
  );
  for (const n of notes) {
    const substance = n.payload.substance!;
    const kindText = n.payload.kind === 'adr' ? L('previous ADR', 'تفاعل ضار سابق') : n.payload.kind === 'intolerance' ? L('intolerance', 'عدم تحمّل') : L('allergy', 'حساسية');
    const documentedLevel: AlertLevel = n.payload.kind === 'intolerance' ? 'important' : 'critical';
    const classes: DrugClass[] = ctx.vocab ? classesForAllergen(substance, ctx.vocab) : [];
    const m = classes.length ? undefined : matchDrug(allergenTerm(substance), ctx.vocab, aliasesFrom(ctx.formulary));
    const allergen = m?.status === 'matched' ? m.ingredients.map((i) => i.rxcui) : [];
    if (!classes.length && !allergen.length) {
      skip({
        key: `allergen:${n.id}`,
        what: 'allergen',
        subject: substance,
        reason: L(`The allergy to "${substance}" could not be checked: the name is not recognised.`, `تعذر فحص الحساسية تجاه «${substance}»: الاسم غير معروف.`),
      });
      continue;
    }
    const allergenClasses = new Map<string, DrugClass>();
    for (const i of allergen) for (const c of ctx.vocab?.classesOf(i) ?? []) allergenClasses.set(c.id, c);
    const source = L(
      `${kindText.en} recorded on Day ${n.hospitalDay}${n.payload.reaction ? ` (${n.payload.reaction})` : ''}; matched through RxNorm ingredients and FDA Established Pharmacologic Classes.`,
      `${kindText.ar} مسجلة في اليوم ${n.hospitalDay}${n.payload.reaction ? ` (${n.payload.reaction})` : ''}؛ بالمطابقة عبر مكونات RxNorm وفئات FDA الدوائية.`,
    );
    for (const d of ds) {
      if (!d.ingredients.length) continue;
      const shared = d.ingredients.filter((i) => allergen.includes(i));
      const inClass = classes.filter((c) => d.ingredients.some((i) => ctx.vocab!.members(c.id).includes(i)));
      const cause = `${n.id}|${d.ref}`;
      const dataHash = hash(`${n.id}|${substance}|${n.payload.kind}|${d.ingredients.slice().sort().join(',')}`);
      if (shared.length || inClass.length) {
        const why = shared.length
          ? L(`contains ${shared.map((i) => ctx.vocab?.ingredientName(i) ?? i).join(', ')}`, `يحتوي ${shared.map((i) => ctx.vocab?.ingredientName(i) ?? i).join('، ')}`)
          : L(`belongs to ${inClass.map((c) => c.name).join(', ')}`, `ينتمي إلى ${inClass.map((c) => c.name).join('، ')}`);
        add({
          key: `allergy:${cause}`,
          ruleId: 'allergy',
          level: documentedLevel,
          title: L(`Documented ${kindText.en}: ${substance}`, `${kindText.ar} موثّقة: ${substance}`),
          detail: L(`${where(d).en} ${why.en}.`, `${where(d).ar} ${why.ar}.`),
          source,
          dataHash,
          entryIds: [n.id],
          ...refsOf(d),
          taskId: 't07',
        });
        continue;
      }
      // A different ingredient of the same class as the documented one: a class-level note.
      const sameClass = [...allergenClasses.values()].filter((c) => d.ingredients.some((i) => ctx.vocab!.members(c.id).includes(i)));
      if (sameClass.length) {
        add({
          key: `allergy:${cause}`,
          ruleId: 'allergy',
          level: 'informational',
          title: L(`Same class as a documented ${kindText.en}: ${substance}`, `من فئة ${kindText.ar} موثّقة: ${substance}`),
          detail: L(`${where(d).en} is in the same class (${sameClass.map((c) => c.name).join(', ')}). Consider cross-reactivity.`, `${where(d).ar} من الفئة نفسها (${sameClass.map((c) => c.name).join('، ')}). انتبه لاحتمال التفاعل المتصالب.`),
          source,
          dataHash,
          entryIds: [n.id],
          ...refsOf(d),
          taskId: 't07',
        });
      }
    }
  }
}

// ---------------------------------------------------------------- 2. interactions (DDInter 2.0, ONC high-priority list)

function interactionRule(ctx: RulesContext, ds: readonly DrugRef[], add: (a: Alert) => void, skip: (n: NotChecked) => void) {
  if (!ctx.interactions) {
    skip({
      key: 'interactions',
      what: 'interactions',
      reason: L(
        'Drug–drug interactions were not checked: the DDInter and ONC datasets are not installed yet. Check interactions yourself in Task 6.',
        'لم تُفحص التداخلات الدوائية: بيانات DDInter وONC غير مثبتة بعد. افحص التداخلات بنفسك في المهمة 6.',
      ),
    });
    return;
  }
  const active = ds.filter((d) => d.kind === 'course' && d.ingredients.length);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      for (const x of a.ingredients) {
        for (const y of b.ingredients) {
          for (const hit of ctx.interactions.lookup(x, y)) {
            const level: AlertLevel = hit.onc ? 'critical' : hit.severity === 'major' ? 'important' : 'informational';
            const sev = hit.onc ? 'ONC high-priority' : hit.severity === 'unknown' ? 'severity not graded' : hit.severity;
            const pair = [a.medId, b.medId].sort().join('+');
            add({
              key: `interaction:${pair}:${[x, y].sort().join('+')}`,
              ruleId: 'interaction',
              level,
              title: L(`Interaction (${sev}): ${a.label} + ${b.label}`, `تداخل (${sev}): ${a.label} + ${b.label}`),
              detail: L(
                [hit.mechanism ? `Mechanism: ${hit.mechanism}` : 'Mechanism: not given by the dataset', hit.management ? `Management: ${hit.management}` : 'Management: not given by the dataset'].join('. '),
                [hit.mechanism ? `الآلية: ${hit.mechanism}` : 'الآلية: غير مذكورة في البيانات', hit.management ? `التعامل: ${hit.management}` : 'التعامل: غير مذكور في البيانات'].join('. '),
              ),
              source: L(ctx.interactions.citation, ctx.interactions.citation),
              dataHash: hash(`${pair}|${hit.severity}|${hit.onc}|${ctx.interactions.version}`),
              medIds: [a.medId!, b.medId!],
              taskId: 't06',
            });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 3. therapeutic duplication

function duplicationRule(ctx: RulesContext, ds: readonly DrugRef[], add: (a: Alert) => void) {
  const active = ds.filter((d) => d.kind === 'course' && d.ingredients.length);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const pair = [a.medId, b.medId].sort().join('+');
      const same = a.ingredients.filter((x) => b.ingredients.includes(x));
      if (same.length) {
        const names = same.map((x) => ctx.vocab?.ingredientName(x) ?? x).join(', ');
        add({
          key: `duplication:${pair}`,
          ruleId: 'duplication',
          level: 'important',
          title: L(`Same ingredient twice: ${names}`, `المادة الفعالة نفسها مرتين: ${names}`),
          detail: L(`${a.label} and ${b.label} are both active orders.`, `${a.label} و${b.label} طلبان فعّالان كلاهما.`),
          source: L('RxNorm ingredients (offline index).', 'مكونات RxNorm (فهرس على الجهاز).'),
          dataHash: hash(`${pair}|${same.join(',')}`),
          medIds: [a.medId!, b.medId!],
          taskId: 't04',
        });
        continue;
      }
      const classesA = new Map(a.ingredients.flatMap((x) => ctx.vocab?.classesOf(x) ?? []).map((c) => [c.id, c]));
      const shared = b.ingredients.flatMap((x) => ctx.vocab?.classesOf(x) ?? []).filter((c) => classesA.has(c.id));
      if (shared.length) {
        const names = [...new Set(shared.map((c) => c.name))].join(', ');
        add({
          key: `duplication:${pair}`,
          ruleId: 'duplication',
          level: 'informational',
          title: L(`Same class: ${names}`, `الفئة نفسها: ${names}`),
          detail: L(`${a.label} and ${b.label} share a pharmacologic class. Duplication or an intended combination?`, `${a.label} و${b.label} من فئة دوائية واحدة. تكرار أم مزيج مقصود؟`),
          source: L('FDA Established Pharmacologic Classes (via RxClass).', 'الفئات الدوائية المعتمدة من FDA (عبر RxClass).'),
          dataHash: hash(`${pair}|${[...new Set(shared.map((c) => c.id))].sort().join(',')}`),
          medIds: [a.medId!, b.medId!],
          taskId: 't04',
        });
      }
    }
  }
}

// ---------------------------------------------------------------- 4. high-alert medication (the trainee's formulary flag)

function highAlertRule(ctx: RulesContext, ds: readonly DrugRef[], add: (a: Alert) => void) {
  const flagged = ctx.formulary.filter((f) => f.status === 'active' && f.highAlert && f.ingredients.length);
  for (const d of ds.filter((x) => x.kind === 'course')) {
    const f = flagged.find((x) => x.ingredients.every((i) => d.ingredients.includes(i)) || d.match.status === 'matched' && d.match.formularyItemId === x.id);
    if (!f) continue;
    add({
      key: `high_alert:${d.medId}`,
      ruleId: 'high_alert',
      level: 'important',
      title: L(`High-alert medication: ${d.label}`, `دواء عالي الخطورة: ${d.label}`),
      detail: L('On your hospital’s high-alert list. Check the safeguards in Task 28.', 'ضمن قائمة الأدوية عالية الخطورة في مستشفاك. تحقق من الضمانات في المهمة 28.'),
      source: L(`Your formulary: ${f.highAlertSource ?? f.sourceNote}`, `دستورك الدوائي: ${f.highAlertSource ?? f.sourceNote}`),
      dataHash: hash(`${f.id}@${f.version}|${d.ingredients.join(',')}`),
      medIds: [d.medId!],
      taskId: 't28',
    });
  }
}

// ---------------------------------------------------------------- 5. laboratory value in the critical range; creatinine rise

const QUANTITY_OF: Record<string, QuantityId> = {
  scr: 'creatinine',
  albumin: 'albumin',
  ca_total: 'calcium',
  na: 'electrolyte',
  k: 'electrolyte',
  cl: 'electrolyte',
  hco3: 'electrolyte',
  tbil: 'bilirubin',
  phenytoin: 'phenytoin',
  vanco: 'vancomycin',
  wbc: 'cell_count',
  neut_abs: 'cell_count',
  plt: 'cell_count',
  inr: 'inr',
};

function labRules(ctx: RulesContext, add: (a: Alert) => void, skip: (n: NotChecked) => void) {
  const labs = ctx.current.filter((e): e is EntryOf<'lab'> => e.type === 'lab' && e.payload.result.kind === 'numeric' && e.provenance !== 'extracted_unverified');
  for (const t of ctx.thresholds.filter((x) => x.status === 'active')) {
    const latest = labs.filter((e) => e.payload.analyte === t.analyte).sort(compareEntries).pop();
    if (!latest || latest.payload.result.kind !== 'numeric') continue;
    let v = latest.payload.result.value;
    if (latest.payload.unit !== t.unit) {
      const q = QUANTITY_OF[t.analyte];
      const c = q ? toCanonical(q, v, latest.payload.unit) : undefined;
      const back = q && c?.ok ? toCanonical(q, 1, t.unit) : undefined;
      if (!c?.ok || !back?.ok) {
        skip({
          key: `lab_unit:${t.id}`,
          what: 'lab_unit',
          subject: latest.payload.analyteName,
          reason: L(`${latest.payload.analyteName} is recorded in ${latest.payload.unit}, the threshold in ${t.unit}: not compared.`, `${latest.payload.analyteName} مسجل بوحدة ${latest.payload.unit} والحد بوحدة ${t.unit}: لم تتم المقارنة.`),
        });
        continue;
      }
      v = c.value / back.value;
    }
    const low = t.low !== undefined && v < t.low;
    const high = t.high !== undefined && v > t.high;
    if (!low && !high) continue;
    const name = ANALYTE_BY_ID.get(t.analyte)?.name ?? t.analyte;
    const shown = `${show(latest.payload.result.value, latest.payload.unit, 4)}`;
    const limit = low ? `below ${show(t.low!, t.unit, 4)}` : `above ${show(t.high!, t.unit, 4)}`;
    const limitAr = low ? `أقل من ${show(t.low!, t.unit, 4)}` : `أعلى من ${show(t.high!, t.unit, 4)}`;
    add({
      key: `lab_critical:${t.id}:${latest.id}`,
      ruleId: 'lab_critical',
      level: 'critical',
      title: L(`Critical laboratory value: ${name} ${shown}`, `قيمة مخبرية حرجة: ${name} ${shown}`),
      detail: L(`Day ${latest.hospitalDay}${latest.timeOfDay ? ` ${latest.timeOfDay}` : ''}: ${limit}. Interpret it with the trend, the draw time and the clinical picture.`, `اليوم ${latest.hospitalDay}${latest.timeOfDay ? ` ${latest.timeOfDay}` : ''}: ${limitAr}. فسّرها مع الاتجاه ووقت السحب والصورة السريرية.`),
      source: L(`Your hospital’s critical threshold — ${t.source}`, `الحد الحرج في مستشفاك — ${t.source}`),
      dataHash: hash(`${latest.id}|${t.id}@${t.version}`),
      entryIds: [latest.id],
      taskId: 't11',
    });
  }

  const series = scrSeries(ctx.current);
  const rise = creatinineChanges(series).filter((c) => c.kind === 'rise_48h' || c.kind === 'rise_7d').pop();
  if (rise) {
    add({
      key: `creatinine_rise:${rise.to.entryId}`,
      ruleId: 'creatinine_rise',
      level: 'important',
      title: L('Creatinine rise meets a KDIGO criterion for acute kidney injury', 'ارتفاع الكرياتينين يحقق معيار KDIGO للإصابة الكلوية الحادة'),
      detail: L(
        `${show(rise.from.mgdl, 'mg/dL')} (Day ${rise.from.day}) → ${show(rise.to.mgdl, 'mg/dL')} (Day ${rise.to.day})${rise.certainWithin48h ? '' : '; clock times not recorded'}. Review renally cleared drugs; estimates of kidney function are unreliable now.`,
        `${show(rise.from.mgdl, 'mg/dL')} (اليوم ${rise.from.day}) ← ${show(rise.to.mgdl, 'mg/dL')} (اليوم ${rise.to.day})${rise.certainWithin48h ? '' : '؛ لم تُسجَّل أوقات السحب'}. راجع الأدوية التي تُطرح كلوياً؛ تقديرات وظيفة الكلى غير موثوقة الآن.`,
      ),
      source: L(KDIGO_CITATION, KDIGO_CITATION),
      dataHash: hash(`${rise.from.entryId}|${rise.to.entryId}`),
      entryIds: [rise.from.entryId, rise.to.entryId],
      taskId: 't08',
    });
  }
}

// ---------------------------------------------------------------- 6. renal or hepatic adjustment required; missing data that blocks it

function latestResult(ctx: RulesContext, calc: string): CalcResult | undefined {
  return [...ctx.calcResults].filter((r) => r.calc === calc).sort((a, b) => (a.computedAt < b.computedAt ? -1 : 1)).pop();
}

const MEASURE_NAME: Record<string, string> = { crcl_cg: 'CrCl (Cockcroft–Gault)', egfr_ckdepi2021: 'eGFR (CKD-EPI 2021)', child_pugh: 'Child–Pugh' };

function adjustmentRules(ctx: RulesContext, courses: readonly MedCourse[], ds: readonly DrugRef[], add: (a: Alert) => void) {
  for (const rule of ctx.adjustments.filter((x) => x.status === 'active' && x.ingredients.length)) {
    for (const d of ds.filter((x) => x.kind === 'course' && x.ingredients.some((i) => rule.ingredients.includes(i)))) {
      const course = courses.find((c) => c.medId === d.medId)!;
      const ruleId = rule.organ === 'renal' ? 'renal_adjustment' : 'hepatic_adjustment';
      const r = latestResult(ctx, rule.measure);
      const gate = rule.organ === 'renal' ? renalDoseReviewGate(ctx.gather, course) : undefined;
      const blocked = !r || !ctx.isCurrent(r) || (gate && !gate.ok);
      if (blocked) {
        const lacking = gate?.items.filter((i) => i.state !== 'ok').map((i) => i.label) ?? [];
        const calcMissing = !r ? L(`no ${MEASURE_NAME[rule.measure]} calculated`, `لم يُحسب ${MEASURE_NAME[rule.measure]}`) : !ctx.isCurrent(r) ? L(`${MEASURE_NAME[rule.measure]} is out of date`, `${MEASURE_NAME[rule.measure]} قديم`) : undefined;
        const parts = [...(calcMissing ? [calcMissing] : []), ...lacking];
        add({
          key: `dose_blocked:${rule.id}:${d.medId}`,
          ruleId: 'dose_blocked',
          level: 'important',
          title: L(`Dose assessment blocked: ${d.label}`, `تقييم الجرعة متوقف: ${d.label}`),
          detail: L(
            `Your adjustment table has an entry for this drug, but the assessment needs: ${parts.map((p) => p.en).join(', ')}.`,
            `في جدول التعديل لديك مدخل لهذا الدواء، لكن التقييم يحتاج: ${parts.map((p) => p.ar).join('، ')}.`,
          ),
          source: L(`Your adjustment table — ${rule.source}`, `جدول التعديل لديك — ${rule.source}`),
          dataHash: hash(`${rule.id}@${rule.version}|${parts.map((p) => p.en).join('|')}|${r?.id ?? ''}`),
          medIds: [d.medId!],
          taskId: 't08',
        });
        continue;
      }
      const required =
        rule.organ === 'renal'
          ? rule.below !== undefined && r.value < rule.below
          : rule.fromClass !== undefined && r.category !== undefined && (r.category.value === 'C' || (r.category.value === 'B' && rule.fromClass === 'B'));
      if (!required) continue;
      const value = rule.organ === 'renal' ? `${MEASURE_NAME[rule.measure]} ${show(r.value, r.unit, r.decimals)}` : `Child–Pugh class ${r.category?.value}`;
      const limit = rule.organ === 'renal' ? `below ${rule.below} ${r.unit}` : `class ${rule.fromClass} or worse`;
      add({
        key: `${ruleId}:${rule.id}:${d.medId}`,
        ruleId,
        level: 'important',
        title: L(`${rule.organ === 'renal' ? 'Renal' : 'Hepatic'} dose adjustment required: ${d.label}`, `يلزم تعديل الجرعة ${rule.organ === 'renal' ? 'كلوياً' : 'كبدياً'}: ${d.label}`),
        detail: L(
          `${value} is ${limit}. Your source says: “${rule.sourceText}”. PRECEPTOR does not calculate the adjusted dose.`,
          `${value} ضمن ${rule.organ === 'renal' ? `أقل من ${rule.below} ${r.unit}` : `الفئة ${rule.fromClass} أو أسوأ`}. يقول مصدرك: «${rule.sourceText}». لا يحسب PRECEPTOR الجرعة المعدّلة.`,
        ),
        source: L(`Your adjustment table — ${rule.source}`, `جدول التعديل لديك — ${rule.source}`),
        dataHash: hash(`${rule.id}@${rule.version}|${r.id}`),
        medIds: [d.medId!],
        taskId: 't08',
      });
    }
  }
}

// ---------------------------------------------------------------- 7. antimicrobials: AWaRe, time-out at 48–72 h, de-escalation

function antimicrobialRules(ctx: RulesContext, courses: readonly MedCourse[], ds: readonly DrugRef[], add: (a: Alert) => void, skip: (n: NotChecked) => void) {
  const t14 = ctx.tasks.find((t) => t.taskId === 't14');
  const antimicrobials = ds.filter((d) => {
    if (d.kind !== 'course') return false;
    const said = t14?.fields[appliesKey(d.medId!)];
    if (said === 'no') return false;
    if (said === 'yes') return true;
    return d.ingredients.some((i) => (ctx.vocab?.antimicrobialClassesOf(i).length ?? 0) > 0);
  });
  if (antimicrobials.length && !ctx.aware) {
    skip({
      key: 'aware',
      what: 'aware',
      reason: L('WHO AWaRe categories were not assigned: the AWaRe 2025 dataset is not installed yet.', 'لم تُحدَّد فئات AWaRe: بيانات AWaRe 2025 غير مثبتة بعد.'),
    });
  }
  const cultures = ctx.current.filter((e): e is EntryOf<'culture'> => e.type === 'culture' && (e.payload.status === 'growth' || e.payload.status === 'no_growth'));
  for (const d of antimicrobials) {
    const course = courses.find((c) => c.medId === d.medId)!;
    if (ctx.aware) {
      const cats = [...new Set(d.ingredients.map((i) => ctx.aware!.categoryOf(i)).filter(Boolean))];
      if (cats.length)
        add({
          key: `aware:${d.medId}`,
          ruleId: 'aware',
          level: 'informational',
          title: L(`AWaRe: ${cats.join(', ')} — ${d.label}`, `تصنيف AWaRe: ${cats.join('، ')} — ${d.label}`),
          detail: L('WHO Access, Watch, Reserve classification of the antibiotic.', 'تصنيف منظمة الصحة العالمية للمضاد الحيوي (Access وWatch وReserve).'),
          source: L(ctx.aware.citation, ctx.aware.citation),
          dataHash: hash(`${d.ingredients.join(',')}|${ctx.aware.version}`),
          medIds: [d.medId!],
          taskId: 't14',
        });
    }
    const review = t14?.checks[scopedKey('timeout', d.medId!)];
    if (ctx.today !== null && ctx.today - course.startDay >= 2 && review !== 'ok' && review !== 'na') {
      const overdue = ctx.today - course.startDay > 3;
      add({
        key: `antibiotic_timeout:${d.medId}`,
        ruleId: 'antibiotic_timeout',
        level: 'important',
        title: L(`Antibiotic time-out ${overdue ? 'overdue' : 'due'}: ${d.label}`, `مراجعة المضاد الحيوي ${overdue ? 'متأخرة' : 'مستحقة'}: ${d.label}`),
        detail: L(
          `Started on Day ${course.startDay}, today is Day ${ctx.today}. Review at 48–72 hours: continue, narrow, switch IV to oral, or stop — and record it in Task 14.`,
          `بدأ في اليوم ${course.startDay}، واليوم هو ${ctx.today}. راجع عند 48–72 ساعة: الاستمرار أو التضييق أو التحويل من الوريد إلى الفم أو الإيقاف — وسجّل ذلك في المهمة 14.`,
        ),
        source: L('Antimicrobial stewardship time-out at 48–72 hours (Section 10).', 'مراجعة ترشيد المضادات عند 48–72 ساعة (القسم 10).'),
        dataHash: hash(`${course.medId}|${course.startDay}`),
        medIds: [d.medId!],
        taskId: 't14',
      });
    }
    const deesc = t14?.checks[scopedKey('deescalation', d.medId!)];
    const result = cultures.filter((c) => c.hospitalDay >= course.startDay).sort(compareEntries).pop();
    if (result && deesc !== 'ok' && deesc !== 'na') {
      const what = result.payload.status === 'growth' ? `${result.payload.specimen}: growth${result.payload.organism ? ` of ${result.payload.organism}` : ''}` : `${result.payload.specimen}: no growth`;
      add({
        key: `deescalation:${d.medId}:${result.id}`,
        ruleId: 'deescalation',
        level: 'important',
        title: L(`Culture result entered: consider de-escalation — ${d.label}`, `أُدخلت نتيجة زرع: فكّر في التضييق — ${d.label}`),
        detail: L(`Day ${result.hospitalDay}, ${what}. Review the spectrum against the result and record your decision in Task 14.`, `اليوم ${result.hospitalDay}، ${what}. راجع الطيف مقابل النتيجة وسجّل قرارك في المهمة 14.`),
        source: L('De-escalation prompt when a culture result is entered (Section 10).', 'تنبيه التضييق عند إدخال نتيجة زرع (القسم 10).'),
        dataHash: hash(`${result.id}|${course.medId}`),
        medIds: [d.medId!],
        entryIds: [result.id],
        taskId: 't14',
      });
    }
  }
}

// ---------------------------------------------------------------- assembly

export function evaluateRules(ctx: RulesContext): RulesOutcome {
  const byKey = new Map<string, Alert>();
  const add = (a: Alert) => {
    const prev = byKey.get(a.key);
    if (!prev || RANK[a.level] > RANK[prev.level]) byKey.set(a.key, a);
  };
  const skipped = new Map<string, NotChecked>();
  const skip = (n: NotChecked) => {
    if (!skipped.has(n.key)) skipped.set(n.key, n);
  };
  const courses = deriveMedCourses(ctx.current);
  const ds = drugs(ctx, courses);
  for (const d of ds) {
    if (d.match.status === 'not_checked' && normaliseName(d.label)) {
      skip({
        key: `drug:${d.ref}`,
        what: 'drug_name',
        subject: d.label,
        reason: L(
          `"${d.label}" was not checked for allergies, duplications or interactions: the name is not recognised. Add it to your formulary with its generic name.`,
          `لم يُفحص «${d.label}» للحساسية والتكرار والتداخلات: الاسم غير معروف. أضفه إلى دستورك الدوائي مع اسمه العلمي.`,
        ),
      });
    }
  }
  allergyRule(ctx, ds, add, skip);
  interactionRule(ctx, ds, add, skip);
  duplicationRule(ctx, ds, add);
  highAlertRule(ctx, ds, add);
  labRules(ctx, add, skip);
  adjustmentRules(ctx, courses, ds, add);
  antimicrobialRules(ctx, courses, ds, add, skip);
  const alerts = [...byKey.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || (a.key < b.key ? -1 : 1));
  return { alerts, notChecked: [...skipped.values()] };
}
