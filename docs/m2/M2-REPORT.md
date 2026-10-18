# PRECEPTOR — M2 report: calculation and rules

**Date:** 18 October 2026 · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.4.0 (M2)

**Status: built and tested, but not complete as the specification defines M2.** Two parts are blocked, and Section 22 says to stop and report a blocker rather than present a simplified milestone as complete:

1. **Interaction and AWaRe data.** M2 requires "DDInter and ONC data loaded locally, AWaRe tagging". The checking, the three alert levels, the loaders and the integrity checks are built and tested, but the data itself — DDInter 2.0, the ONC high-priority list and the WHO AWaRe 2025 classification — could not be downloaded: this environment's network policy blocks their publishers' sites (Section 9 below lists the hosts). Until the data is installed, every case says plainly that interactions and AWaRe categories were **not checked**.
2. **Vancomycin without levels.** Section 9 asks for "a documented no-level nomogram path for the low-resource setting". It needs a published method that you choose (M2 plan, decision 6); it is not built.

Everything else in M2 is built, tested and shown below. Nothing is claimed that was not verified. I am waiting for your decisions before going further.

The plan, with the decisions it asked for, is in [M2-PLAN.md](M2-PLAN.md). Every calculator's test cases, the origin of each test value and every plausibility range are in [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md), generated from the code and an actual test run, for review by a qualified pharmacist.

---

## 1. What was built

