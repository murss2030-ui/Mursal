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

The two invented cases ([tests/live/cases.ts](../../tests/live/cases.ts)) were entered as a trainee types them: **A** — community-acquired pneumonia, acute kidney injury on chronic kidney disease and type 2 diabetes, with metformin and ibuprofen still ordered; **B** — atrial fibrillation and decompensated heart failure, warfarin with newly started amiodarone, digoxin with low potassium and magnesium, and an INR rising to 3.9. Each case was drafted module by module with the app's own code (28 of the 30 tasks are drafted; Tasks 23 and 25 never are, by design), then every statement that rests on case data — a checklist answer's reason, a register row's reason, each claim of a drafted Problem Card — was verified against the very text the drafting model had received for the data it cites.

| | Case A | Case B |
|---|---|---|
| Modules drafted | **8 of 8** | **8 of 8** |
| Drafting model | `gemini-3.6-flash` (collect, review, dosing, safety); `gemini-3-flash-preview` (plan, follow-up, discharge, document) | `gemini-3-flash-preview` (collect, review, dosing, plan, follow-up); `gemini-3.5-flash-lite` (safety, discharge, document) |
| Suggestions drafted | 161: 47 checklist answers, 20 register rows, 28 summaries, 30 missing data, 36 questions | 146: 51 checklist answers, 20 register rows, 28 summaries, 18 missing data, 29 questions |
| Problem Cards drafted | 4 | 4 |
| Statements on case data verified | **58** | **61** |
| Verdicts | 20 supported · 20 partly · 15 unsupported · **3 contradicted** | 25 supported · 14 partly · 22 unsupported |

Several drafting models were needed because the free tier allows **20 requests per model per day, refused ones included**; each model ran out in turn. Verification was done by `gemini-3.5-flash-lite` (29 statements), `gemini-3.1-flash-lite-preview` (55) and `gemini-3.1-flash-lite` (35, including the 15 the preview model could not check that day).

**Of 119 statements, 45 were supported with a quote and would pass the gate; 74 would be held back, each with its reason:** 34 partly supported, with the unsupported words named; 37 unsupported; 3 contradicted, with the contradicting quote — one a real error (the "elevated" clearance below), two judged wrong by the reviewer (below).

### Checked against a reviewer's reading

The coding agent read all 119 statements beside their sources, under the verifier's own rule (support by the cited sources only), and recorded every verdict a careful reader could defend ([live/review-claims.json](live/review-claims.json)). **The verifier agreed on 110 (92 %)**, was stricter on 3, and **looser on 6 (5 %)** — the unsafe direction:

| Statement (as drafted) | Verifier | Reading | What it let through |
|---|---|---|---|
| "Acute kidney injury is present, but nephrotoxic agents like ibuprofen and metformin are still active." | supported | partly | **A wrong medical description: metformin is not nephrotoxic** (its risk in kidney injury is lactic acidosis), and no source says "nephrotoxic". |
| "Nephrotoxic NSAID (ibuprofen) and metformin continue during active AKI." | supported | partly | A drug property not in the data (true for ibuprofen). |
| "Hypertension is active but home amlodipine is not ordered; blood pressure currently 98/60 mmHg." | supported | partly | "Currently" for a Day 0 value on Day 2, and an absence the cited sources do not show. |
| "Elevated creatinine, glucose, and potassium levels are noted without a documented interpretation of the AKI severity…" | supported | partly | A statement about the record. |
| "Dose and route were changed for the management of acute decompensation." | supported | partly | A reason the data does not state. |
| "INR increased to 3.9 on hospital day 2." | supported | partly | A rise, when only the Day 2 value is cited (true in the record). |

**The weakness is consistent:** a description, a time word, a reason or an absence folded into a statement whose facts are in the data. One of the six is medically wrong. The stricter answers were two false "contradicted" verdicts (a change from "as needed" to a fixed schedule, which both sources show; "no interventions recorded") and one statement whose quotes did not match its source.

Once, the verifier was more careful than the reviewer: *"Creatinine, glucose, and potassium trends are available for the first three days"* → **partly supported**, unsupported part "potassium trends are available for the first three days" — potassium has values for Day 0 and Day 1 only. The reviewer had missed it; the reading was corrected.

On the 17 statements both `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite-preview` answered, they gave the same verdict 13 times and **the same pass-or-hold decision 16 times**.

### What the verifier caught that no check in code could

- *"Ibuprofen and metformin are prescribed despite worsening renal function and **elevated** creatinine clearance."* → **contradicted**, quoting "Creatinine clearance (Cockcroft-Gault): 30 mL/min - Day 2". There is no number in the statement for the number check to test.
- *"Patient remains febrile on day 2 despite current antibiotic regimen."* → **partly supported**, unsupported part "on day 2": the fever is recorded on Day 1. "2" is today's hospital day, so the number check let it through.
- *"Patient has documented penicillin allergy (rash); cross-reactivity risk with cephalosporins must be evaluated."* → **partly supported**: the allergy is in the data, the cross-reactivity point is clinical knowledge — exactly what M5's evidence library must ground.
- *"Amiodarone increases the effect of warfarin, raising bleeding risk and INR."* → **unsupported**: true, but not in the case data; it needs a retrieved source.
- *"The INR of 3.9 and potassium of 3.4 mmol/L are outside reference ranges and require intervention."* → **partly supported**: "require intervention" is a judgement.
- About 20 of the 119 statements described what was done — "were evaluated for interactions", "checked for look-alike sound-alike drug mix-ups", "were reconciled" — which the drafting prompt already forbids (rule 8). The verifier held all of them back.

