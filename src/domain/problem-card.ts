/**
 * The Clinical Problem Card (Section 14): one template for every drug-related
 * problem, built from the drug-related problem register row (owner decision
 * D2 of 20 October 2026). This module derives what the card shows beyond the
 * trainee's own entries, the same way wherever the card appears (Tasks 5, 13
 * and 29, the Problems list, the department form):
 *
 * - each of the thirteen fields, filled or explicitly missing — never blank;
 * - the PCNE codes and the two mappings derived from them (pcne-maps.ts);
 * - the checks on each claim (before M5: checks in code only);
 * - the review state from the append-only decisions (Section 8, Review);
 * - the stage of the problem (Section 8: "stage per problem");
 * - the rank (owner decision D5) and the staleness (decisions D7 and D8);
 * - whether the card may enter the form's Sections 8 and 9.
 */
import { claimKeyTargets, claimsValue, claimTargets, parseClaims, parseLinks, type CardClaim, type CardLink } from './card-data';
import { L } from './label';
import { doseNumbersInText, numbersInText } from './numbers';
import { PCNE_CODE, type PcneCode } from './pcne';
import { classificationUnanswered, pcneCoherence, type CoherenceIssue } from './pcne-coherence';
import { claimKey, normalizeForMatch, passesGate, type ClaimVerification } from './verdicts';
import { cipolleFor, formBoxesFor, type CipolleView } from './pcne-maps';
import { compareEntries, indexTimeline } from './timeline';
import type { CardDecision, CardReview, RegisterItem, TimelineEntry } from './types';
import { CARD_SECTIONS, DRP_CATEGORIES, DRP_RECORD_FIELDS, type DrpCategory } from './workflow/registers';
import { VITAL_BY_ID } from './catalogue';
import type { CalcResult } from '../calc/types';

export const CARD_FIELD_COUNT = 13;

export interface CardContext {
  /** Every timeline entry of the case, including corrected and retracted ones. */
  entries: readonly TimelineEntry[];
  calcResults: readonly CalcResult[];
  /** Ids of calculation results whose inputs changed since they were computed (calc/currency.ts). */
  calcOutOfDate: ReadonlySet<string>;
  /** Every card decision of the case. */
  reviews: readonly CardReview[];
  /** The keys of the offline interaction check's current alerts, when known (claims citing the check). */
  alertKeys?: ReadonlySet<string>;
  /** A calculator's name, for the reasons shown. */
  calcName?: (calcId: string) => L | undefined;
  /** M5: the latest verdict of each checked statement, by its key (verdicts.ts). */
  verdicts?: ReadonlyMap<string, ClaimVerification>;
}

/** M5: the latest verdict on one claim of a card: for exactly its words and what it cites. */
export const claimVerdict = (c: CardClaim, ctx: Pick<CardContext, 'verdicts'>): ClaimVerification | undefined => ctx.verdicts?.get(claimKey(c.text, claimKeyTargets(c)));

/**
 * M5: whose words a claim is, decided by its words, not by the editor: a
 * claim is the model's exactly when its text is one the model drafted for this
 * card (whitespace, quotes and dashes aside); rewritten, it is the trainee's.
 * A card the trainee wrote has no model claims.
 */
export function markModelClaims(value: string | undefined, drafted: readonly CardClaim[]): string | undefined {
  if (!value) return value;
  const words = new Set(drafted.map((c) => normalizeForMatch(c.text)));
  const claims = parseClaims(value).map(({ by: _by, ...c }) => (words.has(normalizeForMatch(c.text)) ? { ...c, by: 'model' as const } : c));
  return claimsValue(claims);
}

/**
 * M5, decision 6: the claims the model drafted that have not passed the gate —
 * "supported", shown by a literal quote. A claim the trainee wrote or rewrote
 * is theirs: it shows its verdict when checked, and is not gated.
 */
export const unverifiedModelClaims = (f: Readonly<Record<string, string>>, ctx: Pick<CardContext, 'verdicts'>): CardClaim[] =>
  cardClaims(f).filter((c) => c.by === 'model' && !passesGate(claimVerdict(c, ctx)));

