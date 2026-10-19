# PRECEPTOR — M2 report: calculation and rules

**Date:** 19 October 2026 (replaces the report of 18 October) · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.4.0 (M2)

**Status: built and tested with the real data and your decisions of 18 October 2026, but not complete as the specification defines M2.** Section 22 says to report a blocker rather than present a simplified milestone as complete:

1. **The ONC high-priority interaction list is not installed.** M2 requires "DDInter and ONC data loaded locally". The list is published in Phansalkar et al., *JAMIA* 2012 (PMC3422823). From this session PMC answers only with a "checking your browser" reCAPTCHA page, which I will not try to get around, and the other places that carry the paper (Europe PMC, NCBI E-utilities, PubMed, Oxford Academic) are still refused by the network policy — re-checked on 19 October 2026 at 20:37 UTC, after your change to the allowed domains. The loader, the integrity check and the rule that raises an ONC-listed pair to critical are built and tested with test data. On every case the app lists, under "not checked", that the ONC list is not installed and no pair is raised to critical.
2. **DDInter's download files are incomplete** (a limitation, not a blocker, but you should decide on it). They hold 160,235 of the 302,516 interactions DDInter's site reports: only pairs in which at least one drug is in ATC group A, B, D, H, L, P, R or V. A pair of two drugs outside those groups — for example amiodarone + digoxin, both cardiovascular — is not in the files, and the app lists it as **not checked**, never as "no interaction". The rest of DDInter is only on its site, page by page. DDInter's terms put all its data under CC BY-NC-SA 4.0 and allow downloading content for non-commercial, scholarly use, but when I started to look at how the site's pages load their interaction lists, this environment's automatic safety check stopped it as bulk access to a third-party site. I did not try to get around that. See Section 8.

Everything else in M2 is built, tested and shown below. Nothing is claimed that was not verified. I am waiting for your approval before going further.

The plan is in [M2-PLAN.md](M2-PLAN.md). Every calculator's test cases, the origin of each test value and every plausibility range are in [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md), generated from the code and an actual test run, for review by a qualified pharmacist. How every dataset name was mapped to RxNorm, and what could not be mapped, is in [datasets/](datasets/).

---

## 1. What was built

### Since the report of 18 October

