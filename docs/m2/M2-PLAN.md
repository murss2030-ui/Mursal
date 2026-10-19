# PRECEPTOR — M2 implementation plan (Calculation and rules)

**Status:** plan prepared 13 October 2026, updated 16 October 2026 for M1 Revision 1. M2 was started on the owner's "go ahead" of 17 October 2026 and built on 17–19 October 2026. On 18 October 2026 the owner confirmed the proposed defaults for decisions 1, 3, 4, 5 and 7, and decided 6 (vancomycin without levels), 9 (infusion rates) and the phenytoin renal threshold; decision 2 is still open and decision 8 stays deferred to M6. Results, what is still blocked and what is open: [M2-REPORT.md](M2-REPORT.md).

## 1. Where M2 sits in the whole product

M1 is the foundation, not the product. PRECEPTOR remains an AI-supported clinical pharmacy rotation copilot, built in the specification's milestone order:

| Product goal | Built in |
|---|---|
| One patient case with a longitudinal, append-only timeline | M1 (done), extended by every later milestone |
| Source tracking, verification, corrections, audit history | M1 manual entry (done); M3 document extraction with confirmation; M5 evidence provenance |
| Medication reconciliation and prescription review | M2 safety rules; M4 medication review and DRPs; M6 reconciliation at admission, transfer and discharge |
| DRP identification and clinical assessment | M4 (Problem Cards, PCNE V9.1) |
| Dose optimisation, renal/hepatic adjustment, interactions, ADRs, TDM | **M2** (calculators incl. vancomycin AUC, rules, Naranjo/WHO-UMC); M6 monitoring schedules and trends |
| Evidence-supported learning and recommendations | M5 evidence library and verification; M4 recommendations; M8 learning modes |
| Teaching and clinical workflows, documentation, rounds, discharge, follow-up | M1 case types (done); M4 rounds preparation; M6 discharge, follow-up, form export; M7 presentation; M8 learning |
| Separation of source facts, calculations, AI suggestions, trainee decisions | M1 provenance states (done); **M2** `calculated`; M3 `extracted_unverified`/`confirmed`; M4 `ai_suggestion`/`trainee_decision` |

## 2. M2 scope (Section 22, M2)

### 2.1 Calculation engine (Section 9)
- Calculator contract exactly as specified: id, name, formula version, citation, required and optional inputs (each with accepted units and a physiologic plausibility range), `validate`, `compute`, `explain`, limitations, `validated`.
- Explicit unit conversion tested in both directions (creatinine mg/dL ↔ µmol/L, albumin g/dL ↔ g/L, calcium mg/dL ↔ mmol/L, weight kg ↔ lb, height cm ↔ in, temperature °C ↔ °F). An unknown unit is rejected.
- Inputs are pulled from timeline entries (with their entry ids); a value still `extracted_unverified` is refused. Out-of-range values trigger a confirmation showing value and unit.
- Every result is persisted as an append-only `CalcResult` (new table) referencing its source entries; recomputation creates a new result. Results render with the `calculated` provenance badge, and one tap shows formula, substituted values, units and assumptions.
- The sixteen calculators, with the specification's required behaviour:
  1. CrCl, Cockcroft–Gault — weight basis (TBW/IBW/AdjBW) chosen by the trainee and recorded; warnings for unstable creatinine, AKI, extremes of age and weight.
  2. eGFR, CKD-EPI 2021 — labelled a staging tool; never substituted for CrCl in drug dosing.
  3. BSA, Mosteller.
  4. IBW (Devine) and AdjBW — adjustment factor configurable and recorded.
  5–6. QTc Bazett and Fridericia — always shown together, with the guidance on which to trust at extremes of heart rate. QT and heart rate are transcribed from the ECG *report*; no ECG interpretation.
  7. Anion gap with albumin correction. 8. Corrected calcium for albumin. 9. Corrected phenytoin (Sheiner–Tozer) with the renal-impairment branch.
  10. Child–Pugh, with its limitations for dose adjustment stated. 11. CURB-65. 12. qSOFA. 13. CHA₂DS₂-VASc. 14. HAS-BLED. 15. ANC.
  16. Vancomycin AUC₂₄ by two-level Sawchuk–Zaske — target AUC/MIC 400–600 assuming MIC 1 mg/L (2020 consensus); warnings above AUC 800 or trough 15 mg/L; statement that evidence is insufficient for AUC targeting in non-invasive infection; refuses without both levels and their exact draw times relative to the dose; a separately labelled no-level nomogram path (source to be chosen, Section 5).
