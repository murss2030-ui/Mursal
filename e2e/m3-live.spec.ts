/**
 * The live run of M3 (acceptance criterion 9): the walkthrough of
 * m3-ai.spec.ts with Google's real Gemini service and the real RxNav, on
 * synthetic data only. It runs only when asked for — it needs network access
 * to both services and uses the provider's quota:
 *
 *   PRECEPTOR_LIVE=1 PRECEPTOR_LIVE_READ=<model id> PRECEPTOR_LIVE_DRAFT=<model id> \
 *   PRECEPTOR_LIVE_PRICE=<input US$ per 1M>:<output US$ per 1M> NODE_USE_ENV_PROXY=1 \
 *   npx playwright test e2e/m3-live.spec.ts
 *
 * The key comes from GEMINI_API_KEY, or is added on the way out by the
 * environment's egress proxy; it never appears here. A value read by the
 * model is confirmed only when it matches what the synthetic document says,
 * as a careful trainee would do; anything else is rejected with a reason.
 * Every call is recorded (timing, tokens, outcome) in test-results/live/.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { admissionNote, LAB_PAGE_LINES } from './ai-fixtures';
import { installTestRelay, type LiveCall } from './ai-relay';
import { addLabPage, addTypedNote, dmy, expectRedactedImage, field, saveModels, shot } from './ai-steps';
import { createCase, createRotation, isoDate, onboard, watchPage } from './helpers';

const READ = process.env.PRECEPTOR_LIVE_READ ?? '';
const DRAFT = process.env.PRECEPTOR_LIVE_DRAFT || READ;
const PRICE = process.env.PRECEPTOR_LIVE_PRICE ?? '';
const OUT = 'test-results/live';
const SHOTS = process.env.PRECEPTOR_LIVE_SHOTS ?? `${OUT}/screenshots`;
const PROXY = process.env.HTTPS_PROXY;

test.skip(!process.env.PRECEPTOR_LIVE || !READ || !PRICE, 'Live run only: set PRECEPTOR_LIVE=1, PRECEPTOR_LIVE_READ, PRECEPTOR_LIVE_DRAFT and PRECEPTOR_LIVE_PRICE.');
// page.route must see every call to /api; the browser reaches RxNav through the environment's proxy.
test.use({ serviceWorkers: 'block', ...(PROXY ? { proxy: { server: PROXY, bypass: 'localhost,127.0.0.1' } } : {}) });

const numbers = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"«»]/g, '').trim();

/** Whether what was read is really in the document: its text is found there, and every number shown comes from it. */
function matchesDocument(doc: string, raw: string, value: string): boolean {
  const d = norm(doc);
  const parts = norm(raw)
    .split(/\bday -?\d+\b/)
    .map((p) => p.trim().replace(/^[.,;:]+|[.,;:]+$/g, ''))
    .filter((p) => p.length >= 4);
  if (!parts.length || !parts.every((p) => d.includes(p))) return false;
  const allowed = new Set(numbers(raw));
  return numbers(value).every((n) => allowed.has(n));
}

interface FieldRecord {
  id: string;
  target: string;
  value: string;
  raw: string;
  day: string;
  flags: string[];
  rxnorm?: string;
  secondReading?: string;
  confirmable: boolean;
  matches: boolean;
  decision?: string;
}

async function recordField(card: Locator, doc: string): Promise<FieldRecord> {
  const text = await card.innerText();
  const value = (await card.getByTestId('review-value').innerText()).trim();
  const raw = (await card.getByTestId('review-raw').innerText()).replace(/^Read as:\s*/, '').trim();
  const lines = text.split('\n').map((l) => l.trim());
  return {
    id: (await card.getAttribute('data-field')) ?? '',
    target: lines[0] ?? '',
    value,
    raw,
    day: lines.find((l) => /^Day -?\d+|Hospital day not known|^No day/.test(l)) ?? '',
    flags: await card.locator('[data-flag]').evaluateAll((els) => els.map((e) => e.getAttribute('data-flag') ?? '')),
    rxnorm: (await card.getByTestId('review-rxnorm').count()) ? (await card.getByTestId('review-rxnorm').innerText()).trim() : undefined,
    secondReading: lines.find((l) => l.startsWith('Second reading:')),
    confirmable: await card.getByRole('button', { name: 'Confirm' }).isEnabled(),
    matches: matchesDocument(doc, raw, value),
  };
}

