# PRECEPTOR — M5 plan: Evidence

**Status:** plan prepared on 20 October 2026, after the owner accepted M4 and asked to start preparing M5 — with the paid model tried on the 30 tasks and the **meaning** of claims checked, not only their numbers. Nothing of M5 is visible in the app yet. Two things were prepared ahead of the build, because the owner asked for them and they inform the decisions below:

1. **The verifier pass** (Section 12, check 4) as a tested module, not yet connected to any screen: `src/ai/verification/` (prompt `verify-v1`), with 15 unit tests and a 37-item semantic benchmark (`tests/fixtures/semantic-benchmark.ts`).
2. **A live probe** of the real models on synthetic cases: the benchmark, and the 30 tasks drafted and then verified claim by claim. Results: [M5-LIVE-PROBE.md](M5-LIVE-PROBE.md).

**The owner's decisions (20 October 2026):** decisions 1–10 approved, with these choices:

- **Network:** the five open-source hosts were allowed by the owner; all five answered on 20 October 2026.
- **Guideline editions (decision 2):** community-acquired pneumonia — the **2019 ATS/IDSA** guideline as the primary document, the **2025 ATS** update as a secondary reference; heart failure — the **2022 AHA/ACC/HFSA** guideline as the primary document, **ESC 2021** (with its **2023** focused update) as a reference; acute kidney injury — **KDIGO 2012 only**, the published guideline; the 2026 draft is not used, since it is not final.
- **Licence (decision 3):** the default, *local search only*, until the trainee confirms a document's licence allows sending its text to the AI service.
- **The verdict gate (decision 6):** a statement enters the official form only with the verdict *supported* and its literal quote.

Decision 11 (the paid key) is the owner's to act on. The build follows the owner's review of the live probe's final results.

## 1. What M5 must deliver

From the specification:

- **Section 22, M5:** "Guideline upload, structure-aware chunking, local hybrid index, open-API connectors with caching, the retrieval flow, and the full five-check anti-fabrication pipeline with its hostile-fixture tests."
- **Section 11:** the library the trainee uploads (publisher, title, year, version, URL, licence, retrieval date and file hash per document; the age of the guideline beside every citation drawn from it, with a warning past five years); one recommendation, table or drug paragraph per chunk; dose tables as structured data for the rules engine, not prose for the model; hybrid search (BM25 + vectors) because drug names fail semantic search; embeddings through `callModel`, computed once; live sources (openFDA labels, DailyMed links, RxNorm, PubMed, Europe PMC, MedlinePlus Connect) cached with their retrieval date; and the retrieval flow — question in PICO form shown for editing before anything is sent, minimum case context, the local library first, each retrieved item recorded, the model drafting strictly from the retrieved text, verification, and **"when retrieval returns nothing adequate, the app says so plainly"**.
- **Section 12:** the structured output contract (claims with chunk ids, a literal quote and numeric references; `insufficientEvidence`; `missingData`) and the **five checks enforced in code**: chunk existence, literal quote match, numeric provenance, an independent verifier pass, and the calculation cross-check. A claim failing any of them is flagged and cannot enter a form or presentation until the trainee edits it. Composite confidence from deterministic factors, never the model's own rating. Every call audited with its retrieved chunk ids.
- **Section 23, M5:** all four hostile fixtures of Section 21 are caught; a claim with no retrieved support renders as unsupported and cannot enter a form; every citation shown opens a real source; when retrieval finds nothing adequate, the app says so rather than answering from model knowledge.
- **Section 4 and 24:** no commercial reference in any form; the app ships no guideline text; the model never produces a citation, title, author, year, DOI, URL or grade.

## 2. What already exists and will be reused

- **The model path:** `callModel` → the relay (allow-list, spending cap, rate limits, key class) → the provider adapter. The task `verify` already exists in the protocol and in Settings.
- **The checks in code of M3–M4**, which are the case-data form of checks 1–3 and 5: a reference must point to data actually sent (chunk existence); every number must be in the data it cites (numeric provenance); a dose only from a cited calculation result; citations, URLs, grades and commercial names removed.
- **Claims with their sources** on the Problem Card (M4): case data, a calculation, the offline interaction check, a source the trainee read, or none. M5 adds library passages, drug labels and literature as sources, each with its quote and verdict.
- **pdf.js on the device** (the patient file of M1) for the text of guideline PDFs; **the RxNav connector with its cache** (M3) as the pattern for the other connectors; **the renal and hepatic table** of M2 (trainee-sourced, with page or URL) as the place for dose tables.
- **Prepared today:** the verifier module, its tests, the benchmark and the live probe (above).