- **The Verify gate** (Section 8): each calculator and assessment declares its mandatory inputs; if any is absent the analysis is refused and the missing fields are named (e.g. a renally cleared drug review needs age, weight, sex, serum creatinine with its draw date, dialysis status, current dose and route, indication).

### 2.2 Local formulary and brand-alias table (Decision 11)
Initially empty, trainee-editable, versioned and audited: generic name, RxCUI when matched, local brand names (Egyptian, Indian, Jordanian brands), strengths, forms, availability in the hospital, source note, verified by/at. Medication entries are linked to a formulary item or RxNorm concept when a match exists; nothing is substituted automatically.

### 2.3 Rules and safety engine (Section 10), fully offline
- Documented allergy or previous ADR against active or proposed drugs, through RxNorm ingredient normalisation and drug-class membership.
- Drug–drug interactions: DDInter 2.0 as the dataset, the ONC high-priority list to raise severity.
- Therapeutic duplication within a class. High-alert medication flag.
- Laboratory value crossing a defined threshold, and a defined rate of change (e.g. the KDIGO creatinine-rise criteria for AKI), each with its source.
- Renal or hepatic adjustment required, against a trainee-sourced table with page or URL recorded. The rule flags and cites; it never computes or suggests a dose.
- Missing data that blocks a dose assessment (from the Verify gate).
- WHO AWaRe 2025 tagging of every antimicrobial; antibiotic time-out prompt at 48–72 hours; de-escalation prompt when a culture result is entered.
- Naranjo and WHO-UMC causality assessment as structured questionnaires, scored deterministically, linked to the ADR entry.
- Exactly three alert levels (Critical = interruptive modal with mandatory reason; Important = inline badge; Informational = collapsed group); duplicate alerts collapsed; an acknowledged alert does not return for the same case and cause unless the underlying data changes; per-rule firing and override counts recorded.
- An unrecognised drug name is reported as "not checked", never silently treated as safe.

### 2.4 Integration with M1
- Department form Section 1: BMI and CrCl/eGFR filled from `CalcResult`s (never typed). Section 7: interaction rows from the rules engine, each with its source attribution, kept apart from the rows the trainee recorded in the interaction register.
- About screen: attribution and licence for every dataset (DDInter, AWaRe, ONC list, RxNorm).

**With the Clinical Modules of Revision 1** — the engine appears inside the worksheets that already exist; nothing it produces enters a register or the form without an explicit per-item decision:
- *Dosing* (tasks 8, 9, 10): calculator results are shown with their formula, inputs and units beside the trainee's own calculation checks (the `calc_check` register stays); a difference between the two is shown, never overwritten. The vancomycin AUC calculator reads levels and draw times from the timeline; the TDM register keeps the trainee's interpretation.
- *Safety* (tasks 6, 7, 28): interaction and allergy flags appear next to the trainee's interaction and ADR rows; adding a flag as a row is the trainee's decision. Naranjo and WHO-UMC questionnaires attach to an ADR row; the trainee's earlier judgement stays on record as a version. The formulary's high-alert flag (decision 3) is shown beside each medication's answer in task 28.
- *Antimicrobial stewardship* (task 14): AWaRe tags and the 48–72 h time-out prompt in the antimicrobial-days panel; the de-escalation prompt when a culture result is entered.
- *Readiness:* the "dialysis status" item, shown today as "Not yet — M2", is satisfied by the structured renal-replacement-therapy entry (decision 7). Revision 1 already marks monitoring as due or overdue from the trainee's own plan (next review day); the schedule rule of decision 8 extends it in M6.

## 3. Data sources: verification status (13 October 2026)