/** Decides every value of one reading, one at a time, as a careful trainee would. */
async function checkReading(page: Page, doc: string, docDay: number): Promise<FieldRecord[]> {
  const out: FieldRecord[] = [];
  for (;;) {
    const card = page.locator('[data-testid="review-field"][data-decision="pending"]').first();
    if (!(await card.count())) break;
    const r = await recordField(card, doc);
    let corrected = false;
    if (r.matches && r.confirmable) {
      await card.getByRole('button', { name: 'Confirm' }).click();
      r.decision = 'confirmed';
      corrected = true;
    } else if (r.matches) {
      // Correct it with what the document makes clear — its day; for a listed diagnosis, acute and active — and save.
      const reviewUrl = page.url();
      await card.getByRole('button', { name: 'Correct' }).click();
      await expect(page.getByRole('heading', { name: 'Correct what was read' })).toBeVisible();
      const changes: string[] = [];
      const day = page.getByLabel('Hospital day', { exact: true });
      if ((await day.count()) && !(await day.inputValue())) {
        await day.fill(String(docDay));
        changes.push(`day ${docDay}`);
      }
      const status = page.getByLabel('Status', { exact: true });
      if (await status.count()) {
        if (!(await page.getByRole('radio', { name: 'Acute', exact: true }).isChecked()) && !(await page.getByRole('radio', { name: 'Chronic', exact: true }).isChecked())) {
          await page.getByRole('radio', { name: 'Acute', exact: true }).check();
          changes.push('acute');
        }
        if (!(await status.inputValue())) {
          await status.selectOption('active');
          changes.push('active');
        }
      }
      await page.getByRole('button', { name: 'Save the corrected value' }).click();
      corrected = await page
        .getByTestId('extraction-review')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (corrected) r.decision = `corrected (${changes.join(', ') || 'as read'})`;
      else await page.goto(reviewUrl.replace(/^.*#/, '/#'));
    }
    if (corrected) {
      // decided above
    } else {
      const reason = r.matches ? 'Live run: cannot be confirmed as read' : 'Live run: does not match the document';
      await card.getByRole('button', { name: 'Reject' }).click();
      await card.getByLabel('Why (optional)').fill(reason);
      await card.getByRole('button', { name: 'Reject' }).click();
      r.decision = `rejected — ${reason}`;
    }
    await expect(field(page, r.id)).not.toHaveAttribute('data-decision', 'pending');
    out.push(r);
  }
  return out;
}

/** What the synthetic admission note says, item by item: did the reading find each one? */
const EXPECTED_NOTE: [string, RegExp][] = [
  ['Chief complaint (fever, cough, confusion)', /fever|cough|confusion/i],
  ['Past history (diabetes, hypertension, CKD)', /diabetes|hypertension|chronic kidney/i],
  ['Home: metformin 1000 mg BID', /metformin.*1000/i],
  ['Home: amlodipine 10 mg daily', /amlodipine\D*10\b/i],
  ['Home: ibuprofen 400 mg TID PRN', /ibuprofen.*400/i],
  ['Allergy: penicillin (rash)', /penicillin/i],
  ['HR 112', /\b112\b/],
  ['BP 98/60', /98\s*\/\s*60/],
  ['Temperature 38.9 °C', /38\.9/],
  ['SpO2 91 %', /\b91\b/],
  ['Weight 72 kg (measured)', /\b72\b/],
  ['Creatinine 2.1 mg/dL', /creatinine.*2\.1/i],
  ['Potassium 5.4 mmol/L', /potassium.*5\.4/i],
  ['WBC 14.2', /14\.2/],
  ['Ceftriaxone 1 g IV q24h', /ceftriaxone/i],
  ['Enoxaparin 40 mg SC daily', /enoxaparin.*40/i],
  ['Problem: community-acquired pneumonia', /pneumonia/i],
  ['Problem: acute kidney injury', /kidney injury/i],
];
const EXPECTED_PAGE: [string, RegExp][] = [
  ['Creatinine 2.6 mg/dL (Day 1)', /creatinine.*2\.6/i],
  ['Potassium 5.1 mmol/L (Day 1)', /potassium.*5\.1/i],
  ['CRP 96 mg/L (Day 1)', /\b96\b/],
  ['Insulin glargine — dose not legible', /insulin/i],
];

const found = (expected: [string, RegExp][], fields: FieldRecord[]) =>
  expected.map(([label, re]) => {
    const hit = fields.find((f) => re.test(`${f.value} ${f.raw}`));
    return { item: label, found: Boolean(hit), field: hit ? `${hit.value} — ${hit.decision}` : undefined };
  });

/** Clicks a step's button and waits until its work is over (the progress line appears, then goes). */
async function runStep(page: Page, button: Locator, minutes: number) {
  await button.click();
  const progress = page.getByTestId('analyse-progress');
  await progress.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  await expect(progress).toHaveCount(0, { timeout: minutes * 60_000 });
}

const MODULE_IDS = ['collect', 'review', 'dosing', 'safety', 'plan', 'followup', 'discharge', 'document'];
const TASK_IDS = Array.from({ length: 30 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);

test('live: the patient file read by Gemini, checked value by value, and the 30 tasks drafted (synthetic Teaching Case)', async ({ page }) => {
  test.setTimeout(40 * 60_000);
  mkdirSync(SHOTS, { recursive: true });
  const watch = watchPage(page);
  const calls: LiveCall[] = [];
  const models = [...new Set([READ, DRAFT])];
  const relay = await installTestRelay(
    page,
    {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'supplied-by-the-environment',
      PRECEPTOR_THINKING: process.env.PRECEPTOR_LIVE_THINKING ?? '',
      PRECEPTOR_MODELS: models.map((m) => `${m}:${PRICE}`).join(','),
      PRECEPTOR_SUGGESTED: `extract=${READ},analyse=${DRAFT}`,
      PRECEPTOR_KEY_CLASS: 'free',
      PRECEPTOR_MONTHLY_BUDGET_USD: '2',
      PRECEPTOR_RATE_PER_MINUTE: '10',
      PRECEPTOR_RATE_PER_DAY: '100',
    },
    { calls },
  );
  const results: Record<string, unknown> = { date: new Date().toISOString(), models: { read: READ, draft: DRAFT }, thinking: process.env.PRECEPTOR_LIVE_THINKING ?? 'model default', priceUsdPerMillion: PRICE };
  const save = () => writeFileSync(`${OUT}/live-run.json`, JSON.stringify({ ...results, calls: calls.map(({ output, images, text, ...c }) => ({ ...c, images: images.length, sentChars: text.length, outputChars: output?.length ?? 0 })) }, null, 2));

  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching', admissionOffset: -3 });
  const admitted = dmy(isoDate(-3));
  const note = admissionNote(admitted);
  // The admission note's hospital day is given, as the review screen now recommends.
  await addTypedNote(page, note, true, 0);
  await addLabPage(page);
  await saveModels(page, {}, { extract: READ, analyse: DRAFT });
  await shot(page, 'live-01-settings', true, SHOTS);

  // 1. Read both documents; Google's temporary refusals (high demand, quota per minute) are retried a few times.
  await page.goto(`/#/cases/${caseId}/analyse`);
  await expect(page.getByTestId('analyse-doc')).toHaveCount(2);
  const readFailures: string[] = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const unread = page.getByRole('button', { name: /Read \d document\(s\)/ });
    if (!(await unread.count())) break;
    if (attempt > 1) await page.waitForTimeout(45_000);
    await expect(unread).toBeEnabled({ timeout: 30_000 }); // the relay's status has loaded
    await runStep(page, unread, 10);
    for (const t of await page.getByTestId('analyse-doc').allInnerTexts()) if (!/values read/.test(t)) readFailures.push(`attempt ${attempt}: ${t.replace(/\s+/g, ' ')}`);
  }
  results.readFailures = readFailures;
  const reads = calls.filter((c) => c.task === 'extract');
  results.readingCalls = reads.length;
  save();
  await expect(page.locator('[data-testid="analyse-doc"][data-read="yes"]')).toHaveCount(2);
  await shot(page, 'live-02-read', false, SHOTS);

  // What left the relay: no identifier, no calendar date, the redacted page only.
  for (const c of calls) {
    expect(c.text).not.toMatch(/Synthetic Gamma|55501234|SYNTHETIC ALPHA|00451287|CASE-\d/);
    expect(c.text).not.toContain(admitted);
  }
  const imageCall = reads.find((c) => c.images.length && c.status === 200);
  expect(imageCall, 'the page image was sent').toBeDefined();
  await expectRedactedImage(page, imageCall!.images[0]!);
  // What the model itself answered for the illegible dose (before the app's checks).
  results.insulinAsReturnedByModel = reads
    .filter((c) => c.images.length && c.output)
    .map((c) => {
      try {
        const items = (JSON.parse(c.output!) as { items: Record<string, unknown>[] }).items;
        const it = items.find((x) => /insulin/i.test(String(x.name ?? x.rawText ?? '')));
        return it ? { pass: c.pass, dose: it.dose, doseUnit: it.doseUnit, legibility: it.legibility, handwritten: it.handwritten, rawText: it.rawText } : { pass: c.pass, notReturned: true };
      } catch {
        return { pass: c.pass, unparsable: true };
      }
    });
  save();

  // 2. Check every value against the document.
  const storedNote = note.replace(/^Patient name: .*$/m, 'Patient name: [REMOVED]').replace(/^MRN: .*$/m, 'MRN: [REMOVED]');
  await page.getByRole('link', { name: 'Admission note' }).click();
  await expect(page.getByTestId('extraction-review')).toBeVisible();
  await shot(page, 'live-03-review-note', false, SHOTS);
  const noteFields = await checkReading(page, storedNote, 0);
  await page.goto(`/#/cases/${caseId}/analyse`);
  await page.getByRole('link', { name: 'Laboratory report' }).click();
  await expect(page.getByTestId('extraction-review')).toBeVisible();
  await expect(page.locator('[data-box]').first()).toBeVisible();
  await shot(page, 'live-04-review-page', false, SHOTS);
  const pageDoc = [LAB_PAGE_LINES.title, LAB_PAGE_LINES.creatinine, LAB_PAGE_LINES.potassium, LAB_PAGE_LINES.crp, LAB_PAGE_LINES.insulin].join('\n');
  const pageFields = await checkReading(page, pageDoc, 1);
  results.extraction = { note: noteFields, page: pageFields, noteFound: found(EXPECTED_NOTE, noteFields), pageFound: found(EXPECTED_PAGE, pageFields) };
  // An illegible dose is never shown as a number, whatever the model returned.
  const insulin = pageFields.find((f) => /insulin/i.test(`${f.value} ${f.raw}`));
  if (insulin) expect(insulin.value).not.toMatch(/\d+(\.\d+)?\s*(units|iu|u)\b/i);
  // Nothing that does not match the documents entered the record.
  for (const f of [...noteFields, ...pageFields]) if (!f.matches) expect(f.decision).toMatch(/^rejected/);
  save();

  // 3. Draft the 30 tasks from the confirmed record; temporary refusals are retried for the modules that failed only.
  await page.goto(`/#/cases/${caseId}/analyse`);
  await expect(page.getByTestId('analyse-module-collect')).toBeVisible();
  await expect(page.getByTestId('analyse-pending')).toBeVisible();
  const draftFailures: string[] = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const button = page.getByRole('button', { name: /Draft the 30 tasks|Draft \d+ module\(s\)/ });
    if (!(await button.count())) break;
    if (attempt > 1) await page.waitForTimeout(60_000);
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await runStep(page, button, 25);
    for (const t of await page.getByTestId('analyse-module-error').allInnerTexts()) draftFailures.push(`attempt ${attempt}: ${t}`);
  }
  results.draftFailures = draftFailures;
  const moduleStates: Record<string, { state: string | null; error?: string }> = {};
  for (const m of MODULE_IDS) {
    const row = page.getByTestId(`analyse-module-${m}`);
    moduleStates[m] = { state: await row.getAttribute('data-state'), ...((await row.getByTestId('analyse-module-error').count()) ? { error: await row.getByTestId('analyse-module-error').innerText() } : {}) };
  }
  results.modules = moduleStates;
  await shot(page, 'live-05-drafted', true, SHOTS);
  save();
  const drafted = Object.values(moduleStates).filter((s) => s.state === 'drafted').length;
  expect(drafted, 'modules drafted').toBeGreaterThan(0);

  // What was sent for drafting: the confirmed record only. A decimal value that was rejected (and is not part of any
  // confirmed value) must not appear in the case data sent.
  const drafts = calls.filter((c) => c.task === 'analyse' && c.status === 200);
  const all = [...noteFields, ...pageFields];
  const kept = new Set(all.filter((f) => !f.decision?.startsWith('rejected')).flatMap((f) => numbers(`${f.value} ${f.raw}`)));
  const rejected = [...new Set(all.filter((f) => f.decision?.startsWith('rejected')).flatMap((f) => numbers(f.value)))].filter((n) => n.includes('.') && !kept.has(n));
  const leaked = rejected.filter((n) => drafts.some((c) => numbers(c.text.split('CASE DATA (JSON) below.')[1] ?? '').includes(n)));
  results.rejectedValuesCheckedForLeaks = rejected;
  expect(leaked, 'rejected values sent for drafting').toEqual([]);

  // 4. Every task's draft, as the trainee sees it.
  const caseNumbers = new Set(drafts.flatMap((c) => numbers(c.text)));
  const tasks: Record<string, { kind: string | null; basis: string | null; checks: string[]; text: string }[]> = {};
  const problems: string[] = [];
  for (const id of TASK_IDS) {
    await page.goto(`/#/cases/${caseId}/task/${id}`);
    await expect(page.getByTestId('ai-draft')).toBeVisible();
    const cards = page.locator('[data-testid="suggestion"]');
    const list = [];
    for (let i = 0; i < (await cards.count()); i++) {
      const c = cards.nth(i);
      const text = (await c.innerText()).replace(/\s+/g, ' ').trim();
      // The statement itself, without the interface around it (badges, chips, buttons).
      const statement = await c.evaluate((el) => {
        const x = el.cloneNode(true) as HTMLElement;
        x.querySelectorAll('[data-check], [data-basis], button, [data-provenance]').forEach((n) => n.remove());
        return (x.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      list.push({
        kind: await c.getAttribute('data-kind'),
        basis: (await c.locator('[data-basis]').count()) ? await c.locator('[data-basis]').getAttribute('data-basis') : null,
        checks: await c.locator('[data-check]').evaluateAll((els) => els.map((e) => e.getAttribute('data-check') ?? '')),
        text: text.slice(0, 400),
      });
      // No citation of any kind reaches the trainee, and every number shown was in the case data sent.
      if (/https?:\/\/|doi|pmid|et al\./i.test(text)) problems.push(`${id}: citation shown: ${text.slice(0, 120)}`);
      for (const n of numbers(statement)) if (!caseNumbers.has(n)) problems.push(`${id}: number ${n} not in the case data: ${statement.slice(0, 160)}`);
    }
    tasks[id] = list;
  }
  results.drafts = tasks;
  results.draftProblems = problems;
  save();
  expect(problems, 'citations or numbers that are not in the case data').toEqual([]);

  // 5. Decide a few suggestions, one at a time: accept one, reject one with its reason.
  const decisions: string[] = [];
  await page.goto(`/#/cases/${caseId}/task/t08`);
  await expect(page.getByTestId('ai-draft')).toHaveAttribute('data-state', 'current');
  const pending = page.locator('[data-testid="suggestion"][data-decision="pending"]');
  const acceptable = pending.filter({ has: page.getByRole('button', { name: 'Accept', disabled: false }) }).first();
  if (await acceptable.count()) {
    const label = (await acceptable.innerText()).split('\n').slice(0, 4).join(' ');
    await acceptable.getByRole('button', { name: 'Accept' }).click();
    decisions.push(`t08 accepted: ${label}`);
  }
  await shot(page, 'live-06-task8', true, SHOTS);
  if (await pending.count()) {
    const card = pending.first();
    const label = (await card.innerText()).split('\n').slice(0, 4).join(' ');
    await card.getByRole('button', { name: 'Reject' }).click();
    await card.getByLabel('Why are you rejecting it?').fill('Live run: reviewed and not needed');
    await card.getByRole('button', { name: 'Reject' }).click();
    decisions.push(`t08 rejected with reason: ${label}`);
  }
  await page.goto(`/#/cases/${caseId}/task/t05`);
  await expect(page.getByTestId('ai-draft')).toHaveAttribute('data-state', 'current');
  const drp = page.locator('[data-testid="suggestion"][data-kind="item"][data-decision="pending"]').first();
  if (await drp.count()) {
    await shot(page, 'live-07-task5', true, SHOTS);
    if (await drp.getByRole('button', { name: 'Accept' }).isEnabled()) {
      await drp.getByRole('button', { name: 'Accept' }).click();
      await expect(page.getByTestId('card-summary').first()).toBeVisible();
      decisions.push('t05 accepted a drug-related problem row');
    } else decisions.push('t05: the proposed row is incomplete; it would need the trainee to edit it');
  }
  results.decisions = decisions;

  // 6. The month's spend as the relay counted it, and what went over the network from the browser.
  results.relayStatus = await page.evaluate(async () => (await fetch('/api/status')).json());
  const external = watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:'));
  results.browserExternalRequests = external;
  for (const u of external) expect(u).toMatch(/^https:\/\/rxnav\.nlm\.nih\.gov\/REST\/approximateTerm\.json\?term=[^&]+&maxEntries=3$/);
  results.consoleErrors = watch.errors;
  results.relayAnswers = relay.relay.filter((r) => r.path === '/api/model').map((r) => ({ status: r.status, error: r.error }));
  await page.goto('/#/settings/ai');
  await shot(page, 'live-08-usage', true, SHOTS);
  save();
});
