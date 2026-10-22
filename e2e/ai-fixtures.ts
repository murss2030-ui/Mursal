/**
 * Test fixtures for the AI features (M3). These answers exist only in the
 * tests: they stand in for Google's servers so the whole path — the browser,
 * the relay code (relay/handler.ts) and its Gemini adapter
 * (relay/providers/gemini.ts) — runs as deployed, with only the final HTTPS
 * call answered here, in Gemini's response format.
 *
 * The stand-in reads each request the way the model would (the task header,
 * the de-identified text, the case references) and answers for the synthetic
 * documents the tests add. Its answers deliberately include what the app must
 * catch: a doctor's name, an illegible dose, a second reading that disagrees,
 * citations, a dose, an unknown reference and fields only the trainee may
 * record.
 */

// ---------------------------------------------------------------- the synthetic documents

/** The typed admission note. Line 2 and 3 are identifiers the trainee removes before saving. */
export function admissionNote(admittedDmy: string): string {
  return [
    'ADMISSION NOTE (synthetic teaching case)',
    'Patient name: Synthetic Gamma',
    'MRN: 55501234',
    `Admitted ${admittedDmy} with fever, productive cough and confusion for 3 days.`,
    'Past history: type 2 diabetes, hypertension, chronic kidney disease.',
    'Home medications: metformin 1000 mg PO BID; amlodipine 10 mg PO daily; ibuprofen 400 mg PO TID PRN.',
    'Allergy: penicillin (rash).',
    'Vitals: HR 112 bpm, BP 98/60 mmHg, temperature 38.9 C, SpO2 91 %.',
    'Weight 72 kg (measured).',
    'Labs on admission: creatinine 2.1 mg/dL; potassium 5.4 mmol/L; WBC 14.2 x10^9/L.',
    'Inpatient orders: ceftriaxone 1 g IV q24h; enoxaparin 40 mg SC daily.',
    'Assessment: community-acquired pneumonia; acute kidney injury.',
  ].join('\n');
}

/** What the photographed laboratory page shows (drawn by the test; identifiers on the top line). */
export const LAB_PAGE_LINES = {
  identifiers: 'Name: SYNTHETIC ALPHA   MRN 00451287',
  title: 'Laboratory report (synthetic)   Day 1',
  creatinine: 'Serum creatinine 2.6 mg/dL',
  potassium: 'Potassium 5.1 mmol/L',
  crp: 'CRP 96 mg/L',
  insulin: 'Insulin glargine ~~ units (handwritten)',
};

// ---------------------------------------------------------------- the model's readings

type Item = Record<string, unknown> & { kind: string; rawText: string; legibility: 'clear' | 'uncertain' | 'illegible'; handwritten: boolean };

const blank = {
  medContext: null, name: null, valueText: null, unit: null, dose: null, doseUnit: null, route: null, frequency: null, indication: null,
  status: null, organism: null, susceptibility: null, detail: null, category: null, acuity: null, khat: null, tobacco: null,
  dateText: null, timeText: null, box: null, note: null,
};
const item = (x: Partial<Item> & Pick<Item, 'kind' | 'rawText'>): Item => ({ ...blank, legibility: 'clear', handwritten: false, ...x });

