# PRECEPTOR — M4 plan: Assessment and drug-related problems

**Status:** plan prepared on 19 October 2026. The owner approved decisions 2–9 as proposed on 19 October 2026; decision 1 was settled the same day, when the owner allowed `pcne.org` and the official PCNE V9.1 document was downloaded. Built on 20 October 2026 — see the [M4 report](M4-REPORT.md) — and accepted by the owner the same day, with both PCNE mappings approved as they stand. The plan below is kept as approved.

## 1. What M4 must deliver

From the specification:

- **Section 22, M4:** "The Clinical Problem Card, PCNE V9.1 classification with both mappings, prioritisation, the review workflow with per-item decisions and reasons, staleness propagation, versioned analyses."
- **Section 14:** one card template for every drug-related problem, used unchanged in assessment, documentation, rounds preparation, the department form and the monthly presentation, with thirteen fields: 1 clinical problem · 2 supporting data, each item linked to its timeline entry · 3 missing information, named explicitly · 4 clinical assessment, with the alternative explanations · 5 drug-related problem: PCNE V9.1 problem and cause codes, the optional Cipolle mapping shown separately · 6 priority and urgency, with the reason · 7 evidence and references: each claim with its source, quote and verifier verdict, and the limits of the evidence · 8 recommendation and rationale (a dose, route or duration only where Section 12's numeric rule is met) · 9 monitoring plan · 10 human review · 11 implementation status · 12 follow-up outcome ("not yet measured" is a valid value) · 13 teaching explanation, "generated in every mode".
- **PCNE and the two mappings:** PCNE V9.1 is the stored classification (problem domains P1 effectiveness, P2 safety, P3 other; cause domains C1–C9, with C8 for transitions of care). Two mappings are derived from it and never stored as the primary record: the department form's Section 8 checkboxes (pre-ticked from the PCNE code, adjustable by the trainee; a deterministic map in one module with its own tests) and Cipolle, Strand and Morley's seven categories (an optional teaching view, labelled as a mapping; the UI must say the two systems are not equivalent).
- **Section 8, Identify DRPs:** a systematic search across the PCNE domains, ranked by clinical significance, urgency, strength of evidence and potential patient impact — "a prioritised set of Problem Cards, not an undifferentiated alert list".
- **Section 8, Review:** per recommendation, Accept, Edit, Reject (with reason), Request more evidence, or Needs senior review. No bulk approve. "A later change of mind is recorded as a new decision with its reason, not an overwrite."
- **Section 7, Staleness:** when an entry is added, every analysis version based on an entry of an affected type, and every analysis that depends on a calculation that used it, is marked stale, with a "Re-analyse — Day N" badge. Re-analysis creates version n+1; the earlier version stays readable. A stale analysis can never be inserted into a form or a presentation.
- **Section 23, M4 acceptance:** every Problem Card carries all thirteen fields populated or explicitly marked missing; bulk approve does not exist; adding a new creatinine marks the dependent analysis stale within one interaction and blocks its export; a rejected recommendation records a reason.
- **Section 21:** the PCNE-to-Cipolle and PCNE-to-checkbox maps tested across all codes; staleness propagation tested when a new entry lands.

## 2. What already exists and will be reused

| Already built | Where | Use in M4 |
|---|---|---|
| The drug-related problem register, used by Task 5 (DRPs), Task 13 (recommendations) and Task 29 (response evaluation) | `src/domain/workflow/registers.ts` | It already holds most of the card: problem, medicines, linked diagnosis, supporting data, missing information, assessment, priority with its reason, recommendation, monitoring, references read by the trainee, communication and response, implementation (by whom, which day), goal met and outcome ("not measured yet" included), teaching point, preceptor discussion. It is versioned and audited. **Proposal (decision 2): the Problem Card *is* this record, extended** — so the three tasks, the form and the AI drafts keep working. |
| The form's Section 8 checkboxes and Section 9 | `src/domain/form/derive.ts` | Today the trainee picks one of the form's ten boxes per problem. M4 derives the boxes from the PCNE code through the map; Section 9 already takes only recommendations marked final — M4 makes it "accepted, current cards only". |
| AI drafts with per-item decisions (accept, edit, reject with a reason), versioned module analyses, code checks on every draft (references, numbers, citations, field limits) | `src/ai/analysis/`, `src/store/store.ts` | Drafted cards go through the same path, extended to the five review decisions and to the card's fields. |
| Calculators, DDInter, the ONC list, the rules engine | `src/calc/`, `src/rules/` | The sources a card's claims can cite before M5: a calculation result, a dataset record, the case data — or "no source" (general knowledge, labelled, owner decision D3 of M3). |
| Staleness of module analyses (any change to the record) and of calculation results (newer inputs) | `src/store/store.ts`, `src/calc/currency.ts` | Refined into per-card dependencies (decision 7). |

## 3. What will be built

| Part | Content |
|---|---|
| **M4a — PCNE V9.1** | The problem and cause codes with their official wording, in one module, from the official document (decision 1). The map to the form's ten checkboxes and the map to Cipolle's seven categories, each in its own module, with tests across every code; both tables shown to you for approval before use (decisions 3 and 4). |
| **M4b — the Problem Card** | The drug-related problem record extended to the thirteen fields: PCNE problem and cause codes (picked from the list, never typed); supporting data as links to timeline entries and calculation results, shown with their values and days; claims (field 7) each with its source type — calculation, DDInter, ONC, case data, or "no source" — and the check result; and every field either filled or explicitly marked missing with what is missing. One card view used in Tasks 5, 13 and 29, on the case's new **Problems** list and in the form. |
| **M4c — prioritisation** | Priority (critical, important, informational) with its reason, and the ranking factors of Section 8, in a fixed, visible order (decision 5). The Problems list is that ranked list; each card shows why it sits where it does. The stage of each problem (identified, planned, reviewed, communicated, implemented, followed up) is shown per card (Section 8: "the app tracks stage per problem"). |
| **M4d — review workflow** | The five decisions on each recommendation, each with its time; a reason required for Reject, Request more evidence and Needs senior review; a change of mind is a new decision with its reason, the earlier ones kept. No control that acts on several items at once, and no default decision. "Proposed" and "implemented" never look alike. |
| **M4e — versioned analyses and staleness** | Every card version records what it was based on (entries and calculation results). A new or corrected entry of an affected kind, or a calculation result gone out of date, marks the dependent cards stale at once, with "Re-analyse — Day N". A stale card stays readable but cannot enter the form (Sections 8 and 9) — and later the export (M6) and the presentation (M7) — until a new version is made (decision 8). |
| **M4f — the model's part** | The case analysis drafts Problem Cards: the thirteen fields, PCNE codes chosen from the stored list (an invalid code is removed), claims with their source types, the teaching explanation (decision 6). Checks in code, as in M3: references must point to data that was sent; every number must trace to the case data or a calculation result, otherwise it is removed and the claim flagged; doses only from a calculation result (Section 12); no citation, author, year, DOI, URL or grade; the model never sets the review decision, the implementation or the outcome. Each draft is decided card by card. |
| **Tests and report** | Unit tests: the PCNE list against the document, both maps across all codes, the thirteen-field completeness rule, the review history, the ranking, staleness propagation (a new creatinine → the creatinine-based card stale; an unrelated entry → not), form exclusion of stale and unaccepted cards, the model checks with hostile fixtures (an invalid PCNE code, an untraceable number, a dose not from a calculation, a citation). Browser tests for the four acceptance criteria. Screenshots and the M4 report. |

## 4. Data model (Section 7, adapted to what exists)

- **Problem Card** = the drug-related problem record (versioned, audited), with new fields: `pcneProblem` (one code), `pcneCauses` (codes), `supporting` (links: timeline entry or calculation result, with the label shown), `claims` (Section 7's `Claim`: text, source type, reference, and the verdict of the checks available before M5), `priorityFactors`, `missing` (per field: what is missing), `basedOn` (entry ids and calculation result ids) and `analysisState` (current, stale, superseded). The form checkboxes and the Cipolle category are **derived**, never stored as the record (Section 14); the trainee's adjustment of a pre-ticked box is stored as an adjustment with its reason.
- **Review decisions**: an append-only list per card — `accepted`, `edited`, `rejected` (reason), `needs_evidence` (what evidence), `needs_senior_review` (why) — each with its time; the card shows the latest and keeps the history.
- **Analysis versions**: each model analysis stays as now (module, model, prompt version, what was sent, usage), and each card version points to the analysis it came from, or to the trainee as author.
- Existing rows keep their department checkbox until the trainee gives a PCNE code; nothing is converted automatically.

## 5. Decisions needed from the owner

Each has a proposed default; you can approve them all at once or change any.

1. **The PCNE V9.1 document (blocking for M4a).** The official classification (PCNE Classification for Drug-Related Problems, V9.1) is published on www.pcne.org, which this environment cannot reach. Please upload the PDF here — or allow `www.pcne.org` in the environment's network settings and start a new session. I will not type the codes or their wording from memory. Its terms of use will be checked in the document and shown on the About screen.
2. **One record:** the Problem Card is the existing drug-related problem record, extended (proposed), rather than a new separate record.
3. **PCNE → form checkbox map:** I draft the table once the PCNE list is in; you approve it before it is used; codes without a clean box tick "other" with the PCNE label, as Section 15 says.
4. **PCNE → Cipolle map:** I draft it as a teaching view, labelled "a mapping — the two systems are not equivalent"; you approve it.
5. **Prioritisation (proposed):** the priority level with its reason is set by the trainee (the model may propose it); within a level, cards are ordered by urgency, then clinical significance, then potential patient impact — each rated high, medium or low — then by strength of evidence, which is derived, not rated (calculation or dataset, then case data, then "no source"). The order and the factors are shown on each card.
6. **Field 13, the teaching explanation:** the specification says it is generated in every mode. In M3 the model was not allowed to draft the teaching point (it was kept as the trainee's own). Proposed: the model drafts field 13 for every card it drafts, labelled "general knowledge — no source" and decided like any other field; a card the trainee writes shows field 13 as missing until the trainee writes it.
7. **What makes a card stale (proposed):** a card depends on the entries it cites and on the calculation results it cites. A new or corrected entry of the same kind as one it cites makes it stale — the same laboratory test, the same vital sign, the weight, the same medication order, the allergy record, the renal replacement therapy — and so does a cited calculation result going out of date. An unrelated entry does not. (The alternative is coarser: any new entry makes every card stale.)
8. **What happens to a stale card (proposed):** it stays readable with "Re-analyse — Day N" and is kept out of the form until a new version exists: a new model analysis (version n+1), or the trainee's own re-review saved as version n+1 with a reason (e.g. "still valid with the creatinine of Day 4").
9. **Review of the trainee's own cards (proposed):** the five decisions apply to every recommendation the model drafts. A card the trainee writes shows "written by you" in field 10, and can be marked "needs senior review" and then decided with the preceptor.

## 6. Acceptance criteria and their tests

| Criterion (Section 23, M4) | Test |
|---|---|
| Every Problem Card carries all thirteen fields populated or explicitly marked missing | Unit: the card view gives each of the thirteen fields either its content or "missing — what is missing"; an empty field is never hidden or left blank. Browser: a drafted card and a hand-written card, each showing its thirteen fields |
| Bulk approve does not exist | Unit: the store has no operation over several cards; each decision names one card. Browser: no control decides more than one card; a decision needs its own click and, where required, its reason |
| Adding a new creatinine marks the dependent analysis stale within one interaction and blocks its export | Browser: a card citing a creatinine; add a new creatinine; the card shows "Re-analyse — Day N" on the next screen without reload, and the form's Sections 8 and 9 leave it out and say why. Unit: an unrelated entry (a potassium) does not make it stale |
| A rejected recommendation records a reason | Unit and browser: Reject without a reason is refused; the reason is stored, shown and audited |
| Section 21: both maps across all codes; staleness propagation | Unit: every PCNE code maps to at least one checkbox (or "other" with its label) and to at most one Cipolle category or "no equivalent"; staleness as above |

All M1, M2 and M3 tests must still pass.

## 7. Not in M4

The evidence library, retrieval and the five-check verification with a second model (M5) — so before M5 a claim's verdict comes only from the checks in code, and a "no source" claim is shown as unverified. The PDF export of the form (M6, where export blocking is enforced on the file itself), monitoring schedules (M6), the presentation (M7), the learning modes and the portfolio (M8), the clinical fixture library with expert review (M9).

## 8. Main risks

- **PCNE wording:** without the official document the classification cannot be built faithfully (decision 1).
- **Map tables are clinical judgements:** they need your approval and are tested across every code.
- **Noise:** an over-eager model could produce many low-value cards; the ranking, the per-card decisions and the "no source" label keep the list usable and honest.
- **Existing data:** cards recorded before M4 keep their department checkbox until classified, so nothing is changed behind the trainee's back.
