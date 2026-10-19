# PRECEPTOR — M2 report: calculation and rules (final)

**Date:** 19 October 2026 · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.4.0 (M2)

**Status: built and tested, with every decision you made on 18 and 19 October 2026 applied.** Acceptance criteria 2, 3 and 4 are met. Criterion 1 is met for the boundary tests; for worked examples it rests on values computed by hand or by an independent implementation, which still need a pharmacist's review (Section 5). I recommend accepting M2 with that review as a follow-up, but that is your decision. I am waiting for your approval before starting M4.

The plan is in [M2-PLAN.md](M2-PLAN.md). Every calculator's test cases, the origin of each test value and every plausibility range are in [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md), generated from the code and an actual test run, for review by a qualified pharmacist. How every dataset name was mapped to RxNorm, and what could not be mapped, is in [datasets/](datasets/).

---

## 1. Your decisions of 19 October 2026, and what was done

| Your decision | What the build does |
|---|---|
| **ONC list:** stop trying to download it; let the administrator enter it in the app | **More → Reference tables → ONC high-priority interactions.** Each pair has its wording as the source gives it, two sides and the reference (page or table). A side names single-ingredient drugs or drug classes, separated by commas; each name is matched on screen, as you type, to one RxNorm ingredient or to an FDA Established Pharmacologic Class or VA class (singular or plural), with the number of drugs the class holds. A name that is not recognised, or a combination product, blocks the save — nothing is guessed. Every record is versioned and audited; removal is a new version with a reason. Two medicines under an entered pair are a **critical** alert (the blocking dialog), with DDInter's level when it has one, or "not in DDInter's download files"; until a pair is entered, the app says that no interaction is raised to critical. Nothing is shipped: the list is entered on the device. |
| **DDInter coverage:** option (c), keep the gap declared; no scraping | Nothing was downloaded beyond DDInter's official files. A pair outside them is listed as **not checked**, never as safe. Your warning is shown, fixed and not dismissible, in Task 6, on the case's safety card and in Section 7 of the department form: *"Warning: the database is not connected to the internet and does not include all drug groups, such as cardiac drugs. The trainee must check interactions in the hospital's approved references, such as Lexicomp or Micromedex."* (Arabic: your own wording.) Section 4 of the specification forbids integrating those references or claiming they were consulted; telling the trainee to check them through the hospital's own access does neither, and nothing from them is in the app. |
| **Decision 2:** the app gives the severity only; the trainee looks up and writes the mechanism and the management in Task 6 | Every interaction alert gives DDInter's level and says: "PRECEPTOR gives the level only: look up the mechanism and the management in your hospital's approved reference and write them in Task 6." In Task 6's interaction register, **Mechanism** and **Management plan** are now required, with a hint that the trainee writes them from the hospital's reference. The AI drafts (M3) no longer propose the mechanism, the clinical effect or the management of an interaction (as they already never proposed its severity or its source); they can still suggest a pair to check, its type and its relevance for the patient, each accepted or rejected by the trainee item by item. |
| **Vancomycin intervals:** your table, built in | Built into the calculator "Vancomycin without levels": CrCl **above 90 mL/min → every 8 h**; **50–90 → every 12 h**; **20–49 → every 24 h**; **below 20, or on dialysis → one dose, then dosing by levels.** CrCl is Cockcroft–Gault with the trainee's recorded weight basis, compared with the table as a whole number, as it is shown — so the bands meet without a gap (49 → 24 h, 50 → 12 h). "On dialysis" is asked as one question covering intermittent haemodialysis, peritoneal dialysis and CRRT; on dialysis Cockcroft–Gault is neither asked for nor used. The dose is 15–20 mg/kg of actual body weight (your decision 6). For "one dose" the result gives that single dose, with no interval and no daily dose, and says to measure the level and set the next doses from it with the preceptor. Every result shows the band it used and cites your decision. The trainee-entered interval table of the previous version is removed from the screens; its storage is kept unused, so nothing a device held is deleted. |

