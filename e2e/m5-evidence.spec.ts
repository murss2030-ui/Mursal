/**
 * M5 in the browser (Section 23, M5 acceptance): the evidence library and
 * "Research this question" from a Problem Card, with only the AI service and
 * the open services replaced by stand-ins (the model by ai-fixtures.ts, the
 * open services by answers recorded from the real ones). Everything is
 * synthetic. Each criterion of the plan's Section 6 has its steps here:
 *
 * - a claim with no retrieved support renders as unsupported and cannot enter the card;
 * - every citation shown opens a real source (the stored document at its page, or the recorded address);
 * - when retrieval finds nothing adequate, the app says so plainly and keeps an open question;
 * - a research is stale like a card when a new value lands.
 *
 * The four hostile fixtures and the spending cap are in the unit tests
 * (research.test.ts, embed.test.ts), where they run against the very same code.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installTestRelay } from './ai-relay';
import { saveModels } from './ai-steps';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';
import { syntheticGuideline } from './pdf-fixture';

test.use({ serviceWorkers: 'block' });

const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'docs/m5/screenshots';
const shot = async (page: Page, name: string, full = true) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
};

interface Recorded {
  url: string;
  status: number;
  contentType: string;
  body: string;
}
const recorded = (name: string): Recorded[] => (JSON.parse(readFileSync(`tests/fixtures/connectors/${name}.json`, 'utf8')) as { requests: Recorded[] }).requests;

/** The open services, answered from what the real ones answered (this environment has no route to them). */
async function serveOpenSources(page: Page, log: string[], opts: { none?: boolean } = {}) {
  const cors = { 'access-control-allow-origin': '*' };
  const json = (body: string, status = 200, type = 'application/json') => ({ status, headers: { ...cors, 'content-type': type }, body });
  await page.route('https://api.fda.gov/**', async (route) => {
    const url = route.request().url();
    log.push(url);
    await route.fulfill(opts.none || !url.includes('metformin') ? json('{"error":{"code":"NOT_FOUND","message":"No matches found!"}}', 404) : json(recorded('openfda-metformin')[0]!.body));
  });
  await page.route('https://eutils.ncbi.nlm.nih.gov/**', async (route) => {
    const url = route.request().url();
    log.push(url);
    if (opts.none) return route.fulfill(json(recorded('pubmed-none')[0]!.body));
    await route.fulfill(url.includes('efetch') ? json(recorded('pubmed-vancomycin')[1]!.body, 200, 'text/xml') : json(recorded('pubmed-vancomycin')[0]!.body));
  });
  await page.route('https://www.ebi.ac.uk/**', async (route) => {
    log.push(route.request().url());
    await route.fulfill(opts.none ? json('{"hitCount":0,"resultList":{"result":[]}}') : json(recorded('europepmc-vancomycin')[0]!.body));
  });
}

const PROBLEM = 'Metformin dose not adjusted for kidney function';

