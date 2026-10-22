/**
 * The export of the department form (plan M6; Section 15: Ward and Teaching
 * copies; the task catalogue's own words: "PDF export of the department form,
 * blocked while anything is unverified").
 *
 * The export is built from the very view the screen shows (deriveForm), never
 * from the record directly, so nothing the form leaves out — a stale card, a
 * claim the verifier did not find supported, an undecided draft — can reach
 * the file. On top of that, the export is *refused*, with the reasons, while
 * anything shown is unverified: a value read by the model and not confirmed, a
 * model suggestion not decided, a calculation out of date, a data conflict, a
 * Problem Card held back for evidence, review or verification, or a machine
 * reading still waiting to be checked. The file states what it is, carries a
 * content hash, and never presents itself as a replacement for a clinical
 * pharmacist (Section 24).
 */
import { en } from '../../i18n/en';
import { PROVENANCE_VISUALS } from '../provenance';
import type { FormExclusion } from '../problem-card';
import type { CaseKind } from '../types';
import type { CopyMode, FieldItem, FieldState, FormFieldView, FormSectionView, FormView } from './derive';
import { FORM_TITLE, type FormLabel } from './spec';

export type ExportBlocker =
  | { code: 'ward_copy_not_allowed'; why: 'teaching_case' | 'release_gate' }
  | { code: 'unverified_value'; section: number; label: FormLabel; provenance: 'extracted_unverified' | 'ai_suggestion' }
  | { code: 'excluded_card'; section: 8 | 9; problem: string; reason: FormExclusion }
  | { code: 'calc_out_of_date'; section: number }
  | { code: 'data_conflict'; section: number; note: string }
  | { code: 'pending_extraction'; n: number };

/** Cards left out for these reasons are unresolved, so the export waits; a rejected card is a final decision, a card with no final recommendation is only unfinished. */
const UNRESOLVED: ReadonlySet<FormExclusion> = new Set<FormExclusion>(['stale', 'needs_evidence', 'needs_senior_review', 'undecided', 'untraced_dose', 'classification', 'claims_not_verified']);

export interface ExportOptions {
  /** Extracted values read by the model that the trainee has not yet confirmed, corrected or rejected. */
  pendingExtractions: number;
  /** RELEASE_GATE_MET: until it is met, Clinical Case identifiers are never written to a file. */
  releaseGateMet: boolean;
  caseKind: CaseKind;
  caseId: string;
  today: string;
  appVersion: string;
}

export interface ExportLine {
  label: FormLabel;
  text: string;
}

export interface ExportSection {
  number: number;
  title: FormLabel;
  lines: ExportLine[];
  table?: { columns: FormLabel[]; rows: string[][]; empty?: string };
  checkboxes?: { label: FormLabel; ticked: boolean | null }[];
  /** Text of cards left out of this section, with why. */
  leftOut: string[];
  /** Text of the automatic interaction check, beside the trainee's own rows. */
  automatic?: { title: string; rows: string[][]; notes: string[] };
}

export interface ExportDocument {
  title: FormLabel;
  copy: CopyMode;
  caseId: string;
  generatedOn: string;
  sections: ExportSection[];
  missing: { section: number; label: string; why?: string }[];
  /** What the file says about itself, on every page's end. */
  statement: string[];
  /** SHA-256 of the content above (hex), computed by hashDocument. */
  hash?: string;
}

const dayText = (a: number, b: number | null) => (b === null ? `Day ${a}–ongoing` : `Day ${a}–${b}`);

export function itemText(it: FieldItem): string {
  const parts: string[] = [];
  if (it.day !== undefined) parts.push(it.date ? `${it.date} (Day ${it.day})` : `Day ${it.day}`);
  if (it.dayRange) parts.push(dayText(it.dayRange[0], it.dayRange[1]));
  if (it.text) parts.push(it.text);
  const tag = it.provenance && it.provenance !== 'user_entered' ? ` [${PROVENANCE_VISUALS[it.provenance].label}]` : '';
  return `${parts.join(' · ')}${tag}`;
}

const msg = (key: string): string => (en as Record<string, string>)[key] ?? key;

export function stateText(s: FieldState): string {
  switch (s.kind) {
    case 'value': {
      const body = s.items.map(itemText).join('\n');
      const parts = (s.missingParts ?? []).map((m) => `Missing: ${msg(`form.missing.${m}`)}`);
      const notes = (s.notes ?? []).map((n) => msg(`form.note.${n}`));
      return [body, ...parts, ...notes].filter(Boolean).join('\n');
    }
    case 'missing':
      return `Missing${s.hint ? ` — ${msg(`form.missing.${s.hint}`)}` : ''}`;
    case 'empty':
      return '—';
    case 'not_yet':
      return `Not yet available — ${s.milestone}`;
    case 'withheld':
      return 'Withheld in the Teaching copy';
    case 'not_applicable':
      return s.reason === 'teaching_case' ? 'Not applicable — Teaching Case' : 'Not discharged';
    case 'signature_line':
      return '';
  }
}

const isSignature = (s: FieldState) => s.kind === 'signature_line';

function fieldsIn(s: FormSectionView): FormFieldView[] {
  return [...s.fields, ...(s.table?.rows.flatMap((r) => r.cells) ?? [])];
}

