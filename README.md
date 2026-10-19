# PRECEPTOR

An educational clinical pharmacy rotation copilot for a supervised Master's-level trainee.

## Intended use

```
PRECEPTOR is an educational tool for supervised clinical pharmacy trainees,
used to structure, document and reflect on a pharmacotherapy workup.

It is not intended for diagnosis, treatment, or patient-care decisions.

Outputs must not be entered into a medical record, or communicated to the
care team, without independent verification by a licensed pharmacist or
preceptor. All calculations, interactions and recommendations must be
independently confirmed before any clinical action.
```

PRECEPTOR does not replace a clinical pharmacist. It never makes a clinical decision; the trainee decides, under supervision.

**Release gate:** this build has not passed the release gate (Section 23 of the specification). Use synthetic cases only. Real patient data may not be entered until the department head has given written authorisation, a paid API key is configured, milestones M1–M6 have been accepted, and the clinical fixture library has run with no missed critical problem.

## Status

| Milestone | State |
|---|---|
| M1 — Case and timeline core, with Revision 1 (patient-file intake and the Clinical Modules) | Accepted by the owner on 16 October 2026 ([report](docs/m1/M1-REPORT.md)) |
| M3 — The patient file read by the model, and AI drafts for the 30 tasks (moved before M2 by the owner's decision of 16 October 2026) | Accepted by the owner on 17 October 2026, after a live run with Google Gemini on a synthetic case ([plan](docs/m3/M3-PLAN.md), [report](docs/m3/M3-REPORT.md), [live run](docs/m3/M3-LIVE-RUN.md)) |
| M2 — Calculation and rules | Accepted by the owner on 19 October 2026 ([plan](docs/m2/M2-PLAN.md), [report](docs/m2/M2-REPORT.md), [test values for review](docs/m2/CALCULATOR-FIXTURES.md), [dataset mapping](docs/m2/datasets/)) |
| M4 — Assessment and DRPs | Approved to start on 19 October 2026; plan prepared, waiting for the owner's answers to its decisions ([plan](docs/m4/M4-PLAN.md)) |
| M5–M9 | Not started (each begins only after the previous one is accepted) |

What M1 contains: an encrypted local record (AES-GCM, key derived from a passphrase), rotations, Teaching and Clinical Cases, manual entry on an append-only timeline dated by hospital day, correction by supersession, an append-only audit log, the eight provenance states, the department's 11-section form as an on-screen review with missing-data flags, encrypted backup and restore, Arabic and English with right-to-left layout, and an offline-capable installable web app.

Revision 1 adds the **patient file** — the case typed or pasted, uploaded (text, PDF read on the device, images) or photographed, with identifiers removed before anything is saved (text check with mandatory confirmation; covers burned into image pixels; the unredacted original is never stored) — and a **Next** step into the **Clinical Modules**: the 30 tasks of a hospital clinical pharmacist in 8 modules, each with a worksheet (steps, the data it needs, checklist, per-medication and per-problem review), twelve shared registers (pre-admission medications, drug-related problems and recommendations, interactions, ADRs, medication errors, drug levels, monitoring, rounds, counselling, discharge medications, references, the trainee's own calculation checks) that also fill the department form, and progress tracking per case, per module and on the Workflow screen.

M3 adds **Next: Analyse the file**, in three steps the trainee controls:

1. **Read** — the model reads each document of the patient file (identifiers masked again and calendar dates turned into hospital days before sending; only redacted images). Medication pages and handwriting are read twice; a disagreement flags the value. Values are checked in code (units, plausible ranges, error-prone abbreviations, drug names through RxNorm); an illegible value is never guessed.
2. **Check** — each value read is shown beside the page (with its box on a photographed page) and is **confirmed, corrected or rejected one at a time**. Until confirmed it is used nowhere.
3. **Draft** — the confirmed record (no identifiers) is sent module by module, and every task worksheet shows the model's draft: checklist answers, register rows, missing data and questions. Each statement says whether it rests on the case data (with references) or on **general knowledge — no source, unverified**. Before anything is shown, code removes references to data that was not sent, numbers not in the case data, **doses** (a dose comes only from a tested calculator), citations and commercial source names, invalid values, and everything only the trainee can record (what was done, outcomes, sources). Each suggestion is **accepted, edited or rejected with a reason**, one at a time; there is no "accept all". A draft older than the record is locked until drafted again.

The Clinical Modules stay one tap away throughout, so every task can still be done by hand, offline or without the AI service.

M2 adds the **calculators and the safety checks**, all on the device and without AI:

- **20 tested calculators** (the specification's sixteen, BMI, two infusion-rate calculators, and vancomycin without levels with the department's interval table built in), inside the tasks that use them and on the case's Calculators screen. Every result shows its formula, each value used with where it came from, the units, the steps and the assumptions; it is stored, never overwritten, and marked out of date when its inputs change. A missing or unconfirmed input is refused by name; an implausible value needs confirmation; a calculator that has not passed its tests is hidden, with the reason. The renal dose review stays locked until its required data is recorded.
- **Safety checks with three alert levels**: a documented allergy or previous ADR (by ingredient and drug class), duplication, the high-alert flag, laboratory critical values, creatinine rise (KDIGO), renal and hepatic adjustment from your own table, missing data that blocks a dose assessment, the antibiotic time-out and the de-escalation prompt; **drug–drug interactions** from DDInter (a *Major* pair is important, *Moderate*, *Minor* and *Unknown* are informational) and the **WHO AWaRe 2025** category of every antibiotic. PRECEPTOR gives an interaction's level only: the trainee looks up and writes the mechanism and the management in Task 6, and a fixed warning says that the offline database does not cover every drug group and that interactions must be checked in the hospital's approved references. A pair on the **ONC high-priority list**, as the administrator enters it, is critical. A **critical** alert blocks the screen until it is acknowledged with a reason (audited); **important** alerts are badges; **informational** notes are collapsed. Whatever could not be checked — an unrecognised drug name, a pair outside DDInter's download files, the ONC list while it has not been entered — is listed, never shown as safe.
- **Your reference tables**: the local formulary with local brand names and the high-alert flag, the renal and hepatic adjustment table, the laboratory's critical values, and the ONC high-priority interaction list (entered by the administrator, pair by pair, each name matched to RxNorm or to a drug class) — versioned and audited; none of their content is shipped. **Naranjo and WHO-UMC** questionnaires on each suspected ADR, beside your own judgement.

## Privacy and data

- All records stay on the device, encrypted in IndexedDB with a random data key. That key is wrapped by a key derived from the trainee's passphrase (PBKDF2-HMAC-SHA-256, 600,000 iterations, per-install salt). Only non-secret material is stored unencrypted: the salt, the wrapped key, display preferences and the acknowledgement timestamp. The passphrase is never stored; a forgotten passphrase means the data cannot be recovered.
- There is no account and no cloud sync. The app's Content-Security-Policy lets the browser connect to only two places: the app's own site (where the AI relay answers at `/api`) and RxNav, the U.S. National Library of Medicine's free RxNorm service, which receives a **drug name only** (answers are cached on the device).
- What the model receives (M3): the text of a document after a second identifier check, with calendar dates replaced by hospital days; a page image only after its identifiers were covered and burned in; and, for drafting, the **confirmed** record with age (banded over 89), sex, height and hospital days — never the name, MRN, bed or consultant, which live in a separate encrypted group that the analysis does not read. The API key stays on the server and never reaches the browser.
- A **Clinical Case is never sent with a free-tier key** (the provider may use free-tier data): the app refuses, and the relay refuses again. With a free key, use synthetic Teaching Cases only. Real patient data stays forbidden until the release gate is passed.
- The relay stores no request and no answer and logs nothing; it keeps only usage counters (one per month for the spending cap, one per installation for the rate limits, keyed by a random installation id). On the device, the audit log records each call's model, prompt version, token use and cost — never its content.
- Patient name and MRN (Clinical Cases only) are kept in a separate encrypted field group, never shown in the Teaching copy of the form and never written to the audit log.
- Patient-file documents are stored encrypted like every other record, only after their identifiers have been removed: typed or imported text passes an identifier check and a mandatory confirmation; each image is covered in a redaction editor, the covers are burned into the pixels and the image is re-encoded (which drops camera metadata). The unredacted original is never stored. A document's content can be removed with a reason; its description and the removal stay in the audit log.
- Backups are encrypted files the trainee saves themselves, restorable only with the passphrase.

## AI service (M3): setting up the relay on Netlify

The AI features need the relay deployed with the site and an API key. Without it, the app says so and everything else keeps working. A step-by-step guide with a ready-to-paste settings block is in [docs/deploy/NETLIFY.md](docs/deploy/NETLIFY.md).

1. **Get a Gemini API key** in Google AI Studio (the "Get API key" page). A key on a project without billing is a **free-tier** key: use it with synthetic Teaching Cases only. A key on a project with billing enabled is a **paid** key.
2. **In Netlify**, open the site's environment variables and add:

   | Variable | Value |
   |---|---|
   | `GEMINI_API_KEY` | the key (mark it secret) |
   | `PRECEPTOR_MODELS` | the models the trainee may choose, with their prices in US$ per million tokens: `model-id:input:output`, comma-separated. Copy the current ids and prices from Google's Gemini API model and pricing pages; no model id is written in the code. |
   | `PRECEPTOR_SUGGESTED` | optional: the models offered first, e.g. `extract=<model-id>,analyse=<model-id>` |
   | `PRECEPTOR_KEY_CLASS` | `free` (the default when unset) or `paid` — set `paid` only when billing is enabled for the key's project. The provider has no way to tell the relay which kind of key it is. |
   | `PRECEPTOR_MONTHLY_BUDGET_USD` | the hard monthly cap (default `5`). Each call's cost is estimated generously and reserved before the call, then corrected to the tokens actually used; a call that could exceed the cap is refused. |
   | `PRECEPTOR_ACCESS_CODE` | optional but recommended: a code the trainee enters in Settings → AI service, so that only they can use the relay |
   | `PRECEPTOR_RATE_PER_MINUTE`, `PRECEPTOR_RATE_PER_DAY` | per-installation limits (defaults `10` and `200`) |
   | `PRECEPTOR_THINKING` | recommended: how much the model reasons before answering, per task, e.g. `extract=low,analyse=low` (levels `minimal`, `low`, `medium`, `high`; unset = the model's default). In the live run, the default made one reading take 26 s and two drafts nearly 30 s; at `low` the same reading took under 4 s. |
   | `PRECEPTOR_PROVIDER_TIMEOUT_MS` | how long the relay waits for the model (default `25000`). Netlify stops a function after 30 s; the relay answers clearly before that, and counts the call's full estimate against the budget. |
   | `PRECEPTOR_MODEL_PATTERN`, `PRECEPTOR_DEFAULT_PRICE` | optional: also allow model ids matching a pattern, at a default price `input:output` |
   | `PRECEPTOR_MAX_OUTPUT_TOKENS`, `PRECEPTOR_IMAGE_TOKENS`, `PRECEPTOR_MAX_REQUEST_BYTES` | optional limits (defaults `8192`, `1600`, 5 MB — Netlify refuses requests over about 6 MB) |

3. **Deploy** (Netlify applies environment-variable changes on the next deploy; no code change is needed). Open `https://<your-site>/api/status`: it should answer JSON with `"configured": true` and your models.
4. **In the app**, open Settings → AI service: check the status, the key class and the budget, enter the access code if you set one, choose a model for reading and one for analysis, and save.
5. **When Google retires a model**, choose another model from the list in Settings straight away, then update `PRECEPTOR_MODELS` at leisure. Keeping two or three models on the list avoids any interruption.
6. **Free-tier limits.** In the live run, Google's free tier allowed **20 requests per model per day**, and often answered "high demand" (the app retries such a refusal once, after 4 seconds). Reading a document takes two requests (it is read twice) and drafting takes eight (one per module), so a free key covers about one synthetic case per model per day. Listing two models and choosing one for reading and another for drafting doubles that. A paid key has far higher limits.

The relay's code is in `relay/` (provider-independent; one module per provider, `relay/providers/gemini.ts` today) and `netlify/functions/model.mts`.

## Sources and licences

This build contains no third-party clinical reference text (no monograph, guideline or dosing content). UpToDate, Medscape, Lexicomp, Micromedex, Clinical Pharmacology, Epocrates, NICE, BNF and NCCN content is not and will not be integrated (Section 4 of the specification), and the model's drafts are cleaned of any such name. The task worksheets were written for PRECEPTOR from general clinical-pharmacy practice and contain no doses or drug-specific thresholds. Each calculator cites the published source of its formula.

The offline drug vocabulary (`public/data/rxnorm-subset.json`) is built from RxNorm Current Prescribable Content and RxClass (FDA Established Pharmacologic Classes, VA antimicrobial classes) through the RxNav API. This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

Two datasets are installed, each in its own file with its licence and attribution, also shown on the About screen:

- `public/data/ddinter-interactions.json` — the DDInter download files (Xiong G, et al. DDInter: an online drug–drug interaction database towards improving clinical decision-making and patient safety. *Nucleic Acids Res* 2022;50:D1200–D1207), licensed CC BY-NC-SA 4.0. PRECEPTOR's file is an adaptation (drug names mapped to RxNorm ingredients, the highest level kept for a pair) and is shared under the same licence. DDInter's disclaimer applies: the data is for reference and does not replace professional judgement. The download files hold about half of the interactions DDInter reports (the pairs in which at least one drug is in ATC group A, B, D, H, L, P, R or V); a pair outside them is reported as not checked, never as safe.
- `public/data/who-aware-2025.json` — the WHO AWaRe classification of antibiotics, 2025 (WHO, CC BY-NC-SA 3.0 IGO). PRECEPTOR's file is an adaptation (names mapped to RxNorm ingredients, the route kept where WHO gives one); it was not created by WHO, and WHO is not responsible for its content or accuracy and does not endorse PRECEPTOR.

The derived files are non-commercial and share-alike, like their sources. How each source name was mapped, and what could not be mapped, is listed in [docs/m2/datasets](docs/m2/datasets/). The ONC high-priority list (Phansalkar et al., *JAMIA* 2012) is not shipped: its publisher could not be reached from the build environment, so the administrator enters it in More → Reference tables.

Libraries shipped in the app: React and React DOM (MIT), Dexie and dexie-react-hooks (Apache-2.0), Workbox window (MIT), PDF.js `pdfjs-dist` (Apache-2.0; runs on the device, loaded only when a PDF is added), and the IBM Plex Sans, Sans Arabic and Mono fonts via Fontsource (SIL Open Font License 1.1, bundled — no font server). The relay uses `@netlify/blobs` (MIT) for its counters.

## Development

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # development server
npm run typecheck  # TypeScript, strict mode
npm test           # unit tests (Vitest)
npm run build      # production build with service worker and CSP
npm run test:e2e   # end-to-end tests (Playwright, Chromium) against the production build
```

The end-to-end tests run against `vite preview` of the production build, because the service worker and the Content-Security-Policy exist only there. Run `npm run build` first.

**Calculators and their tests.** `npm test` writes `src/calc/validation-manifest.json` when every calculator test ran: per calculator, its formula version and passing tests, and a hash of the engine's code and tests. The build hides any calculator without a passing record — and all of them if `src/calc/` or `tests/calc/` changed after the last full run. After changing either, run `npm test` before `npm run build`, and commit the manifest. `npm run docs:fixtures` regenerates `docs/m2/CALCULATOR-FIXTURES.md` (every test case with the origin of its values, for review).

**Drug data.** `NODE_USE_ENV_PROXY=1 npm run data:build` rebuilds every data file in order: the offline vocabulary from RxNav (`build-rxnorm.mjs`), the FDA classes (`build-epc.mjs`), DDInter (`build-ddinter.mjs`) and WHO AWaRe (`build-aware.mjs`). Each script records the file's version, size and SHA-256 in `src/data/datasets.json` (the app refuses a file whose checksum does not match) and writes its mapping report to `docs/m2/datasets/`. Downloads and RxNav answers are cached in `node_modules/.cache/preceptor-data/`.

The AI tests (`e2e/m3-ai.spec.ts`) need no key and no network: the app's calls to `/api` run the real relay code and Gemini adapter inside the test, and only the final call to Google is answered by a stand-in that replies in Gemini's response format (`e2e/ai-relay.ts`, `e2e/ai-fixtures.ts`). The same suite scans the built app for API keys, the provider's address and model names.

The live run (`e2e/m3-live.spec.ts`) uses Google's real service and RxNav on a synthetic case, and runs only when asked for (it needs network access and uses the provider's quota):

```bash
PRECEPTOR_LIVE=1 PRECEPTOR_LIVE_READ=<model-id> PRECEPTOR_LIVE_DRAFT=<model-id> \
PRECEPTOR_LIVE_THINKING=extract=low,analyse=low PRECEPTOR_LIVE_PRICE=<input>:<output> \
NODE_USE_ENV_PROXY=1 npx playwright test e2e/m3-live.spec.ts
```

The key is read from `GEMINI_API_KEY`, or added by the environment's proxy. Results go to `test-results/live/`.

### Layout

```
src/
  crypto/     Web Crypto: key derivation, data-key wrapping, AES-GCM sealing
  store/      Dexie schema, append-only guard, encrypted repository, session/lock, backup
  domain/     data model, entry validation, timeline logic, provenance spec, department form
    workflow/ the 30-task catalogue, registers, worksheet progress, readiness checks, identifier check
  calc/       the calculation engine: units, input specifications, the 17 calculators, the Verify gate, the validation manifest
  drugs/      the offline drug vocabulary and dataset loaders (checksum-verified), drug-name matching
  rules/      the safety rules, allergy class words, Naranjo and WHO-UMC
  data/       the dataset manifest (version, size, SHA-256, licence of each file in public/data)
  ai/         callModel (the only way to the model), settings, RxNorm
    extraction/ reading a document: contract, de-identification, checks, dual pass
    analysis/   drafting a module: payload with references, contract, checks in code, limits
  i18n/       English and Arabic strings, clinical term glossary
  ui/         React screens and components (patient file, redaction, analysis, review, Clinical Modules)
relay/        the model relay: configuration, spending cap and rate limits, provider modules
netlify/functions/  the relay's Netlify Function entry
tests/unit/   unit tests
tests/calc/   calculator and engine tests (they write the validation manifest)
e2e/          end-to-end tests (with the test relay and the provider stand-in)
docs/         milestone plans and reports, with screenshots
```