/** Two readings of the admission note: the second disagrees on one dose, and the first "sees" a doctor's name. */
export function readAdmissionNote(pass: number): { readable: boolean; items: Item[] } {
  const d0 = 'Day 0';
  const items: Item[] = [
    item({ kind: 'history', category: 'chief_complaint', detail: 'fever, productive cough and confusion for 3 days', rawText: 'Admitted Day 0 with fever, productive cough and confusion for 3 days.', dateText: d0 }),
    item({ kind: 'history', category: 'pmh', detail: 'type 2 diabetes, hypertension, chronic kidney disease', rawText: 'Past history: type 2 diabetes, hypertension, chronic kidney disease.', dateText: d0 }),
    item({ kind: 'medication', medContext: 'home', name: 'metformin', dose: '1000', doseUnit: 'mg', route: 'PO', frequency: 'BID', rawText: 'metformin 1000 mg PO BID' }),
    item({ kind: 'medication', medContext: 'home', name: 'amlodipine', dose: pass === 2 ? '5' : '10', doseUnit: 'mg', route: 'PO', frequency: 'daily', rawText: 'amlodipine 10 mg PO daily' }),
    item({ kind: 'medication', medContext: 'home', name: 'ibuprofen', dose: '400', doseUnit: 'mg', route: 'PO', frequency: 'TID PRN', rawText: 'ibuprofen 400 mg PO TID PRN' }),
    item({ kind: 'allergy', name: 'penicillin', detail: 'rash', status: 'allergy', rawText: 'Allergy: penicillin (rash).', dateText: d0 }),
    // The day was left out for this one value: it cannot be confirmed until a day is given.
    item({ kind: 'vital', name: 'HR', valueText: '112', unit: 'bpm', rawText: 'HR 112 bpm' }),
    item({ kind: 'vital', name: 'BP', valueText: '98/60', unit: 'mmHg', rawText: 'BP 98/60 mmHg', dateText: d0 }),
    item({ kind: 'vital', name: 'temperature', valueText: '38.9', unit: 'C', rawText: 'temperature 38.9 C', dateText: d0 }),
    item({ kind: 'vital', name: 'SpO2', valueText: '91', unit: '%', rawText: 'SpO2 91 %', dateText: d0 }),
    item({ kind: 'weight', valueText: '72', unit: 'kg', status: 'measured', rawText: 'Weight 72 kg (measured).', dateText: d0 }),
    item({ kind: 'lab', name: 'creatinine', valueText: '2.1', unit: 'mg/dL', rawText: 'creatinine 2.1 mg/dL', dateText: d0 }),
    item({ kind: 'lab', name: 'potassium', valueText: '5.4', unit: 'mmol/L', rawText: 'potassium 5.4 mmol/L', dateText: d0 }),
    item({ kind: 'lab', name: 'WBC', valueText: '14.2', unit: 'x10^9/L', rawText: 'WBC 14.2 x10^9/L', dateText: d0 }),
    item({ kind: 'medication', medContext: 'inpatient', name: 'ceftriaxone', dose: '1', doseUnit: 'g', route: 'IV', frequency: 'q24h', rawText: 'ceftriaxone 1 g IV q24h', dateText: d0 }),
    item({ kind: 'medication', medContext: 'inpatient', name: 'enoxaparin', dose: '40', doseUnit: 'mg', route: 'SC', frequency: 'daily', rawText: 'enoxaparin 40 mg SC daily', dateText: d0 }),
    item({ kind: 'problem', name: 'community-acquired pneumonia', acuity: 'acute', status: 'active', rawText: 'community-acquired pneumonia', dateText: d0 }),
    item({ kind: 'problem', name: 'acute kidney injury', acuity: 'acute', status: 'active', rawText: 'acute kidney injury', dateText: d0 }),
  ];
  // Only the first reading invents a line with a doctor's name: the app masks it and flags it as read once.
  if (pass === 1) items.push(item({ kind: 'history', category: 'progress', detail: 'Reviewed on the ward round by Dr Synthetic Person.', rawText: 'Reviewed on the ward round by Dr Synthetic Person.', dateText: d0 }));
  return { readable: true, items };
}

/** Boxes on the 1200 × 900 test page, as [ymin, xmin, ymax, xmax] scaled 0–1000. */
const BOX = { creatinine: [360, 45, 415, 420], potassium: [450, 45, 505, 360], crp: [540, 45, 595, 260], insulin: [630, 45, 690, 560] };

