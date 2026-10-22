# PRECEPTOR — M5 report: evidence

**Date:** 21 October 2026 · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.6.0 (M5)

**Status: built, awaiting the owner's review.** By the owner's instruction (21 October 2026) no live run of the whole app was made at the end of M5 and no quota of the free key was used: everything below was tested with unit tests, fixtures and stand-ins. The paid-key rerun is deferred until the whole app is built.

## 1. What M5 contains

| Part | What the build does |
|---|---|
| **The library** (M5a) | **Resources → Guideline library.** The trainee adds a PDF they obtained lawfully; it is read on the device (pdf.js), stored encrypted with its SHA-256, never shipped, never shared. Every item of its record is typed or confirmed by the trainee (title, publisher, year, edition, URL, licence, retrieval date, topic) — what the file says about itself is only offered. A role (primary document of its topic, or reference) and one choice about its text: **local search only (default)** or **may be sent to the AI service**, which needs the trainee's explicit confirmation that the licence allows it. A document older than five years carries a warning, and every citation from it says so. A scanned PDF is listed as "no text layer". The same file twice, and a file that is not a PDF, are refused. A correction is a new version with its reason; removal purges the file, its passages and vectors (the record and the reason stay in the audit log). |
| **Chunking and search** (M5a/b) | Structure-aware chunking from pdf.js text positions and sizes: headings give the section path; each numbered recommendation, table and drug paragraph is one passage with its page; a recommendation's strength is kept only as printed. BM25 on the device, plus vectors when an embedding model is chosen (task `embed` through the same relay: allow-list, free-key refusal of Clinical Cases, rate limits, spending cap, audit without the text), fused by reciprocal rank, exact drug names kept on top. A document kept for local search is never embedded. If the embedding service fails or the device is offline, search by words goes on and says why. A citation opens the stored PDF at its page, rendered on the device. A table passage offers **"Add to my renal and hepatic table"**, which opens the reference editor with the passage and its citation filled in; the trainee types the rows. |
| **The open sources** (M5c) | openFDA labels, PubMed (E-utilities), Europe PMC (peer-reviewed only), MedlinePlus Connect; DailyMed by link (below). No key; only drug names and the question's words are sent, after a check for identifiers (the case's own patient name, number, bed, consultant, a phone or long number, a doctor's name, a calendar date — refused, not masked). Every answer is cached encrypted with its retrieval date, refreshed after 30 days when online, and an old answer is kept and called old when the service cannot be reached. Studies carry "Literature to appraise — not a recommendation in itself". |
| **Research this question** (M5d) | **From a Problem Card.** The question in PICO form, built from the card, edited by the trainee; what leaves the device is said before anything is sent. Retrieval: the library first (primary documents before reference ones), then the open sources; every item is recorded as a source with its record-derived citation and a link. The model (task `research`, prompt `research-v1`; it uses the case-analysis model if none is chosen) drafts **only from the passages it was sent**, each statement citing one passage and quoting it word for word; it never writes a citation, a dose or a number the quote does not contain. A document kept for local search is *shown* to the trainee and **never sent** (the store refuses a run that would). When nothing is sendable the model is not asked; when nothing adequate is found the app says so plainly and keeps the question as an open item for the preceptor. The screen shows what the sources say to do, the supporting and the **conflicting** evidence side by side, what is missing, and **the limits of confidence as separate factors** (source type, abstracts only, age, verification, conflict, missing data, passages not read by the AI, sources not reached, a dose differing from the card's calculation) — computed in code, no single score. A run is versioned, never overwritten, and **stale like a card** when its card changes or a value it cites is superseded. |
| **The five checks on every statement** | (1) shape, (2) the cited passage was retrieved, (3) the quote is found word for word in it, (4) the independent verifier (`verify-v2`) reads its meaning against that passage and gives supported / partly / unsupported / contradicted with quotes, (5) numbers and doses must be in the quote, citations the model wrote are removed, and a dose that **differs from the calculation the card cites for the same quantity** is flagged in red and not shown. A statement the code rejects is recorded "unsupported" without asking a model. **The model's withheld number is stored nowhere.** |
| **The gate everywhere** (M5e, decision 6) | A statement is added to a card **one at a time**, only if the verifier found it supported with a literal quote and no check removed or withheld anything, and its run is not stale. A claim from a research carries its citation and quote and opens its run; reworded by the trainee it becomes the trainee's own (shown with its verdict if checked, not gated). A card with a model claim not found supported is left out of Section 9 of the form with the reason. |
| **Earlier M5 work** (in the same milestone) | Verifier `verify-v2` with a guard in code and fallback verifier models; the verifier after every draft; drafting prompt `analyse-v4`; the PCNE coherence check of each card against PCNE's official wording (with a trainee-only reason when the classification is questioned). |

## 2. Findings worth your attention

1. **DailyMed cannot be called from a browser.** Its service sends no CORS headers (checked on 21 October 2026 with the five hosts now allowed). Labels are therefore opened by **link only**, built from the set id openFDA returns; DailyMed is not in the Content-Security-Policy. The other four hosts send `access-control-allow-origin: *` and are in `connect-src`.
2. **Documents kept for local search are not read by the AI.** A research over a library made only of such documents finds the passages and shows them, and says the AI did not see them. To let the AI read a guideline, its licence must allow it and the trainee must say so.
3. **The calculation cross-check is deliberately cautious.** A dose in a statement with the same unit as a calculation the card cites but a different number is flagged red, even if the source's dose is for something else; the flag asks the trainee to look, it does not decide which is right.
4. **A statement the verifier cannot reach stays "not checked" and cannot be added**, until "Check these statements" succeeds.

## 3. Tests (21 October 2026, this build)

| Suite | Result |
|---|---|
| Type check (`tsc -b`, strict) | no error |
| Unit tests (Vitest) | **798 passed**, 53 files, 0 failed |
| Browser tests (Playwright, production build) | **40 passed**, 1 skipped (the live run), 0 failed |

New: `library.test.ts`, `library-run.test.ts`, `embed.test.ts`, `connectors.test.ts` (answers **recorded once from the real services**, `tests/fixtures/connectors`, replayed only for the exact address the app builds), `research.test.ts` (the four hostile fixtures of Section 21 — a source never retrieved, a paraphrased quote, a dose contradicting the calculation, a fact with no support — and the PICO, retrieval, licence gate, nothing-adequate, identifier, staleness, one-at-a-time and confidence-factor behaviour), plus the earlier `pcne-coherence`, `analyse-v4` and `verdict-gate`. `e2e/m5-evidence.spec.ts` (4 tests) runs the Section 23 criteria in the browser; `m3-ai.spec.ts` now shows a drafted card that cannot be accepted as it is, is left out of the form, and enters after the unsourced claim is edited out. Screenshots: `docs/m5/screenshots/`.

## 4. Section 23 — M5 criteria

| Criterion | Where it is shown |
|---|---|
| All four hostile fixtures are caught | `research.test.ts` (check level and through the whole run) |
| A claim with no retrieved support renders as unsupported and cannot enter a form | e2e: "Not supported by its source", Add disabled; unit: it cannot be added; m3-ai: a card with an unsupported model claim is left out of Section 9 |
| Every citation shown opens a real source | e2e: the library citation opens the stored page; label, PubMed and Europe PMC links are the recorded addresses (`rel="noopener noreferrer"`) |
| When retrieval finds nothing adequate, the app says so | e2e: "Nothing adequate was found…", open question, the model not called |
| Staleness; spending cap | e2e: a new creatinine makes the research stale; the cap applies to `embed` and every task (`embed.test.ts`, `m3-ai`) |

## 5. Not done, and limits (honestly)

- **No live run.** Nothing here has been checked against the real model; the real services' answers were recorded once for the connectors' tests only. The browser tests use stand-ins for the model and the open services, so "the CSP allows the hosts" is checked by the browser but the real services' CORS behaviour is as I measured with `curl`, not in a browser.
- The stand-in model is cooperative; how well the real model drafts from passages (and how often the verifier objects) is for the deferred paid-key rerun.
- Chunking is tested on synthetic documents; real guidelines (multi-column, scanned tables) may chunk worse.
- Tables are not extracted automatically; the rows of the renal and hepatic table are typed by the trainee.
- Vectors are computed on request per document; re-embedding after a model change is manual ("Compute them again").
- Task 23 (protocols and guidelines drafted from the library, decision 9) and the opening of an AI-suggested library document by id are **not** built: drafting for Task 23 still has no library hook. This is the one planned item left out; say if you want it before M6.
- Not in M5: export of the form (M6), the presentation (M7), learning modes (M8).
