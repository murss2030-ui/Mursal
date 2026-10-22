# PRECEPTOR — final build report (M1–M9)

Version 0.9.0, milestone M9. **The release gate is NOT met** (`RELEASE_GATE_MET = false`): synthetic cases only.

| Milestone | Delivered | Report |
|---|---|---|
| M1–M5 | Foundations, reference/calculators/rules, AI extraction and drafts, Assessment/DRPs, evidence | earlier reports (accepted through M5) |
| M6 | Print-to-PDF + text export of the department form with an export gate; monitoring-due and reconciliation rules | docs/m6/M6-REPORT.md |
| M7 | Monthly presentation built only from the verified record | docs/m7/M7-REPORT.md |
| M8 | Teach Me / Assessment / Argue With Me (deterministic, no model) and the competency portfolio | docs/m8/M8-REPORT.md |
| M9 | 15 synthetic clinical fixtures with a runner and expert review sheet | docs/m9/M9-REPORT.md |

## Verification at the end
- Unit tests: 825 passed (57 files). `tsc -b` clean. Production build succeeds.
- End-to-end: all specs pass (the m2-reference version string and an audit-page race in the m8 spec were fixed at the end).
- No live model run and no free-key quota was used in M6–M9.

## What remains with people, not code
1. The M6–M9 specification text was not available to me; I built from the catalogue and plan statements and documented every interpretation in the milestone reports. Please review those decisions.
2. Expert clinical review and signature of docs/m9/CLINICAL-FIXTURES.md.
3. Written authorisation from the department head and a paid key.
4. Backlog: Task 23 (protocols drafted from the library only).
5. The Ward copy export stays refused until the gate is met.