| Part | Where in the app | What it does |
|---|---|---|
| **DDInter interactions, installed** | `public/data/ddinter-interactions.json` | DDInter's download files (8 files, 222,383 rows, 160,235 drug pairs), mapped to RxNorm ingredients: **146,697 ingredient pairs** — Major 25,258, Moderate 85,820, Minor 5,832, Unknown 29,787. 1,814 of DDInter's 1,939 drug names are used; 33 could not be mapped exactly (21 not found, 12 ambiguous), 1 combination product and 91 local-route duplicates (eye, ear, nose, skin, where a systemic entry exists) were left out — each one is listed in [DDINTER-MAPPING.md](datasets/DDINTER-MAPPING.md), with the 398 names resolved through RxNav for review. A pair with two levels keeps the higher. The file is served by the app, works offline and is **refused if its SHA-256 does not match**. |
| **What "no interaction found" means** | rules engine | A pair with no record counts as checked only when the files hold all of one drug's DDInter partners (801 "anchored" ingredients, e.g. warfarin). Otherwise the pair is listed as **not checked**, with the reason: outside the download files, or a drug DDInter does not name. |
| **Interaction alerts with the real data** | case screens, Task 6, Form Section 7 | DDInter *Major* → **important** (badge on both medicines, row on the safety card); *Moderate*, *Minor*, *Unknown* → **informational** (collapsed). Each alert gives DDInter's level and DDInter's own definition of it, and says the dataset gives the level only: the mechanism and the management are for the trainee to look up and record in Task 6 (decision 2). Form Section 7's automatic block now reports what DDInter found, with its source, and lists the pairs that could not be checked; it stays separate from the trainee's rows. |
| **WHO AWaRe 2025, installed** | `public/data/who-aware-2025.json` | WHO's 2025 classification (268 entries) mapped to RxNorm: **209 categories** — Access 71, Watch 112, Reserve 26 (212 entries mapped exactly; 3 of them name the same ingredients and route as another entry). 56 names RxNorm does not hold (e.g. aspoxicillin, biapenem) are listed in [AWARE-MAPPING.md](datasets/AWARE-MAPPING.md); an order for one of them shows "AWaRe not assigned". A combination is classified as a whole (amoxicillin + clavulanic acid = Access) and a route-specific entry by the order's route (fosfomycin by mouth = Watch, IV = Reserve). |
| **AWaRe tagging** | case screens, Task 14 | Every antimicrobial order shows its category (informational), also on its row in Task 14. |
| **Drug vocabulary additions** | `public/data/rxnorm-subset.json` | 315 RxNorm ingredients that DDInter or WHO name but that are outside RxNorm's US prescribable list (e.g. acenocoumarol), so an order for one of them can be matched. |
| **FDA classes rebuilt** (a defect found and fixed) | allergy and duplication checks | Reviewing the screenshots with the real data, I found false informational notes such as "Same class: Established Pharmacologic Classes" between enoxaparin and furosemide: broad grouping classes of the FDA hierarchy were counted as shared classes. Classes now hold only the drugs FDA assigns to them directly (632 classes); the 106 grouping classes are used only to widen an allergy class word ("opioid", "penicillin") to its subclasses. Regression tests added. |
| **Infusion rates** (decision 9) | Task 9, and Case → Calculators | Two calculators, with your formulas. **Weight-based**: rate (mL/h) = dose rate (mcg/kg/min) × weight (kg) × 60 ÷ concentration (mcg/mL); also shows the drug delivered per minute and per hour; a dose rate in mcg/kg/h and a concentration in mg/mL are converted explicitly and the conversion is shown; the weight comes from the timeline. It is a **high-risk** calculation: extended tests, the escalation message for a patient under 18, and a warning when the pump rate is below 0.5 or above 500 mL/h (a likely unit slip). **Volume over time**: rate (mL/h) = volume (mL) ÷ time (h), with mL or L and minutes or hours. Neither holds any drug-specific dose or concentration. |
| **Vancomycin without levels** (decision 6) | Task 10, and Case → Calculators | Your method: **15–20 mg/kg of actual body weight per dose**, the **dosing interval from Cockcroft–Gault creatinine clearance**. Your decision names the method but not the clearance bands, so the bands are your department's table (below), each with its source — none are shipped, as for the high-alert list and the critical values. The calculator works out CrCl with the CrCl calculator's own formula and inputs, takes the band that holds it (as a whole number), and shows the dose, the interval, the total daily dose and the CrCl, with the band's version and source. It is labelled "a population-based starting regimen for a setting where levels cannot be measured" on every result. It **refuses** when the table is empty, when no band holds the value, when two bands do ("correct the table"), when the band says "dose by levels", and for a patient on dialysis or CRRT. The result is marked out of date if the band is changed or removed. No loading dose, no maximum single dose and no rounding are applied (the hospital's protocol). High-risk. |
| **The department's vancomycin interval table** | More → Reference tables | Bands of creatinine clearance ("from" inclusive, "below" exclusive), each either "one dose every N hours" (up to 168 h) or "no fixed interval: dose by levels", with the reference (page or URL) and who verified it. Versioned and audited like the other tables; a change needs a reason; removal is a new version with a reason. |
| **Phenytoin renal definition** | the phenytoin calculator | The question now states your department's definition: creatinine clearance below 10 mL/min, or on haemodialysis. The trainee answers from the record; "Yes" uses the renal-failure form (measured level ÷ (0.1 × albumin + 0.1)). The cited caveat that this form was found inaccurate in haemodialysis patients (Soriano et al., *Ann Pharmacother* 2017) is still shown with the result. |

### The whole of M2

