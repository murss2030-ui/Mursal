# M9 report — clinical fixture library and expert-review harness

## What was built
- `src/fixtures/clinical.ts`: 15 synthetic cases (allergy by ingredient, brand, class, ADR, home list; critical potassium; unit-converted creatinine; ONC high-priority interaction; major interaction shown as important; duplication; overdue monitoring; unresolved reconciliation) plus four "must stay silent" cases (unrelated drug, NKDA, unverified machine-read value, unknown names reported as not checked).
- A runner (`runFixture`) passes each case through the real `evaluateRules`, and reports **misses**, **false alarms** and names that should have been reported as not checked. `missedCritical` is the release gate's own wording.
- `tests/unit/clinical-fixtures.test.ts` (5 tests): no critical problem missed; every fixture matches; critical coverage includes allergy, interaction and critical lab; the harness really detects a miss; no fixture is marked reviewed and the gate is closed.
- `npm run docs:clinical` writes `docs/m9/CLINICAL-FIXTURES.md`, the sheet an expert signs (realistic / expectations right / nothing missing, with reviewer and date).

## Decisions (owner delegated engineering choices)
1. **The fixtures run against a small synthetic vocabulary and interaction file**, not the shipped datasets, so the test is stable and the data are plainly not clinical claims. Running the same fixtures over the shipped datasets is a task for the reviewer's environment.
2. **Scope is the deterministic rules engine.** Model output is never "critical" in this app and is checked by the verifier gate, so the model is not part of the fixture run (no live calls, no key quota).
3. **Every fixture is `awaiting_review`.** I wrote them; I am not a clinical expert and the sheet says so. Passing the library is necessary for the release gate, not sufficient.
4. **No in-app fixture screen**: a screen could be misread as clinical validation inside a patient-facing tool. The sheet is a document instead.

## Not done / still open
- The real expert review and signature.
- Written authorisation from the department head, and a paid key — the other gate conditions.
- `RELEASE_GATE_MET` remains **false**.
