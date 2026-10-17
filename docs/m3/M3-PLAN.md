# PRECEPTOR — M3 plan: the patient file read by the model, and case analysis for the 30 tasks

**Status:** accepted by the owner on 17 October 2026, after the live run with Google Gemini on a synthetic case — see the [M3 report](M3-REPORT.md) and the [live run](M3-LIVE-RUN.md). M1 (with Revision 1) was approved by the owner on 16 October 2026.

## 1. Owner decisions that change the specification (16 October 2026)

| # | Decision | Specification text it changes |
|---|---|---|
| D1 | **M1 is approved** (owner's choice "AI analysis next", which stated "approve M1 now"). | — |
| D2 | **AI analysis comes next, before M2.** After the patient file is entered, an **Analyse** step reads it and produces drafts for the 30 tasks, one by one, each decided item by item. Dose numbers wait for the M2 calculators. | Section 22 order (M2 before M3; Problem Cards in M4, evidence in M5). |
| D3 | **The model may draft from general clinical knowledge, labelled.** Each such statement is marked *no source — unverified*; the trainee decides per item. Doses and references stay forbidden. | Section 12: "never recalls a clinical fact from training". The data model already has `sourceType: 'llm_only'` for such claims. Conflicts with the M5 acceptance criterion "the app says so rather than answering from model knowledge" — to be re-decided when M5 is built. |
| D4 | **No paid key yet.** | Unchanged rules apply: a **free key may be used with synthetic data only** (Decision 3); the app refuses to send a **Clinical Case** to a free-tier key and offers Teaching Cases (Section 18, in code). |

Everything else in the specification stands: the key never reaches the browser; one `callModel` entry point; model ids are configuration; a hard server-side spending cap; no payload logging; identifiers never sent; redaction before upload; every extracted field confirmed before use; no number without a source; no citation from the model; no bulk approve; proposed ≠ implemented.

## 2. Build-time verification (Section 24, "verify at build time")

Checked on 16 October 2026 through web search; the official pages could not be opened from the build environment, so each point must be re-checked when the relay is deployed.

- **Availability:** Yemen appears in Google's list of regions where Google AI Studio and the Gemini API are available.
- **Free tier and data use:** Google's pricing page marks free-tier content as used to improve Google's products and paid-tier content as not — consistent with Section 18 (free key = synthetic data only).
- **Model identifiers change fast:** sources describe a Gemini 3.x line-up (Flash, Flash-Lite, a Pro preview) and the retirement of Gemini 2.5 Pro/Flash on 20 October 2026. This confirms Section 6: **no model id appears in the code**; the operator sets an allow-list, the trainee picks from it, and a retired model is replaced without a rebuild.
- **Prices:** third-party figures disagree. Prices are **configuration** of the relay; the spending cap uses them, and a model without a configured price is refused.
- **Key class:** the Gemini API offers no way to ask whether a key is free or billing-enabled. The relay therefore takes the key class from its configuration, **defaults to "free"** when it is not set, and the refusal of Clinical Cases on a free key is enforced in code on both sides (relay and app).
- **Network in the build environment:** `generativelanguage.googleapis.com` and `rxnav.nlm.nih.gov` are blocked here. The provider adapter and the RxNorm connector are tested against recorded responses that follow the published formats; **a live run is required on the deployed relay** before M3 can be accepted.

## 3. What will be built

1. **Relay** (`netlify/functions/model.mts`, core in `relay/`): stateless; holds the API key; provider module for Gemini behind a provider-agnostic interface; model allow-list and prices from environment variables; monthly spending cap with the estimated cost reserved before the call and reconciled after; per-minute and per-day limits per installation; optional access code; key class; `/api/status`; no payload logging.
2. **Client AI layer** (`src/ai/`): the single `callModel({ task, input, schema })`; AI settings (models per task tier chosen from the relay's allow-list, access code) in the encrypted settings; every call audited with model id, prompt version, retrieved chunk ids (none yet), timestamp and token use — never the payload; a usage screen.
3. **Extraction** (Section 13): de-identified payloads (identifier guard on text, calendar dates converted to hospital days, images only after redaction); the extraction contract (raw text beside the value, legibility, bounding box, null rather than a guess); dual pass on medication documents and handwriting; deterministic checks (plausibility ranges, units, drug names through RxNorm approximate matching, with a local cache and "not checked" offline); an extraction run stored as versions; the **side-by-side review** where each field is confirmed, corrected or rejected; a confirmed field becomes a timeline entry (or a pre-admission/discharge medication row) with provenance *confirmed* and a link back to the source and its box.
4. **Case analysis** (D2, D3): the de-identified, **confirmed** case is analysed module by module; for each of the 30 tasks the model drafts checklist answers, register rows (e.g. drug-related problems, interactions, monitoring), missing data and questions, each statement labelled *from the case data* or *general knowledge — no source*. Checks in code: references must point to data actually sent; every number must trace to the case data or is removed (doses withheld until M2); citations are removed; choices must be valid. Each suggestion is **accepted, edited or rejected (with a reason)** one at a time; an analysis older than the data is marked stale.
5. **The Next step:** "Next: Analyse the file" on the patient-file screens → reading → review → analysis → the Clinical Modules with the drafts in each task. Without a configured service, the app says so and keeps the manual path.

## 4. Acceptance criteria (Section 23, M3, plus the owner's additions)

1. No API key anywhere in the built frontend bundle — verified by searching the build output.
2. Upload is impossible until redaction is confirmed.
3. An extracted field cannot be used (timeline, tasks, form, analysis) until confirmed.
4. An illegible dose is returned as null, never guessed — enforced in code whatever the model returns.
5. The spending cap refuses a call at the boundary with a clear message.
6. A Clinical Case is refused on a free-tier key, with Teaching Cases offered.
7. The four hostile fixtures of Section 21, adapted: a reference to data that was not sent, a number not in the case data, a dose in the narrative, a citation — each caught and flagged.
8. No bulk approve; accept never pre-selected; a rejection records its reason.
9. A live extraction and analysis of a synthetic case on the deployed relay (needs the owner's key).