/** Two readings of the photographed laboratory page: a handwritten dose that cannot be read. */
export function readLabPage(): { readable: boolean; items: Item[] } {
  const d1 = 'Day 1';
  return {
    readable: true,
    items: [
      item({ kind: 'lab', name: 'Serum creatinine', valueText: '2.6', unit: 'mg/dL', rawText: LAB_PAGE_LINES.creatinine, dateText: d1, box: BOX.creatinine }),
      item({ kind: 'lab', name: 'Potassium', valueText: '5.1', unit: 'mmol/L', rawText: LAB_PAGE_LINES.potassium, dateText: d1, box: BOX.potassium }),
      item({ kind: 'lab', name: 'CRP', valueText: '96', unit: 'mg/L', rawText: LAB_PAGE_LINES.crp, dateText: d1, box: BOX.crp }),
      // An illegible dose comes back as a number from a careless reader; the app must drop it.
      item({ kind: 'medication', medContext: 'inpatient', name: 'insulin glargine', dose: '20', doseUnit: 'units', rawText: 'Insulin glargine ~~ units', legibility: 'illegible', handwritten: true, dateText: d1, box: BOX.insulin, note: 'dose overwritten' }),
    ],
  };
}

// ---------------------------------------------------------------- the model's drafts

interface CaseData {
  timeline: { ref: string; day: number; type: string; text: string }[];
  medications: { ref: string; drug: string; regimen: string }[];
  problems: { ref: string; name: string }[];
  registerRows: { ref: string; register: string; fields: Record<string, string> }[];
  module: { id: string };
  tasks: {
    taskId: string;
    checks: { id: string }[];
    perMedication?: { checks: { id: string }[] };
    perProblem?: { checks: { id: string }[] };
    registers: { register: string; fields: { id: string }[] }[];
  }[];
}

/**
 * A draft for every task of the module, written the way a careless model
 * might: mostly grounded in the case references, with a general-knowledge
 * statement carrying a citation, a dose that is not in the data, a reference
 * to data never sent, a checklist item of the wrong task, and fields only the
 * trainee may fill. Like Gemini's constrained output, it never leaves the
 * schema it is given.
 */