| Source | Use in M2 | What was confirmed | Still to verify before use |
|---|---|---|---|
| **DDInter 2.0** | Interaction pairs and severity | Tian et al., *Nucleic Acids Res* 2025;53(D1):D1356–D1362; free access at ddinter2.scbdd.com; last database update 2024-05-14 (Database Commons); bulk CSV files with severity *Major / Moderate / Minor / Unknown*; licence reported as CC BY-NC-SA 4.0 by secondary sources | The official terms page; whether the bulk files contain **mechanism and management** text (the specification expects both for form Section 7); whether "contraindicated" exists as a level |
| **ONC high-priority DDI list** | Raise severity | Phansalkar et al., *JAMIA* 2012;19(5):735–743: a consensus list of 15 high-severity interactions | The exact 15 pairs from the full text (PMC3422823) |
| **WHO AWaRe 2025** | Antimicrobial tagging | Published 5 September 2025, WHO reference B09489, DOI 10.2471/B09489; licence CC BY-NC-SA 3.0 IGO (IRIS record); 268 antibiotics classified | The machine-readable file and its exact columns |
| **RxNav interaction API** | Not used | Discontinued, as the specification says | **Discrepancy:** the date "2 January 2024" could not be confirmed from sources reachable here. It does not change the plan, since the API is not used. |
| **RxNorm Current Prescribable Content** | Offline name normalisation | Free from NLM with no licence required (RXNCONSO, RXNSAT, RXNREL); latest snapshot seen January 2026 | The current release and its date |
| **RxClass drug classes** | Allergy class matching, duplication | Classes come from FDA EPC (via MED-RT), NLM MeSH, WHO ATC and others; SNOMED CT content is licence-restricted | Redistribution terms of EPC/MeSH content (recommended) and of WHO ATC content (likely restricted, so avoided unless cleared) |
| **Calculator formulas** | Engine | Primary citations per formula | One published worked example per calculator where one exists; where none exists, test values are computed independently by hand and marked as such |

**Licensing consequences.** DDInter (CC BY-NC-SA 4.0) and AWaRe (CC BY-NC-SA 3.0 IGO) are non-commercial and share-alike: each derived data file is kept separate, carries its own licence and attribution, and is shown on the About screen. PRECEPTOR stays free and non-commercial, as planned.

**Network access needed.** This environment's network policy currently blocks the publishers' sites, so M2 cannot download its data until these hosts are allowed in the environment settings: `ddinter2.scbdd.com` (and `ddinter.scbdd.com`), `pmc.ncbi.nlm.nih.gov`, `www.who.int` and `iris.who.int`, `download.nlm.nih.gov` and `www.nlm.nih.gov`, `rxnav.nlm.nih.gov`, `lhncbc.nlm.nih.gov`.

## 4. Order of work inside M2

| Step | Content | Depends on |
|---|---|---|
| M2a | Unit conversion, input specifications, calculator framework, `CalcResult` table, Verify gate, the "calculated" basis view | M1 |
| M2b | The sixteen calculators with their test suites; extended suites for vancomycin and phenytoin; the build-time validation manifest | M2a |
| M2c | Local formulary and alias table; RxNorm prescribable subset import; name normalisation | Network access |
| M2d | Dataset pipeline: DDInter, ONC list, AWaRe 2025, class membership — each with version, retrieval date, checksum, licence | Network access, Section 3 checks, Section 5 decisions |
| M2e | Rules engine, three-tier alerts, acknowledgement and counts, time-out and de-escalation prompts, Naranjo and WHO-UMC | M2c, M2d |
| M2f | Form Sections 1 and 7, About attributions, Arabic/English strings, end-to-end tests, M2 report | All |

Large datasets are loaded once into IndexedDB from a compressed file and queried locally; the app keeps working offline and makes no new network requests at runtime.

## 5. Decisions needed from the owner

1. **Critical interaction tier.** The specification reserves *Critical* for a "DDInter major contraindicated pair". If DDInter has no separate contraindicated level, proposal: Critical = pair on the ONC high-priority list; Important = DDInter *Major*; Informational = *Moderate*, *Minor*, and *Unknown* (shown as "severity not graded").
2. **Mechanism and management text** for form Section 7 if DDInter's bulk files lack them: trainee-entered from a cited source, or left marked as missing.
3. **High-alert medications.** The ISMP list is copyrighted. Proposal: a trainee-maintained "high-alert" flag in the local formulary, with its source recorded.
4. **Laboratory critical thresholds** vary by laboratory. Proposal: none shipped; the trainee enters the hospital's thresholds with their source. The KDIGO creatinine-rise criteria are offered as the cited default for the rate-of-change rule.
5. **BMI.** Form Section 1 requires BMI as a calculated value, but BMI is not among the sixteen calculators. Proposal: add BMI as a seventeenth calculator.
6. **Vancomycin no-level path.** Which published nomogram or dosing method to implement (it needs a citable source). It will be clearly labelled as a population-based estimate for the low-resource setting.
7. **Dialysis status**, required by the Verify gate. Proposal: a structured "renal replacement therapy" timeline entry (none, intermittent haemodialysis, peritoneal dialysis, CRRT).
8. **Monitoring due/overdue rule.** It depends on monitoring schedules, which the specification builds in M6. Proposal: the rule ships with M6.
9. **Infusion-rate calculator** (Revision 1, task 9 "dose and infusion calculations"). It is not among the sixteen calculators. Proposal: add it as a tested calculator — dose ↔ rate with drug amount, diluent volume, weight where the dose is weight-based, and time units — with formula, inputs and units always shown and no drug-specific default concentrations; or keep task 9 as the trainee's own calculation record only.

