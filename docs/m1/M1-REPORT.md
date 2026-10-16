# PRECEPTOR — Milestone M1 report

**Milestone:** M1 — Case and timeline core, with the early department-form screen (owner's amendment 1) and **Revision 1** (the owner's request after the first M1 report: patient-file intake and the Clinical Modules for the 30 tasks of a clinical pharmacist).
**Status:** built and tested; **awaiting the owner's approval**. M2 has not been started.
**Build:** version 0.1.0 · branch `claude/preceptor-build-prompt-v4-slhq8k` · report of 16 October 2026

---

## ملخص بالعربية

- **ما أُضيف في هذه المراجعة:** بعد إنشاء الحالة تنتقل مباشرة إلى **ملف المريض**: اكتب أو الصق نص الحالة، أو ارفع ملفاً (نص، PDF، صور)، أو صوّر صفحات الملف. تُزال المعرّفات قبل الحفظ (فحص تلقائي للنص + تأكيدك الإلزامي؛ وفي الصور تغطية تُدمج في البكسلات ولا تُحفظ الصورة الأصلية أبداً). ثم زر **التالي: الوحدات السريرية** يفتح **8 وحدات تضم المهام الثلاثين** للصيدلي السريري، لكل مهمة ورقة عمل: الهدف، كيف تؤديها، البيانات المطلوبة وما ينقص منها، قائمة تحقق (تم / مشكلة / لا ينطبق)، وقوائم مشتركة (أدوية ما قبل الدخول، المشكلات الدوائية، التداخلات، الآثار الجانبية، الأخطاء الدوائية، مستويات الأدوية، خطة المتابعة، الجولات، التثقيف، أدوية الخروج، المراجع، الحسابات اليدوية). **تتبّع الحالة:** حلقة تقدّم (x/30)، شريط لكل وحدة، المهمة المقترحة التالية، وشاشة «سير العمل» لكل الحالات النشطة. **نموذج القسم** يمتلئ الآن من هذه القوائم (الأقسام 4 و7–11). وتصميم جديد بخطوط IBM Plex العربية واللاتينية.
- **ما لم يتغيّر:** التشفير، السجل غير القابل للحذف (append-only)، الخط الزمني بأيام الإقامة، التصحيح بالإحلال، سجل التدقيق، حالات المصدر الثماني. **لا ذكاء اصطناعي ولا حاسبات ولا محرك قواعد** — فهي في مراحلها (M2–M8) كما في المواصفات.
- **نتائج الاختبارات الفعلية:** فحص الأنواع ناجح؛ 150/150 اختبار وحدة؛ 13/13 اختبار شامل (مرتين متتاليتين)؛ البناء بلا تحذيرات.
- **ما أحتاجه منك:** الموافقة على M1 أو طلب التعديل، والقرارات في القسم 6 (خصوصاً R1–R4 وR8).

---

## 0. Revision 1 — what changed and why

The owner asked (in Arabic) to keep the first M1 work, to add a way to enter the case **manually as text, as a file, or as photographs of the patient file**, to **track the case** like the "Clinical Modules" section of the prototype attached as an initial idea, and — once the case is entered — a **Next** button leading to the **Clinical Modules**, where all **30 tasks of a hospital clinical pharmacist** can be done; and to be creative in the design without copying the prototype.