// ---------------------------------------------------------------- PCNE and the two mappings

export interface CardPcne {
  problem?: PcneCode;
  type?: 'potential' | 'manifest';
  causes: PcneCode[];
  /** A card recorded before M4 with the department's category only, not yet classified. */
  legacyBox?: DrpCategory;
}

export function cardPcne(f: Readonly<Record<string, string>>): CardPcne {
  const problem = f.pcneProblem ? PCNE_CODE.get(f.pcneProblem) : undefined;
  const causes = (f.pcneCauses ?? '')
    .split('|')
    .map((x) => PCNE_CODE.get(x))
    .filter((x): x is PcneCode => !!x);
  const type = f.pcneType === 'potential' || f.pcneType === 'manifest' ? f.pcneType : undefined;
  const legacy = !problem && f.category ? (f.category as DrpCategory) : undefined;
  return { ...(problem ? { problem } : {}), ...(type ? { type } : {}), causes, ...(legacy ? { legacyBox: legacy } : {}) };
}

export interface CardBoxes {
  boxes: DrpCategory[];
  /** The PCNE wording written under "other". */
  otherText: string[];
  /** pcne: ticked from the codes; adjusted: the trainee's adjustment (with its reason); legacy: the pre-M4 category. */
  source: 'pcne' | 'adjusted' | 'legacy' | 'none';
  /** The boxes the codes tick, shown beside an adjustment. */
  derived: DrpCategory[];
  reason?: string;
}

const BOX_ORDER = DRP_CATEGORIES.map((c) => c.value as DrpCategory);

/** The department form's Section 8 boxes of one card: derived from its PCNE codes, never stored as the record (Section 14). */
export function cardBoxes(f: Readonly<Record<string, string>>): CardBoxes {
  const p = cardPcne(f);
  const derived = p.problem ? formBoxesFor(p.problem.code, p.causes.map((x) => x.code)) : { boxes: [], otherText: [] };
  if (f.boxes) {
    const chosen = new Set(f.boxes.split('|'));
    const boxes = BOX_ORDER.filter((b) => chosen.has(b));
    return { boxes, otherText: boxes.includes('other') ? derived.otherText : [], source: 'adjusted', derived: derived.boxes, ...(f.boxesReason ? { reason: f.boxesReason } : {}) };
  }
  if (p.problem) return { boxes: derived.boxes, otherText: derived.otherText, source: 'pcne', derived: derived.boxes };
  if (p.legacyBox) return { boxes: [p.legacyBox], otherText: [], source: 'legacy', derived: [] };
  return { boxes: [], otherText: [], source: 'none', derived: [] };
}

export function cardCipolle(f: Readonly<Record<string, string>>): CipolleView {
  const p = cardPcne(f);
  return cipolleFor(p.problem?.code, p.causes.map((x) => x.code));
}

// ---------------------------------------------------------------- what the card cites

export const cardLinks = (f: Readonly<Record<string, string>>): CardLink[] => parseLinks(f.supporting);
export const cardClaims = (f: Readonly<Record<string, string>>): CardClaim[] => parseClaims(f.claims);

/** The values the card links and its claims cite (a claim may cite several: claimTargets). */
const citedOf = (f: Readonly<Record<string, string>>, kind: CardLink['kind']): string[] =>
  [...new Set([...cardLinks(f), ...cardClaims(f).flatMap(claimTargets)].filter((l) => l.kind === kind).map((l) => l.id))];

export const citedEntryIds = (f: Readonly<Record<string, string>>): string[] => citedOf(f, 'entry');

export const citedCalcIds = (f: Readonly<Record<string, string>>): string[] => citedOf(f, 'calc');

/** Numbers a statement citing this entry may use: its values, its day and its time. */
export function entryNumbers(e: TimelineEntry): Set<string> {
  const out = numbersInText(JSON.stringify(e.payload));
  out.add(String(e.hospitalDay));
  for (const n of numbersInText(e.timeOfDay ?? '')) out.add(n);
  return out;
}