**Please check one reading of mine:** I treated CRRT and peritoneal dialysis as "dialysis" in your table (one dose, then levels). Tell me if CRRT should be handled differently.

## 2. What M2 contains

| Part | Where in the app | What it does |
|---|---|---|
| Calculation engine | `src/calc/` | One contract for every calculator (Section 9): formula version, citation, required and optional inputs with their accepted units, plausibility ranges and definitional limits, `validate`, `compute`, `explain`, limitations, `validated`. Units converted explicitly in both directions; an unknown unit is rejected. A value outside the plausible range is used only after the trainee confirms it. A missing input, or one still waiting in the document review, is refused by name. An input can be asked only for some answers (the creatinine inputs only when the patient is not on dialysis). |
| **20 calculators** | Case → Calculators, and inside Tasks 3, 6, 8, 9, 10, 11, 14, 27 | CrCl (Cockcroft–Gault, weight basis chosen and recorded), eGFR CKD-EPI 2021 (staging only, never dosing), IBW/AdjBW, BSA, BMI, QTc Bazett and Fridericia (always together), anion gap with albumin correction, corrected calcium, corrected phenytoin (your renal-failure definition), Child–Pugh, CURB-65, qSOFA, CHA₂DS₂-VASc, HAS-BLED, ANC, vancomycin AUC₂₄ (two levels, Sawchuk–Zaske), **vancomycin without levels** (your table), **infusion rate weight-based** and **volume over time** (your formulas). Every result shows its formula, the values used with where each came from, the units, the steps and the assumptions; it is stored as a new record (never overwritten) and marked out of date when its inputs change. High-risk calculations (vancomycin, phenytoin, weight-based infusion) carry extended tests and the escalation message. |
| Validation manifest | build time | A calculator without a passing test record, or after any engine change not yet re-tested, is **hidden** with the reason. |
| Verify gate | Task 8 | The renal dose review stays locked until age, weight, sex, serum creatinine with its date, dialysis status, current dose and route, and indication are recorded. |
| Department form, Sections 1 and 7 | Case → Form | BMI and CrCl/eGFR come only from stored calculation results. Section 7 keeps PRECEPTOR's automatic check (with its source, its gaps and your warning) apart from the trainee's own rows. |
| Offline drug vocabulary | built in | RxNorm prescribable ingredients (5,874), precise ingredients (1,654), multiple-ingredient concepts (954), brands (4,140), 99 international names, 315 further ingredients named by DDInter or WHO (e.g. acenocoumarol), 632 FDA Established Pharmacologic Classes (direct members) with 106 grouping classes used only to widen an allergy class word, and 23 VA antimicrobial classes. Exact matching after cleaning — no fuzzy guessing; an unrecognised name is "not checked". |
| **DDInter interactions** | `public/data/ddinter-interactions.json` | DDInter's 8 download files (222,383 rows, 160,235 drug pairs) mapped to RxNorm: **146,697 ingredient pairs** — Major 25,258, Moderate 85,820, Minor 5,832, Unknown 29,787. Major → **important**; Moderate, Minor, Unknown → **informational**. A pair with no record counts as checked only when the files hold all of one drug's DDInter partners (801 "anchored" ingredients, e.g. warfarin); otherwise it is listed as not checked. |
| **WHO AWaRe 2025** | `public/data/who-aware-2025.json` | 209 categories (Access 71, Watch 112, Reserve 26) from WHO's 268 entries; a combination as a whole, a route-specific entry by the order's route (fosfomycin by mouth Watch, IV Reserve). Every antimicrobial order shows its category; 56 WHO names RxNorm does not hold show "AWaRe not assigned". |
| Integrity | every data file | Served by the app, cached for offline use, and **refused if its SHA-256 does not match** the manifest; the check is then reported as not made. |
| Reference tables | More → Reference tables | The trainee's formulary (local brands, high-alert flag with its source), renal and hepatic adjustment table, laboratory critical values, and the **ONC list** entered by the administrator. Versioned and audited; none of their content is shipped. |
| Rules engine | `src/rules/` | Deterministic, offline, no model: allergy or previous ADR by ingredient and drug class; duplication; high-alert flag; laboratory critical value; creatinine rise (KDIGO); renal and hepatic adjustment; dose assessment blocked by missing data; antibiotic time-out at 48–72 hours; de-escalation prompt after a culture; DDInter interactions; the ONC list; AWaRe. |
| Three alert levels | every case screen | **Critical** (documented allergy, ONC pair, laboratory critical value): a dialog that blocks the screen and closes only with a written reason. **Important**: a badge and a safety-card row. **Informational**: a collapsed group. Acknowledgements are audited and hold for one version of the data. What could not be checked is always listed. |
| Causality | an ADR row (Task 7) | Naranjo and WHO-UMC, scored by fixed rules, beside the trainee's own category. |
| About | More → About | Each dataset with version, retrieval date, counts, checksum, licence and attribution; the ONC list as entered or not entered on the device. |

