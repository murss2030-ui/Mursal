# PRECEPTOR — M6 report: export, monitoring and reconciliation

**Date:** 22 October 2026 · **Build:** 0.6.0 · built under the owner's autonomous-execution instruction; decisions are in [M6-PLAN.md](M6-PLAN.md).

| Part | What the build does |
|---|---|
| **Export of the form** | Form tab → "Export the form (PDF)". The document is the eleven sections with their Arabic labels, tables, the Section 8 boxes, the Section 7 automatic check kept apart, cards left out with why, the missing items, a statement of what it is, and its SHA-256. "Print or save as PDF" uses the browser; "Save as a text file" downloads the same content. Print styles hide the app's navigation and banners. |
| **Export blocking** | Refused with a list of reasons, each with a link to where it is resolved (see plan, decision 2). Verified: a stale card makes the export refuse; no card, no blocker. |
| **Ward and Teaching copies** | Teaching copy never holds an identifier; Ward copy is refused until the release gate is met. |
| **Audit** | `form_export` events by hash, never content. |
| **Monitoring rule** | `monitoring_due`: important when overdue, informational when due today. |
| **Reconciliation rule** | `reconciliation`: see plan, decision 7. |
| **Housekeeping** | The form's date line is a hand-filled line (no longer "not yet"); the form-view code is shared by the screen and the export; the catalogue's M6 "later" notes are removed. |

**Tests:** unit **807 passed** (new: `form-export.test.ts`, monitoring and reconciliation rules in `rules.test.ts`); browser **41 passed**, 1 skipped (the live run). New `e2e/m6-export.spec.ts` produces a real PDF with Chromium's print and checks the print stylesheet, the text download, the audit entries (hash only), the refusal when a card goes stale, and Arabic. Screenshots: `docs/m6/screenshots/`.

**Limits.** The PDF is made by the browser, so its page breaks and fonts depend on it; the section layout is mine, not a scan of the paper form, whose labels still need checking against the paper original (noted in `spec.ts` since M1). There is no separate "discharge summary" or "follow-up letter" document: discharge and follow-up stay as the Task 20–21 registers feeding Sections 4 and 10 of the form.