/** Numbers a statement citing this result may use: the value as computed and as shown, the inputs, the secondary values, the day. */
export function calcNumbers(r: CalcResult): Set<string> {
  const out = new Set<string>([String(r.value), String(Number(r.value.toFixed(r.decimals)))]);
  for (const v of Object.values(r.inputs.values)) out.add(String(v));
  for (const s of r.secondary ?? []) {
    out.add(String(s.value));
    out.add(String(Number(s.value.toFixed(s.decimals))));
  }
  if (r.day !== undefined) out.add(String(r.day));
  return out;
}

// ---------------------------------------------------------------- the checks on each claim (Section 12, before the verifier of M5)

export type ClaimCheck =
  /** The source exists and every number of the claim is in it. */
  | { kind: 'numbers_found' }
  | { kind: 'numbers_not_found'; numbers: string[] }
  /** The cited entry was corrected or retracted, or the cited result is out of date. */
  | { kind: 'source_changed' }
  | { kind: 'source_missing' }
  /** A source the trainee read, the offline check (no numbers to compare), or no source: shown as unverified by PRECEPTOR. */
  | { kind: 'not_checked'; why: 'reading' | 'none' | 'dataset' | 'research' };

export function checkClaim(c: CardClaim, ctx: CardContext, current: ReadonlySet<string>): ClaimCheck {
  switch (c.source) {
    case 'entry':
    case 'calc': {
      // Every value the claim cites must exist and be current; its numbers may come from any of them.
      const allowed = new Set<string>();
      for (const t of claimTargets(c)) {
        if (t.kind === 'entry') {
          const e = ctx.entries.find((x) => x.id === t.id);
          if (!e) return { kind: 'source_missing' };
          if (!current.has(e.id)) return { kind: 'source_changed' };
          for (const n of entryNumbers(e)) allowed.add(n);
        } else {
          const r = ctx.calcResults.find((x) => x.id === t.id);
          if (!r) return { kind: 'source_missing' };
          if (ctx.calcOutOfDate.has(r.id)) return { kind: 'source_changed' };
          for (const n of calcNumbers(r)) allowed.add(n);
        }
      }
      const missing = [...numbersInText(c.text)].filter((n) => !allowed.has(n));
      return missing.length ? { kind: 'numbers_not_found', numbers: missing } : { kind: 'numbers_found' };
    }
    case 'dataset':
      if (ctx.alertKeys && !ctx.alertKeys.has(c.ref ?? '')) return { kind: 'source_missing' };
      return { kind: 'not_checked', why: 'dataset' };
    case 'reading':
      return { kind: 'not_checked', why: 'reading' };
    // A researched statement was checked against the passage it quotes when it was drafted (research/check.ts); its verdict is shown beside it.
    case 'research':
      return { kind: 'not_checked', why: 'research' };
    case 'none':
      return { kind: 'not_checked', why: 'none' };
  }
}

/** Doses in the recommendation that do not appear in a cited calculation, a cited value or a claim with a source (Section 12). */
export function untracedDoses(f: Readonly<Record<string, string>>, ctx: CardContext): string[] {
  const doses = doseNumbersInText(f.recommendation ?? '');
  if (!doses.length) return [];
  const allowed = new Set<string>();
  for (const id of citedCalcIds(f)) {
    const r = ctx.calcResults.find((x) => x.id === id);
    if (r) for (const n of calcNumbers(r)) allowed.add(n);
  }
  for (const id of citedEntryIds(f)) {
    const e = ctx.entries.find((x) => x.id === id);
    if (e) for (const n of entryNumbers(e)) allowed.add(n);
  }
  for (const c of cardClaims(f)) if (c.source !== 'none') for (const n of numbersInText(c.text)) allowed.add(n);
  return doses.filter((d) => !allowed.has(d.number)).map((d) => d.text);
}

// ---------------------------------------------------------------- review state (Section 8: per recommendation, append-only)