## 3. Your decisions: the complete record

| # | Question | Decision | In the build |
|---|---|---|---|
| 1 | Critical interaction tier | Default confirmed (18 Oct) | ONC pair = critical; DDInter Major = important; others informational |
| 2 | Mechanism and management | Level only; the trainee writes both (19 Oct) | As in Section 1 |
| 3 | High-alert medicines | Default confirmed | A flag in the formulary, with its source |
| 4 | Laboratory critical values | Default confirmed | None shipped; entered with their source |
| 5 | BMI | Default confirmed | A tested calculator |
| 6 | Vancomycin without levels | Method (18 Oct), table (19 Oct) | As in Section 1 |
| 7 | Dialysis status | Default confirmed | A structured "renal replacement therapy" timeline entry |
| 8 | Monitoring due/overdue rule | Not changed | Deferred to M6, as proposed |
| 9 | Infusion rates | Your two formulas | Two calculators, as in Section 2 |
| — | Phenytoin renal threshold | CrCl < 10 mL/min or on haemodialysis | Stated with the question; "Yes" uses the renal-failure form (measured level ÷ (0.1 × albumin + 0.1)); the cited caveat about haemodialysis patients (Soriano et al. 2017) stays with the result |
| — | ONC list | Entered by the administrator (19 Oct) | As in Section 1 |
| — | DDInter coverage | Keep the gap declared, with your warning (19 Oct) | As in Section 1 |

## 4. Test results (run on 19 October 2026)

| Check | Result |
|---|---|
| TypeScript, strict (`npm run typecheck`) | No errors |
| Unit and calculator tests (`npm test`) | **574 passed** of 574, in 40 files |
| Calculator validation manifest | 20 calculators, every one with all its tests passing (176 calculator cases and 64 engine cases) |
| Production build (`npm run build`) | Built; the service worker precaches 31 files, including the three data files |
| End-to-end tests (`npm run test:e2e`, Chromium, phone size) | **35 passed**, 1 skipped (the live Gemini run, which needs a real key) — every M1 and M3 test still passes |

New since the report of 18 October: the department's table in the vancomycin calculator (every band edge, dialysis, refusals; 14 tests), the ONC list (name resolution, matching in either order and through a class, critical alerts with and without DDInter's level, acknowledgement tied to the entry's version; 7 tests, and its storage, validation and audit), the AI drafts no longer carrying an interaction's mechanism, effect or management, DDInter and AWaRe on the installed files, the infusion calculators (17 tests), and these browser tests: the ONC entry screen and the critical alert it causes, the vancomycin calculator in Task 10, the infusion calculators in Task 9, a pair outside DDInter's files, a data file whose checksum does not match, and your warning in Task 6, on the safety card and in Form Section 7.

## 5. Acceptance criteria (Section 23, M2)

