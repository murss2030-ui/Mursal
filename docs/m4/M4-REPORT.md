# PRECEPTOR — M4 report: assessment and drug-related problems

**Date:** 20 October 2026 · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.5.0 (M4)

**Status: accepted by the owner on 20 October 2026.** The owner's decisions, the same day:

1. **Both PCNE mappings are approved as they stand**, including the nine choices marked ⚑ ([PCNE-MAPPINGS.md](PCNE-MAPPINGS.md)). The "draft mapping" notes are gone from the screens and the form. The approval is bound to the approved results by a fingerprint (`f4b262be`): if a table or a rule changes, a unit test fails until the owner approves the change.
2. **A card the trainee writes keeps the current rule** (limitation 7 below): it enters Section 9 as soon as its recommendation is marked "Final", unless a later decision disputes it. No decision with the preceptor is required first.
3. **M4 is accepted.** M5 starts with its plan ([docs/m5/M5-PLAN.md](../m5/M5-PLAN.md)).

The report below is kept as it was submitted for review; limitation 1 no longer applies.

The plan, with the owner's decisions 2–9 (all approved on 19 October 2026), is in [M4-PLAN.md](M4-PLAN.md).

---

## 1. What M4 contains

| Part | What the build does |
|---|---|
| **PCNE V9.1** (M4a) | The 6 problem codes, 38 cause codes, 17 interventions, 10 acceptance codes and 7 status codes, with the official English wording copied from the PCNE document of 7 January 2026 and checked word for word against it; PRECEPTOR's Arabic explanation beside each. PCNE's terms of use are recorded in the code and in the mapping document. |
| **The two mappings** (M4a) | PCNE → the department form's Section 8 boxes (one box per code; causes before the problem; a code without a clean box ticks "other" and writes its PCNE wording) and PCNE → Cipolle, Strand and Morley (a teaching view, labelled "a mapping — the two systems are not equivalent"). Both in one module each, tested across every code, **drafts for the owner's approval**. |
| **The Problem Card** (M4b, decision D2) | The drug-related problem register is the card, extended. Its thirteen fields, in the order of Section 14, are the editor's numbered sections. New: the PCNE problem, its type (potential or manifest) and its causes — required, picked from the stored list, never typed; supporting data **linked** to timeline entries and calculation results (shown with value and day); **claims**, each with its source (a timeline value, a calculation, PRECEPTOR's offline interaction check, a source the trainee read, or none — general knowledge, unverified) and the result of the checks in code; urgency, clinical significance and potential impact; the trainee's adjustment of the form boxes, only with a reason. The card view shows **every field with its content or "Missing — what is missing"**, never a blank. |
| **Prioritisation** (M4c, decision D5) | The case's new **Problems** tab: the cards ranked by priority level, then urgency, significance, impact, then the strength of the evidence, derived (calculation or dataset › this patient's data › nothing PRECEPTOR can check). Each card says why it sits where it does, its stage (identified, planned, reviewed, communicated, implemented, followed up; declined shown apart), its review state and whether it is stale. Tasks 5, 13 and 29 show the same cards, in the same order. |
| **Review** (M4d, decision D9) | The five decisions — accept, edit, reject, request more evidence, needs senior review — on **one card at a time**; reject, more evidence and senior review are refused without their reason; a change of mind is a new decision, the earlier ones kept (append-only table, audited). "Edit" is the edit itself, recorded as the decision on the new version. A card the trainee writes shows "written by you", can be referred for senior review, and is then decided **with the preceptor**. There is no control and no store operation that decides more than one card, and nothing is pre-selected. |
| **Staleness and versions** (M4e, decisions D7, D8) | A card depends on the entries and calculation results it cites. It becomes stale when an entry of the same kind (same laboratory test, vital sign, weight, medication order, allergy record, dialysis status, problem) is recorded after its content was last written or reviewed, when a cited entry is corrected or retracted, or when a cited result goes out of date. It then shows **"Re-analyse — Day N"**, stays readable, cannot be accepted, and is **left out of the form's Sections 8 and 9**, which list it with the reason. It becomes current again only by a new version: a re-review with its reason ("still valid with the creatinine of Day 4"), or an edit of its content — on a stale card, also with its reason. Recording communication, implementation or the outcome does not make a stale card current. |
| **The form** | Section 8: the boxes of the current, undisputed cards, from their PCNE codes (the draft-mapping note shown while unapproved); one line per card with its PCNE codes; the PCNE wording of codes under "other"; the trainee's adjustments with their reasons. Section 9: the final recommendations of those cards only — never a stale, rejected, undecided or waiting card, nor one whose dose is not traced to a calculation or a cited source. Each card left out is listed with why. |
| **The model's part** (M4f, decision D6) | The case analysis (prompt `analyse-v3`) drafts Problem Cards: PCNE codes from the allowed lists only, the values they rest on as references, claims with their basis and references, priority and its factors, and the teaching explanation (field 13, labelled "general knowledge — no source"). Current calculation results are now sent too (C1, C2 …), so that a claim — and a dose — can cite one. Checks in code before anything is shown: an invalid PCNE code is removed; references must point to data that was sent; every number must be in the data the statement cites (a dose: only in a cited calculation result), otherwise it is removed or withheld; citations, URLs and grades are removed; the review decision, communication, implementation, outcome, the form boxes and the trainee's references are never taken from the model. A drafted card is decided on its own: accept, edit, reject, or kept as a card waiting for more evidence or for a senior review (with the reason). |