/** A fingerprint of the card's clinical content: what was decided. Recording communication, implementation or outcome does not change it. */
export function contentHash(fields: Readonly<Record<string, string>>): string {
  const content = Object.keys(fields)
    .filter((k) => !DRP_RECORD_FIELDS.has(k))
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\u0000');
  let h = 0x811c9dc5; // FNV-1a, 32 bits
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function reviewsOf(itemId: string, reviews: readonly CardReview[]): CardReview[] {
  return reviews.filter((r) => r.itemId === itemId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

export type ReviewState =
  /** A card the trainee wrote, with no decision recorded (owner decision D9). */
  | { kind: 'written_by_you' }
  /** A card from the model's draft with no decision: never shown as accepted. */
  | { kind: 'undecided' }
  | { kind: 'decided'; decision: CardDecision; review: CardReview; changedSince: boolean };

export const fromModel = (item: RegisterItem): boolean => item.origin?.kind === 'suggestion';

export function reviewState(item: RegisterItem, reviews: readonly CardReview[]): ReviewState {
  const last = reviewsOf(item.id, reviews).at(-1);
  if (!last) return fromModel(item) ? { kind: 'undecided' } : { kind: 'written_by_you' };
  return { kind: 'decided', decision: last.decision, review: last, changedSince: last.contentHash !== contentHash(item.fields) };
}

// ---------------------------------------------------------------- stage per problem (Section 8)

export const CARD_STAGES = ['identified', 'planned', 'reviewed', 'communicated', 'implemented', 'followed_up'] as const;
export type CardStage = (typeof CARD_STAGES)[number];

export interface StageInfo {
  reached: ReadonlySet<CardStage>;
  /** The furthest stage reached. */
  current: CardStage;
  /** The team declined the recommendation. */
  declined: boolean;
}

export function cardStage(item: RegisterItem, review: ReviewState): StageInfo {
  const f = item.fields;
  const reached = new Set<CardStage>(['identified']);
  if (f.recommendation) reached.add('planned');
  const accepted = review.kind === 'decided' && (review.decision === 'accepted' || review.decision === 'edited');
  if (accepted || (review.kind === 'written_by_you' && f.recStatus === 'final')) reached.add('reviewed');
  if (f.response && f.response !== 'not_communicated') reached.add('communicated');
  if (f.implemented === 'yes') reached.add('implemented');
  if (f.goalMet && f.goalMet !== 'not_measured') reached.add('followed_up');
  const current = [...CARD_STAGES].reverse().find((s) => reached.has(s))!;
  return { reached, current, declined: f.response === 'declined' };
}

// ---------------------------------------------------------------- staleness (owner decisions D7 and D8)

/** Entries "of the same kind": the same laboratory test, vital sign, medication order, allergy record, dialysis status, problem … */
export function kindKey(e: TimelineEntry): string {
  switch (e.type) {
    case 'lab':
      return `lab:${e.payload.analyte === 'other' ? e.payload.analyteName.trim().toLowerCase() : e.payload.analyte}`;
    case 'vital':
      return `vital:${e.payload.vital}`;
    case 'weight':
      return 'weight';
    case 'med_start':
    case 'med_change':
    case 'med_stop':
      return `med:${e.payload.medId}`;
    case 'note': {
      const p = e.payload;
      if (p.category === 'problem') return `problem:${p.problemId}`;
      if (p.category === 'allergy_adr') return 'allergy';
      if (p.category === 'renal_replacement') return 'rrt';
      return `note:${p.category}`;
    }
    case 'culture':
      return `culture:${e.payload.specimen.trim().toLowerCase()}`;
    case 'imaging':
      return `imaging:${e.payload.modality.trim().toLowerCase()}`;
    case 'procedure':
      return `procedure:${e.payload.name.trim().toLowerCase()}`;
    case 'event':
      return `event:${e.payload.category}`;
    default:
      return e.type;
  }
}

/** What an entry is, in a reason ("the creatinine", "the weight"). */
export function kindLabel(e: TimelineEntry): L {
  switch (e.type) {
    case 'lab':
      return L(e.payload.analyteName, e.payload.analyteName);
    case 'vital': {
      const name = VITAL_BY_ID.get(e.payload.vital)?.name ?? e.payload.vital;
      return L(name, name);
    }
    case 'weight':
      return L('weight', 'الوزن');
    case 'med_start':
    case 'med_change':
    case 'med_stop':
      return L(`${e.payload.drug} order`, `طلب ${e.payload.drug}`);
    case 'note': {
      const p = e.payload;
      if (p.category === 'problem') return L(`problem "${p.name}"`, `المشكلة "${p.name}"`);
      if (p.category === 'allergy_adr') return L('allergy record', 'سجل الحساسية');
      if (p.category === 'renal_replacement') return L('renal replacement therapy status', 'حالة العلاج الكلوي البديل');
      return L(`${p.category.replace(/_/g, ' ')} note`, 'ملاحظة');
    }
    default:
      return L(e.type.replace(/_/g, ' '), e.type.replace(/_/g, ' '));
  }
}

export interface CardStaleness {
  stale: boolean;
  /** The hospital day of the data that made it stale: "Re-analyse — Day N". */
  day?: number;
  reasons: L[];
}

/**
 * A card version depends on the entries and calculation results it cites (and
 * on the entries those results used). It is stale when one of them was
 * corrected or retracted, when an entry of the same kind was recorded after
 * its content was last written or reviewed again, or when a cited result went
 * out of date. An unrelated entry does not make it stale.
 */
export function cardStaleness(item: RegisterItem, ctx: CardContext): CardStaleness {
  const idx = indexTimeline(ctx.entries);
  const current = new Set(idx.current.map((e) => e.id));
  const since = item.contentAt ?? item.versionCreatedAt;
  const reasons = new Map<string, L>();
  let day: number | undefined;
  const bump = (d: number) => (day = day === undefined ? d : Math.max(day, d));
  const nameOf = (r: CalcResult) => ctx.calcName?.(r.calc) ?? L(r.calc, r.calc);

  const watch: { e: TimelineEntry; via?: CalcResult }[] = [];
  for (const id of citedEntryIds(item.fields)) {
    const e = idx.byId.get(id);
    if (e) watch.push({ e });
  }
  const results = citedCalcIds(item.fields).map((id) => ({ id, r: ctx.calcResults.find((x) => x.id === id) }));
  // A result's own inputs matter only once the result is out of date (calc/currency.ts decides); they then say which data and which day.
  for (const { r } of results) {
    if (!r || !ctx.calcOutOfDate.has(r.id)) continue;
    for (const id of r.inputs.entryIds) {
      const e = idx.byId.get(id);
      if (e) watch.push({ e, via: r });
    }
  }

  for (const { e, via } of watch) {
    const what = kindLabel(e);
    const used = via ? L(` (used by ${nameOf(via).en})`, ` (استخدمه ${nameOf(via).ar})`) : L('', '');
    if (!current.has(e.id)) {
      const head = idx.headOf(e.id);
      const retracted = !head || head.correction?.kind === 'retract' || !current.has(head.id);
      reasons.set(`changed:${e.id}`, L(
        `The ${what.en} of Day ${e.hospitalDay}${used.en} was ${retracted ? 'marked entered in error' : 'corrected'}.`,
        `${retracted ? 'عُلّم' : 'صُحّح'} ${what.ar} لليوم ${e.hospitalDay}${used.ar}${retracted ? ' كإدخال خاطئ' : ''}.`,
      ));
      bump(head && current.has(head.id) ? head.hospitalDay : e.hospitalDay);
      continue;
    }
    const key = kindKey(e);
    const newer = idx.current.filter((x) => x.id !== e.id && x.recordedAt > since && kindKey(x) === key).sort(compareEntries);
    const latest = newer.at(-1);
    if (latest) {
      reasons.set(`newer:${key}`, L(
        `A new ${what.en} was recorded after this card (Day ${latest.hospitalDay})${used.en}.`,
        `سُجّلت قيمة جديدة لـ ${what.ar} بعد هذه البطاقة (اليوم ${latest.hospitalDay})${used.ar}.`,
      ));
      bump(latest.hospitalDay);
    }
  }
  for (const { id, r } of results) {
    if (!r) {
      reasons.set(`calc:${id}`, L('A calculation it cites no longer exists.', 'حساب تستشهد به لم يعد موجوداً.'));
      continue;
    }
    if (ctx.calcOutOfDate.has(r.id)) {
      reasons.set(`calc:${id}`, L(`The ${nameOf(r).en} it cites is out of date: its inputs changed.`, `نتيجة ${nameOf(r).ar} التي تستشهد بها لم تعد محدّثة: تغيّرت مدخلاتها.`));
      if (r.day !== undefined && day === undefined) bump(r.day);
    }
  }
  const list = [...reasons.values()];
  if (list.length && day === undefined) day = idx.current.at(-1)?.hospitalDay;
  return { stale: list.length > 0, ...(day !== undefined ? { day } : {}), reasons: list };
}

// ---------------------------------------------------------------- the thirteen fields, filled or explicitly missing

export interface CardFieldStatus {
  /** 1–13 (Section 14). */
  no: number;
  label: L;
  /** Set when the field has no content: what is missing, said explicitly. */
  missing?: L;
  /** Gaps in a field that has content. */
  notes: L[];
}

const M = {
  problem: L('The problem, in one sentence.', 'المشكلة في جملة واحدة.'),
  supporting: L('No supporting data: link the values from the timeline this problem rests on.', 'لا بيانات داعمة: اربط القيم من الخط الزمني التي تستند إليها المشكلة.'),
  unlinked: L('Not linked to the timeline: link each value to its entry.', 'غير مرتبطة بالخط الزمني: اربط كل قيمة بإدخالها.'),
  missingInfo: L('Not stated: name what is still needed, or write "Nothing missing".', 'غير محددة: سمِّ ما زال مطلوباً، أو اكتب "لا شيء ناقص".'),
  assessment: L('No assessment and no alternative explanations yet.', 'لا تقييم ولا تفسيرات بديلة بعد.'),
  pcne: L('No PCNE problem code.', 'لا يوجد رمز مشكلة وفق PCNE.'),
  legacy: L('No PCNE codes: this card has the department’s category only (recorded before M4). Edit it to classify it.', 'لا رموز PCNE: لهذه البطاقة فئة القسم فقط (سُجّلت قبل M4). عدّلها لتصنيفها.'),
  causes: L('No PCNE cause code (C9.3 if there is no obvious cause).', 'لا رمز سبب وفق PCNE (C9.3 إن لم يوجد سبب واضح).'),
  type: L('Potential or manifest is not said.', 'لم يُحدَّد إن كانت محتملة أم قائمة.'),
  questioned: L(
    'The codes and the problem as written disagree, and no reason is given: correct one of them, or say why both are right. Until then the card stays out of the department form.',
    'الرموز والمشكلة كما كُتبت لا تتفقان، ولم يُذكر سبب: صحّح أحدهما، أو اذكر لماذا كلاهما صحيح. حتى ذلك الحين تبقى البطاقة خارج نموذج القسم.',
  ),
  priority: L('No priority.', 'لا أولوية.'),
  priorityReason: L('The reason for this priority is not given.', 'لم يُذكر سبب هذه الأولوية.'),
  claims: L('No claim with its source yet: add the statements this card rests on, each with its source.', 'لا ادعاءات مع مصادرها بعد: أضف العبارات التي تستند إليها البطاقة، كلٌّ مع مصدره.'),
  recommendation: L('No recommendation yet.', 'لا توصية بعد.'),
  monitoring: L('No monitoring plan yet.', 'لا خطة مراقبة بعد.'),
  undecided: L('Not decided: accept, edit, reject, ask for evidence or refer for senior review.', 'لم يُتخذ قرار: اقبل أو عدّل أو ارفض أو اطلب دليلاً أو أحِل لمراجعة أعلى.'),
  implementation: L('Not recorded: whether it was communicated and carried out.', 'غير مسجّل: هل أُبلغت التوصية ونُفّذت.'),
  outcome: L('Not recorded: "Not measured yet" is a valid answer.', 'غير مسجّلة: «لم تُقَس بعد» إجابة صحيحة.'),
  teaching: L('Not written yet: what question does this problem teach you to ask?', 'لم يُكتب بعد: ما السؤال الذي تعلّمك هذه المشكلة أن تطرحه؟'),
};

export function cardFields(item: RegisterItem, ctx: CardContext, review: ReviewState = reviewState(item, ctx.reviews)): CardFieldStatus[] {
  const f = item.fields;
  const p = cardPcne(f);
  const out: CardFieldStatus[] = CARD_SECTIONS.map((label, i) => ({ no: i + 1, label, notes: [] }));
  const at = (n: number) => out[n - 1]!;
  const miss = (n: number, what: L) => (at(n).missing = what);

  if (!f.problem) miss(1, M.problem);
  const links = cardLinks(f);
  if (!links.length && !f.evidence) miss(2, M.supporting);
  else if (!links.length) at(2).notes.push(M.unlinked);
  if (!f.missing) miss(3, M.missingInfo);
  if (!f.assessment) miss(4, M.assessment);
  if (!p.problem) miss(5, p.legacyBox ? M.legacy : M.pcne);
  else {
    if (!p.causes.length) at(5).notes.push(M.causes);
    if (!p.type) at(5).notes.push(M.type);
    // M5: a classification that disagrees with the problem as written, with no reason given (pcne-coherence.ts).
    if (classificationUnanswered(f)) at(5).notes.push(M.questioned);
  }
  if (!f.priority) miss(6, M.priority);
  else if (!f.priorityReason) at(6).notes.push(M.priorityReason);
  if (!cardClaims(f).length) miss(7, M.claims);
  if (!f.recommendation) miss(8, M.recommendation);
  else {
    const doses = untracedDoses(f, ctx);
    if (doses.length) at(8).notes.push(L(`Not traced to a calculation or a cited source: ${doses.join(', ')}.`, `غير مستندة إلى حساب أو مصدر مذكور: ${doses.join('، ')}.`));
  }
  if (!f.monitoring) miss(9, M.monitoring);
  if (review.kind === 'undecided') miss(10, M.undecided);
  if (!f.implemented && !f.response) miss(11, M.implementation);
  if (!f.goalMet) miss(12, M.outcome);
  if (!f.teaching) miss(13, M.teaching);
  return out;
}

// ---------------------------------------------------------------- prioritisation (owner decision D5)

export type EvidenceStrength = 'calc_or_dataset' | 'case_data' | 'no_source';

/** Derived, never rated: a calculation or a dataset, then the case's own data, then nothing PRECEPTOR can check. */
export function evidenceStrength(f: Readonly<Record<string, string>>): EvidenceStrength {
  const links = cardLinks(f);
  const claims = cardClaims(f);
  if (links.some((l) => l.kind === 'calc') || claims.some((c) => c.source === 'calc' || c.source === 'dataset')) return 'calc_or_dataset';
  if (links.some((l) => l.kind === 'entry') || claims.some((c) => c.source === 'entry')) return 'case_data';
  return 'no_source';
}

const LEVEL: Record<string, number> = { critical: 0, important: 1, informational: 2 };
const RATED: Record<string, number> = { high: 0, medium: 1, low: 2 };
const STRENGTH: Record<EvidenceStrength, number> = { calc_or_dataset: 0, case_data: 1, no_source: 2 };

/** The sort key, in the fixed, visible order: priority level, urgency, significance, impact, strength of evidence. Unrated sorts after low. */
export function rankKey(f: Readonly<Record<string, string>>): number[] {
  return [LEVEL[f.priority ?? ''] ?? 3, RATED[f.urgency ?? ''] ?? 3, RATED[f.significance ?? ''] ?? 3, RATED[f.impact ?? ''] ?? 3, STRENGTH[evidenceStrength(f)]];
}

export function compareCards(a: RegisterItem, b: RegisterItem): number {
  const ka = rankKey(a.fields);
  const kb = rankKey(b.fields);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function rankCards(items: readonly RegisterItem[]): RegisterItem[] {
  return [...items].sort(compareCards);
}

// ---------------------------------------------------------------- the department form (Sections 8 and 9)

/** Why a card is kept out of the form. */
export type FormExclusion =
  | 'stale'
  | 'rejected'
  | 'needs_evidence'
  | 'needs_senior_review'
  | 'undecided'
  | 'no_recommendation'
  | 'not_final'
  | 'untraced_dose'
  /** M5: its PCNE classification disagrees with the problem as written, and no reason was given. */
  | 'classification'
  /** M5, decision 6: a claim the model drafted is not "supported" with a literal quote. */
  | 'claims_not_verified';

export interface CardFormStatus {
  /** Undefined: the card enters Section 8 (its boxes and its line). */
  section8?: FormExclusion;
  /** Undefined: its recommendation enters Section 9. */
  section9?: FormExclusion;
  staleness: CardStaleness;
  review: ReviewState;
}

/**
 * A stale card never enters the form (Section 7); neither does a rejected one,
 * one waiting for evidence or a senior review, a model draft not decided, one
 * whose PCNE classification PRECEPTOR questions with no reason given, or one
 * with a claim the model drafted that the verifier has not found supported
 * with a literal quote (decision 6).
 * Section 9 takes only the final recommendations of the cards that remain,
 * with every dose traced to its source (Section 12).
 */
export function cardFormStatus(item: RegisterItem, ctx: CardContext): CardFormStatus {
  const staleness = cardStaleness(item, ctx);
  const review = reviewState(item, ctx.reviews);
  let s8: FormExclusion | undefined;
  if (staleness.stale) s8 = 'stale';
  else if (review.kind === 'undecided') s8 = 'undecided';
  else if (review.kind === 'decided' && (review.decision === 'rejected' || review.decision === 'needs_evidence' || review.decision === 'needs_senior_review')) s8 = review.decision;
  else if (classificationUnanswered(item.fields)) s8 = 'classification';
  else if (unverifiedModelClaims(item.fields, ctx).length) s8 = 'claims_not_verified';
  let s9 = s8;
  if (!s9) {
    if (!item.fields.recommendation) s9 = 'no_recommendation';
    else if (item.fields.recStatus !== 'final') s9 = 'not_final';
    else if (untracedDoses(item.fields, ctx).length) s9 = 'untraced_dose';
  }
  return { ...(s8 ? { section8: s8 } : {}), ...(s9 ? { section9: s9 } : {}), staleness, review };
}

// ---------------------------------------------------------------- everything the card view shows

export interface CardModel {
  item: RegisterItem;
  pcne: CardPcne;
  /** M5: the questions PRECEPTOR asks of its classification (pcne-coherence.ts). */
  coherence: CoherenceIssue[];
  boxes: CardBoxes;
  cipolle: CipolleView;
  links: { link: CardLink; entry?: TimelineEntry; result?: CalcResult; current: boolean }[];
  /** Each claim with the checks in code and, once checked, the verifier's latest verdict on exactly these words and sources. */
  claims: { claim: CardClaim; check: ClaimCheck; verdict?: ClaimVerification }[];
  reviews: CardReview[];
  review: ReviewState;
  stage: StageInfo;
  staleness: CardStaleness;
  fields: CardFieldStatus[];
  evidence: EvidenceStrength;
  form: CardFormStatus;
}

export function buildCard(item: RegisterItem, ctx: CardContext): CardModel {
  const idx = indexTimeline(ctx.entries);
  const current = new Set(idx.current.map((e) => e.id));
  const review = reviewState(item, ctx.reviews);
  const form = cardFormStatus(item, ctx);
  return {
    item,
    pcne: cardPcne(item.fields),
    coherence: pcneCoherence(item.fields),
    boxes: cardBoxes(item.fields),
    cipolle: cardCipolle(item.fields),
    links: cardLinks(item.fields).map((link) => {
      if (link.kind === 'entry') {
        const entry = idx.byId.get(link.id);
        return { link, ...(entry ? { entry } : {}), current: current.has(link.id) };
      }
      const result = ctx.calcResults.find((r) => r.id === link.id);
      return { link, ...(result ? { result } : {}), current: !!result && !ctx.calcOutOfDate.has(result.id) };
    }),
    claims: cardClaims(item.fields).map((claim) => {
      const verdict = claimVerdict(claim, ctx);
      return { claim, check: checkClaim(claim, ctx, current), ...(verdict ? { verdict } : {}) };
    }),
    reviews: reviewsOf(item.id, ctx.reviews),
    review,
    stage: cardStage(item, review),
    staleness: form.staleness,
    fields: cardFields(item, ctx, review),
    evidence: evidenceStrength(item.fields),
    form,
  };
}