### What no check looks at yet: the classification of the drafted Problem Cards

The verifier checks statements against data; nothing yet checks a drafted card's PCNE codes against what the card says. Of the 8 drafted cards, **3 carry a classification that contradicts their own text**: two cards about toxicity (metformin in kidney injury; digoxin with a raised level) list **C3.1 "Drug dose of a single active ingredient too low"** — which would tick "Dose too low" in the form's Section 8 — and a card titled "*Potential* nephrotoxicity from NSAID use" is typed **manifest**. The trainee decides every card, so none of this reaches the form unseen; but it is a check the app could make (proposal 6 below). The model also drafted the same problems in Task 5 and again in Task 29.

## 3. Reliability on this day (free tier)

| Calls | Attempts | Answered | "High demand" (HTTP 503) | Over the 25-second limit | Daily free-tier limit (HTTP 429) |
|---|---|---|---|---|---|
| Drafting | 61 | 16 | 28 | 2 | 15 |
| Verification | 96 | 45 | 29 | 21 | 1 |

Answered calls took a median of 9 s (drafting 5–17 s, verification 3–25 s). The free tier allows 20 requests per model per day, refused ones included, and offers no Pro or newest-generation model (`gemini-3.1-pro-preview`, `gemini-pro-latest`, `gemini-4-argon` and `gemini-omni-1.1-flash` have a free-tier limit of 0). **Regular use needs the paid key** (plan decision 11).

## 4. The cost

- **Billed: US$0** — the key is free-tier.
- **The same calls at published paid prices: US$0.20 for the whole probe** (the benchmark, the smoke test, both cases, the re-verifications): drafting US$0.11, verification US$0.09. Calls cut off at 25 seconds are not counted; on a paid key Google may bill them.
- **One whole case** — 28 tasks drafted and every statement verified — is about 22,000 input and 13,500 output tokens of drafting and about 8 verification calls: **about US$0.08 at paid prices** (drafting about US$0.07 at Flash prices, verification about US$0.015 on the cheapest tier). One case per working day is **under US$2 a month**, inside the US$5 cap with room for M5's research and embeddings.
- Prices used (USD per million tokens, input/output, thinking billed as output), as listed by third-party price pages on 20 October 2026 because Google's own page could not be reached from here: 3.6 and 3.8 Flash 0.75/3.75 (until 31 December 2026), 3 Flash Preview 0.50/3.00, 3.5 Flash-Lite 0.30/2.50, 3.1 Flash-Lite 0.25/1.50. To be checked on Google's page.

## 5. What this means for M5 (proposals, for the owner's decision)

Already done while the probe ran, with tests (the verifier module is not yet on any screen):

- A claim citing data must be **shown supported by that data**, not only by the case header; a verifier that also quotes a **source the claim does not cite** gives at most "partly supported"; the **number of quotes allowed follows the claim's sources** (a whole batch had been refused). None of these changes any benchmark verdict; they are applied to the case statements above.

Proposed for the M5 build:

1. **Verifier prompt `verify-v2`:** name the categories it let through — drug properties ("nephrotoxic"), time words ("currently", "on day N"), changes with one value cited ("increased"), stated reasons ("for the management of"), absences ("not ordered") — with benchmark items for each before it replaces `verify-v1`.
2. **A fallback verifier:** the verify task takes an ordered list of models, so that a busy model (as on this day) passes the batch to the next instead of leaving claims unchecked. The models stay configuration.
3. **Drafting prompt `analyse-v4`:** a checklist reason states the data that answers it, never that a check was done; no internal references ("Amlodipine (R2)") in the text; a Problem Card's claim may cite several values; no second card for a problem already drafted.
4. **What the model receives:** register rows with their field names and choice labels (the verifier saw "patient|containers" with no hint that these are the sources of a medication history); calculation results with their inputs (weight, creatinine, day).
5. **The lite tier does not draft:** `gemini-3.5-flash-lite`'s drafts included fragments ("Pre-admission warfarin reconciliation."). Drafting stays on the Flash tier; the lite tier verifies.
6. **New: a coherence check of the classification.** A drafted card's PCNE problem, type and causes are checked, as claims, against PCNE's official wording of those codes and the card's own statements; "dose too low" on a toxicity card or "manifest" on a "potential" problem is flagged before the trainee decides.
7. **A clean rerun on the paid key** at the end of M5 (M5f): one drafting model throughout, both cases, the same review.

## 6. Limits of this probe

- **Synthetic, and small:** 37 benchmark claims and two invented cases. The expected verdicts are the coding agent's reading, not a pharmacist's; the benchmark's reference passages are test passages written for it, not guidance.
- **Support, not truth:** the verifier judges whether a statement is supported by the sources it cites. A statement the model labels "general knowledge" has no source, so it is unsupported by definition until the evidence library (M5) can give it one; its medical truth is not judged by another model's memory.
- **A second model agreeing is not proof** (Section 12): it is one of the five signals, and the trainee still decides every item.
- **Free tier, one day, several models:** the availability and limits measured here are the free tier's on 20 October 2026, and the drafts come from three models because each ran out of its daily quota; a clean rerun on the paid key is proposed (proposal 7).
- **The rules changed during the probe:** the three code rules added while it ran are applied to every recorded verdict above; the raw answers in [live/](live/) are as returned.