| Part | Where in the app | What it does |
|---|---|---|
| Calculation engine | `src/calc/` | One contract for every calculator (Section 9): formula version, citation, required and optional inputs with their accepted units, physiologic plausibility ranges and definitional limits, `validate`, `compute`, `explain`, limitations, `validated`. Units converted explicitly in both directions; an unknown unit is rejected. A value outside the plausible range is used only after the trainee confirms it, with value and unit shown. A missing input, or one still waiting in the document review, is refused by name. An input can also come from one of the trainee's reference tables (the vancomycin bands), recorded in the result with its version and source. |
| **20 calculators** | Case → Calculators, and inside Tasks 3, 6, 8, 9, 10, 11, 14, 27 | CrCl (Cockcroft–Gault, weight basis chosen and recorded), eGFR CKD-EPI 2021 (a staging tool, never for dosing), IBW/AdjBW, BSA, BMI (decision 5), QTc Bazett and Fridericia (always together), anion gap with albumin correction, corrected calcium, corrected phenytoin with the renal-failure form, Child–Pugh, CURB-65, qSOFA, CHA₂DS₂-VASc, HAS-BLED, ANC, vancomycin AUC₂₄ (two levels, Sawchuk–Zaske), **vancomycin without levels**, **infusion rate weight-based**, **infusion rate volume over time**. Every result shows its formula, the values used with where each came from, the units, the steps and the assumptions; it is stored as a new record (never overwritten) and marked out of date when its inputs change. |
| Validation manifest | build time | The test run records, per calculator and formula version, how many tests passed; the build reads the record and a hash of the engine's code and tests. A calculator without a passing record, or after any engine change not yet re-tested, is **hidden** with the reason. |
| Verify gate | Task 8 | The renal dose review stays locked until age, weight, sex, serum creatinine with its date, dialysis status, current dose and route, and indication are recorded. Dialysis status is a structured "renal replacement therapy" entry (decision 7). |
| Department form, Sections 1 and 7 | Case → Form | BMI and CrCl/eGFR come only from stored calculation results. Section 7 keeps PRECEPTOR's automatic check separate from the trainee's rows. |
| Offline drug vocabulary | built in | RxNorm prescribable ingredients (5,874), precise ingredients (1,654), multiple-ingredient concepts (954), brands (4,140), 99 international names confirmed by RxNav, the 315 dataset ingredients above, FDA Established Pharmacologic Classes and 23 VA antimicrobial classes. Exact matching after cleaning — no fuzzy guessing; an unrecognised name is "not checked". |
| Local formulary and reference tables | More → Reference tables | The trainee's own formulary (local brands, high-alert flag with its source — decision 3), renal and hepatic adjustment table, laboratory critical values (none shipped — decision 4) and the vancomycin interval table. Versioned and audited. |
| Rules engine | `src/rules/engine.ts` | Deterministic, offline, no model: allergy or previous ADR by ingredient and drug class; duplication; high-alert flag; laboratory critical value; creatinine rise (KDIGO); renal and hepatic adjustment (trainee's table); dose assessment blocked by missing data; antibiotic time-out at 48–72 hours; de-escalation prompt after a culture; **DDInter interactions; AWaRe**. |
| Three alert levels | every case screen | **Critical** (documented allergy match, an ONC-listed pair, a laboratory critical value): a dialog that blocks the screen and closes only with a written reason. **Important**: a badge and a safety-card row. **Informational**: a collapsed group. An acknowledgement covers one cause and one version of its data; every one is audited. What could not be checked is always listed, never shown as safe. |
| Rule counts | More → Reference tables | How often each check fired and was acknowledged, across the device's cases (Section 10). |
| Causality | an ADR row (Task 7) | Naranjo and WHO-UMC, scored by fixed rules, beside the trainee's own category. |
| About | More → About | Every installed dataset with version, retrieval date, counts, checksum, licence and attribution (NLM's statement for RxNorm; DDInter's citation, licence and disclaimer; WHO's suggested citation, licence and the adaptation notice); the ONC list as not installed. |

## 2. Your decisions: what was applied

| # | Question | Your decision (18 October) | What the build does |
|---|---|---|---|
| 1 | Critical interaction tier | Default confirmed | ONC-listed pair = critical (takes effect when the list is installed); DDInter *Major* = important; *Moderate*, *Minor*, *Unknown* = informational. In effect with the real DDInter data. |
| 2 | Mechanism and management text | **Not answered — open** | DDInter's download files have no mechanism or management column (only the two drugs and the level). The alert says the dataset gives the level only and asks the trainee to look both up and record them in Task 6. Nothing is invented. Please confirm, or tell me otherwise. |
| 3 | High-alert medicines | Default confirmed | A flag in your formulary, with its source. No list shipped. |
| 4 | Laboratory critical values | Default confirmed | None shipped; you enter your laboratory's values with their source. KDIGO creatinine-rise criteria, cited. |
| 5 | BMI | Default confirmed | A tested calculator. |
| 6 | Vancomycin without levels | Empiric weight-based dosing, 15–20 mg/kg actual body weight, interval adjusted by Cockcroft–Gault CrCl | Built as described in Section 1. **The bands are yours to enter** (More → Reference tables), with their source; until then the calculator refuses and says why. |
| 7 | Dialysis status | Default confirmed | A structured "renal replacement therapy" timeline entry. |
| 8 | Monitoring due/overdue rule | Not mentioned | Stays deferred to M6, as proposed. |
| 9 | Infusion-rate calculator | Your two formulas | Built as described in Section 1. |
| — | Phenytoin renal threshold (Section 6 of the last report) | CrCl < 10 mL/min or on haemodialysis | Applied, as described in Section 1. |

## 3. Test results (run on 19 October 2026)

| Check | Result |
|---|---|
| TypeScript, strict (`npm run typecheck`) | No errors |
| Unit and calculator tests (`npm test`) | **566 passed** of 566, in 39 files |
| Calculator validation manifest | 20 calculators, every one with all its tests passing (176 calculator cases and 64 engine cases) |
| Production build (`npm run build`) | Built; the service worker precaches 31 files, including the three data files |
| End-to-end tests (`npm run test:e2e`, Chromium, phone size) | **34 passed**, 1 skipped (the live Gemini run, which needs a real key) — every M1 and M3 test still passes |

New tests since the last report: DDInter on the installed file (published levels of well-known pairs such as warfarin + amiodarone and clarithromycin + simvastatin, both Major; a pair outside the files reported as such; the file's checksum), AWaRe on the installed file (amoxicillin, amoxicillin–clavulanate, ceftriaxone, piperacillin–tazobactam, meropenem, linezolid, fosfomycin by route), the FDA-class regressions, the coverage and combination rules, the infusion calculators (17), vancomycin without levels (14), the interval table's validation and storage, and four new browser tests — a pair outside the files, an interaction file whose checksum does not match, the vancomycin table and calculator, and the infusion calculators inside Task 9. The browser test of the interaction levels now runs on the real DDInter and WHO data instead of a test file.

## 4. Acceptance criteria (Section 23, M2)

| # | Criterion | How it was verified | Result |
|---|---|---|---|
| 1 | Every calculator passes its published worked examples and its boundary tests | Every calculator has boundary tests (limits on both sides, units in both directions, refusal of missing and unverified inputs), all passing. **Published worked examples are in the tests for 3 of the original 17** (Cockcroft–Gault, vancomycin AUC, phenytoin); the other 14 use the published formula or point table with values computed by hand or by an independent Python implementation (`scripts/calc-crosscheck.py`). The three new calculators implement your department's formulas, so their examples are worked by hand and written out in each test's title. | **Partly met** — published examples for 14 calculators still to be added, or the independent values accepted by your reviewer |
| 2 | A calculator with a failing test does not appear in the UI | End-to-end: a build whose manifest records one failing calculator; it is absent from the list and its place says why | **Met** |
| 3 | A calculation with a missing required input is refused and names the missing field | Unit tests for every calculator; end-to-end refusals for a missing creatinine, vancomycin AUC without two levels and their times, and vancomycin without levels while the department's table is empty | **Met** |
| 4 | A documented allergy produces a critical interruptive alert; a moderate interaction does not | End-to-end: penicillin allergy, then an amoxicillin order → a dialog that blocks the screen until a reason is written; the reason is audited. **With the real DDInter data:** enoxaparin + ibuprofen (DDInter *Major*) is a badge, furosemide + ibuprofen (*Moderate*) stays in the collapsed group, and neither opens a dialog | **Met** |

Additional tests from the plan: alert de-duplication ✓; acknowledgement persistence and return when data changes ✓; override counts ✓; **AWaRe tags with the real WHO data** ✓; time-out at 48–72 h ✓; de-escalation prompt ✓; Naranjo and WHO-UMC ✓; formulary versioning and audit ✓; unrecognised names reported as not checked ✓; works offline ✓; no new network requests (CSP `connect-src` still only the app and RxNav) ✓; all M1 and M3 tests pass ✓.

## 5. Not done, known defects and limitations

- **ONC list not installed** (Section 8). No interaction is critical until it is.
- **DDInter coverage**: pairs outside the download files are "not checked" (Section 8). The levels are those of DDInter's download files (DDInter 1.0 content, 2021, re-served by DDInter 2.0); a level revised in DDInter 2.0 is not reflected.
- **No mechanism or management text** for interactions (decision 2).
- **Unmapped names**: 33 DDInter names and 56 WHO AWaRe names did not map exactly to RxNorm; an order for one of them is reported as not checked or "AWaRe not assigned".
- **Vancomycin without levels** works only once your department's bands are entered; adults only; not for dialysis, CRRT or changing creatinine; no loading dose, maximum dose or rounding.
- **Infusion calculators** check arithmetic only: the drug, its dose rate and its preparation come from the order and the hospital's protocol. The weight-based one uses the weight recorded in the case.
- **Published worked examples** for 14 calculators: see criterion 1. **No pharmacist has reviewed the test values yet**; [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md) is ready for that review.
- **openFDA label text** as supporting detail for interactions (Section 10): with the live connectors in M5.
- **Laboratory critical alerts** fire only after you enter your laboratory's values.
- **Allergy classes** are recognised for the class words in the fixtures document; any other class word is listed as "could not be checked".
- **Name matching is exact** after cleaning, by design: a misspelling or a local brand is "not checked" until it is in your formulary.
- **Antibiotic time-out** counts hospital days (started on Day 1, due from Day 3), not clock hours.
- **Critical dialog placement:** on the case screens, not inside the editors, so that a correction can be made.
- **Counts are per device** (the record never leaves the device).

## 6. Discrepancies with the specification, for your decision

| Point | The specification | What I found | What the build does |
|---|---|---|---|
| Critical interaction tier | "a DDInter major contraindicated pair" | DDInter's own paper (*Nucleic Acids Res* 2022) describes four levels — major, moderate, minor, unknown — with no "contraindicated" level | Decision 1 (ONC list = critical), confirmed by you |
| DDInter content | "DDInter 2.0 … severity, mechanism, management" | DDInter's download files hold the level only, and about half of the interactions the site reports (Section 8) | Level only, gaps listed as not checked |
| Vancomycin no-level path | "a documented no-level nomogram path" | Your decision names the method (15–20 mg/kg, interval by CrCl) but not the bands | The department's own table, with its source on every result |
| RxNav interaction API | discontinued "2 January 2024" | Not confirmed from a source reachable here | Not used either way |

## 7. How to see it

On a synthetic Teaching Case:

1. **Calculators** — Case → Calculators, or Task 8: CrCl with the weight basis you choose ([m2-02](screenshots/m2-02-crcl-result.png)); out of date after a new creatinine ([m2-03](screenshots/m2-03-crcl-recalculated.png)); vancomycin AUC from two levels ([m2-05](screenshots/m2-05-vancomycin.png)); a calculator whose tests failed is hidden ([m2-07](screenshots/m2-07-hidden-calculator.png)).
2. **Infusion rates** — Task 9: 5 mcg/kg/min, 70 kg, 1.6 mg/mL → 13.1 mL/h, with the conversion to 1600 mcg/mL shown; 1000 mL over 8 h → 125 mL/h ([m2-19](screenshots/m2-19-infusion-rates.png)).
3. **Vancomycin without levels** — More → Reference tables → Vancomycin dosing intervals: enter your bands with their source ([m2-17](screenshots/m2-17-vancomycin-interval-table.png); the bands in the screenshot are a synthetic test table, not a recommendation). Then Task 10 → "Vancomycin without levels" ([m2-18](screenshots/m2-18-vancomycin-no-level.png)).
4. **Interactions and AWaRe with the real data** — order enoxaparin, ibuprofen, furosemide and ceftriaxone: enoxaparin + ibuprofen is a *Major* badge, furosemide + ibuprofen a collapsed *Moderate* note, ceftriaxone is tagged *Watch*, and the safety card lists what could not be checked ([m2-10](screenshots/m2-10-interaction-levels.png)).
5. **Critical alert** — a penicillin allergy, then amoxicillin: the dialog ([m2-08](screenshots/m2-08-critical-allergy-alert.png)) and the safety card ([m2-09](screenshots/m2-09-safety-card.png)).
6. **Formulary** — a local brand (Megamox) is "not checked" until it is in your formulary ([m2-11](screenshots/m2-11-formulary-editor.png), [m2-12](screenshots/m2-12-reference-hub.png)).
7. **Causality** — Naranjo and WHO-UMC beside your own category ([m2-13](screenshots/m2-13-naranjo.png), [m2-14](screenshots/m2-14-adr-causality.png)).
8. **About** — the installed datasets with their licences, and the ONC list as not installed ([m2-15](screenshots/m2-15-about-datasets.png)); Arabic ([m2-16](screenshots/m2-16-safety-arabic.png)).

## 8. What I need from you

1. **The ONC list.** Either upload the paper here (Phansalkar S, et al. High-priority drug–drug interactions for use in electronic health records. *J Am Med Inform Assoc* 2012;19(5):735–743), and I will build the list from its table, with every pair shown to you for checking; or make the network change take effect for this work (it may need a new session) for the hosts in Section 9.
2. **DDInter's missing pairs.** Choose one: (a) you allow me to retrieve them from DDInter's site, slowly (one request at a time, about a second apart), with attribution and the same licence — this environment's safety check stopped my first step, so it needs your explicit permission here and may also need a permission rule in the session's settings; (b) you or the department ask DDInter for the complete files (their site has a contact page); or (c) keep the gap, reported as "not checked".
3. **Decision 2**: confirm "level only", with the mechanism and management recorded by the trainee from their reference.
4. **Your vancomycin bands**, entered in the app with their source — or send me the table, and I will add it to the tests so the calculator is checked against your numbers.
5. **A pharmacist's review** of [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md) (criterion 1).
6. **Approval or changes.** M2 is not complete until the ONC list is installed; tell me whether to finish it in M2 once it can be obtained, or how you want to proceed.

## 9. Network access

Reachable and used: `rxnav.nlm.nih.gov` (RxNorm and RxClass), `ddinter2.scbdd.com` (DDInter download files), `iris.who.int` (AWaRe 2025). Still refused from this session on 19 October 2026: `eutils.ncbi.nlm.nih.gov`, `www.ncbi.nlm.nih.gov`, `pubmed.ncbi.nlm.nih.gov`, `europepmc.org`, `www.ebi.ac.uk`, `academic.oup.com`; `pmc.ncbi.nlm.nih.gov` answers with a reCAPTCHA browser check.

## 10. Files

- Engine and calculators: `src/calc/` (with `validation-manifest.json`, written by the test run); tests in `tests/calc/`; independent cross-check `scripts/calc-crosscheck.py`; manifest plugin `scripts/calc-validation.ts` and reporter `scripts/calc-manifest-reporter.ts`. New: `src/calc/calculators/infusion.ts`, `src/calc/calculators/vancomycin-empiric.ts`.
- Drug data: `public/data/rxnorm-subset.json`, `public/data/ddinter-interactions.json`, `public/data/who-aware-2025.json`, their manifest `src/data/datasets.json`; built by `npm run data:build` (`scripts/data/`: `build-rxnorm.mjs`, `build-epc.mjs`, `build-ddinter.mjs`, `build-aware.mjs`); mapping reports in `docs/m2/datasets/`; loaders `src/drugs/`; dataset plugin `scripts/datasets-plugin.ts`.
- Rules: `src/rules/` (engine, allergy class words, causality).
- Reference tables: `src/domain/reference.ts`; screens `src/ui/screens/Reference.tsx`; safety views `src/ui/rules/`.
- Fixtures document generator: `scripts/fixtures-doc.ts` (`npm run docs:fixtures`).
