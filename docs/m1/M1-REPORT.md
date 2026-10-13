# PRECEPTOR — Milestone M1 report

**Milestone:** M1 — Case and timeline core (plus the early department-form screen from the owner's execution amendment)
**Status:** built and tested; **awaiting the owner's approval**. M2 has not been started.
**Build:** version 0.1.0 · branch `claude/preceptor-build-prompt-v4-slhq8k`

---

## 1. What was built

| Spec item (Section 22, M1) | What exists |
|---|---|
| Project setup | React 18 + TypeScript (strict) + Vite + Tailwind; Vitest unit tests; Playwright end-to-end tests against the production build. |
| Encrypted local store | IndexedDB via Dexie. Every record is AES-GCM encrypted with a random 256-bit data key (only non-secret material is stored unencrypted: the salt, the wrapped key, display preferences and the acknowledgement timestamp); the data key is wrapped by a key derived from the passphrase (PBKDF2-HMAC-SHA-256, 600,000 iterations, per-install salt). Each ciphertext is bound to its table, id and index fields (AAD), so a moved or edited row fails to decrypt. The passphrase is never stored. Idle lock (default 5 min, configurable 1–30) drops the key from memory. Passphrase change re-wraps the key. |
| Case creation | Teaching Cases and Clinical Cases as separate record types (type fixed at creation). Random `CASE-####` id, never the MRN. Name/MRN/room/consultant only for Clinical Cases, in a separate encrypted group. A synthetic-data attestation is required for every case while the release gate is unmet. |
| Rotation records | Department (the eight from Section 17, or other), dates, competency areas, goals. Current rotation shown on Home. |
| Manual data entry | Lab results, vital signs, weight, medication start/change/stop, cultures, imaging report text, procedures, events, and history notes (chief complaint, HPI, PMH, PSH, allergy/ADR including explicit NKDA, family history, social history with **mandatory khat status**, problems/diagnoses). Units are explicit per analyte; an unknown unit is rejected. Commas as decimal marks are rejected rather than guessed. Abbreviations follow ISMP guidance ("subcut", "units", "mcg", frequencies written out). |
| Append-only timeline with hospital-day numbering | Every entry is dated by hospital day (Day 0 = admission) with optional clock time. The hospital day is **never pre-filled** — a one-tap "Day N = today" button fills it explicitly. Writes other than `add` are refused at the database-core level on every append-only table. |
| Provenance states rendered distinctly | All eight states have a distinct icon, text label (English + Arabic explanation), border style/width and fill, rendered from one tested specification. M1 entries are all `user_entered`; the other states are produced by later milestones. |
| Correction by supersession | A correction is a new entry pointing at the one it replaces, with a required reason; kinds: *amend* (new values) or *entered in error*. The original stays readable (struck through, "Superseded by a correction"); the full version chain is viewable. An entry can be superseded only once (unique index), so corrections form one chain. A correction can never move an entry to another medication course or problem. |
| Audit log | Append-only, never pruned, encrypted, included in backups. Records every create, edit, correction and retraction of a record, trainee-profile changes, the intended-use acknowledgement, key events, backup export and restore, with before/after values. (Interface preferences — language and idle time — are not audited.) Identifier values are never written to it (only which fields changed). Viewable per case and globally. |
| PWA shell working offline | Service worker precaches the app shell; installable manifest with 192/512 and maskable icons. Persistent offline indicator. An update prompt that never reloads silently (implemented but not exercised by any test). |

**Also built in M1** (needed for safe use, not assigned to another milestone):
- First-run screen showing the intended-use statement verbatim, with mandatory acknowledgement; the statement also appears in About and in every backup file.
- Non-dismissible short disclaimer footer on every screen inside the unlocked app (the first-run screen shows the full statement; the lock and passphrase screens show neither).
- Arabic and English interface with right-to-left layout; clinical terms stay English with the Arabic explanation beside them.
- Encrypted backup export and restore-into-empty-installation (Decision 8).
- Interruption-safe forms: unsaved entry and form text is kept as an encrypted working draft, saved before the idle lock, and restored after unlocking.
- Content-Security-Policy with `connect-src 'self'`: the browser itself blocks connections to any other origin. Apart from loading its own files, the app makes no requests (verified by the core-flow test).

## 2. Owner's amendment 1 — the department form, established early

- **Data structure:** the 11 sections and their field names (`src/domain/form/spec.ts`) and a derivation that builds the form from the record (`src/domain/form/derive.ts`). Every value carries its provenance and source entry. Nothing is invented: a field with no source is **Missing**; a field built later is **Not yet available — Mx**; identifier fields are **withheld** or replaced by the case id in the Teaching copy.
- **Editable screen** (Case → Form): Teaching copy (default) and Ward copy (Clinical Cases only); a list of every missing item; each field links to where its data is entered (so data is entered once, in the record); trainee-authored text for Section 5 (interpretation) and Section 6 (effectiveness, safety, monitoring, target) is saved as numbered versions.
- **Integrated now:** Sections 1–6 and 11 from the timeline and case record. **Deferred to their milestones:** BMI and CrCl/eGFR (M2 calculators — never typed), Section 7 interactions (M2), Sections 8–9 DRPs and recommendations (M4), pre-admission/discharge reconciliation and Section 10 follow-up (M6), references (M5), **PDF export and final validation (M6)**.

## 3. Test results (actual)

Run on the final M1 code, Chromium 141 (Playwright 1.56.1), Node 22.

| Check | Result |
|---|---|
| TypeScript strict typecheck (`tsc -b`) | **Pass**, no errors |
| Unit tests (`vitest run`) | **115 passed / 115**, 8 files: entries 41 · store 20 · timeline-form 13 · crypto 12 · session-backup 10 · db 8 · provenance 6 · i18n 5 |
| Production build (`vite build`) | **Pass**, no warnings; 450 KB JS (141 KB gzip), 17 KB CSS; 14 files precached |
| End-to-end tests (`playwright test`) | **8 passed / 8**, run twice in a row with the same result |

The end-to-end tests:
1. Core flow — onboarding, rotation, Clinical Case, validation refusals, entry, correction (both versions readable), audit before/after, Teaching vs Ward copy, **IndexedDB dump in the real browser contains none of the typed text**, **zero console errors, zero CSP violations, zero requests leaving the origin**.
2. Offline restart — profile on disk; the preview server is **stopped** and the browser relaunched **offline**; the page is confirmed **served by the service worker**; after unlocking, the case and its entry are there, and a new entry can be added offline.
3. Provenance — computed styles of the eight rendered badges are pairwise distinct (icon, label, colours, and border/emphasis without colour).
4. Arabic — `dir="rtl"`, `lang="ar"`, Arabic chrome, English clinical terms with Arabic explanations, verbatim English statement, preference persists.
5. Idle lock — fake clock advanced past the idle period → locked; after unlocking, the half-typed note is restored.
6. Installability — see criterion 4 below.
7. Backup — exported from Settings through the UI, contains no plaintext, wrong passphrase refused, restored into a fresh browser context.
8. Screenshots for this report.

**How I checked that the tests can fail:** I temporarily disabled the append-only guard and leaked one plaintext field — the six append-only tests and the encryption-at-rest test failed, then passed again once restored. For installability I added a negative control (see below); it exposed that my first version of that test was vacuous, and I replaced it.

## 4. M1 acceptance criteria

| # | Criterion | Evidence | Verdict |
|---|---|---|---|
| 1 | A case survives a full browser restart with the device offline. | E2E *offline-restart*: server stopped, new browser process, offline, shell served by the service worker, case and entry present after unlock. | **Met** |
| 2 | A corrected value leaves both versions readable and the audit log shows the change. | Unit tests (store: original byte-identical after correction; chain; one correction per entry; retraction) and E2E *core flow* (both entries visible, version history, audit event with before 21 / after 2.1 and the reason). | **Met** |
| 3 | The eight provenance states are visually distinguishable to a reviewer who was not told which is which. | Automated: unit test (unique icon, label, border/fill; AA contrast ≥ 4.5:1) and E2E on rendered styles. **The human review is still yours to do:** `screenshots/provenance-blind-review.png` shows the eight badges shuffled with no explanation. | **Automated checks met; human review pending** |
| 4 | The PWA installs and opens with no network. | Chrome's own installability checker reports **no errors** for the app. Because the default headless browser silently skips that check, the test uses the full Chromium build with a non-incognito profile, and a **negative control** (a page without a manifest) proves the checker runs (`no-manifest` reported). Offline cold start served by the service worker. | **Met in automated testing.** Not yet installed on a physical phone. |

## 5. Demonstration (synthetic data)

Screenshots in `docs/m1/screenshots/`, captured from the production build at Pixel 7 size:

| File | Shows |
|---|---|
| `01-first-run-intended-use.png` | Verbatim intended-use statement with mandatory acknowledgement |
| `02-home.png` | Current rotation and active cases |
| `03a-timeline-top.png`, `03b-timeline-correction.png` | Timeline by hospital day; a corrected medication (20 g → 2 g) with the superseded original still readable |
| `05-correction-editor.png` | Correction screen: kind, mandatory reason, original kept |
| `06a-form-top-missing-list.png` | Department form, Teaching copy default, missing-data list |
| `06b-form-section1-teaching-copy.png` / `07-form-section1-ward-copy.png` / `compare-teaching-vs-ward.png` | Section 1 in each copy, and side by side — identifiers only in the Ward copy |
| `06c-form-section5-6.png` | Laboratory monitoring and medication therapy review rows |
| `08-audit-correction-event.png` | Audit event for a correction, before/after values |
| `09-arabic-rtl-timeline.png` | Arabic, right-to-left |
| `10-locked.png` | Locked state |
| `provenance-legend.png`, `provenance-blind-review.png` | The eight states, explained and shuffled |

## 6. Decisions I made that need your approval

None of these changes a settled decision; each is an interpretation or a detail the specification leaves open.

1. **What the Teaching copy hides.** Section 15 says name and MRN become the case id. Following Section 18 (Safe Harbor as design standard) I also withhold room/bed and consultant name, show admission/discharge and lab dates as hospital days only, and show ages over 89 as "90 or older". The Ward and Teaching copies differ only in these fields (unit-tested).
2. **Data-model extensions** (all optional fields, marked in `src/domain/types.ts`): entry `timeOfDay` (needed for level draw times in M2) and `correction {kind, reason}`; case `ward`, `dischargeDate`, `syntheticDataAttestedAt`; audit `caseId`. Cases, rotations, identifiers and form text are stored as **numbered versions**, never overwritten.
3. **History as timeline notes.** Chief complaint, HPI, PMH/PSH, allergies/ADRs, family and social history and problems are `note` entries with a category — within the spec's entry types, so they are dated, correctable and audited like everything else. "No allergies" is shown only from an explicit NKDA entry; an empty record shows **Missing**.
4. **"Erase this installation"** on the lock screen (typed `ERASE` confirmation) for a forgotten passphrase — otherwise the trainee would be locked out forever with no way to start again.
5. **Navigation.** Bottom bar: Home · Cases · Reports · Resources · More. Workflow (M4), Learning (M8) and Portfolio (M8) are listed in More as disabled with their milestone — not mock screens.
6. **Section 5** lists lab results, vital signs and cultures ("clinical monitoring"); a missing reference range is flagged for lab results only. **Section 8** shows the ten box labels as "not assessed" instead of empty boxes, so it never implies "no problems".
7. **Every case** (Teaching and Clinical) requires the synthetic-data attestation until the release gate is met.

## 7. Incomplete features, known limitations and defects

**Blocking item outside the code:** pushing to GitHub was refused (HTTP 403 — the Claude GitHub App does not have write access to `murss2030-ui/Mursal`). All work is committed locally on the branch; it will be pushed as soon as access is granted.

Limitations, by design or deferred:
- **Plausibility range checks** (e.g. potassium 1–10 mmol/L) are not applied at entry yet; they belong to the calculator input specifications in M2. M1 enforces only definitional limits (non-negative quantities, GCS 3–15, SpO₂ ≤ 100 %, diastolic < systolic).
- Weight is entered in kg and height in cm only; unit conversion arrives with M2.
- Interventions and outcomes cannot be recorded yet (they need Problem Cards, M4/M6). The `implemented` and `outcome_documented` states are rendered but nothing produces them yet.
- Section 6 assessment text is not flagged when the regimen later changes (staleness is M4). Section 5 interpretation is tied to the exact entry, so a corrected value deliberately needs its interpretation re-entered.
- **Field labels of the department form come from the specification's description, not from the paper form.** Please send a photo or scan of the paper form before M6 so the printed layout and wording can match it exactly.
- The audit log is append-only in the application and tamper-evident (encryption with bound AAD), but someone with physical access to an unlocked browser's developer tools could still delete rows; there is no hash chain.
- Testing was in headless Chromium with phone emulation only. **Not tested on a physical Android phone, on iOS/Safari or Firefox.** Time-to-interactive on a mid-range phone (an M9 criterion) has not been measured.
- Accessibility basics are in place (labels on every input, focus outlines, 44 px targets, AA contrast checked for the provenance badges); a full WCAG audit is M9.
- The Arabic translations were written by me and need review by a native speaker. A few connective words inside clinical summary lines (e.g. "Indication: not recorded") stay English with the clinical text — please confirm that is acceptable.
- `npm audit` reports advisories in development tools only (Vite/esbuild dev server, Vitest, a Tailwind build dependency); none is in the shipped app. To be resolved in the M9 security review.
- Persistent storage is requested from the browser but may be denied; Settings shows the state and recommends regular backups.

## 8. Verifications the specification asks for at build time

None of the sources in Sections 4 and 11 is used in M1, so none was checked yet. As instructed, each will be verified against its publisher **before** the milestone that uses it, and any discrepancy reported before proceeding: DDInter 2.0 licence, ONC list, AWaRe 2025, RxNav interaction-service status (M2); model identifiers, pricing and free-tier terms (M3); the ten guideline versions (M5).

## 9. What I need from you

1. **Approve M1, or tell me what to change.** I will not start M2 until you approve.
2. Do the blind review of `provenance-blind-review.png` (acceptance criterion 3).
3. Confirm or change the decisions in Section 6 of this report.
4. Grant the Claude GitHub App write access to `murss2030-ui/Mursal` so the branch can be pushed.
5. When convenient, a photo of the paper form (needed before M6).