## 3. What will be built

| Part | Content |
|---|---|
| **M5a — The library** | Upload a guideline PDF (with a text layer); SHA-256 of the file; the metadata typed or confirmed by the trainee — nothing filled in by a model; age shown, warning past five years. Structure-aware chunking on the device from pdf.js's text positions and font sizes: headings give the section path, numbered recommendations, tables and drug paragraphs become one chunk each, with page and section; a recommendation's strength or grade is kept **only as printed in the document**. Local lexical index (BM25). Stored encrypted; never shipped, never shared. |
| **M5b — Hybrid search** | A new task `embed` through `callModel` and the relay (the embedding model is configuration, like the others); vectors computed once per chunk and stored on the device; re-embedding after a model change runs in the background. Ranking fuses BM25 and vector similarity, with exact drug-name matches kept on top. |
| **M5c — Open sources** | openFDA label sections (dosage, contraindications, interactions, renal and hepatic use), DailyMed links by set id, PubMed (E-utilities) and Europe PMC abstracts with links to full text, MedlinePlus Connect counselling text by RxCUI. Every answer cached with its retrieval date, so the same lookup never costs twice; only drug names or the question's words leave the device, never an identifier. PubMed and Europe PMC results are labelled "literature to appraise — not a recommendation in itself". |
| **M5d — Research this question** | From a Problem Card: the question in PICO form, built by the app from the card and editable before anything is sent; the minimum case context; the library first, then the open sources; every retrieved item recorded (source, title, publisher, date, URL, full text or abstract). The model drafts from the retrieved passages only, in the Section 12 contract. Then the five checks. The screen shows the recommendation, supporting and **conflicting** evidence side by side, what is missing, the limits of confidence as factors, and every source as a link that opens it. Nothing adequate → the app says so and offers the question as an open item for the preceptor; the model is not asked to fill the gap. |
| **M5e — Verdicts everywhere a claim is shown** | The verifier runs after every draft (M3 tasks, M4 cards, M5 research) on each statement that rests on a source, and on request on the trainee's own claims. Each statement shows its verdict: **supported**, **partly supported** (the words its source does not state are marked), **unsupported**, **contradicted by its source** (with the quote), or **not checked**. The form takes only claims that passed every check (decision 6). |
| **M5f — Tests and report** | The four hostile fixtures, the Section 23 criteria in the browser, a live run on synthetic cases, the report. |

The calculation cross-check (check 5) becomes explicit: today a dose not found in the cited calculation is withheld; in M5, when the case has a calculation for the same quantity, the statement is also flagged in red as **"differs from the calculation (C1: 26 mL/min)"** — the model's number is still never shown.

## 4. Data model (Section 7, adapted to what exists)

- **GuidelineDocument** — publisher, title, year, version, URL, licence, *may be sent to the AI service* (decision 3), retrieval date, file hash, pages; a correction is a new version.
- **EvidenceChunk** — id (document, section, page, number), section path, page, kind (recommendation, table, paragraph, drug paragraph), text exactly as extracted, recommendation strength and evidence grade as printed (if any), licence.
- **ChunkEmbedding** — chunk id, embedding model, vector, date.
- **SourceRecord** — every retrieved item: kind (library, openFDA label, DailyMed, PubMed, Europe PMC, MedlinePlus), title, publisher, date, URL or local document, full text or abstract only, retrieval date.
- **ResearchRun** — the *AnalysisVersion* of Section 7 for a question: the card, the PICO question, the retrieved chunk ids, model, prompt version, `insufficientEvidence`, the claims, the missing data and the conflicts; versioned, never overwritten, stale like a card.
- **Claim** (Section 7) — text, source type, source reference, **quote**, the results of the five checks and the **verifier verdict**.
- **ClaimVerification** — append-only: the claim's and source's fingerprints, the verdict, the quotes found, the unsupported words, the flags, model and prompt version.

## 5. Decisions needed from the owner

Each has a proposed default; you can approve them all at once or change any.

