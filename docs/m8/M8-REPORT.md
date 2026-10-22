# PRECEPTOR — M8 report: learning modes and the portfolio

**Date:** 22 October 2026 · built under the owner's autonomous-execution instruction.

**Decisions (the specification's M8 text is not available; built from the task catalogue's note, "Teach Me, Assessment Mode, Argue With Me, competency tagging and the portfolio"):**

1. **No model in any learning mode.** Everything is built from the trainee's own record and the app's tested knowledge, so nothing — a question, a challenge, a lesson — can contain an invented dose, citation or fact (Section 24). A model could later phrase challenges, but then each would need the verdict gate of M5; the deterministic version needs none and works offline.
2. **Teach me** (per Problem Card): what its PCNE problem and causes mean (the official wording, with the Arabic explanation), the trainee's own "question this teaches me to ask" (labelled general knowledge), a search of the trainee's own library on the device, links to the research and the calculators, and "I studied this".
3. **Assessment mode**: one question per current calculation result — reproduce it from the case's own inputs (the calculator's formula and steps are shown after the answer). Marked against the validated calculator, within 5 % or one unit of the last place; a comma decimal is refused, never guessed; the answer is not in the question; a result out of date is not asked.
4. **Argue with me** (per card): the questions a preceptor would put, from the card's own missing fields, the alerts the app raised for its drugs, the kind of cause (PCNE cause group C1–C9), and two always (the strongest argument against; what if the team declines). The trainee answers in their own words; the answer is kept.
5. **Records**: append-only `learning` table (database version 9, backup format 7, old backups still readable); each record is tagged with competency areas (shown to the trainee). The audit log holds the mode, tags and length — never the words.
6. **Portfolio** (More → Portfolio): per competency area, the trainee's own record as evidence to discuss with the preceptor — Problem Cards (proposed or implemented; outcome measured or not), reflections tagged by the trainee in Task 25, learning records with the trainee's own answers, counselling, rounds, monitoring plans, reconciliation, preceptor discussions, research ideas, teaching delivered; the rotation's declared goals are marked and shown with "nothing recorded yet" when empty. **Counts, no scores or grades.** Printable or text; recorded in the audit log by counts and hash.

**Tests:** unit `learning.test.ts` (5) and the existing suites (**820 passed**); browser `e2e/m8-learning.spec.ts` runs all three modes on a real case with the test relay never called, the portfolio by competency, the text export and the audit, and Arabic. Screenshots: `docs/m8/screenshots/`.

**Limits:** the challenges are templates keyed to what the app knows, not a conversation; Assessment mode covers calculations only (no interpretation questions); no spaced repetition or progress curve (a grade-like construct, left out on purpose).