## 6. M2 acceptance criteria and their tests

| Criterion (Section 23) | Test |
|---|---|
| Every calculator passes its published worked examples and its boundary tests | Per-calculator Vitest suite: cited worked example(s); minimum, maximum and out-of-range inputs; both unit directions; refusal for a missing input and for an unverified input; extended suites for vancomycin and phenytoin |
| A calculator with a failing test does not appear in the UI | The test run writes a validation manifest (calculator, formula version, tests passed, date); the build reads it; a calculator without a passing record is hidden with an explanation. An end-to-end test runs a build with one calculator marked failed and checks it is hidden |
| A calculation with a missing required input is refused and names the missing field | Unit tests per calculator; an end-to-end test without a creatinine draw date |
| A documented allergy produces a critical interruptive alert; a moderate interaction does not | End-to-end: penicillin allergy plus a new amoxicillin order shows a modal requiring a reason; a DDInter *Moderate* pair appears only in the collapsed informational group |

Additional tests: alert de-duplication, acknowledgement persistence and reappearance when data changes; override counts; AWaRe tags; time-out at 48–72 hours; de-escalation prompt on a culture result; Naranjo and WHO-UMC scoring against their published scoring tables; formulary versioning and audit; unrecognised drug names reported as "not checked"; everything works offline; no new network requests (Content-Security-Policy unchanged); all M1 tests still pass.

## 7. Not in M2

Any AI or model call (M3 onwards); openFDA label text and other live connectors (M5); monitoring schedules (M6); Problem Cards and DRPs (M4); any dose suggestion not produced by a validated calculation or a verified reference (never).

## 8. Main risks

- **Clinical correctness of formulas and fixtures.** Every test value has a recorded origin (published example or independent hand calculation), and the fixture list is offered for review by a qualified pharmacist.
- **Name matching.** Local brands are absent from RxNorm; unmatched names are reported as unchecked, and the alias table closes the gap over time.
- **Dataset size and start-up time.** DDInter holds about 300,000 pairs; it is imported once in the background, and the time-to-interactive budget from M9 is tracked from M2 onwards.
- **Licences.** Share-alike data stays in separate files with its own licence; no commercial use.

## 9. Sources consulted for Section 3

- DDInter 2.0: [NAR 2025 article](https://academic.oup.com/nar/article/53/D1/D1356/7740584), [PMC11701621](https://pmc.ncbi.nlm.nih.gov/articles/PMC11701621/), [Database Commons entry](https://ngdc.cncb.ac.cn/databasecommons/database/id/7473), [ddinter2.scbdd.com](https://ddinter2.scbdd.com/)
- ONC list: [Phansalkar et al., JAMIA 2012 (PMC3422823)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3422823), [AHRQ PSNet summary](https://psnet.ahrq.gov/issue/high-priority-drug-drug-interactions-use-electronic-health-records)
- WHO AWaRe 2025: [WHO publication B09489](https://www.who.int/publications/i/item/B09489), [IRIS record](https://iris.who.int/handle/10665/382244)
- RxNav interaction API: [DrugBank announcement](https://blog.drugbank.com/nih-discontinues-their-drug-interaction-api/), [RxNav news](https://www.lhncbc.nlm.nih.gov/RxNav/news/news.html)
- RxNorm prescribable content: [NLM page](https://www.nlm.nih.gov/research/umls/rxnorm/docs/rxnormfiles.html)
- RxClass sources: [RxClass introduction](https://rxnav.nlm.nih.gov/RxClassIntro.html), [data.gov entry](https://catalog.data.gov/dataset/rxclass)

The publishers' own pages for DDInter, PMC and NLM could not be opened from this environment (network policy) when this plan was written; the findings above came from search results. DDInter's site and WHO's IRIS were opened directly on 18 October 2026 and their files used (M2 report, Section 1); PMC still answers with a browser check, and the other literature hosts are still refused.