export function draftModule(data: CaseData): unknown {
  const scr = [...data.timeline].reverse().find((e) => /creatinine/i.test(e.text));
  const scrValue = scr ? /(\d+(?:\.\d+)?)\s*mg\/dL/.exec(scr.text)?.[1] : undefined;
  const aki = data.problems.find((p) => /kidney/i.test(p.name));
  const enox = data.medications.find((m) => /enoxaparin/i.test(m.drug));
  const ibu = data.registerRows.find((r) => r.register === 'home_med' && /ibuprofen/i.test(r.fields.drug ?? ''));
  const grounded = [scr?.ref, aki?.ref].filter(Boolean) as string[];
  const scrText = scr && scrValue ? `Creatinine ${scrValue} mg/dL on Day ${scr.day}` : 'Creatinine is not recorded';

  return {
    tasks: data.tasks.map((t) => {
      const [c1, c2, c3] = t.checks;
      const checks: unknown[] = [];
      if (c1) checks.push({ checkId: c1.id, scopeRef: null, answer: 'issue', reason: `${scrText} with acute kidney injury.`, basis: 'case_data', refs: grounded });
      if (c2) checks.push({ checkId: c2.id, scopeRef: null, answer: 'ok', reason: 'Kidney function should be reviewed every day in acute kidney injury (Smith et al., 2019).', basis: 'general_knowledge', refs: [] });
      if (c3) checks.push({ checkId: c3.id, scopeRef: null, answer: 'issue', reason: 'The latest result needs review.', basis: 'case_data', refs: ['E99'] });
      const med = t.perMedication?.checks[0];
      if (med && enox) {
        checks.push({ checkId: med.id, scopeRef: enox.ref, answer: 'issue', reason: `Enoxaparin 40 mg SC daily while ${scrText.toLowerCase()}; 30 mg daily may be needed.`, basis: 'case_data', refs: [enox.ref, ...(scr ? [scr.ref] : [])] });
      }
      const prob = t.perProblem?.checks[0];
      if (prob && aki) checks.push({ checkId: prob.id, scopeRef: aki.ref, answer: 'issue', reason: 'Acute kidney injury is active.', basis: 'case_data', refs: [aki.ref] });
      // A checklist item of another task of the module: allowed by the schema (Gemini enforces it), wrong for this task.
      const mine = new Set([...t.checks, ...(t.perMedication?.checks ?? []), ...(t.perProblem?.checks ?? [])].map((c) => c.id));
      const foreign = data.tasks.flatMap((o) => o.checks).find((c) => !mine.has(c.id));
      if (foreign) checks.push({ checkId: foreign.id, scopeRef: null, answer: 'ok', reason: 'Misplaced.', basis: 'general_knowledge', refs: [] });

      const items: unknown[] = [];
      for (const r of t.registers) {
        if (r.register === 'drp' && enox) {
          // M4: a Problem Card with PCNE codes (one invented), linked values, claims and the teaching explanation.
          items.push({
            register: 'drp',
            fields: [
              { field: 'problem', value: 'Enoxaparin dose not adjusted for reduced kidney function' },
              { field: 'drugs', value: 'enoxaparin' },
              ...(aki ? [{ field: 'linkedProblemId', value: aki.ref }] : []),
              { field: 'pcneProblem', value: 'P2.1' },
              { field: 'pcneType', value: 'potential' },
              { field: 'pcneCauses', value: 'C3.2|C12.9' },
              ...(scr ? [{ field: 'supporting', value: `${scr.ref}, E99` }] : []),
              { field: 'evidence', value: `${scrText}; enoxaparin 40 mg SC daily.` },
              { field: 'priority', value: 'important' },
              { field: 'urgency', value: 'high' },
              { field: 'recommendation', value: 'Reduce enoxaparin to 30 mg SC daily and monitor anti-Xa levels (Garcia et al., 2012).' },
              { field: 'recStatus', value: 'draft' },
              { field: 'implemented', value: 'yes' },
              { field: 'teaching', value: 'Which drugs on this chart are cleared by the kidney, and has each dose followed the kidney function?' },
            ],
            claims: [
              ...(scr ? [{ text: `${scrText}.`, basis: 'case_data', refs: [scr.ref] }] : []),
              { text: 'Enoxaparin accumulates when kidney function is reduced (Garcia et al., 2012).', basis: 'general_knowledge', refs: [] },
            ],
            reason: 'The dose was ordered before the creatinine rose.',
            basis: 'case_data',
            refs: [enox.ref, ...grounded],
          });
        }
        if (r.register === 'interaction' && ibu && aki) {
          items.push({
            register: 'interaction',
            fields: [
              { field: 'kind', value: 'drug_disease' },
              { field: 'drugA', value: 'ibuprofen' },
              { field: 'drugB', value: 'acute kidney injury' },
              { field: 'severity', value: 'major' },
              { field: 'management', value: 'Avoid NSAIDs while kidney function is reduced.' },
            ],
            reason: 'NSAIDs reduce renal blood flow.',
            basis: 'general_knowledge',
            refs: [ibu.ref, aki.ref],
          });
        }
        if (r.register === 'monitoring' && scr) {
          items.push({
            register: 'monitoring',
            fields: [
              { field: 'parameter', value: 'Serum creatinine' },
              { field: 'target', value: 'below 1.5 mg/dL' },
              { field: 'frequency', value: 'daily' },
              { field: 'status', value: 'active' },
            ],
            reason: 'Creatinine is rising.',
            basis: 'case_data',
            refs: [scr.ref],
          });
        }
      }
      return {
        taskId: t.taskId,
        summary: `${scrText}.`,
        checks,
        items,
        missingData: ['Urine output is not recorded.'],
        questions: ['Was ibuprofen taken in the week before admission?'],
      };
    }),
  };
}

// ---------------------------------------------------------------- the verifier's answers (M5)

interface VerifyRequest {
  sources: { id: string; text: string }[];
  claims: { id: string; text: string; sources: string[] }[];
}

/**
 * The verifier as a careful model would answer: each claim supported by a
 * quote copied from the start of each source it cites (never the case
 * header) — except a statement of what "may be needed", a judgement no source
 * states, which is partly supported. The checks in code (check.ts, guard.ts)
 * still run on every answer.
 */