| # | Added | Where |
|---|---|---|
| R-a | **Patient file intake** — step 2 of a new case. *Type or paste* (any language), *upload* a text file, a PDF (read on the device; as text or as page images, up to 20 pages at a time) or images, or *photograph* the pages with the phone camera. Text passes an identifier check (case identifiers, labelled lines in English and Arabic, Yemeni phone numbers, long numbers, "Dr"/"د." names) with highlighted hits, one-tap removal and a mandatory confirmation. Every image passes the **redaction editor** (box and brush covers, move, zoom, rotate before covering, undo); Save stays disabled until the trainee ticks the confirmation; covers are **burned into the pixels**; the image is re-encoded as JPEG, which drops EXIF metadata; **the unredacted original is never stored** (it exists only in memory while the editor is open). | `SourceIntake`, `TextSourceEditor`, `RedactionEditor`, `pdf.ts` |
| R-b | **Patient file tab** — every document with its type, hospital day and origin; a viewer; **"Add an entry from this document"** opens the entry form beside the document (side by side), and the entry keeps a link back to it. A document can be removed with a reason: its encrypted content is purged, its metadata and the audit record stay. | `SourcesTab`, `SourceViewer`, `EntryEditor` |
| R-c | **Clinical Modules** — step 3, and the screen a case opens on. **8 modules in the order of the care process, holding tasks 1–30** with the owner's Arabic titles: *Collect* (1, 2, 22) · *Medication review* (3, 4, 16, 28) · *Dosing* (8, 9, 10) · *Safety* (6, 7, 26, 19) · *Problems & plan* (5, 13, 14, 27, 24) · *Rounds & follow-up* (12, 11, 15, 29) · *Discharge & counselling* (20, 21, 17) · *Document & learn* (18, 23, 25, 30). | `catalogue.ts`, `ModulesHub`, `ModulePage` |
| R-d | **A worksheet for each task**: purpose; "how to do it" steps; **data this task needs** (24 checks against the record, each Missing/OK with a link to add it); data panels from the record (inpatient medications, allergies, orders without an indication, cultures, antimicrobial days, drug levels, lab trends, monitoring due, rounds brief, interventions, care plan); a checklist answered **OK / Problem / N/A** (a Problem links straight to a new DRP); checks **per medication** and **per problem** where the task is about each one; status Not started / In progress / Done / Not applicable (with a reason); notes; and "what later milestones add". Saved as numbered versions with an audit record; unsaved answers are kept as an encrypted draft, the same mechanism as the entry form. | `TaskPage`, `panels.tsx`, `tasks.ts`, `readiness.ts` |
| R-e | **Twelve shared registers** — data entered once and reused by every task that needs it: pre-admission medications (BPMH), drug-related problems with recommendation, team response, implementation and outcome, interactions, ADRs, medication errors, drug levels, monitoring plan, rounds, counselling, discharge medications, references, and the trainee's own calculation checks. Rows are versioned, never deleted (retracted with a reason). | `registers.ts`, `RegisterList`, `ItemEditor` |
| R-f | **Case tracking** — progress ring (x/30) on the case header, a bar per module, the suggested next task, coloured task chips per module; **Workflow** screen with every active case, its progress, its next task and what needs attention (monitoring overdue or due today, recommendations awaiting the team's response). Home shows the same per case. | `ModulesHub`, `Workflow`, `Home` |
| R-g | **Department form wired to the registers** — Section 4 (each pre-admission medication: before / during / at discharge / action, inpatient-only medications marked "Not on the pre-admission list"), Section 7 (interactions), Section 8 (DRPs; the ten boxes ticked from the categories recorded), Section 9 (final recommendations, team response, then *implemented* and *outcome* as separate items with their own provenance), Section 10 (monitoring plan with the next review day), Section 11 references. | `derive.ts` |
| R-h | **New visual design** — deep teal and saffron palette, IBM Plex Sans / Sans Arabic / Mono (self-hosted, no font server), module colours and icons, progress rings, chip controls sized for touch. Bottom bar: Home · Cases · Workflow · Reports · More. | `tailwind.config.js`, `Shell`, components |

**What did not change:** encryption, the append-only store, the hospital-day timeline, correction by supersession, the audit log, the eight provenance states, the Teaching/Ward copies, backup, offline use and the Content-Security-Policy (`connect-src 'self'` — the build still makes no request outside its own origin, verified by the walkthrough test). **There is still no AI, no calculator and no rules engine.** The worksheets structure the trainee's own work; the app computes, suggests and cites nothing.

**How the specification's safety rules apply to the revision**
- No dose, concentration, rate or score is produced by the app. The calculation-check register records the trainee's own calculation (what, inputs with units, formula and its source, result with unit, independent double-check). The worksheets contain no doses or drug-specific thresholds; the only number is the process interval of the antimicrobial review at 48–72 hours.
- No citation is generated: references are typed by the trainee with a mandatory "I read this source myself". A link is kept as text; the app never opens or fetches it.
- A proposed recommendation is never shown as implemented: *implemented* needs who and the hospital day; an *outcome* needs the measurement and its day; each has its own provenance in the form.
- Nothing enters a document by default: each register row is the trainee's explicit entry; there is no bulk accept.
- Identifiers: removed from text before saving (scan + confirmation) and covered in images before upload (burned in, original not stored) — Section 13.
- Missing data is shown as **Missing**, never as normal: e.g. "no pre-admission medication list recorded (Task 2)", "not compared", "no final recommendation".

## 1. What was built in M1 (Section 22)

| Spec item (Section 22, M1) | What exists |
|---|---|
| Project setup | React 18 + TypeScript (strict) + Vite + Tailwind; Vitest unit tests; Playwright end-to-end tests against the production build. |
| Encrypted local store | IndexedDB via Dexie. Every record is AES-GCM encrypted with a random 256-bit data key (only non-secret material is stored unencrypted: the salt, the wrapped key, display preferences and the acknowledgement timestamp); the data key is wrapped by a key derived from the passphrase (PBKDF2-HMAC-SHA-256, 600,000 iterations, per-install salt). Each ciphertext is bound to its table, id and index fields (AAD), so a moved or edited row fails to decrypt. Binary content (document images) is sealed the same way. The passphrase is never stored. Idle lock (default 5 min, configurable 1–30) drops the key from memory. Passphrase change re-wraps the key. |
| Case creation | Teaching Cases and Clinical Cases as separate record types (type fixed at creation). Random `CASE-####` id, never the MRN. Name/MRN/room/consultant only for Clinical Cases, in a separate encrypted group. A synthetic-data attestation is required for every case while the release gate is unmet. Creating a case leads to the patient file (step 2) and then the Clinical Modules (step 3). |
| Rotation records | Department (the eight from Section 17, or other), dates, competency areas, goals. Current rotation shown on Home. |
| Manual data entry | Lab results, vital signs, weight, medication start/change/stop, cultures, imaging report text, procedures, events, and history notes (chief complaint, HPI, PMH, PSH, allergy/ADR including explicit NKDA, family history, social history with **mandatory khat status**, problems/diagnoses). Units are explicit per analyte; an unknown unit is rejected. Commas as decimal marks are rejected rather than guessed. Abbreviations follow ISMP guidance ("subcut", "units", "mcg", frequencies written out). An entry can be transcribed from a patient-file document and keeps a link to it. |
| Append-only timeline with hospital-day numbering | Every entry is dated by hospital day (Day 0 = admission) with optional clock time. The hospital day is **never pre-filled** — a one-tap "Day N = today" button fills it explicitly. Writes other than `add` are refused at the database-core level on every append-only table (now including documents' metadata, task worksheets and register rows). |
| Provenance states rendered distinctly | All eight states have a distinct icon, text label (English + Arabic explanation), border style/width and fill, rendered from one tested specification. Entries and register rows are `user_entered`; `implemented` and `outcome_documented` are now produced by the DRP register (Section 9 of the form); the other states come with later milestones. |
| Correction by supersession | A correction is a new entry pointing at the one it replaces, with a required reason; kinds: *amend* (new values) or *entered in error*. The original stays readable (struck through, "Superseded by a correction"); the full version chain is viewable. An entry can be superseded only once (unique index), so corrections form one chain. A correction can never move an entry to another medication course or problem. |
| Audit log | Append-only, never pruned, encrypted, included in backups. Records every create, edit, correction, retraction and removal, trainee-profile changes, the intended-use acknowledgement, key events, backup export and restore, with before/after values (for worksheets: the status change and which items changed). Identifier values and document contents are never written to it. Viewable per case and globally. |
| PWA shell working offline | Service worker precaches the app shell (including the fonts and the PDF reader); installable manifest with 192/512 and maskable icons. Persistent offline indicator. An update prompt that never reloads silently (implemented but not exercised by any test). |

**Also built in M1** (needed for safe use, not assigned to another milestone): the first-run screen with the intended-use statement verbatim and mandatory acknowledgement (also in About and in every backup file); the non-dismissible disclaimer footer on every screen inside the unlocked app; Arabic and English with right-to-left layout (clinical terms stay English with the Arabic explanation beside them); encrypted backup export and restore into an empty installation (Decision 8; backup format 2 now carries the patient file, worksheets and registers, and format-1 backups still restore); interruption-safe forms (unsaved work kept as an encrypted draft and restored after unlocking); a Content-Security-Policy with `connect-src 'self'`.

## 2. Owner's amendment 1 — the department form, established early

- **Data structure:** the 11 sections and their field names (`src/domain/form/spec.ts`) and a derivation that builds the form from the record (`src/domain/form/derive.ts`). Every value carries its provenance and its source (entry or register row). Nothing is invented: a field with no source is **Missing**; a field built later is **Not yet available — Mx**; identifier fields are **withheld** or replaced by the case id in the Teaching copy.
- **Editable screen** (Case → Form): Teaching copy (default) and Ward copy (Clinical Cases only); a list of every missing item; each field links to where its data is entered — the timeline, the case details or **the task that owns it** — so data is entered once; trainee-authored text for Section 5 (interpretation) and Section 6 (effectiveness, safety, monitoring, target) is saved as numbered versions.
- **Integrated now:** Sections 1–6 from the timeline and case record; **Sections 4 and 7–11 from the Clinical Modules registers (Revision 1)**. **Still deferred:** BMI and CrCl/eGFR (M2 calculators — never typed), the date of the form (M6), PCNE classification behind the Section 8 boxes (M4), **PDF/DOCX export and final validation (M6)**.

## 3. Test results (actual)

Run on the final code of this revision, Chromium 141 (Playwright 1.56.1), Node 22.

| Check | Result |
|---|---|
| TypeScript strict typecheck (`tsc -b`) | **Pass**, no errors |
| Unit tests (`vitest run`) | **150 passed / 150**, 12 files: entries 41 · store 20 · timeline-form 13 · crypto 12 · db 12 · session-backup 10 · modules-store 10 · workflow-domain 9 · form-modules 8 · provenance 6 · i18n 5 · readiness-deidentify 4 |
| Production build (`vite build`) | **Pass**, no warnings. JavaScript loaded at start: app 435 KB (140 KB gzip) + React 134 KB (43 KB) + Dexie 102 KB (34 KB); CSS 35 KB (7 KB). The PDF reader (334 KB + 1.4 MB worker) loads only when a PDF is added. 28 files precached, 2.7 MB in total. |
| End-to-end tests (`playwright test`) | **13 passed / 13**, run twice in a row with the same result |
| `npm audit --omit=dev` (what ships) | **0 vulnerabilities** |

The end-to-end tests (all against the production build, phone-sized Chromium):
1. **Core flow** — onboarding, rotation, Clinical Case, validation refusals, entry, correction (both versions readable), audit before/after, Teaching vs Ward copy, IndexedDB dump in the real browser contains none of the typed text, zero console errors, zero CSP violations, zero requests leaving the origin.
2. **Offline restart** — preview server stopped, browser relaunched offline, page served by the service worker; after unlocking the case and its entry are there and a new entry can be added offline.
3. **Provenance** — the eight rendered badges have pairwise distinct computed styles (icon, label, colours, border/emphasis without colour).
4. **Arabic** — `dir="rtl"`, Arabic chrome, English clinical terms with Arabic explanations, preference persists.
5. **Idle lock** — locked after the idle period; the half-typed note is restored after unlocking.
6. **Installability** — Chrome's own installability checker reports no errors; a negative control proves the checker runs.
7. **Backup** — exported through the UI, no plaintext, wrong passphrase refused, restored into a fresh browser.
8. **Screenshots** of the original M1 screens.
9. **Blocked storage** — a clear explanation instead of endless loading.
10. **Revision walkthrough** — new case → typed admission note with five identifiers found and removed (nothing saved before the confirmation) → photographed page covered with a box, then the **saved pixels are read back**: the covered band is black, the clinical text is intact → creatinine transcribed from that page with the link kept → PDF read on the device and imported as text → **Next** → the 8 modules → Task 1 names what is missing and finds the transcribed creatinine → Task 2: a home medication added in the register with an unintentional omission, checklist answered, **Done refused while 4 items are unanswered**, accepted once all 6 are → **1/30** on the case, **1/3** on the module → the department form's Section 4 shows the medication, its regimen and "Unintentional; Omission" → Workflow lists the case; no console errors, no request outside the origin.
11. **Clinical Modules in Arabic** — right to left, Arabic module and task titles.
12. **All 30 worksheets** open in English and in Arabic: both titles, the per-medication and per-problem rows, no untranslated message key.
13. **All 12 registers** save a row through their editor, back to the task that shows it, each with one audit record.

**How I checked that the tests can fail:** for M1, disabling the append-only guard and leaking one plaintext field made the append-only and encryption-at-rest tests fail. For the revision I made three deliberate breakages, one at a time — allowing an overwrite (`put`) of document content, ignoring conditional requirements in the registers (e.g. the type of an unintentional discrepancy), and keeping a removed document's content — and each made a new unit test fail; all 150 pass again with the code restored. The walkthrough found a real defect before release: the form screen was not receiving the register rows, so Section 4 stayed empty although the domain tests passed; it is fixed and now covered end to end.

## 4. Acceptance criteria

| # | Criterion | Evidence | Verdict |
|---|---|---|---|
| 1 | A case survives a full browser restart with the device offline. | E2E *offline restart* (test 2). | **Met** |
| 2 | A corrected value leaves both versions readable and the audit log shows the change. | Unit tests (original byte-identical after correction; chain; one correction per entry; retraction) and E2E *core flow*. | **Met** |
| 3 | The eight provenance states are visually distinguishable to a reviewer who was not told which is which. | Automated: unit test (unique icon, label, border/fill; AA contrast ≥ 4.5:1) and E2E on rendered styles. **The human review is still yours to do:** `screenshots/provenance-blind-review.png` shows the eight badges shuffled with no explanation. | **Automated checks met; human review pending** |
| 4 | The PWA installs and opens with no network. | Chrome's installability checker: no errors (with a negative control); offline cold start served by the service worker. | **Met in automated testing.** Not yet installed on a physical phone. |
| R1 | The case can be entered manually as text, as a file, or as images of the patient file. | E2E test 10 (typed text, PDF, photographed page) and unit tests (attachments, purge-only content, sizes, JPEG check, backup). | **Met** |
| R2 | After the case is entered, **Next** leads to the Clinical Modules, where all 30 tasks can be done. | E2E tests 10, 12 and 13; unit test: exactly tasks 1–30, each in one module, with the owner's Arabic titles. | **Met** |
| R3 | The case is tracked as in the prototype's Clinical Modules. | E2E test 10 (1/30 on the case, 1/3 on the module, next task, Workflow). | **Met** |
| R4 | The specification's safety rules still hold. | Identifier removal and burned-in covers (test 10, pixel check); no AI, no calculation, no request outside the origin (tests 1 and 10); proposed / implemented / outcome kept apart (unit tests). | **Met** |

## 5. Demonstration (synthetic data)

Screenshots in `docs/m1/screenshots/`, regenerated from the production build at Pixel 7 size. Long screens are captured in full, so the fixed header and bottom bar can appear in the middle of those images.

| File | Shows |
|---|---|
| `r01-home.png` | Home: current rotation, "Add a new case" |
| `r02-intake.png` | Step 2: type, upload or photograph the patient file; **Next: Clinical modules** |
| `r03-text-identifiers.png` | Typed admission note: five identifiers highlighted (name, MRN, phone, a name part, a doctor), Remove all, mandatory confirmation |
| `r04-redaction.png` | Photographed page: the identifiers covered with a box; Save disabled until confirmed |
| `r05-source-viewer.png`, `r06-transcribe.png` | The saved (covered) page; transcribing a value from it side by side |
| `r07-modules-hub.png`, `r07b-modules-hub-full.png` | Clinical Modules: progress 0/30, suggested next task, the 8 modules with their tasks |
| `r08-module-collect.png` | Module 1: tasks 1, 2 and 22 with status and answered items |
| `r09-task1.png` | Task 1 worksheet: steps, data this task needs (Missing/OK), patient file, checklist |
| `r10-item-editor.png` | A pre-admission medication in the register: sources, admission status, unintentional omission |
| `r11-task2.png` | Task 2 completed: checklist, the medication in the register |
| `r12-workflow.png` | Workflow: the case with 1 of 30 tasks complete and its next task |
| `r13-modules-arabic.png`, `r14-task-arabic.png` | Clinical Modules and the antimicrobial stewardship worksheet in Arabic |
| `01-first-run-intended-use.png` | Verbatim intended-use statement with mandatory acknowledgement |
| `02-home.png` | Home with an active case and its progress |
| `03a-timeline-top.png`, `03b-timeline-correction.png` | Timeline by hospital day; a corrected medication (20 g → 2 g) with the superseded original still readable |
| `05-correction-editor.png` | Correction screen: kind, mandatory reason, original kept |
| `06a-form-top-missing-list.png` | Department form: the missing-data list, now pointing to the tasks |
| `06b-…teaching-copy.png` / `07-…ward-copy.png` / `compare-teaching-vs-ward.png` | Section 1 in each copy, and side by side — identifiers only in the Ward copy |
| `06c-form-section5-6.png` | Laboratory monitoring and medication therapy review rows |
| `08-audit-correction-event.png` | Audit event for a correction, before/after values |
| `09-arabic-rtl-timeline.png` | Arabic, right-to-left |
| `10-locked.png` | Locked state |
| `provenance-legend.png`, `provenance-blind-review.png` | The eight states, explained and shuffled |

## 6. Decisions I made that need your approval

From the first M1 report (unchanged unless noted):
1. **What the Teaching copy hides** — name, MRN, room/bed and consultant; dates as hospital days only; ages over 89 as "90 or older" (Section 18, Safe Harbor).
2. **Data-model extensions** (optional fields): entry `timeOfDay` and `correction {kind, reason}`, case `ward`, `dischargeDate`, `syntheticDataAttestedAt`, audit `caseId`; Revision 1 adds entry `sourceAttachmentId` and three record types (below).
3. **History as timeline notes** (chief complaint, HPI, PMH/PSH, allergies, family and social history, problems). "No allergies" only from an explicit NKDA entry.
4. **"Erase this installation"** on the lock screen for a forgotten passphrase (typed `ERASE`).
5. **Navigation** — *changed by Revision 1:* bottom bar Home · Cases · **Workflow** · Reports · More; Resources moved into More; Learning and Portfolio (M8) stay listed as not yet built. A case opens on its Clinical Modules; Timeline, Patient file, Form, Details and Audit are tabs.
6. **Section 5** lists labs, vital signs and cultures; **Section 8** shows its ten boxes as "not assessed" until DRPs are recorded — never as "no problems".
7. **Every case** requires the synthetic-data attestation until the release gate is met.

New in Revision 1:
- **R1. Manual versions of later-milestone work are in M1, at your request.** All 30 tasks are usable now as worksheets and registers. What the specification assigns to later milestones stays there and is named on each worksheet ("What later milestones add", 20 notes): calculators, the rules engine, interaction checks, Naranjo and the vancomycin AUC (M2); document extraction with confirmation (M3); Problem Cards with PCNE V9.1 and AI suggestions (M4); the evidence library (M5); reconciliation and follow-up automation, form export and validation (M6); presentation (M7); learning and portfolio (M8).
- **R2. Document content can be removed** — the one exception to append-only. Only the encrypted content table (`blobs`) allows a keyed delete; `put` and range deletes are refused at the database core; the document's metadata and the audit record stay. Reason: Section 13 — a page later found to contain an identifier must be removable, and the original must never be kept.
- **R3. Form Sections 4 and 7–11 are filled from the registers now** instead of in M2/M4/M5/M6 (export and final validation stay in M6).
- **R4. Infusion-rate calculation (task 9) is not among the sixteen calculators of Section 9.** M1 only records the trainee's own calculation. Tell me whether to add a tested infusion-rate calculator (dose ↔ rate with concentration, formula, units and limits shown) to M2, or keep it manual.
- **R5. "Done" means every item was answered** (N/A counts). A finished task that gains a new medication or problem shows "N new to review".
- **R6. No high-alert medication list is shipped** (the ISMP list is copyrighted and not among the permitted sources); the trainee marks each medication against the hospital's own list.
- **R7. ADR causality (Naranjo, WHO-UMC) and interaction severity are recorded as the trainee's judgement**, with a mandatory source for interactions; the Naranjo calculator and the interaction rules remain M2.
- **R8. References are typed by the trainee** with "I read this source myself", and Section 11 shows them as "read by the trainee". The register does not refuse the names of the commercial references listed in Section 4 of the specification, because the app itself never consults or cites them; if you read Section 24 as forbidding the form from showing such a name even when the trainee typed it, tell me and I will refuse those names in this field.
- **R9. The identifier check for text is an aid, not a guarantee.** It finds the case's own identifiers and common patterns; an unlabelled name that is not in the case record can be missed, which is why the confirmation stays mandatory and the screen says "check the rest of the text yourself".
- **R10. PDFs** are read on the device with pdf.js (Mozilla, Apache-2.0), at most 20 pages at a time; a scanned PDF has no text layer, so its pages are added as images. Word files are not supported (the message says to save as PDF or paste the text).
- **R11. Fonts and design:** IBM Plex Sans, Sans Arabic and Mono (SIL Open Font License 1.1), bundled in the app; the CSP is unchanged.
- **R12. Library chunks:** React and Dexie are built as separate files, so an app update re-downloads only the app code.

## 7. Incomplete features, known limitations and defects

- **No automation yet, by design:** no OCR or extraction from photographed pages (transcription is manual; M3), no calculators, rules, interaction or dose checks (M2), no AI (M3–M4). The worksheets do not judge the trainee's answers.
- **The worksheet content** (steps and checklists of the 30 tasks, in English and Arabic) was written by me from general clinical-pharmacy practice, not copied from any reference. It needs review by your preceptor, like the Arabic translations, which have grown considerably and need a native speaker's review.
- **Redaction is by touch or pointer only**; there is no keyboard way to draw a cover (accessibility gap, to be addressed by M9).
- Images are saved as JPEG (quality 0.85, longest side 2000 px): very small print can lose some sharpness. Because the original is never kept, a page that is too blurry must be photographed again.
- **Camera capture** was tested with the file input in headless Chromium; the `capture` attribute opens the camera on phones, but this has **not been tried on a physical phone**, nor on iOS/Safari or Firefox. Time-to-interactive on a mid-range phone (an M9 criterion) has not been measured; the app is now larger (about 670 KB of JavaScript at start, 220 KB compressed).
- **Plausibility range checks** at entry belong to the M2 input specifications; M1 enforces only definitional limits. Weight in kg and height in cm only until M2.
- Section 6 text is not flagged when a regimen later changes (staleness is M4). Section 5 interpretation is tied to the exact entry.
- **Field labels of the department form come from the specification, not from the paper form.** Please send a photo of the paper form before M6.
- The audit log is append-only in the application and tamper-evident (bound AAD), but someone with physical access to an unlocked browser's developer tools could still delete rows; there is no hash chain.
- `npm audit` reports 14 advisories (2 critical, 7 high, 5 moderate) in **development tools only** (Vitest/tinypool, esbuild dev server, PostCSS, braces); the shipped app has none. Fixing them needs major-version upgrades of the build tools, planned for the M9 security review unless you want it sooner.
- Persistent storage is requested from the browser but may be denied; Settings shows the state and recommends regular backups.
- The open-source components are credited in About and in the README with their licences, but their full licence texts are not yet shipped inside the app; they will be before any distribution (M9 at the latest).

## 8. Verifications the specification asks for at build time

None of the clinical sources in Sections 4 and 11 is used in M1, so none was checked yet; each will be verified against its publisher **before** the milestone that uses it, and any discrepancy reported first: DDInter 2.0 licence, ONC list, AWaRe 2025, RxNav interaction-service status (M2); model identifiers, pricing and free-tier terms (M3); the ten guideline versions (M5). The two libraries added by the revision were checked from their published packages: pdfjs-dist 4.10.38 (Apache-2.0; run with `isEvalSupported: false`) and @fontsource IBM Plex 5.3.0 (OFL-1.1).

## 9. What I need from you

1. **Approve M1 (with Revision 1), or tell me what to change.** I will not start M2 until you approve.
2. Decisions R1–R12 above, especially **R4** (infusion-rate calculator in M2?) and **R8** (commercial names in the reference list).
3. The blind review of `provenance-blind-review.png` (acceptance criterion 3).
4. A review of the 30 worksheets and the Arabic text by your preceptor, when possible.
5. When convenient, a photo of the paper form (needed before M6).