| Part | Where in the app | What it does |
|---|---|---|
| Calculation engine | `src/calc/` | One contract for every calculator (Section 9): formula version, citation, required and optional inputs with their accepted units, physiologic plausibility ranges and definitional limits, `validate`, `compute`, `explain`, limitations, `validated`. Units converted explicitly in both directions; an unknown unit is rejected. A value outside the plausible range is used only after the trainee confirms it, with value and unit shown. A missing input, or one still waiting in the document review, is refused by name. |
| 17 calculators | Case → Calculators, and inside Tasks 3, 6, 8, 9, 10, 11, 14, 27 | CrCl (Cockcroft–Gault, weight basis chosen and recorded), eGFR CKD-EPI 2021 (labelled a staging tool, never for dosing), IBW/AdjBW (factor recorded), BSA, **BMI** (decision 5), QTc Bazett and Fridericia (always together), anion gap with albumin correction, corrected calcium, corrected phenytoin with the renal-failure form, Child–Pugh, CURB-65, qSOFA, CHA₂DS₂-VASc, HAS-BLED, ANC, vancomycin AUC₂₄ (two levels, Sawchuk–Zaske). Every result shows its formula, the values used with where each came from, the units, the steps and the assumptions; it is stored as a new record (never overwritten) and marked out of date when its inputs change. |
| Validation manifest | build time | The test run records, per calculator and formula version, how many tests passed; the build reads the record and a hash of the engine's code and tests. A calculator without a passing record, or after any engine change not yet re-tested, is **hidden** with the reason. |
| Verify gate | Task 8 | The renal dose review stays locked until age, weight, sex, serum creatinine with its date, dialysis status, current dose and route, and indication are recorded (Section 8's example). Dialysis status is a structured "renal replacement therapy" entry (decision 7). |
| Department form, Section 1 | Case → Form | BMI and CrCl/eGFR come only from stored calculation results, marked out of date when the record has moved on. Never typed. |
| Offline drug vocabulary | built in | RxNorm prescribable ingredients (5,874), precise ingredients, combinations and brands (4,140), 99 international names confirmed by RxNav, 672 FDA Established Pharmacologic Classes and 23 VA antimicrobial classes. Served by the app itself, cached for offline use, and **refused if its SHA-256 does not match**. Names are matched exactly after cleaning (strength, form, combinations) — no fuzzy guessing; an unrecognised name is reported as "not checked". |
| Local formulary and reference tables | More → Reference tables | The trainee's own: formulary items (generic name matched to RxNorm on screen, local brands, strengths, forms, availability, **high-alert flag with its source** — decision 3), the renal and hepatic adjustment table (threshold and measure as the trainee's source states it, with page or URL; PRECEPTOR never computes the adjusted dose), and the laboratory's critical values (none shipped — decision 4). Each record is versioned and audited; a change needs a reason; removal is a new version with a reason. An unrecognised medication name offers "Add it to your formulary" with the name filled in as a brand. |
| Rules engine | `src/rules/engine.ts` | Deterministic, offline, no model. Allergy or previous ADR against inpatient, home and discharge medicines, by ingredient and by drug class (class words such as "penicillin", "sulfa", "NSAIDs" are listed in the fixtures document); therapeutic duplication; high-alert flag; laboratory critical value (the trainee's thresholds, with unit conversion); creatinine rise (KDIGO, cited); renal and hepatic adjustment required (the trainee's table); dose assessment blocked by missing data (Verify gate) or an out-of-date result; antibiotic time-out at 48–72 hours; de-escalation prompt after a culture result; interactions and AWaRe (built, waiting for data). |
| Three alert levels | every case screen | **Critical** (documented allergy match, an ONC-listed pair, a laboratory critical value): a dialog that blocks the screen and closes only with a written reason — or by going to change the order or correct the record. **Important**: a badge on the medicine and a row on the safety card. **Informational**: a collapsed group. An acknowledgement covers one cause and one version of its data: the same alert does not return, new data brings it back. Every acknowledgement is in the audit log with its reason. What could not be checked is always listed, never shown as safe. |
| Rule counts | More → Reference tables | How often each check fired (first appearance for one cause and data version) and how often it was acknowledged, across the device's cases (Section 10). |
| Causality | an ADR row (Task 7) | Naranjo (10 questions, the published points shown beside each answer) and WHO-UMC (criteria → category by fixed rules, with the criteria that decided it). Nothing is pre-filled; every save is a new version and is audited. The trainee's own WHO-UMC category on the row stays as written; a difference is shown, never overwritten. |
| Form Section 7 | Case → Form | PRECEPTOR's automatic check is a separate block, each row with its source, never mixed with the trainee's rows; today it says the check could not be made. |
| About | More → About | Every installed dataset with version, retrieval date, counts, checksum, licence and attribution (NLM's required statement for RxNorm); the datasets not installed, and what that means. |

Task worksheets show the alerts that belong to them (Task 4 duplication, Task 6 interactions, Task 7 allergy, Task 8 renal and hepatic adjustment and blocked dose assessments, Task 11 laboratory values, Task 14 stewardship, Task 28 high-alert medicines); where a task reviews the medicines one by one (Tasks 8, 14 and 28), each medicine's row carries its own alerts. An interaction flag can be copied into the trainee's own interaction register only by tapping "Record it in your interaction register" — only the drug names are carried over; the severity, management and source stay the trainee's to write.

## 2. Your decisions: what was applied

You said "go ahead" without answering the nine questions of the plan's Section 5, so I used the plan's proposed defaults where the work could not wait, and stopped where a choice is truly yours. **Please confirm or change each.**

| # | Question | What the build does now |
|---|---|---|
| 1 | Critical interaction tier (DDInter has no "contraindicated" level) | Proposed default applied in the engine: ONC-listed pair = critical; DDInter *Major* = important; *Moderate*, *Minor*, *Unknown* = informational ("severity not graded"). It takes effect when the data is installed. |
| 2 | Mechanism and management text if DDInter lacks them | Shown as "not given by the dataset" — nothing invented. Decide when the data is installed and we can see its columns. |
| 3 | High-alert medicines | Proposed default: a flag in your formulary, with its source. No list shipped. |
| 4 | Laboratory critical values | Proposed default: none shipped; you enter your hospital's values with their source. KDIGO creatinine-rise criteria used, cited. |
| 5 | BMI | Proposed default: added as the 17th calculator, tested like the others. |
| 6 | Vancomycin without levels | **Not built** — needs the published method you choose. |
| 7 | Dialysis status | Proposed default: a structured "renal replacement therapy" timeline entry (none, intermittent haemodialysis, peritoneal dialysis, CRRT). |
| 8 | Monitoring due/overdue rule | Deferred to M6, as proposed. |
| 9 | Infusion-rate calculator (Task 9) | **Not built** — waiting for your choice: add it as a tested calculator, or keep Task 9 as your own calculation record. |

## 3. Test results (run on 18 October 2026)

| Check | Result |
|---|---|
| TypeScript, strict (`npm run typecheck`) | No errors |
| Unit and calculator tests (`npm test`) | **511 passed** of 511, in 36 files. M2's share: 206 calculator and engine tests (`tests/calc/`, 13 files: 145 calculator cases + 61 engine cases), rules 27, rules store 6, causality 12, calculation store 15, drug vocabulary 7, dataset loaders 4, and the form and readiness additions |
| Production build (`npm run build`) | Built; the service worker precaches 29 files, including the drug vocabulary |
| End-to-end tests (`npm run test:e2e`, Chromium, phone size) | **30 passed**, 1 skipped (the live Gemini run, which needs a real key) — 11 new for M2, and every M1 and M3 test still passes |
| Mutation checks | A safeguard switched off on purpose, to see that a test notices: a documented allergy downgraded from critical (6 tests failed); the reason requirement removed from acknowledgements (1 failed); a calculator formula changed (its tests failed and the manifest hid it — earlier in M2). Each was restored. |

The M2 end-to-end tests (`e2e/m2-calc.spec.ts`, `e2e/m2-safety.spec.ts`, `e2e/m2-reference.spec.ts`, and an addition to `e2e/offline-restart.spec.ts`) check, among others: that only the app's own origin is contacted during the safety checks and that the page reports no Content-Security-Policy violation (the policy itself is unchanged: `connect-src` still lists only the app and RxNav); that the new screens fit a phone's width; and that the safety checks run with the network gone.

## 4. Acceptance criteria (Section 23, M2)

| # | Criterion | How it was verified | Result |
|---|---|---|---|
| 1 | Every calculator passes its published worked examples and its boundary tests | Every calculator has boundary tests (plausible and definitional limits on both sides, units in both directions, refusal of missing and unverified inputs) and all 145 calculator cases pass. **Published worked examples are in the tests for 3 of the 17** (Cockcroft–Gault, vancomycin AUC, phenytoin). For the other 14, the tests use the published formula or point table with values computed by hand or by an independent Python implementation (`scripts/calc-crosscheck.py`), as the M2 plan allowed where no published example was available to me. | **Partly met** — boundary tests met; published examples for 14 calculators still to be added (or the independent values accepted by your reviewer) |
| 2 | A calculator with a failing test does not appear in the UI | End-to-end: a build whose manifest records one failing calculator; the calculator is absent from the list and its place says why | **Met** |
| 3 | A calculation with a missing required input is refused and names the missing field | Unit tests for every calculator; end-to-end refusals for a missing creatinine and for vancomycin without two levels and their times | **Met** |
| 4 | A documented allergy produces a critical interruptive alert; a moderate interaction does not | End-to-end: penicillin allergy, then an amoxicillin order → a dialog that blocks the screen and does not close without a reason; the reason is audited; the acknowledgement holds after reload; a second penicillin-class order interrupts again; a local brand (Megamox) is caught once it is in the formulary. The moderate interaction stays in the collapsed group and a major one is a badge, with no dialog — **verified only with a test file marked as test data**, because DDInter is not installed | **Allergy part met; interaction part verified with test data only** — real verification needs the DDInter data |

Additional tests from the plan: alert de-duplication ✓; acknowledgement persistence and return when data changes ✓; override counts ✓; time-out at 48–72 h ✓; de-escalation prompt on a culture result ✓; Naranjo and WHO-UMC against their scoring tables ✓; formulary versioning and audit ✓; unrecognised names reported as not checked ✓; works offline ✓; no new network requests (CSP `connect-src` still only the app and RxNav) ✓; all M1 and M3 tests pass ✓; AWaRe tags — engine tested with test data only, **data not installed**.

## 5. Not done, known defects and limitations

- **DDInter 2.0, ONC list, WHO AWaRe 2025:** not installed (blocked by the network). Their licences (CC BY-NC-SA) will be shown on the About screen when they are.
- **Vancomycin no-level path** (decision 6) and **infusion-rate calculator** (decision 9): not built.
- **Published worked examples** for 14 calculators: see criterion 1.
- **openFDA label text** as supporting detail for interactions (Section 10): planned with the live connectors in M5.
- **No pharmacist has reviewed the test values yet.** [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md) is ready for that review.
- **Laboratory critical alerts** fire only after you enter your laboratory's values; none are shipped.
- **Allergy classes** are recognised for the class words in the fixtures document; any other class word is listed as "could not be checked", never as safe.
- **Name matching is exact** after cleaning, by design: a misspelling or a local brand is "not checked" until it is in your formulary.
- **Antibiotic time-out** counts hospital days (started on Day 1, due from Day 3), not clock hours.
- **Critical dialog placement:** it appears on the case screens (hub, timeline, tasks, calculators, form), not inside the editors, so that a correction can be made; it returns, if still relevant, after the save.
- **Counts are per device** (the record never leaves the device).

## 6. Discrepancies with the specification, for your decision

| Point | The specification | What I found | What the build does |
|---|---|---|---|
| Critical interaction tier | "a DDInter major contraindicated pair" | The sources reachable during planning describe DDInter's grades as Major, Moderate, Minor and Unknown, with no "contraindicated" grade; this could not be confirmed on DDInter's own site, which is blocked here | Decision 1's proposal (ONC list = critical) |
| Phenytoin renal branch | "Separate branch for renal impairment" | Sources differ on when the renal-failure form applies: creatinine clearance thresholds from 10 to 25 mL/min are used, and some sources say "on haemodialysis" | The trainee answers "severe renal failure" from the record, and the app states that sources differ; tell me which definition the department uses |
| RxNav interaction API | discontinued "2 January 2024" | The date could not be confirmed from sources reachable here | Not used either way |

## 7. How to see it

On a synthetic Teaching Case:

1. **Calculators** — Case → Calculators, or Task 8: CrCl with the weight basis you choose; every value with its source, the formula and the steps ([m2-02](screenshots/m2-02-crcl-result.png)); add a new creatinine and the result is marked out of date ([m2-03](screenshots/m2-03-crcl-recalculated.png)); vancomycin AUC from two levels with their times ([m2-05](screenshots/m2-05-vancomycin.png)); a calculator whose tests failed is hidden with the reason ([m2-07](screenshots/m2-07-hidden-calculator.png)).
2. **Critical alert** — record an allergy to penicillin, then order amoxicillin: the dialog ([m2-08](screenshots/m2-08-critical-allergy-alert.png)); acknowledge with a reason; the case hub's safety card shows it with your reason and lists what could not be checked ([m2-09](screenshots/m2-09-safety-card.png)).
3. **Formulary** — order a local brand (e.g. Megamox): "not recognised — not checked"; tap "Add it to your formulary", write the generic name, see the RxNorm match ([m2-11](screenshots/m2-11-formulary-editor.png)); the allergy check now sees through the brand; the counts ([m2-12](screenshots/m2-12-reference-hub.png)).
4. **Causality** — Task 7 → add a suspected ADR → Naranjo ([m2-13](screenshots/m2-13-naranjo.png)) and WHO-UMC, beside your own category ([m2-14](screenshots/m2-14-adr-causality.png)).
5. **About** — the datasets, their licences and what is not installed ([m2-15](screenshots/m2-15-about-datasets.png)); the same screens in Arabic ([m2-16](screenshots/m2-16-safety-arabic.png)).

The interaction display with test data is in [m2-10](screenshots/m2-10-interaction-levels-test-fixture.png): **the two interactions there are test records, not clinical data** — the screen says so in their source line.

## 8. What I need from you

1. **Network access** so the interaction and AWaRe data can be downloaded and installed (Section 9).
2. **Decisions 1–9** in Section 2: confirm the defaults, and choose for 6 and 9.
3. **The phenytoin renal threshold** your department uses (Section 6).
4. **Approval or changes.** M2 is not complete until the blocked parts are done; tell me whether to finish them in M2 when access is granted, or how you want to proceed.

## 9. Network access needed

Allow these hosts in the environment's network settings: `ddinter2.scbdd.com` and `ddinter.scbdd.com` (DDInter 2.0), `pmc.ncbi.nlm.nih.gov` (the ONC list's published paper), `www.who.int` and `iris.who.int` (AWaRe 2025), and, for the official RxNorm release files, `download.nlm.nih.gov`, `www.nlm.nih.gov` and `lhncbc.nlm.nih.gov`. RxNav (`rxnav.nlm.nih.gov`) is already reachable and was used to build the drug vocabulary.

## 10. Files

- Engine and calculators: `src/calc/` (with `validation-manifest.json`, written by the test run); tests in `tests/calc/`; independent cross-check `scripts/calc-crosscheck.py`; manifest plugin `scripts/calc-validation.ts` and reporter `scripts/calc-manifest-reporter.ts`.
- Drug data: `public/data/rxnorm-subset.json`, its manifest `src/data/datasets.json`, built by `scripts/data/build-rxnorm.mjs`; loaders `src/drugs/`; dataset plugin `scripts/datasets-plugin.ts`.
- Rules: `src/rules/` (engine, allergy class words, causality).
- Reference tables: `src/domain/reference.ts`; screens `src/ui/screens/Reference.tsx`; safety views `src/ui/rules/`.
- Fixtures document generator: `scripts/fixtures-doc.ts` (`npm run docs:fixtures`).