| # | Criterion | How it was verified | Result |
|---|---|---|---|
| 1 | Every calculator passes its published worked examples and its boundary tests | Every calculator has boundary tests (limits on both sides, units in both directions, refusal of missing and unverified inputs), all passing. Published worked examples are in the tests of Cockcroft–Gault, vancomycin AUC and phenytoin. The other 14 of the specification's calculators are tested against the published formula or point table with values computed by hand or by an independent Python implementation (`scripts/calc-crosscheck.py`); the papers with worked examples could not be reached from the build environment. The three calculators that implement your department's formulas and table are tested against hand-worked examples, written out in each test. | **Met for boundary tests; worked examples pending a pharmacist's review** of [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md) (or published examples added later) |
| 2 | A calculator with a failing test does not appear in the UI | End-to-end: a build whose manifest records one failing calculator; it is absent and its place says why | **Met** |
| 3 | A calculation with a missing required input is refused and names the missing field | Unit tests for every calculator; end-to-end refusals for a missing creatinine and for vancomycin AUC without two levels and their times | **Met** |
| 4 | A documented allergy produces a critical interruptive alert; a moderate interaction does not | End-to-end: penicillin allergy, then amoxicillin → a blocking dialog until a reason is written, audited. With the real DDInter data: enoxaparin + ibuprofen (*Major*) is a badge, furosemide + ibuprofen (*Moderate*) stays collapsed, neither opens a dialog. And an entered ONC pair does open one | **Met** |

Additional tests from the plan: alert de-duplication ✓; acknowledgement persistence and return when data changes ✓; override counts ✓; AWaRe tags with the real WHO data ✓; time-out at 48–72 h ✓; de-escalation prompt ✓; Naranjo and WHO-UMC ✓; reference-table versioning and audit ✓; unrecognised names reported as not checked ✓; works offline ✓; no new network requests (CSP `connect-src` still only the app and RxNav) ✓; all M1 and M3 tests pass ✓.

## 6. Known limitations