export function verifyAnswer(req: VerifyRequest): unknown {
  const text = (id: string) => req.sources.find((s) => s.id === id)?.text ?? '';
  return {
    results: req.claims.map((c) => {
      const quotes = c.sources.filter((s) => s !== 'H').map((s) => ({ sourceId: s, text: text(s).slice(0, 24) }));
      if (/may be needed/.test(c.text)) return { claimId: c.id, verdict: 'partial', contradicted: false, quotes, unsupportedParts: ['may be needed'] };
      // A statement no passage makes (M5d): the stand-in verifier, like a careful one, finds nothing in the source to show it.
      if (/without any monitoring/.test(c.text)) return { claimId: c.id, verdict: 'unsupported', contradicted: false, quotes: [], unsupportedParts: ['without any monitoring'] };
      return { claimId: c.id, verdict: 'supported', contradicted: false, quotes, unsupportedParts: [] };
    }),
  };
}

// ---------------------------------------------------------------- research (M5d)

interface ResearchRequest {
  question: string;
  sources: { id: string; kind: string; text: string }[];
}

/**
 * The model drafting from retrieved passages, as the tests need it: an honest
 * recommendation quoting the guideline passage, a supporting statement quoting
 * the drug label, a statement with a dose its quote does not contain, and a
 * conflicting statement no passage makes (the verifier finds it unsupported).
 * With no passage the model is never asked; with none it can use, it says so.
 */
export function researchAnswer(req: ResearchRequest): unknown {
  const guide = req.sources.find((s) => /^guideline passage/.test(s.kind));
  const label = req.sources.find((s) => /^drug label section/.test(s.kind));
  const first = guide ?? label;
  if (!first) return { answerable: false, statements: [], missingData: ['Nothing in the passages addresses the question'] };
  const quote = (s: { text: string }, n: number) => s.text.replace(/\s+/g, ' ').slice(0, n);
  return {
    answerable: true,
    statements: [
      ...(guide ? [{ role: 'recommendation', text: quote(guide, 90), sourceId: guide.id, quote: quote(guide, 90), caseRefs: [] }] : []),
      ...(label ? [{ role: 'supporting', text: quote(label, 70), sourceId: label.id, quote: quote(label, 70), caseRefs: [] }] : []),
      { role: 'supporting', text: 'Restart at 850 mg daily once stable', sourceId: first.id, quote: quote(first, 60), caseRefs: [] },
      { role: 'conflicting', text: 'Metformin is safe to continue without any monitoring', sourceId: first.id, quote: quote(first, 60), caseRefs: [] },
    ],
    missingData: ['Creatinine clearance on the day of the decision'],
  };
}

// ---------------------------------------------------------------- the provider stand-in

export interface ProviderCall {
  url: string;
  model: string;
  apiKey: string | null;
  task: 'extract' | 'analyse' | 'verify' | 'research' | 'other';
  pass?: number;
  module?: string;
  /** Every text part, joined. */
  text: string;
  /** Images sent, base64. */
  images: string[];
}

/** Models the stand-in "knows"; any other id answers 404 like a retired model. */
export const PROVIDER_MODELS = ['reader-test-1', 'drafter-test-1', 'verifier-test-1'];

function geminiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code: status, status: code, message } }), { status, headers: { 'content-type': 'application/json' } });
}

type GeminiBody = {
  systemInstruction?: { parts?: { text?: string }[] };
  contents?: { parts?: ({ text?: string } | { inlineData?: { mimeType: string; data: string } })[] }[];
  generationConfig?: { responseMimeType?: string; responseSchema?: { type?: string } };
};

/** What a generateContent request carries, as the tests inspect it (shared by the stand-in and the live recorder). */
export function describeGeminiRequest(input: string | URL | Request, init?: RequestInit): { call: ProviderCall; body: GeminiBody; texts: string[]; endpoint: boolean } {
  const url = String(input);
  const m = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/([^/:]+):generateContent$/.exec(url);
  const headers = new Headers(init?.headers);
  const body = JSON.parse(String(init?.body ?? '{}')) as GeminiBody;
  const parts = body.contents?.[0]?.parts ?? [];
  const texts = parts.map((p) => ('text' in p ? (p.text ?? '') : '')).filter(Boolean);
  const images = parts.flatMap((p) => ('inlineData' in p && p.inlineData ? [p.inlineData.data] : []));
  const header = texts[0] ?? '';
  return {
    call: {
      url,
      model: m ? decodeURIComponent(m[1]!) : '',
      apiKey: headers.get('x-goog-api-key'),
      task: /^TASK: extract/m.test(header) ? 'extract' : /^TASK: analyse/m.test(header) ? 'analyse' : /^TASK: verify/m.test(header) ? 'verify' : /^TASK: research/m.test(header) ? 'research' : 'other',
      pass: Number(/^PASS: (\d)/m.exec(header)?.[1]) || undefined,
      module: /^MODULE: (\w+)/m.exec(header)?.[1],
      text: texts.join('\n'),
      images,
    },
    body,
    texts,
    endpoint: Boolean(m) && init?.method === 'POST',
  };
}