1. **Network access (blocking for M5c).** This environment refuses the open sources: `api.fda.gov`, `dailymed.nlm.nih.gov`, `eutils.ncbi.nlm.nih.gov`, `www.ebi.ac.uk` (Europe PMC) and `connect.medlineplus.gov` were all refused on 20 October 2026 (RxNav and the Gemini service answer). Please add these five hosts under **Allowed domains** in the environment's settings (the cloud environment menu in the session's title bar → Edit → Network access), leaving **Allow package managers** ticked; the steps are at https://code.claude.com/docs/en/cloud-environments#network-access. I will not build the connectors against recorded answers presented as real. In the deployed app the browser's Content-Security-Policy will allow the same hosts, which receive drug names or the question's words only.
2. **The guideline editions (Section 11 asks to verify them at build time; differences found).** Checked by web search on 20 October 2026 — please confirm which you will upload:

   | Section 11 lists | What is current | Note |
   |---|---|---|
   | Surviving Sepsis Campaign | **2026** international guidelines (published 23 March 2026) | Replaces 2021. |
   | KDIGO — AKI and CKD | AKI: the **2012** guideline is still the published one; a **2026 AKI/AKD guideline was a draft for public review** (closed May 2026), final publication not confirmed. CKD: **2024** guideline. | The 2012 AKI guideline will carry the "older than five years" warning. |
   | ADA Standards of Care 2026 | **Standards of Care in Diabetes—2026** (Diabetes Care 49, Suppl. 1) | As listed. |
   | IDSA/ATS community-acquired pneumonia | The joint guideline is **2019**. A **2025 update was published by ATS only — IDSA did not endorse it**. | Discrepancy: which one (or both, shown as separate documents)? |
   | ASHP/IDSA/PIDS/SIDP vancomycin, 2020 | **2020** (AJHP 2020;77:835–864) is still current. | As listed. |
   | GOLD | **GOLD 2026** report | Annual. |
   | GINA | **GINA 2026** strategy report | Annual. |
   | ESC/ACC heart failure | There is no joint ESC/ACC guideline: **ESC 2021** (with its **2023** focused update) and **AHA/ACC/HFSA 2022** are separate documents. | Discrepancy: which one(s)? |
   | WHO AWaRe antibiotic book | **2022** first edition; licence **CC BY-NC-SA 3.0 IGO** | As listed. |
   | IDSA/SHEA antimicrobial stewardship | The core guideline is **2016**; a 2026 multi-society document covers the skills of stewardship leaders, not the programme guideline. | The 2016 guideline will carry the five-year warning. |

   The trainee obtains the PDFs lawfully and uploads them in the app; they never enter the repository. My tests use synthetic documents only.

   **The owner's choice (20 October 2026):** pneumonia — 2019 ATS/IDSA primary, 2025 ATS secondary; heart failure — 2022 AHA/ACC/HFSA primary, ESC 2021 with its 2023 update as a reference; acute kidney injury — KDIGO 2012 only (the 2026 draft is not used). The library records each document's role (primary or reference), and a citation from a reference document says so.