async function addCard(page: Page, caseId: string) {
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByRole('link', { name: 'Add a drug-related problem' }).click();
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await page.getByLabel(/Clinical problem, in one sentence/).fill(PROBLEM);
  await page.getByLabel(/Medication\(s\) involved/).fill('metformin');
  await page.getByLabel(/Values from the timeline/).selectOption({ label: 'Serum creatinine: 2.4 mg/dL — Day 1' });
  await page.getByRole('radio', { name: 'P2.1 Adverse drug event (possibly) occurring' }).click();
  await page.getByRole('radio', { name: 'Potential problem' }).click();
  await page.locator('[data-group="C3"] summary').click();
  await page.getByRole('button', { name: 'C3.2 Drug dose of a single active ingredient too high' }).click();
  await page.getByRole('radio', { name: 'Critical' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('card-summary')).toHaveCount(1);
}

async function addDocument(page: Page, o: { title: string; aiUse: 'local' | 'send'; marker: string; inText?: string }) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Add a PDF' }).click();
  await page.getByLabel('PDF file').setInputFiles({ name: `${o.marker}.pdf`, mimeType: 'application/pdf', buffer: syntheticGuideline(o.marker, o.inText ?? '') });
  await expect(page.getByText('File read: 1 pages.')).toBeVisible({ timeout: 30_000 });
  // What the file said about itself is offered, never applied silently: the trainee types or confirms the rest.
  await page.getByLabel('Title', { exact: true }).fill(o.title);
  await page.getByLabel('Publisher or society').fill('Synthetic Society');
  await page.getByLabel('Year of publication').fill('2024');
  await page.getByLabel('Licence', { exact: true }).fill(o.aiUse === 'send' ? 'CC BY 4.0' : 'All rights reserved');
  if (o.aiUse === 'send') {
    await page.getByRole('radio', { name: /May be sent to the AI service/ }).check();
    // The licence gate: without the trainee's confirmation, nothing is added.
    await page.getByRole('button', { name: 'Add to the library' }).click();
    await expect(page.getByText('Confirm that the licence allows it')).toBeVisible();
    await page.getByLabel(/I checked the licence/).check();
  }
  await page.getByRole('button', { name: 'Add to the library' }).click();
  await expect(page).toHaveURL(/#\/library\/[^/]+$/);
}

test('the library: a PDF added with its licence gate, searched on the device, opened at the page a citation names', async ({ page }) => {
  test.setTimeout(240_000);
  const watch = watchPage(page);
  await onboard(page);
  await page.goto('/#/resources');
  await page.getByRole('link', { name: 'Guideline library' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByText('No document yet.')).toBeVisible();
  await shot(page, 'm5-01-library-empty');

  await addDocument(page, { title: 'Synthetic kidney guideline', aiUse: 'send', marker: 'sendable' });
  await expect(page.getByRole('heading', { name: 'Synthetic kidney guideline' })).toBeVisible();
  await expect(page.getByText('SHA-256')).toBeVisible();
  await expect(page.getByText('Primary document for its topic').first()).toBeVisible();
  await expect(page.getByText('May be sent to the AI service').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Passages \(\d+\)$/ })).toBeVisible();
  const passages = page.getByTestId('passage');
  expect(await passages.count()).toBeGreaterThanOrEqual(2);
  await expect(passages.first()).toContainText('Synthetic Society. Synthetic kidney guideline, 2024, p. 1');
  await expect(page.getByText('Recommendation').first()).toBeVisible();
  // A recommendation's strength is kept only as printed in the document.
  await expect(page.getByText('As printed: Strong recommendation, moderate-quality evidence')).toBeVisible();
  await shot(page, 'm5-02-library-document');

  // Not a PDF: refused by the reader, not stored.
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Add a PDF' }).click();
  await page.getByLabel('PDF file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf file at all') });
  await expect(page.getByRole('button', { name: 'Add to the library' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // The same file twice is refused.
  await page.getByRole('button', { name: 'Add a PDF' }).click();
  await page.getByLabel('PDF file').setInputFiles({ name: 'again.pdf', mimeType: 'application/pdf', buffer: syntheticGuideline('sendable') });
  await expect(page.getByText('File read: 1 pages.')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Title', { exact: true }).fill('A copy');
  await page.getByLabel('Publisher or society').fill('Synthetic Society');
  await page.getByLabel('Year of publication').fill('2024');
  await page.getByLabel('Licence', { exact: true }).fill('All rights reserved');
  await page.getByRole('button', { name: 'Add to the library' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already in your library' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Search on the device, by words.
  await page.getByLabel('Question or drug').fill('metformin acute kidney injury');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const results = page.getByTestId('library-results');
  await expect(results).toContainText('Searched by words on this device.');
  await expect(results.getByTestId('passage').first()).toContainText('We recommend that synthetic metformin be held');
  await expect(results.getByTestId('passage').first()).toContainText('p. 1');
  await shot(page, 'm5-03-library-search');

  // A citation opens the stored document at the page: rendered on the device.
  await results.getByRole('link', { name: 'Open page 1' }).first().click();
  await expect(page.getByTestId('page-number')).toHaveText('Page 1 of 1');
  await expect(page.getByTestId('page-canvas').locator('canvas')).toBeVisible({ timeout: 30_000 });
  await shot(page, 'm5-04-library-page', false);

  // Nothing went anywhere: no outside request at all.
  expect(watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
  expect(watch.errors).toEqual([]);
});

test('Research this question: PICO from the card, the library then the open sources, drafted only from what was retrieved, every statement checked, added one at a time, stale on a new value', async ({ page }) => {
  test.setTimeout(300_000);
  const watch = watchPage(page);
  const relay = await installTestRelay(page);
  const open: string[] = [];
  await serveOpenSources(page, open);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '2.4', '1');
  await saveModels(page);
  await addDocument(page, { title: 'Synthetic kidney guideline', aiUse: 'send', marker: 'sendable' });
  const LOCAL = 'LOCALONLY-MARKER-4410';
  await addDocument(page, { title: 'Local protocol', aiUse: 'local', marker: 'local', inText: `${LOCAL} ` });
  await addCard(page, caseId);

  // ---- the question, built from the card, for the trainee to edit; what leaves the device is said first
  await page.getByTestId('card-summary').click();
  await page.getByTestId('research-link').click();
  await expect(page.getByTestId('research-screen')).toBeVisible();
  await expect(page.getByLabel(/^Intervention or drug/)).toHaveValue('metformin');
  await expect(page.getByLabel(/^Problem or outcome/)).toHaveValue(PROBLEM);
  await expect(page.getByTestId('pico-question')).toContainText('how should metformin be used');
  await page.getByLabel(/^Comparison/).fill('stopping it');
  await expect(page.getByTestId('pico-question')).toContainText('compared with stopping it');
  await expect(page.getByText('Never the patient’s name, record number or dates.')).toBeVisible();
  await expect(page.getByText('1 document(s) in your library may be sent to the AI service; 1 are kept for local search')).toBeVisible();
  await shot(page, 'm5-05-research-question');
  await page.getByTestId('research-go').click();
  await expect(page.getByTestId('research-run')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('research-run')).toHaveAttribute('data-status', 'answered');

  // ---- what left the device: drug names and the question's words, nothing else; a local document never
  const external = watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:') && !u.startsWith('https://rxnav.nlm.nih.gov/'));
  expect(external.length).toBeGreaterThan(0);
  for (const u of external) expect(u).toMatch(/^https:\/\/(api\.fda\.gov|eutils\.ncbi\.nlm\.nih\.gov|www\.ebi\.ac\.uk)\//);
  expect(external.some((u) => u.includes('dailymed'))).toBe(false);
  expect(open.find((u) => u.startsWith('https://api.fda.gov/'))).toContain('metformin');
  const asked = relay.provider.filter((c) => c.task === 'research');
  expect(asked).toHaveLength(1);
  expect(asked[0]!.text).toContain('We recommend that synthetic metformin be held');
  expect(asked[0]!.text).not.toContain(LOCAL);
  expect(JSON.stringify(relay.provider)).not.toContain(LOCAL);

  // ---- the answer: what the sources say, supporting and conflicting evidence side by side, each beside its verdict and quote
  const statements = page.getByTestId('research-statement');
  await expect(statements).toHaveCount(4);
  const recommendation = page.getByTestId('research-recommendation').getByTestId('research-statement');
  await expect(recommendation).toHaveCount(1);
  await expect(recommendation.getByTestId('verdict')).toHaveAttribute('data-verdict', 'supported');
  await expect(recommendation.getByTestId('verdict-quotes')).toBeVisible();
  await expect(recommendation).toContainText('Synthetic Society. Synthetic kidney guideline, 2024, p. 1');
  // A dose its quote does not contain is withheld, flagged, and the statement cannot be added.
  const dose = statements.filter({ hasText: '[dose withheld' });
  await expect(dose.locator('[data-flag="dose_withheld"]')).toBeVisible();
  await expect(dose.getByTestId('research-add')).toBeDisabled();
  await expect(dose).not.toContainText('850');
  // A statement no passage makes: Unsupported by its source — and cannot be added.
  const conflicting = page.getByTestId('research-conflicting').getByTestId('research-statement');
  await expect(conflicting).toContainText('safe to continue without any monitoring');
  await expect(conflicting.getByTestId('verdict')).toHaveAttribute('data-verdict', 'unsupported');
  await expect(conflicting.getByTestId('verdict')).toContainText('Not supported by its source');
  await expect(conflicting.getByTestId('research-add')).toBeDisabled();
  // What is missing, and the limits of confidence as factors (no single score).
  await expect(page.getByTestId('research-missing')).toContainText('Creatinine clearance on the day of the decision');
  await expect(page.getByTestId('research-factors').locator('[data-factor="sources"]')).toHaveAttribute('data-level', 'good');
  await expect(page.getByTestId('research-factors').locator('[data-factor="local_only"]')).toBeVisible();
  await expect(page.getByTestId('research-factors').locator('[data-factor="verification"]')).toHaveAttribute('data-level', 'caution');
  await shot(page, 'm5-06-research-answer');

  // ---- every source is recorded, with where it opens
  const sources = page.getByTestId('research-sources');
  await expect(sources.locator('[data-source="library"]')).toHaveCount(2);
  await expect(sources.locator('[data-source="openfda_label"]').first()).toBeVisible();
  await expect(sources.locator('[data-source="pubmed"]').first()).toContainText('Literature to appraise — not a recommendation in itself');
  await expect(sources.locator('[data-source="europepmc"]').first()).toContainText('Literature to appraise — not a recommendation in itself');
  const local = sources.locator('[data-source="library"]').filter({ hasText: 'Kept for local search' });
  await expect(local).toHaveCount(1);
  await expect(local.getByTestId('local-passage')).toContainText(`We recommend that synthetic metformin ${LOCAL} be held`);
  const label = sources.locator('[data-source="openfda_label"]').first().getByTestId('source-link');
  await expect(label).toHaveAttribute('href', /^https:\/\/dailymed\.nlm\.nih\.gov\/dailymed\/lookup\.cfm\?setid=[0-9a-f-]{36}$/);
  await expect(label).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(sources.locator('[data-source="pubmed"]').first().getByTestId('source-link')).toHaveAttribute('href', /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/);
  await expect(sources.locator('[data-source="europepmc"]').first().getByTestId('source-link')).toHaveAttribute('href', /^https:\/\/europepmc\.org\/article\/[A-Z]+\/[A-Za-z0-9]+$/);

  // ---- the statements are added to the card one at a time, with the citation and the quote
  await recommendation.getByTestId('research-add').click();
  await expect(recommendation.getByTestId('research-in-card')).toBeVisible();
  expect(await page.getByTestId('research-add').count()).toBe(3); // no bulk control; the other three stay refused
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByTestId('card-summary').click();
  const claim = page.getByTestId('card-claims').locator('[data-claim-source="research"]');
  await expect(claim).toHaveCount(1);
  await expect(claim).toContainText('Source — retrieved: Synthetic Society. Synthetic kidney guideline, 2024, p. 1');
  await expect(claim.getByTestId('claim-quote')).toContainText('We recommend that synthetic metformin be held');
  await expect(claim.getByTestId('verdict')).toHaveAttribute('data-verdict', 'supported');
  await expect(page.getByTestId('card-claims-gate')).toHaveCount(0);
  await shot(page, 'm5-07-card-with-researched-claim');

  // ---- a citation opens the real source: the stored document, at the page, rendered on the device
  await page.getByTestId('research-link').click();
  await page.getByTestId('research-recommendation').getByTestId('source-link').click();
  await expect(page.getByTestId('page-canvas').locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('page-number')).toHaveText('Page 1 of 1');
  await shot(page, 'm5-08-citation-opens-the-page', false);

  // ---- stale like a card: a new creatinine, and the research can no longer be added from
  await addCreatinine(page, caseId, '3.1', '3');
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByTestId('card-summary').click();
  await page.getByTestId('research-link').click();
  const banner = page.getByTestId('research-run').getByText('Out of date', { exact: true });
  await expect(banner).toBeVisible();
  await expect(page.getByTestId('research-add')).toHaveCount(0);
  await shot(page, 'm5-09-research-stale');

  // ---- Arabic, right to left; clinical wording unchanged
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('research-run')).toContainText('متقادم');
  await shot(page, 'm5-10-research-arabic');
  await page.getByRole('button', { name: 'English' }).first().click();

  // ---- the audit holds counts and ids, never the question or a passage
  await page.goto('/#/audit');
  await expect(page.locator('[data-testid="audit-event"][data-entity="research_run"]')).toHaveCount(1);
  const audit = (await page.locator('[data-testid="audit-event"][data-entity="research_run"], [data-testid="audit-event"][data-entity="model_call"]').allInnerTexts()).join('\n');
  expect(audit).not.toMatch(/We recommend that synthetic metformin|stopping it|dose not adjusted for kidney|LOCALONLY/);
  expect(watch.errors).toEqual([]);
});

test('when retrieval finds nothing adequate, the app says so plainly and keeps the question for the preceptor; the model is not asked', async ({ page }) => {
  test.setTimeout(180_000);
  const watch = watchPage(page);
  const relay = await installTestRelay(page);
  const open: string[] = [];
  await serveOpenSources(page, open, { none: true });
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '2.4', '1');
  await saveModels(page);
  await addCard(page, caseId);
  await page.getByTestId('card-summary').click();
  await page.getByTestId('research-link').click();
  await page.getByTestId('research-go').click();
  await expect(page.getByTestId('research-run')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('research-run')).toHaveAttribute('data-status', 'insufficient');
  await expect(page.getByTestId('research-insufficient')).toHaveText('Nothing adequate was found in your library or the open sources.');
  await expect(page.getByTestId('research-open-question')).toContainText('Open question for the preceptor');
  await expect(page.getByTestId('research-notes')).toContainText('Your library has no document yet.');
  await expect(page.getByTestId('research-statement')).toHaveCount(0);
  await shot(page, 'm5-11-nothing-adequate');
  // The open sources were asked; the model was not. (openFDA answers 404 for a search with no match: the browser logs that, the app does not fail.)
  expect(open.length).toBeGreaterThan(0);
  expect(relay.provider.filter((c) => c.task === 'research')).toEqual([]);
  expect(watch.errors.filter((e) => !/Failed to load resource.*404/.test(e))).toEqual([]);
});

test('a question holding the patient’s name is refused before anything is sent', async ({ page }) => {
  test.setTimeout(180_000);
  const relay = await installTestRelay(page);
  const open: string[] = [];
  await serveOpenSources(page, open);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'clinical', name: 'Saleh Qaid', mrn: 'MRN-77120' });
  await addCreatinine(page, caseId, '2.4', '1');
  await addCard(page, caseId);
  await page.getByTestId('card-summary').click();
  await page.getByTestId('research-link').click();
  await page.getByLabel(/^Population/).fill('Saleh Qaid, an adult');
  await expect(page.getByRole('alert').filter({ hasText: 'looks like an identifier' })).toBeVisible();
  await page.getByTestId('research-go').click();
  await expect(page.getByRole('alert').filter({ hasText: 'looks like an identifier' }).first()).toBeVisible();
  expect(open).toEqual([]);
  expect(relay.provider).toEqual([]);
});