/** Everything the export would be refused for. Empty: the form may be exported. */
export function exportBlockers(view: FormView, o: ExportOptions): ExportBlocker[] {
  const out: ExportBlocker[] = [];
  if (view.mode === 'ward') {
    if (o.caseKind === 'teaching') out.push({ code: 'ward_copy_not_allowed', why: 'teaching_case' });
    else if (!o.releaseGateMet) out.push({ code: 'ward_copy_not_allowed', why: 'release_gate' });
  }
  if (o.pendingExtractions > 0) out.push({ code: 'pending_extraction', n: o.pendingExtractions });
  for (const s of view.sections) {
    for (const f of fieldsIn(s)) {
      if (f.state.kind !== 'value') continue;
      for (const it of f.state.items) {
        if (it.provenance === 'extracted_unverified' || it.provenance === 'ai_suggestion') out.push({ code: 'unverified_value', section: s.number, label: f.label, provenance: it.provenance });
      }
      for (const n of f.state.notes ?? []) {
        if (n === 'calc_out_of_date') out.push({ code: 'calc_out_of_date', section: s.number });
        if (n === 'nkda_conflict' || n === 'interpretation_needs_rereview') out.push({ code: 'data_conflict', section: s.number, note: msg(`form.note.${n}`) });
      }
    }
    for (const x of s.excluded ?? []) if (UNRESOLVED.has(x.reason) && (s.number === 8 || s.number === 9)) out.push({ code: 'excluded_card', section: s.number as 8 | 9, problem: x.problem, reason: x.reason });
  }
  return out;
}

function tableText(s: FormSectionView): ExportSection['table'] {
  const t = s.table;
  if (!t) return undefined;
  return {
    columns: t.columns.map((k) => t.rows[0]?.cells.find((c) => c.key === k)?.label ?? ({ en: String(k), ar: '' } as FormLabel)),
    rows: t.rows.map((r) => t.columns.map((k) => stateText(r.cells.find((c) => c.key === k)?.state ?? { kind: 'empty' }))),
    ...(t.rows.length ? {} : { empty: stateText(t.emptyState) }),
  };
}

export function buildExport(view: FormView, o: ExportOptions): { ok: true; doc: ExportDocument } | { ok: false; blockers: ExportBlocker[] } {
  const blockers = exportBlockers(view, o);
  if (blockers.length) return { ok: false, blockers };
  const sections: ExportSection[] = view.sections.map((s) => ({
    number: s.number,
    title: s.title,
    lines: s.fields.map((f) => ({ label: f.label, text: isSignature(f.state) ? '' : stateText(f.state) })),
    ...(s.table ? { table: tableText(s) } : {}),
    ...(s.checkboxes
      ? { checkboxes: s.checkboxes.labels.map((label, i) => ({ label, ticked: s.checkboxes!.ticked ? (s.checkboxes!.ticked[i] ?? false) : null })) }
      : {}),
    leftOut: (s.excluded ?? []).map((x) => `${x.problem} — ${msg(`form.excluded.${x.reason}`)}${x.day !== undefined ? ` (Day ${x.day})` : ''}`),
    ...(s.automatic
      ? {
          automatic: s.automatic.checked
            ? {
                title: `PRECEPTOR’s offline interaction check — ${s.automatic.source}`,
                rows: s.automatic.rows.map((r) => r.cells.map((c) => stateText(c.state))),
                notes: s.automatic.gaps,
              }
            : { title: 'PRECEPTOR’s offline interaction check', rows: [], notes: [s.automatic.reason] },
        }
      : {}),
  }));
  return {
    ok: true,
    doc: {
      title: FORM_TITLE,
      copy: view.mode,
      caseId: o.caseId,
      generatedOn: o.today,
      sections,
      missing: view.missing.map((m) => ({ section: m.section, label: m.label.en, ...(m.code ? { why: msg(`form.missing.${m.code}`) } : {}) })),
      statement: [
        `${view.mode === 'ward' ? 'Ward copy' : 'Teaching copy'} — case ${o.caseId} — generated by PRECEPTOR ${o.appVersion} on ${o.today}.`,
        'Prepared by a clinical pharmacy trainee under supervision. Every recommendation shown was decided by the trainee; PRECEPTOR sent nothing to the care team. It does not replace a clinical pharmacist and is not for clinical decisions.',
        'Values marked in brackets carry the state of their source; nothing unverified was exported.',
      ],
    },
  };
}

/** Plain text of the whole document, the thing the hash covers and a text export would be. */
export function documentText(d: ExportDocument): string {
  const out: string[] = [d.title.en, d.title.ar, ''];
  for (const s of d.sections) {
    out.push(`${s.number}. ${s.title.en} / ${s.title.ar}`);
    for (const l of s.lines) out.push(`  ${l.label.en}: ${l.text}`);
    if (s.table) {
      out.push(`  | ${s.table.columns.map((c) => c.en).join(' | ')} |`);
      for (const r of s.table.rows) out.push(`  | ${r.join(' | ').replace(/\n/g, ' / ')} |`);
      if (s.table.empty) out.push(`  ${s.table.empty}`);
    }
    for (const c of s.checkboxes ?? []) out.push(`  [${c.ticked === null ? '?' : c.ticked ? 'x' : ' '}] ${c.label.en}`);
    if (s.automatic) {
      out.push(`  ${s.automatic.title}`);
      for (const r of s.automatic.rows) out.push(`  | ${r.join(' | ')} |`);
      for (const n of s.automatic.notes) out.push(`  ${n}`);
    }
    for (const x of s.leftOut) out.push(`  Left out: ${x}`);
    out.push('');
  }
  if (d.missing.length) {
    out.push('Missing information');
    for (const m of d.missing) out.push(`  Section ${m.section}: ${m.label}${m.why ? ` — ${m.why}` : ''}`);
  }
  out.push('', ...d.statement);
  return out.join('\n');
}

export async function hashDocument(d: ExportDocument): Promise<string> {
  const bytes = new TextEncoder().encode(documentText(d));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
