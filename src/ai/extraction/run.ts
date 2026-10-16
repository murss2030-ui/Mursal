/**
 * Reading one document of the patient file (Section 13), end to end:
 * de-identify → read (twice for medication pages and handwriting) → map and
 * check every field → match drug names → store the reading. Nothing read here
 * reaches the timeline, a task or the form until the trainee confirms it.
 */
import type { ExtractionRun } from '../../domain/types';
import type { KnownIdentifiers } from '../../domain/workflow/deidentify';
import type { Store } from '../../store/store';
import { AiError, callModel, type CallDeps } from '../client';
import { rxnormMatch } from '../connectors/rxnorm';
import type { RequestPart } from '../protocol';
import { toCandidate, type Candidate } from './candidates';
import { EXTRACT_PROMPT_VERSION, EXTRACT_SCHEMA, EXTRACT_SYSTEM, extractHeader, type RawExtraction } from './contract';
import { deidentifyForModel } from './deid';
import { mergePasses, needsSecondPass } from './dualpass';

export interface ReadDeps extends CallDeps {
  /** fetch for the RxNorm lookups (defaults to the global fetch). */
  rxFetch?: typeof fetch;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

const addFlag = (c: Candidate, f: Candidate['flags'][number]): Candidate => (c.flags.includes(f) ? c : { ...c, flags: [...c.flags, f] });

export async function readDocument(store: Store, caseId: string, attachmentId: string, deps: ReadDeps = {}): Promise<ExtractionRun> {
  const c = await store.getCase(caseId);
  if (!c) throw new AiError('bad_request', 'That case does not exist.');
  const a = (await store.listAttachments(caseId)).find((x) => x.id === attachmentId);
  if (!a || a.status !== 'active') throw new AiError('bad_request', 'That document is not in the patient file.');
  // Stored documents are always redacted (Section 13); this is the last check before anything is sent.
  if (a.redacted !== true) throw new AiError('bad_request', 'Only documents whose identifiers were removed can be sent.');
  const ids = c.kind === 'clinical' ? await store.getIdentifiers(caseId) : undefined;
  const known: KnownIdentifiers = { patientName: ids?.patientName, mrn: ids?.mrn, roomBed: ids?.roomBed, consultantName: ids?.consultantName };

  let body: RequestPart;
  const sent = { identifiersMasked: 0, datesReplaced: 0 };
  if (a.kind === 'text') {
    const text = (await store.attachmentText(caseId, attachmentId)) ?? '';
    const d = deidentifyForModel(text, c.admissionDay0, known);
    sent.identifiersMasked = d.identifiersMasked;
    sent.datesReplaced = d.datesReplaced;
    body = { text: d.text };
  } else {
    const bytes = await store.attachmentBytes(caseId, attachmentId);
    if (!bytes) throw new AiError('bad_request', 'The page image could not be read.');
    body = { image: { mime: 'image/jpeg', data: bytesToBase64(bytes) } };
  }

  const ctx = { admissionDay0: c.admissionDay0, docType: a.docType, docDay: a.hospitalDay, known };
  const read = async (pass: 1 | 2) =>
    callModel<RawExtraction>(
      store,
      {
        task: 'extract',
        promptVersion: EXTRACT_PROMPT_VERSION,
        caseId,
        caseKind: c.kind,
        system: EXTRACT_SYSTEM,
        parts: [{ text: extractHeader({ pass, docType: a.docType, docDay: a.hospitalDay, content: a.kind }) }, body],
        schema: EXTRACT_SCHEMA,
        maxOutputTokens: 8192,
        temperature: pass === 1 ? 0 : 0.4,
      },
      deps,
    );

  const first = await read(1);
  let fields = first.output.items.map((it, i) => toCandidate(it, i, ctx));
  let passes: 1 | 2 = 1;
  let secondModel: string | undefined;
  const usage = { ...first.usage };
  if (needsSecondPass(a.docType, fields)) {
    try {
      const second = await read(2);
      fields = mergePasses(fields, second.output.items.map((it, i) => toCandidate(it, i, ctx)));
      passes = 2;
      secondModel = second.model;
      usage.inputTokens += second.usage.inputTokens;
      usage.outputTokens += second.usage.outputTokens;
      usage.costUsd += second.usage.costUsd;
    } catch (e) {
      // The second reading was required but failed: every field of this page counts as read once.
      if (!(e instanceof AiError)) throw e;
      fields = fields.map((f) => addFlag(f, 'single_pass'));
    }
  }

  // Drug names through RxNorm; a failed match is uncertain, an unchecked one says so.
  const names = new Map<string, Awaited<ReturnType<typeof rxnormMatch>>>();
  for (const f of fields) {
    if (f.kind !== 'medication') continue;
    const drug = (f.values.drug ?? '').trim();
    if (!drug) continue;
    if (!names.has(drug.toLowerCase())) names.set(drug.toLowerCase(), await rxnormMatch(drug, { store, fetch: deps.rxFetch, online: deps.online }));
  }
  fields = fields.map((f) => {
    const m = f.kind === 'medication' ? names.get((f.values.drug ?? '').trim().toLowerCase()) : undefined;
    if (!m) return f;
    const withDrug: Candidate = { ...f, drug: m.status === 'matched' ? { status: 'matched', rxcui: m.rxcui, ...(m.name ? { name: m.name } : {}) } : { status: m.status } };
    return m.status === 'matched' ? withDrug : addFlag(withDrug, m.status === 'unmatched' ? 'drug_unmatched' : 'drug_not_checked');
  });

  return store.addExtractionRun(caseId, {
    attachmentId,
    model: first.model,
    ...(secondModel ? { secondModel } : {}),
    promptVersion: EXTRACT_PROMPT_VERSION,
    passes,
    readable: first.output.readable,
    fields,
    sent,
    usage,
  });
}