## 2. Test results (run on 20 October 2026, on this build)

| Suite | Result |
|---|---|
| Type check (`tsc -b`, strict) | no error |
| Unit tests (`npm test`, Vitest) | **633 passed** in 43 files, 0 failed |
| Browser tests (`npm run test:e2e`, Playwright, Pixel 7, production build) | **36 passed**, 1 skipped (the live run with the real Gemini service, which needs the deployed relay and key), 0 failed |

New for M4:

- `tests/unit/pcne.test.ts` (31) — the PCNE list against the document's counts and wording; both maps across every code and every problem–cause pair.
- `tests/unit/problem-card.test.ts` (19) — the thirteen-field rule on a minimal, a complete, a drafted and a pre-M4 card; the boxes and Cipolle view of a card; the claim checks; the ranking and the stage; staleness through the store (a potassium does not stale a creatinine card; a new creatinine does, with its day; a corrected value; a cited CrCl going out of date; recording the implementation does not make a stale card current; re-review as version 2 with its reason); the review (no operation over several cards; reasons required; append-only history; the trainee's own card decided with the preceptor; "Edit" recorded with the new version; the first decision on a drafted card); form Sections 8 and 9 leaving out stale, rejected, waiting, draft and untraced-dose cards with their reasons.
- `tests/unit/card-drafts.test.ts` (7) — the model's drafted cards with hostile fixtures: an invented cause code, references never sent, a number not in the cited data, a dose not from a calculation, citations and a URL, the fields only the trainee records, a claims list smuggled as a field value; a dose kept when it comes from a cited calculation result; a medication reference linked through its order; the output schema of every module within the relay's limits; a drafted card accepted, or kept for more evidence or a senior review.
- `e2e/m4-cards.spec.ts` — the whole path in the browser on a card the trainee writes (screenshots in [screenshots/](screenshots/)).
- Updated for M4: the M3 browser test now accepts a drafted Problem Card and checks its PCNE codes, claims, teaching label and first decision; the M1 test that fills every shared list fills the card's new required fields.

## 3. Acceptance criteria (Section 23, M4)

| Criterion | How it is met | Verified by |
|---|---|---|
| Every Problem Card carries all thirteen fields populated or explicitly marked missing | The card view renders the thirteen fields in order; a field without content shows "Missing — " and what is missing; gaps inside a filled field are named under it. Field 10 shows the decisions, or "written by you". | Unit: minimal, complete, drafted and pre-M4 cards. Browser: each of the 13 fields of a card has content or "Missing — …" ([m4-03](screenshots/m4-03-card-thirteen-fields.png)); the drafted card in the M3 test. |
| Bulk approve does not exist | Every decision is one call naming one card; there is no store operation over several cards and no control that decides more than one; nothing is pre-selected, and "Decided with my preceptor" is never ticked in advance. | Unit: the store's decision methods listed and checked. Browser: no "all / bulk / every" control on the Problems tab or Tasks 5 and 13; each decision needs its own click and, where required, its reason. |
| Adding a new creatinine marks the dependent analysis stale within one interaction and blocks its export | After saving a new creatinine, the next screen shows "Re-analyse — Day 2" on the card that cites the earlier creatinine (no reload); a potassium does not. The card cannot be accepted, and the form's Sections 8 and 9 leave it out and say why. **There is no export yet (M6):** the form screen is the department form as it will be exported, so a stale card cannot reach it; M6 will build the PDF from the same rules and add its own block. | Browser: [m4-04](screenshots/m4-04-stale-after-new-creatinine.png), [m4-05](screenshots/m4-05-form-leaves-stale-card-out.png). Unit: the same with a cited CrCl, a corrected value and an unrelated entry. |
| A rejected recommendation records a reason | Reject is refused without a reason (store and screen); the reason is stored with the decision, shown in the card's history and written to the audit log. | Unit and browser ([m4-06](screenshots/m4-06-review-history.png)): the button stays disabled until the reason is given; the audit log holds the rejection with its reason. |
| Section 21: both maps across all codes; staleness when a new entry lands | Both maps are defined for every problem and cause code and resolve every problem–cause pair. | `pcne.test.ts`; `problem-card.test.ts`. |

All M1, M2 and M3 tests still pass (one skipped test is the live run with the real Gemini service, which needs the deployed relay and the key).

## 4. Known limitations — said plainly

1. **The two mappings are drafts.** Until you approve [PCNE-MAPPINGS.md](PCNE-MAPPINGS.md) — in particular the nine ⚑ choices (C4.1, C4.2, C6.2, C6.3, C7.2, C7.3, C7.5, C7.9, C7.10) — every screen that shows a derived box or Cipolle category says it is a draft, and the trainee checks the boxes.
2. **Claims are checked in code only:** that each cited source exists and that every number of the claim is in it. Their meaning is not verified; that is the verifier of M5. A claim with no source is shown as "general knowledge — unverified", and one naming a source the trainee read says that PRECEPTOR did not consult it.
3. **The model's part was tested with the stand-in for the AI service, not with the real model.** The prompt changed (`analyse-v3`: PCNE codes, claims, calculation results). A live run like M3's needs your deployed relay and key; I have not run it, and the real model's cards may be poorer than the stand-in's. Every check in code applies to them whatever they contain.
4. **No export yet.** The form screen excludes stale and disputed cards; the PDF and its own export block come in M6.
5. **PCNE interventions, acceptance and problem status** (I, A, O codes) are stored in the classification module but not yet chosen on the card, which uses the department form's own fields for communication, implementation and outcome. They can be added if you want the PCNE record complete for research.
6. **Staleness is deliberately cautious:** any entry of the same kind recorded after the card's content was written or reviewed makes it stale — even one dated earlier (a value typed in late). An entry of a kind the card does not cite never does.
7. **A card you write yourself** enters Section 9 when you mark its recommendation "Final" (your own explicit act, decision D9), unless a later decision disputes it (rejected, more evidence requested, senior review requested). If you prefer that such cards wait for a decision taken with the preceptor, it is a one-line rule change.
8. **A dose in your own recommendation must be traced:** if it does not appear in a cited calculation, a cited value or a claim with a source, the card stays out of Section 9 with that reason. Your text is never changed.
9. **Cards recorded before M4** keep their department category until edited; editing them then requires the PCNE codes. Nothing is converted automatically. (Only synthetic data exists on any device.)
10. **PCNE asks to be informed of the classification's use** (drp@pcne.org). PRECEPTOR contacts no one; the department should send that notice.

## 5. Review before this report

A review pass over the M4 code (after an attempted automated multi-reviewer pass that could not complete) found and fixed, with tests: the preceptor's part in a decision on the trainee's own card is now stated by the trainee and never ticked in advance; field 8 no longer says "Proposed — not implemented" once the implementation is recorded; recording implementation or outcome no longer makes a stale card current; Section 8 says the cards are held out rather than "not assessed" when every card is left out; a drafted medication or problem reference is linked through its timeline entry instead of being dropped; the editor's PCNE choices keep the official English wording in Arabic; an incomplete claim is reported as required; and a card accepted from the AI draft is no longer headed "AI suggestion — no decision yet" (its origin is now said apart from its review state, checked in the browser test).

## 6. How to see it

Run `npm install`, `npm run build`, `npm run preview`, open the app, create a Teaching Case with a creatinine, open the case's **Problems** tab and add a drug-related problem. Screenshots of the path are in [screenshots/](screenshots/): the editor (m4-01), the ranked list (m4-02), the card's thirteen fields (m4-03), staleness after a new creatinine (m4-04), the form leaving the stale card out (m4-05), the decisions with their reasons (m4-06), the card in Arabic (m4-07), a card drafted by the AI stand-in with what the checks removed (m4-08), and the same card once accepted, with its first decision and its teaching explanation labelled as general knowledge (m4-09).

## 7. Acceptance

Accepted by the owner on 20 October 2026, with both PCNE mappings approved as they stand and the current rule kept for cards the trainee writes (see the status at the top).

## 8. Files

- Classification and maps: `src/domain/pcne.ts`, `src/domain/pcne-maps.ts`, `docs/m4/PCNE-MAPPINGS.md` (generated by `npm run docs:pcne`).
- The card: `src/domain/problem-card.ts`, `src/domain/card-data.ts`, `src/domain/workflow/registers.ts` (the drug-related problem register), `src/domain/types.ts` (`CardReview`).
- Store: `src/store/store.ts` (`reviewCard`, `reconfirmCard`, `updateItem` with the Edit decision, `decideSuggestion`, `cardContext`), `src/store/db.ts` (table `cardReviews`, database version 7), `src/store/backup.ts` (format 5).
- The form: `src/domain/form/derive.ts` (Sections 8 and 9).
- The model: `src/ai/analysis/{payload,contract,verify,limits,run}.ts`.
- Screens: `src/ui/screens/{ProblemCard,ProblemsTab,card-parts,ItemEditor,AiDraft,RegisterList,FormTab}.tsx`, `src/ui/case-bundle.ts`, strings in `src/i18n/{en,ar}.ts`.
- Tests: `tests/unit/{pcne,problem-card,card-drafts}.test.ts`, `e2e/m4-cards.spec.ts`.