const hasKey = (node: unknown, key: string): boolean =>
  Array.isArray(node) ? node.some((x) => hasKey(x, key)) : typeof node === 'object' && node !== null && Object.entries(node).some(([k, v]) => k === key || hasKey(v, key));

/** A fetch that answers Gemini's generateContent like the service does (format of recorded responses). */
export function fakeGemini(calls: ProviderCall[], expectedKey: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const { call, body, texts, endpoint } = describeGeminiRequest(input, init);
    const images = call.images;
    calls.push(call);
    if (!endpoint) return geminiError(404, 'NOT_FOUND', 'Unknown endpoint.');
    if (call.apiKey !== expectedKey) return geminiError(403, 'PERMISSION_DENIED', 'API key not valid.');
    // As in the live run of 16 October 2026: Gemini refused the reading schema while it carried maxItems.
    if (!body.systemInstruction?.parts?.[0]?.text || body.generationConfig?.responseMimeType !== 'application/json' || body.generationConfig.responseSchema?.type !== 'OBJECT' || hasKey(body.generationConfig.responseSchema, 'maxItems')) {
      return geminiError(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.');
    }
    if (!PROVIDER_MODELS.includes(call.model)) return geminiError(404, 'NOT_FOUND', `models/${call.model} is not found for API version v1beta, or is not supported for generateContent.`);

    let output: unknown = { readable: false, items: [] };
    if (call.task === 'extract') {
      if (images.length) output = readLabPage();
      else if (texts.some((t) => t.includes('ADMISSION NOTE (synthetic teaching case)'))) output = readAdmissionNote(call.pass ?? 1);
    } else if (call.task === 'analyse') {
      output = draftModule(JSON.parse(texts[1] ?? '{}') as CaseData);
    } else if (call.task === 'verify') {
      output = verifyAnswer(JSON.parse(texts[1] ?? '{}') as VerifyRequest);
    } else if (call.task === 'research') {
      output = researchAnswer(JSON.parse(texts[1] ?? '{}') as ResearchRequest);
    }
    const out = JSON.stringify(output);
    const prompt = Math.ceil((texts.join('').length + (body.systemInstruction?.parts?.[0]?.text ?? '').length) / 4) + images.length * 1290;
    const candidates = Math.ceil(out.length / 4);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: out }] }, finishReason: 'STOP', index: 0 }],
        usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: candidates, thoughtsTokenCount: 96, totalTokenCount: prompt + candidates + 96 },
        modelVersion: call.model,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

// ---------------------------------------------------------------- RxNorm (approximateTerm.json, recorded format)

const RXCUI: Record<string, { rxcui: string; name: string }> = {
  metformin: { rxcui: '6809', name: 'metformin' },
  amlodipine: { rxcui: '17767', name: 'amlodipine' },
  ibuprofen: { rxcui: '5640', name: 'ibuprofen' },
  ceftriaxone: { rxcui: '2193', name: 'ceftriaxone' },
  enoxaparin: { rxcui: '67108', name: 'enoxaparin' },
};

export function rxnavAnswer(term: string): unknown {
  const hit = RXCUI[term.trim().toLowerCase()];
  return {
    approximateGroup: {
      inputTerm: term,
      candidate: hit ? [{ rxcui: hit.rxcui, rxaui: '1000001', score: '100', rank: '1', name: hit.name, source: 'RXNORM' }] : [],
    },
  };
}
