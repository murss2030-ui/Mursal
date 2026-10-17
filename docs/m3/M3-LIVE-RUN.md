# PRECEPTOR — M3 live run with Google Gemini (acceptance criterion 9)

**Date:** 16 October 2026 · **Data:** synthetic Teaching Case only · **Key:** the owner's free-tier Gemini key, added by the environment's proxy (it never entered this session, the code or the repository).

At the owner's request (option 1: "run it live here"), the M3 walkthrough ran in this environment against **Google's real Gemini API and the real RxNav service**. The path is the deployed one: the app in a browser (Chromium, phone size) → the relay code (`relay/handler.ts`) → the Gemini adapter (`relay/providers/gemini.ts`) → Google. The only difference from Netlify is where the relay runs; the Netlify Function's own wiring (routing, environment, Blobs counters) is covered by `tests/unit/netlify-function.test.ts`.

The test is `e2e/m3-live.spec.ts` (skipped unless asked for). It confirms a value only when it matches what the synthetic document says — as a careful trainee would — and rejects anything else with a reason. Raw results: [run-1-default-thinking.json](live/run-1-default-thinking.json), [run-2-thinking-low.json](live/run-2-thinking-low.json); screenshots in [live/screenshots](live/screenshots/).

## Result (second run, after the fixes below)

| | |
|---|---|
| Models | gemini-3.8-flash for reading and drafting; thinking level "low" |
| Calls | **12 of 12 succeeded at the first attempt** (2 documents × 2 readings, 8 modules); whole walkthrough 2.6 minutes |
| Time per call | reading 5.2–13.0 s; drafting 7.1–15.6 s — under Netlify's 30-second limit |
| Values read | **22 of 22 correct**: all 18 items of the typed admission note and all 4 lines of the photographed page; both readings agreed; the boxes on the page sat on the right lines |
| Illegible dose | the model returned no dose and marked it illegible; the app showed it as "Illegible — enter it yourself" and it could not be confirmed |
| Identifiers and dates | none sent: the name and record number were removed before saving, the page image sent was the redacted one (checked pixel by pixel), calendar dates went as hospital days |
| Values needing a choice | 5 diagnoses came without a status; each was given "active" through Correct, as the document lists them as current problems |
| Drafts | **all 8 modules; 237 suggestions in the 28 tasks the model may draft** (none for Tasks 23 and 25, by design): 101 resting on cited case data, 15 labelled "general knowledge — no source, unverified", 121 missing-data notes and questions |
| Checks in code | 8 numbers not in the data removed, 4 claims without a valid reference relabelled "no source", 8 proposed rows left incomplete for the trainee (fields only the trainee may fill); **no citation and no number outside the case data reached the screen, and no dose was stated** (the model said a dose reduction was needed, without a number) |
| Decisions | one checklist answer accepted (the worksheet updated), one suggestion rejected with its reason |
| RxNav | 6 lookups, drug names only; all matched (e.g. metformin → RxCUI 6809) |
| Browser traffic | only the app's own relay and RxNav; no console errors |
| Tokens | 21,174 in, 21,003 out, 0 thinking |
| Cost | US$0.22 for the whole case at US$1.50 / US$9.00 per million tokens (published Flash pricing, to be checked on Google's page) — reading US$0.07, drafting US$0.15. **A free-tier key is not charged.** |

Examples of drafts from this run, as shown to the trainee:

- Task 14, *"Spectrum fits the likely organisms, local resistance and allergies — ceftriaxone → Problem"*: "Documented penicillin allergy is rash, requiring assessment of cephalosporin cross-reactivity…" — from the case data (penicillin — rash; ceftriaxone; community-acquired pneumonia).
- Task 3, *"Dose appropriate for age, weight and organ function — enoxaparin → Problem"*: "Serum creatinine increased from 2.1 mg/dL to 2.6 mg/dL; enoxaparin accumulates in renal impairment and dose reduction is required…" — no dose given.
- Task 6, a proposed interaction row: enoxaparin with acute kidney injury, "renal elimination of low-molecular-weight heparin is reduced … risk of accumulation", its severity left to the trainee.
- Several tasks: *"Missing data: urine output"*.

## What the first run found, and what was fixed

The first run (default thinking; gemini-3.5-flash for reading, gemini-3.6-flash for drafting) also read **all 22 values correctly**, but showed problems no simulated test could:

| Finding | Fix (with tests) |
|---|---|
| Gemini **refused the reading schema** ("Request contains an invalid argument") because of the array length limits (`maxItems`). | The adapter no longer sends them; the app still enforces every limit when it checks the answer. The test stand-in now refuses them too, so this cannot come back unnoticed. |
| **Thinking tokens were 74 % of the output**, and calls took up to **29.6 s** — at Netlify's 30-second limit. | New relay setting `PRECEPTOR_THINKING` (per task; recommended `extract=low,analyse=low`): the same reading took under 4 s, and the second run's slowest call 15.6 s. The relay now gives up at 25 s (`PRECEPTOR_PROVIDER_TIMEOUT_MS`) with a clear message, keeping the call's full estimate counted against the budget. |
| Google often answered **"high demand" (503)**: 10 of 24 calls. | The app retries such a refusal once, after 4 seconds (both attempts are in the audit log). The drafting button now redoes only the modules that are missing, failed or out of date. |
| The free tier allows **20 requests per model per day**; when used up, the app said "try again in a minute". | A used-up daily quota now has its own message ("…used up for today. Choose another model in Settings, or try again tomorrow") and stops the run. |
| Without the typed document's hospital day, most values came back without a day and each needed a correction. | The day field now explains its effect, and the checking screen says what to do when several values have no day. In the second run the day was given and no value needed a day correction. |
| The checker removed numbers that were grounded: the patient's age, today's hospital day, and "48–72 hours" from the checklist item being answered. | Those numbers are now allowed; **a dose must still come from the data the statement cites** (a test proves "3 mg" is withheld even when today is day 3). |
| gemini-2.5-flash answered 404 for this key (retired). | Nothing to fix: the app's "model not available — choose another in Settings" path is the right answer, as tested. |

## Still to note

- **The free tier is not enough for regular use.** At 20 requests per model per day, it covers about one synthetic case per model per day, and its "high demand" refusals are frequent. Clinical Cases need a paid key in any case (Section 18).
- **The Netlify deployment itself** has not been opened: after deploying, `https://<site>/api/status` must answer with `"configured": true` (README, "AI service"). Set `PRECEPTOR_THINKING=extract=low,analyse=low`.
- **The model's quality was measured on one synthetic case.** Handwriting, poor photographs and Arabic text were not covered; the fixture library of the release gate is where that is measured.
- In the second run, the optional step that accepts a drug-related-problem row in Task 5 was skipped: the test script looked before the page had drawn. That action is covered by the simulated test; the script now waits.
