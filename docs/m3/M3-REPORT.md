# PRECEPTOR — M3 report: the patient file read by the model, and AI drafts for the 30 tasks

**Date:** 16 October 2026 · **Branch:** `claude/preceptor-build-prompt-v4-slhq8k` · **Build:** 0.3.0 (M3)

**Status: built, tested, and run live with Google Gemini on a synthetic case — all nine acceptance criteria met; awaiting your decision.** At your request, the live run (criterion 9) was done in this environment with your free-tier key and the real RxNav service: see [M3-LIVE-RUN.md](M3-LIVE-RUN.md). It found real problems that the simulated tests could not, which are fixed and tested. One check remains for the deployment itself: open `/api/status` on the Netlify site once it is deployed. **M2 or any further milestone will not start without your explicit approval.**

The plan, with your decisions D1–D4, is in [M3-PLAN.md](M3-PLAN.md).

---

## 1. What was built

The flow you asked for: enter the patient file → **Next: Analyse the file** → the model reads it → you check each value → it drafts the 30 tasks, module by module → you open each task and decide each suggestion.

| Part | Where | What it does |
|---|---|---|
| Relay | `relay/`, `netlify/functions/model.mts` | A Netlify Function at `/api/model` and `/api/status`. Holds the API key (environment variable only). Model allow-list and prices from configuration — no model id in the code. Refuses a Clinical Case on a free-tier key. Hard monthly spending cap (cost reserved before the call, corrected after). Per-installation limits per minute and per day. Optional access code. Stores only counters; logs nothing. Gemini adapter behind a provider-independent interface. |
| One entry point | `src/ai/client.ts` | `callModel` is the only way to the model. Checks the answer against the schema. Audits every call (model, prompt version, tokens, cost — never the content). |
| AI settings | Settings → AI service | Relay status, key class, this month's budget, the model per task chosen from the relay's list, the access code, this device's usage. |
| Reading | `src/ai/extraction/` | De-identification at send time (identifiers masked again; calendar dates → hospital days; images only after redaction). The model copies values with the raw text beside each one, its legibility and its box on the page. Medication pages and handwriting are read twice; disagreements are flagged. Every value then passes the same validation as a typed entry: units, plausible ranges, error-prone abbreviations (expanded and flagged), drug names through RxNorm. An illegible value is emptied in code, whatever the model returned. |
| Checking | Analyse → Check the values | Side by side with the source (the value's text highlighted, or its box on the photographed page). Each value is **confirmed, corrected or rejected** on its own. A confirmed value becomes a timeline entry or a pre-admission/discharge medicine row with provenance *confirmed* and a link back to the document. |
| Drafting | `src/ai/analysis/` | The confirmed record only, without identifiers, with a reference for every item (E1, M1, P1, R1). One call per module. The model drafts checklist answers, register rows, missing data and questions; each statement says whether it rests on the case data or on general knowledge. |
| Checks in code | `src/ai/analysis/verify.ts`, `limits.ts` | Before anything is shown: references to data that was not sent are removed; numbers not in the referenced data are removed; **doses are withheld** ("[dose withheld — to be calculated]") until the M2 calculators; citations, DOIs, URLs, "et al.", recommendation grades and commercial source names are removed; invalid choices are dropped; and what only the trainee can record is removed (section 4 below). |
| Deciding | each task worksheet | The task's draft, each suggestion with its basis (*From the case data: …* or *General knowledge — no source, unverified*) and what the checks removed. **Accept, Edit or Reject (a reason is required)**, one at a time. No "accept all"; Accept is never the default or focused action. A draft older than the record is locked until drafted again. |

## 2. Your decisions, and a correction

D1 (M1 approved), D2 (AI before M2, doses wait for M2), D3 (general knowledge allowed, labelled "no source — unverified", decided per item; doses and references still forbidden) and D4 (no paid key yet) are all applied.

**Correction:** in my question to you I wrote that the specification forbids the free tier. That was wrong. Decision 3 of the specification allows a free key **with synthetic data**; what it forbids is sending a **Clinical Case** to a free-tier key. The build follows the specification: with a free key you can use Teaching Cases (synthetic) now; Clinical Cases are refused by the app and by the relay.

## 3. Test results (run on 16 October 2026)

| Check | Result |
|---|---|
| TypeScript, strict (`npm run typecheck`) | No errors |
| Unit tests (`npm test`) | **226 passed** of 226, in 17 files — 74 of them for M3 (relay 26, Netlify Function 4, client 9, reading 20, drafting 15) |
| Production build (`npm run build`) | Built; service worker precaches 28 files |
| End-to-end tests (`npm run test:e2e`, Chromium, phone size) | **19 passed** of 19 — 6 new for M3, and all 13 earlier M1 tests still pass |
| Live run (`e2e/m3-live.spec.ts`, real Gemini and RxNav) | **Passed**: 12 of 12 calls succeeded, 22 of 22 values read correctly, all 8 modules drafted (237 suggestions), every safety check held — [details](M3-LIVE-RUN.md) |

The M3 end-to-end tests run the real relay code and the real Gemini adapter; only the final HTTPS call to Google is answered by a stand-in in Gemini's response format (`e2e/ai-relay.ts`, `e2e/ai-fixtures.ts`). The stand-in's answers deliberately include what the app must catch.

Mutation checks (a safeguard switched off on purpose, to see that a test notices): disabling the free-key refusal, the spending cap, the limit on trainee-only fields, the limit on trainee-only checklist items, or the rule that a dose may use only cited data each made a test fail; each was restored.

## 4. What the model never drafts (new in code, from Section 24)

While preparing the tests I found that the drafts could pre-fill fields that record what **happened** — the team's response, "implemented", outcomes, reports — or a reference. Even with a per-item decision, that would present a proposal as done, or let the model name a source. This is now prevented in code (`src/ai/analysis/limits.ts`): these items are not requested, and are removed with a visible note if the model offers them.

- **Checklist items about what a person did** (38 items), e.g. "Patient or family interviewed", "Allergies confirmed with the patient", "Unintentional discrepancies communicated to the prescriber", "Independent double-check before administration", "Discussed with my preceptor", "Teach-back used", "Attended and contributed".
- **Fields that record events or outcomes**: team response, who it was communicated to and when, implementation, follow-up outcome, ADR action/outcome/causality/reporting, whether an error reached the patient, adherence and last dose (from the patient), resolution of a discrepancy, discharge decisions.
- **Sources and targets**: interaction severity "as stated by your source" and where it was checked; drug-level and monitoring targets; references.
- **Whole registers**: references, rounds, counselling, and the trainee's own calculation checks.
- **Whole tasks**: Task 23 (protocols and guidelines — naming them would be citing) and Task 25 (reflection — the trainee's own). These show "The model does not draft this task: it is yours alone."
- A drug-related problem may be proposed only as a *draft* recommendation; a monitoring row only as *active*.

## 5. Acceptance criteria

| # | Criterion | How it was verified | Result |
|---|---|---|---|
| 1 | No API key anywhere in the built frontend | E2E scans every built file for key patterns (`AIza…`), `GEMINI_API_KEY`, `x-goog-api-key`, the provider's address, the word "gemini" and the test key; the browser's requests carry no key (the relay adds it). | **Met** |
| 2 | Upload impossible until redaction is confirmed | "Save this page" stays disabled until "I have redacted all identifiers" is ticked (E2E); the store refuses a document without the confirmation (unit); the page image the model received is the redacted one — black over the identifiers, untouched below (E2E, pixels checked). | **Met** |
| 3 | An extracted value is used nowhere until confirmed | One value was left unconfirmed in the E2E walkthrough: it is absent from all eight drafting requests; the timeline holds only confirmed values (E2E, unit). | **Met** |
| 4 | An illegible dose is null, never guessed — in code | The stand-in returns "20 units" for an illegible handwritten dose: it is shown as *Illegible — enter it yourself*, without the number, and cannot be confirmed (E2E, unit). | **Met** |
| 5 | The spending cap refuses at the boundary with a clear message | With US$0.995 of US$1.00 spent, the next reading is refused: "The monthly AI budget is reached. It resets at the start of next month. Used this month: US$0.995 of US$1.00." The run stops; nothing reaches the model (E2E). Boundary arithmetic, reconciliation and month change (unit). | **Met** |
| 6 | A Clinical Case is refused on a free-tier key, Teaching Cases offered | The app shows the refusal and disables reading and drafting; a request sent directly to the relay gets 403 `free_key_clinical`; nothing reaches the model (E2E, unit). With the key declared paid, the same case is analysed and its patient name, MRN and consultant never appear in anything sent — including a name typed into a note (E2E). | **Met** |
| 7 | The four hostile fixtures (Section 21, adapted) | A reference to data not sent (E99) → removed, shown as "no source"; a number not in the data → removed; a dose ("30 mg") → withheld; a citation ("Smith et al., 2019") → removed — each flagged on the suggestion (unit and E2E). | **Met** |
| 8 | No bulk approve; accept never pre-selected; a rejection records its reason | No "all" button on the checking or drafting screens; the focused element is never Confirm/Accept; Reject stays disabled until a reason is typed; the reason is in the audit log (E2E, unit). | **Met** |
| 9 | Live extraction and analysis of a synthetic case | Done here at your request, with your key and Google's real service, through the relay code and the app in a browser: 22 of 22 values read correctly, the illegible dose not guessed, all 8 modules drafted, no identifier, date, citation or unsupported number anywhere ([M3-LIVE-RUN.md](M3-LIVE-RUN.md)). The Netlify site itself is checked after deployment (`/api/status`). | **Met** |

## 6. Demonstration

Screenshots from the end-to-end tests (synthetic data, phone size) are in [screenshots/](screenshots/):

| File | Shows |
|---|---|
| `m3-01-ai-settings.png` | Settings → AI service: connected, free-tier key, budget, models from the relay's list |
| `m3-02-analyse-start.png` | Next: Analyse the file — the three steps |
| `m3-03-read.png` | Both documents read (19 and 4 values) |
| `m3-04-review.png` | Checking: values beside the source, nothing confirmed in bulk |
| `m3-05-review-disagreement.png` | The two readings disagree on a dose; RxNorm match; the source highlighted |
| `m3-06-correct.png` | A value read without its day, corrected before use |
| `m3-07-review-page.png` | The photographed page: redacted, a box on every value read |
| `m3-08-drafted.png` | All 8 modules drafted, with the cost |
| `m3-09-task-draft.png` | Task 8's draft: from the case data, and general knowledge with its citation removed |
| `m3-10-drp-suggestion.png` | A drug-related problem proposed: dose withheld, citation and "implemented" removed |
| `m3-11-stale.png` | A draft locked after the record changed |
| `m3-12-usage.png` | This device's calls and the month's spend |
| `m3-13-free-key-refused.png` | A Clinical Case refused on a free-tier key |
| `m3-14-budget-reached.png` | The spending cap reached |
| `m3-15-analyse-arabic.png`, `m3-16-draft-arabic.png` | The same screens in Arabic, right to left |
| `r06b-analyse-no-service.png` | A site without the relay: the app says so and the manual path stays open |

## 7. Defects found by the tests and fixed

- On the checking screen, a tap on **Confirm** could miss: selecting the card on press re-rendered the source and the page moved before release. Fixed (selection on click or keyboard focus only; fixed-height source pane).
- The drafting request listed Tasks 23 and 25 in its header although their content was not sent. Fixed.
- A removed citation could leave a stray bracket. Fixed, with a unit test.
- A related diagnosis in a proposed row showed an internal id instead of its name. Fixed.
- A failed module said only "failed"; it now says why.
- The relay's rate-limit counters created a new record every active minute; now one record per installation, rewritten in place.

## 8. Incomplete, known limitations, and honest caveats

- **The live run covered one synthetic case.** Real handwriting, poor photographs and Arabic text were not covered; the fixture library of the release gate measures that.
- **The free tier is not enough for regular use**: 20 requests per model per day, and frequent "high demand" refusals (10 of 24 calls in the first live run). Clinical Cases need a paid key in any case.
- **On Netlify, set `PRECEPTOR_THINKING=extract=low,analyse=low`.** With the model's default thinking, two drafts took nearly 30 seconds, Netlify's limit; at "low" the slowest call took 15.6 s. The relay now stops at 25 s with a clear message.
- **The key class is declared, not detected.** The provider offers no way to ask whether a key is free or paid; the relay trusts `PRECEPTOR_KEY_CLASS` and assumes *free* when it is not set.
- **Doses are withheld** in every draft until the M2 calculators exist; dosing tasks show "[dose withheld — to be calculated]".
- **No evidence library yet**: general-knowledge statements carry no source by design (D3); the evidence that would back them comes in a later milestone. The spec's M5 criterion ("the app says so rather than answering from model knowledge") conflicts with D3 and must be re-decided then.
- **The second-check model tier** ("verify") can be chosen in Settings but is not used yet.
- **Cost estimates are deliberately high** (2.5 characters per token and the full output allowance are reserved), so the cap can refuse slightly before the true limit.
- **Changing the model list** in Netlify takes effect on the next deploy (no code change). Switching between models already on the list is immediate, in Settings.
- **Highlighting in typed documents** matches what was read; where a date was sent as a hospital day, the longest matching part is highlighted.
- **Main script size** is about 556 kB (180 kB compressed); the build warns above 500 kB. It loads once and is cached for offline use.
- **Release gate unchanged:** no real patient data until the department head's written authorisation, a paid key, M1–M6 accepted and the fixture library passed.

## 9. What remains outside this environment

1. Deploy this branch on Netlify with the environment variables in the README ("AI service"), including `PRECEPTOR_THINKING=extract=low,analyse=low`. `PRECEPTOR_MODELS` takes current model ids and prices from Google's pages (the live run used gemini-3.8-flash).
2. Open `https://<your-site>/api/status`: it should answer `"configured": true` with your models. Then run one synthetic case on the site.

## 10. Your decision

Please choose one:

- **Accept M3** — the live run is done; the Netlify check above can follow the deployment.
- **Request changes** to M3 — tell me what to change; I will fix it and report again.
- **Approve the next milestone (M2, calculators)** — only once you are satisfied with M3.

---

## ملخص بالعربية

- **ما بُني:** بعد إدخال ملف المريض يظهر زر **التالي: تحليل الملف**. يقرأ النموذج كل مستند (بعد إخفاء المعرّفات وتحويل التواريخ إلى أيام الإقامة، والصور بعد التغطية فقط)، ثم تتحقق أنت من كل قيمة على حدة بجانب المصدر (تأكيد أو تصحيح أو رفض)، ثم يكتب النموذج مسودة للمهام الثلاثين وحدةً وحدة من السجل المؤكَّد فقط، وتقرر أنت كل اقتراح منفرداً (قبول أو تعديل أو رفض مع سبب). لا يوجد «قبول الكل».
- **الضوابط في الكود:** حذف أي إحالة لبيانات لم تُرسل، وأي رقم غير موجود في بيانات الحالة، وحجب الجرعات حتى حاسبات M2، وحذف الاستشهادات وأسماء المراجع التجارية، ووسم المعرفة العامة بـ«بلا مصدر وغير متحقق منها»، ومنع النموذج من تعبئة ما لا يسجّله إلا المتدرب (ما تم فعله، والنتائج، والمصادر).
- **التشغيل الحي (16 أكتوبر 2026، بمفتاحك وبيانات مصطنعة):** نجحت 12 من 12 استدعاء، وقُرئت 22 من 22 قيمة بشكل صحيح، ولم تُخمَّن الجرعة غير المقروءة، وكُتبت مسودات الوحدات الثماني (237 اقتراحاً)، ولم يُرسل أي معرّف أو تاريخ، ولم يظهر أي استشهاد أو رقم من خارج بيانات الحالة.
- **الاختبارات:** 226 اختبار وحدة و19 اختبار متصفح، كلها ناجحة.
- **تصحيح:** ذكرتُ سابقاً أن المواصفات تمنع المفتاح المجاني، وهذا خطأ؛ المفتاح المجاني مسموح مع **الحالات التعليمية (بيانات مصطنعة)**، والممنوع هو إرسال **الحالة السريرية** بمفتاح مجاني.
- **بقي خارج هذه البيئة:** نشر الموقع على Netlify والتحقق من `/api/status`، مع ضبط `PRECEPTOR_THINKING=extract=low,analyse=low`.
