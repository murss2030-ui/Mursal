# PRECEPTOR — M7 report: the monthly presentation

**Date:** 22 October 2026 · built under the owner's autonomous-execution instruction.

**Decisions (the specification's M7 text is not available; built from Task 30's note, "the monthly presentation, assembled from the verified record", and the M4 plan, which says a stale card stays out of the form, the export and the presentation):**

1. **One deck per rotation and month**, from the cases the trainee ticks. **Reports → Monthly presentation.**
2. **The department form's gate decides what appears.** A Problem Card is on a slide only if it would enter Section 8 of the form; its recommendation only if it would enter Section 9. A card that is stale, undecided, waiting for evidence or review, or whose drafted claims are not supported is **left out and counted** in the builder (with why), never shown on a slide. Values read by the model and not confirmed are not used.
3. **De-identified like the Teaching copy**: age ("90 or older" past 89), sex, hospital days; no name, number, bed or calendar date.
4. **No overclaiming**: a recommendation is "proposed" unless the trainee recorded it as implemented; an outcome is "Not measured yet" unless measured; the statistics slide gives counts with denominators ("1 of 2"), never a bare percentage.
5. **Slides**: title; per case a summary (problems, latest verified values), one per card, the monitoring plan, the trainee's own learning points (Task 25); the month in numbers; an "About this presentation" statement (assembled from the verified record, trainee's work, replaces no pharmacist, nothing sent to the care team).
6. **Output**: on screen one slide at a time (arrow keys); **print / save as PDF** puts one slide on each landscape page; a text file. Both are recorded in the audit log by counts and SHA-256, never by content. Nothing is sent anywhere.

**Tests:** unit `presentation.test.ts` (7); browser `e2e/m7-presentation.spec.ts` (card slide, arrow keys, print to a real PDF with the app's chrome hidden, text file, audit by hash, a stale card left out and counted, Arabic). Screenshots: `docs/m7/screenshots/`.

**Limits:** slides are text and tables (no charts); the layout is generic, not the department's template; one rotation per deck.