3. **Licence gate for sending library text to a model (proposed).** Uploading a document for personal search is one thing; sending its text to an AI service (to embed it, or as a passage for the drafting model and the verifier) is another, and some publishers forbid it. Proposed: each document records its licence and one choice — **"may be sent to the AI service"** (only when its licence allows it — for example the WHO AWaRe book's CC BY-NC-SA) or **"local search only"** (lexical search; passages shown to the trainee; never sent to any model). The default is *local search only* until the trainee confirms the licence allows it.
4. **Embeddings (proposed).** A Gemini embedding model chosen in Settings like the other tasks; vectors are computed once per document (a guideline of about 100 pages is roughly 60,000 tokens — a few US cents at published embedding prices, to be confirmed on Google's page). Local-only documents stay lexical-only.
5. **Which models (proposed from the probe).** Drafting stays on the fast tier; **verification on the cheapest tier**, which agreed with the expected verdict on every benchmark item it answered. Details and costs in [M5-LIVE-PROBE.md](M5-LIVE-PROBE.md). The models remain configuration that you can change without a rebuild.
6. **The verdict gate (proposed).** A statement enters a form or the presentation only when it passed **all five checks** — its verifier verdict is *supported*. *Partly supported*, *unsupported*, *contradicted* and *not checked* statements are shown with their reason and must be edited (and are then checked again) or removed; they can never be accepted as they are. The trainee's own statements are checked on request and show their verdict, but the trainee's own judgement stays labelled as such.
7. **Open-source details (proposed).** openFDA without an API key (its free limit is ample for one trainee, and a key could not be placed in the browser); PubMed E-utilities with `tool=preceptor` and no e-mail address (no personal data leaves the app); FAERS adverse-event reports are not part of M5.
8. **Dose tables (proposed).** Automatic table extraction from PDFs is unreliable, so a table chunk shows its page and offers **"Add to my renal and hepatic table"**: the M2 table editor opens with the document, page and URL filled in, and the trainee types the rows. The rules engine uses only those confirmed rows.
9. **Task 23, protocols and guidelines (proposed).** Drafted from the library only: the model may point to a library document by its id, and the app shows that document's recorded metadata. A guideline never comes from the model's memory.
10. **Scanned PDFs (proposed).** A PDF without a text layer is listed as "no text — not searchable" and not indexed in M5 (reading it with the model would make every passage unverified text).
11. **The paid key (finding of the probe, action for you).** The key that reaches this environment is **a free-tier key**: Google's own refusals name the free-tier quotas (`generate_content_free_tier_requests`, `…-FreeTier`), and a Pro model, whose free-tier limit is 0, is refused. The paid key you mentioned is therefore not the one configured here. To use it: in this environment, replace the Gemini key in the environment's settings (cloud environment menu → Edit → Network secrets, or the environment variable `GEMINI_API_KEY`), which a new session picks up; on the deployed site, set `GEMINI_API_KEY` to the paid key and `PRECEPTOR_KEY_CLASS=paid` in Netlify. Never paste a key into the chat. A simple proof that a key is paid: a Pro model answers. **Proposed code change:** the relay notices a free-tier key from Google's quota answers and from then on treats it as free whatever `PRECEPTOR_KEY_CLASS` says — refusing Clinical Cases and saying so on the usage screen (Section 18: "This check is in code, not in documentation").

## 6. Acceptance criteria and their tests

| Criterion (Section 23, M5) | Test |
|---|---|
| All four hostile fixtures in Section 21 are caught | Integration, with the stand-in for the AI service: (1) a chunk id that was not retrieved → caught by the schema and the chunk-existence check; (2) a quote that paraphrases its chunk → fails the literal match; (3) a dose that contradicts the calculator → red "differs from the calculation" flag, number withheld; (4) a fact with no retrieved support → unsupported. Verifier-level forms of (1), (2) and (4) already pass in `tests/unit/verification.test.ts`. |
| A claim with no retrieved support renders as unsupported and cannot enter a form | Browser: a researched card with one unsupported claim shows it as *Unsupported*; Section 9 leaves the card out and says why; after the trainee edits the claim and it is checked again, it can enter. |
| Every citation shown opens a real source | Unit: a citation is rendered only from a SourceRecord (never from model text). Browser: each link opens the stored document at its page, or the URL recorded at retrieval (DailyMed set id, PubMed id, Europe PMC). Live: the links are opened against the real services (needs decision 1). |
| When retrieval finds nothing adequate, the app says so | Browser: a question with no matching passage → "Nothing adequate was found in your library or the open sources", the question kept as an open item for the preceptor; the model is not asked to answer it. |
| Section 21: staleness when a new entry lands; spending cap | A research run citing a creatinine goes stale like a card; the cap refuses a call at the boundary (M3 tests extended to `embed`). |

All M1–M4 tests must still pass.

## 7. Not in M5

Export of the form (M6, with its own export block), the presentation (M7), the learning modes (M8), the clinical fixture library with expert review (M9). Commercial references are never integrated (Section 4): a topic the trainee read in one stays "a source you read", which PRECEPTOR did not consult.

## 8. Main risks

- **Network:** the five open-source hosts are blocked in this environment today (decision 1).
- **Licences:** guideline publishers' terms differ; the per-document gate (decision 3) keeps text that may not be sent on the device.
- **The provider's availability:** in the probe, Google answered "high demand" (HTTP 503) often, and some calls passed the relay's 25-second limit (kept below Netlify's 30 seconds); the app retries once and then says so.
- **PDF structure varies:** chunking heuristics are tested on synthetic documents and then on the trainee's own.
- **A second model agreeing is not proof** (Section 12): the verdict is one signal of five, and the trainee still decides every item.
