# PRECEPTOR — M4 report: assessment and drug-related problems

**Date:** 20 October 2026 · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.5.0 (M4)

**Status: built and tested, waiting for the owner's review and approval.** Two things need the owner before M4 can be closed: the approval of the two PCNE mappings ([PCNE-MAPPINGS.md](PCNE-MAPPINGS.md), nine choices marked ⚑), and the acceptance of this milestone. Until the mappings are approved, every screen that shows a box or a Cipolle category derived from a PCNE code says it is a draft.

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

## 2. Test results

*(filled from the final runs below)*

## 3. Acceptance criteria (Section 23, M4)

*(filled from the final runs below)*

## 4. Known limitations

*(below)*

## 5. Files