- **The ONC list is per device.** It is entered on the device that uses it, like the formulary; it is not shared between devices. If you want the same list on every trainee's device, send me the entered list (or the paper) and I can ship it as a data file — the loader for a shipped list is already built.
- **DDInter's download files** hold about half of the interactions DDInter reports; the rest is reported as not checked, with your warning. The levels are those of the download files (DDInter 1.0 content, 2021). 33 DDInter names and 56 WHO AWaRe names did not map exactly to RxNorm; an order for one of them is reported as not checked or "AWaRe not assigned".
- **Vancomycin without levels** is for adults; not reliable while creatinine is changing; no loading dose, maximum dose or rounding (the hospital's protocol).
- **Infusion calculators** check arithmetic only; the drug, its dose rate and its preparation come from the order and the hospital's protocol.
- **No pharmacist has reviewed the test values yet** (criterion 1).
- **openFDA label text** as supporting detail for interactions: with the live connectors in M5.
- **Laboratory critical alerts** fire only after your laboratory's values are entered.
- **Name matching is exact** after cleaning, by design; a misspelling or a local brand is "not checked" until it is in the formulary.
- **Antibiotic time-out** counts hospital days, not clock hours.
- **Counts are per device** (the record never leaves the device).

## 7. Discrepancies with the specification, and how they were settled

| Point | The specification | What I found | Settled |
|---|---|---|---|
| Critical interaction tier | "a DDInter major contraindicated pair" | DDInter's paper describes four levels (major, moderate, minor, unknown), no "contraindicated" | Your decision 1: the ONC list is critical |
| DDInter content | "severity, mechanism, management" | The download files hold the level only, and about half of the interactions | Your decision 2 and option (c) |
| ONC list | "loaded locally" | Its publisher could not be reached from the build environment | Entered by the administrator (your decision of 19 October) |
| Vancomycin no-level path | "a documented no-level nomogram path" | Needed a table | Your table, built in, cited on every result |
| RxNav interaction API | discontinued "2 January 2024" | Not confirmed from a reachable source | Not used either way |

## 8. How to see it

On a synthetic Teaching Case:

1. **ONC list** — More → Reference tables → ONC high-priority interactions → Add: type a pair; each name shows what it matched ([m2-17](screenshots/m2-17-onc-entry.png); the pair in the screenshot is a test entry, not the ONC list). Then order the two medicines in a case: the critical dialog.
2. **Interactions** — order enoxaparin, ibuprofen, furosemide and ceftriaxone: your warning, the *Major* badge, the collapsed *Moderate* note, ceftriaxone tagged *Watch*, and what could not be checked ([m2-10](screenshots/m2-10-interaction-levels.png)). Task 6 shows the same warning; its register asks for the mechanism and the management.
3. **Vancomycin without levels** — Task 10: a 67-year-old woman, 60 kg, creatinine 1.1 mg/dL → CrCl 47 → every 24 h, 900 mg at 15 mg/kg ([m2-18](screenshots/m2-18-vancomycin-no-level.png)); with creatinine 3.0 → CrCl 17 → one dose, then levels.
4. **Infusion rates** — Task 9: 5 mcg/kg/min, 70 kg, 1.6 mg/mL → 13.1 mL/h; 1000 mL over 8 h → 125 mL/h ([m2-19](screenshots/m2-19-infusion-rates.png)).
5. **Calculators** — CrCl with the weight basis ([m2-02](screenshots/m2-02-crcl-result.png)), out of date after a new creatinine ([m2-03](screenshots/m2-03-crcl-recalculated.png)), vancomycin AUC from two levels ([m2-05](screenshots/m2-05-vancomycin.png)), a calculator whose tests failed hidden ([m2-07](screenshots/m2-07-hidden-calculator.png)).
6. **Critical allergy alert** — penicillin allergy, then amoxicillin ([m2-08](screenshots/m2-08-critical-allergy-alert.png), [m2-09](screenshots/m2-09-safety-card.png)).
7. **Formulary, causality, About, Arabic** — [m2-11](screenshots/m2-11-formulary-editor.png), [m2-12](screenshots/m2-12-reference-hub.png), [m2-13](screenshots/m2-13-naranjo.png), [m2-14](screenshots/m2-14-adr-causality.png), [m2-15](screenshots/m2-15-about-datasets.png), [m2-16](screenshots/m2-16-safety-arabic.png).

## 9. What I need from you

1. **Acceptance of M2**, or the changes you want.
2. **Criterion 1**: accept the worked examples after a pharmacist reviews [CALCULATOR-FIXTURES.md](CALCULATOR-FIXTURES.md), or ask me to add published examples later.
3. **CRRT** in your vancomycin table (Section 1): confirm it counts as dialysis.

The next milestone in the specification's order is **M4 — Assessment and DRPs** (the Clinical Problem Card, PCNE V9.1 classification, prioritisation, the review workflow, staleness, versioned analyses). I will not start it before your explicit approval.

## 10. Files

- Engine and calculators: `src/calc/` (with `validation-manifest.json`, written by the test run); tests in `tests/calc/`; cross-check `scripts/calc-crosscheck.py`. Vancomycin without levels: `src/calc/calculators/vancomycin-empiric.ts`; infusion rates: `src/calc/calculators/infusion.ts`.
- Drug data: `public/data/` (vocabulary, DDInter, AWaRe) with the manifest `src/data/datasets.json`, built by `npm run data:build` (`scripts/data/`); mapping reports in `docs/m2/datasets/`; loaders in `src/drugs/`.
- Rules: `src/rules/` (engine, allergy class words, causality, the ONC list in `onc.ts`).
- Reference tables: `src/domain/reference.ts`, `src/ui/screens/Reference.tsx`; safety views and your warning: `src/ui/rules/SafetyViews.tsx`.
- AI drafting limits (what the model never drafts): `src/ai/analysis/limits.ts`.
