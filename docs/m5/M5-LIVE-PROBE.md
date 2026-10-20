# PRECEPTOR — M5 preparation: the live probe of the real model

**Date:** 20 October 2026 · **Data:** synthetic only (two invented Teaching Cases and the synthetic benchmark) · **Asked for by the owner:** "integrate the paid API to try the 30 tasks, focusing on checking the medical meaning of claims, not only the programmatic check."

**The key.** The key that reaches this environment (added on the way out by the environment's proxy; it never entered this session, the code or the repository) is **a free-tier key**, not the paid key the owner mentioned: Google's own refusals name the free-tier quotas (`generate_content_free_tier_requests`, quota ids ending in `-FreeTier`), and `gemini-3.1-pro-preview`, whose free-tier limit is 0, was refused. The first run declared the key "paid" in the relay's settings on the owner's word; that declaration was wrong, and had no effect because only synthetic Teaching Cases were sent. Later runs declare it "free". **Nothing was billed**; the costs below are what the same calls would cost on a paid key, at the prices configured for the run (set above Google's published prices, which could not be checked from here).

**The path** is the deployed one without the browser: the app's own modules (case payload, prompt `analyse-v3`, the checks in code; the verifier `verify-v1`) → `callModel` → the relay code (allow-list, spending cap, rate limits, the 25-second limit kept under Netlify's 30) → the Gemini adapter → Google. The harness is `tests/live/m5-probe.live.ts` (opt-in, never part of `npm test`); raw results are in [live/](live/).

## 1. Checking meaning: the semantic benchmark

37 claims, each beside the sources it cites ([tests/fixtures/semantic-benchmark.ts](../../tests/fixtures/semantic-benchmark.ts)): 15 that their sources support, and 22 that they do not — **16 of which pass the number check of M3–M4**, because every number in them is in their sources: a creatinine *rise* described as a fall (b02), a potassium flagged high called normal (b04), 72 kg written as 72 lb (b13), a clearance of 45 mL/min given the dose for below 30 (b17), metformin "contraindicated below 45" where the source says below 30 (b23), amiodarone said to *lower* the warfarin effect (b25), 30 mg written as 30 units, twice daily or intravenously (b35–b37), and others. The expected verdicts were written by the coding agent and are offered for the owner's review.

| Verifier model (the claim and its sources only) | Run 1 | Run 2 | Calls answered | Median time | Notes |
|---|---|---|---|---|---|
| `gemini-3.1-flash-lite` (cheapest tier) | **37 / 37** | **37 / 37** | 8 of 13 (3 passed the 25-second limit, 2 "high demand") | 7.5 s | Every quote found word for word in its source; every contradiction shown by a quote. |
| `gemini-3.5-flash-lite` | 34 / 37 | 35 / 37 | 8 of 8 | 16.6 s | The misses all called a single wrong word (the unit, the route) or a misapplied threshold "partly supported" instead of contradicted — still not "supported", so still kept out of a form. |
| `gemini-3.8-flash` | 12 / 12 answered (25 not answered) | none answered | 1 of 17 (10 passed 25 s, 5 "high demand", 1 daily free-tier quota) | 24.6 s | Too slow on this day for the 25-second limit, then out of free-tier quota. |

**Across every answer of every model, no claim with a wrong meaning was rated "supported" (0 of 95 answers on the 22 such claims), and every correct claim was rated "supported" (65 of 65 answers).** The verifier only points: its quotes were checked in code against the source text, and its "unsupported parts" against the claim.

Examples, as the cheapest verifier answered them:

- b17 — *"With a creatinine clearance of 45 mL/min, the prophylactic enoxaparin dose should be reduced to 30 mg once daily."* → **contradicted**, quoting "No dose adjustment is recommended in moderate (creatinine clearance 30-50 mL/min) or mild (creatinine clearance 50-80 mL/min) renal impairment"; unsupported part: "should be reduced to 30 mg once daily".
- b02 — *"Serum creatinine fell from 2.6 mg/dL to 2.1 mg/dL between Day 0 and Day 1."* → **contradicted**, quoting both laboratory entries.
- b03 — *"Serum creatinine rose from 2.1 to 2.6 mg/dL, which confirms acute kidney injury."* → **partly supported**; unsupported part: "which confirms acute kidney injury" (an interpretation the data does not state).
- b22 — *"Ceftriaxone needs no renal dose adjustment and covers atypical pathogens such as Mycoplasma."* → **partly supported**; unsupported part: "and covers atypical pathogens such as Mycoplasma".

## 2. The 30 tasks on two synthetic cases, every claim verified

*(Being run at the time of writing; this section is completed with the results.)*

## 3. Reliability on this day

*(Completed with the results.)*

## 4. What this means for M5

*(Completed with the results.)*

## 5. Limits of this probe

- **Synthetic, and small:** 37 benchmark claims and two invented cases. The expected verdicts are the coding agent's reading, not a pharmacist's; the benchmark's reference passages are test passages written for it, not guidance.
- **Support, not truth:** the verifier judges whether a statement is supported by the sources it cites. A statement the model labels "general knowledge" has no source, so it is unsupported by definition until the evidence library (M5) can give it one; its medical truth is not judged by another model's memory.
- **A second model agreeing is not proof** (Section 12): it is one of the five signals, and the trainee still decides every item.
- **Free tier:** the availability and limits measured here are the free tier's on one day; a paid key has higher limits.
