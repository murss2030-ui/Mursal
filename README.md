# PRECEPTOR

An educational clinical pharmacy rotation copilot for a supervised Master's-level trainee.

## Intended use

```
PRECEPTOR is an educational tool for supervised clinical pharmacy trainees,
used to structure, document and reflect on a pharmacotherapy workup.

It is not intended for diagnosis, treatment, or patient-care decisions.

Outputs must not be entered into a medical record, or communicated to the
care team, without independent verification by a licensed pharmacist or
preceptor. All calculations, interactions and recommendations must be
independently confirmed before any clinical action.
```

PRECEPTOR does not replace a clinical pharmacist. It never makes a clinical decision; the trainee decides, under supervision.

**Release gate:** this build has not passed the release gate (Section 23 of the specification). Use synthetic cases only. Real patient data may not be entered until the department head has given written authorisation, a paid API key is configured, milestones M1–M6 have been accepted, and the clinical fixture library has run with no missed critical problem.

## Status

| Milestone | State |
|---|---|
| M1 — Case and timeline core, with Revision 1 (patient-file intake and the Clinical Modules) | Built and tested; awaiting the owner's acceptance ([report](docs/m1/M1-REPORT.md)) |
| M2 — Calculation and rules | Plan prepared ([plan](docs/m2/M2-PLAN.md)); not started |
| M3–M9 | Not started (each begins only after the previous one is accepted) |

What M1 contains: an encrypted local record (AES-GCM, key derived from a passphrase), rotations, Teaching and Clinical Cases, manual entry on an append-only timeline dated by hospital day, correction by supersession, an append-only audit log, the eight provenance states, the department's 11-section form as an on-screen review with missing-data flags, encrypted backup and restore, Arabic and English with right-to-left layout, and an offline-capable installable web app.

Revision 1 adds the **patient file** — the case typed or pasted, uploaded (text, PDF read on the device, images) or photographed, with identifiers removed before anything is saved (text check with mandatory confirmation; covers burned into image pixels; the unredacted original is never stored) — and a **Next** step into the **Clinical Modules**: the 30 tasks of a hospital clinical pharmacist in 8 modules, each with a worksheet (steps, the data it needs, checklist, per-medication and per-problem review), twelve shared registers (pre-admission medications, drug-related problems and recommendations, interactions, ADRs, medication errors, drug levels, monitoring, rounds, counselling, discharge medications, references, the trainee's own calculation checks) that also fill the department form, and progress tracking per case, per module and on the Workflow screen.

It contains no AI, no calculators and no clinical rules yet: the worksheets structure the trainee's own work, and the app computes, suggests and cites nothing.

## Privacy and data

- All records stay on the device, encrypted in IndexedDB with a random data key. That key is wrapped by a key derived from the trainee's passphrase (PBKDF2-HMAC-SHA-256, 600,000 iterations, per-install salt). Only non-secret material is stored unencrypted: the salt, the wrapped key, display preferences and the acknowledgement timestamp. The passphrase is never stored; a forgotten passphrase means the data cannot be recovered.
- There is no account, no cloud sync and no server. Apart from loading its own application files, this build makes no network requests; its Content-Security-Policy (`connect-src 'self'`) blocks connections to any other origin in the browser.
- Patient name and MRN (Clinical Cases only) are kept in a separate encrypted field group, never shown in the Teaching copy of the form and never written to the audit log.
- Patient-file documents are stored encrypted like every other record, only after their identifiers have been removed: typed or imported text passes an identifier check and a mandatory confirmation; each image is covered in a redaction editor, the covers are burned into the pixels and the image is re-encoded (which drops camera metadata). The unredacted original is never stored. A document's content can be removed with a reason; its description and the removal stay in the audit log.
- Backups are encrypted files the trainee saves themselves, restorable only with the passphrase.

## Sources and licences

This build contains no third-party clinical content. UpToDate, Medscape, Lexicomp, Micromedex, Clinical Pharmacology, Epocrates, NICE, BNF and NCCN content is not and will not be integrated (Section 4 of the specification). The task worksheets were written for PRECEPTOR from general clinical-pharmacy practice and contain no doses or drug-specific thresholds.

Libraries shipped in the app: React and React DOM (MIT), Dexie and dexie-react-hooks (Apache-2.0), Workbox window (MIT), PDF.js `pdfjs-dist` (Apache-2.0; runs on the device, loaded only when a PDF is added), and the IBM Plex Sans, Sans Arabic and Mono fonts via Fontsource (SIL Open Font License 1.1, bundled — no font server).

## Development

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # development server
npm run typecheck  # TypeScript, strict mode
npm test           # unit tests (Vitest)
npm run build      # production build with service worker and CSP
npm run test:e2e   # end-to-end tests (Playwright, Chromium) against the production build
```

The end-to-end tests run against `vite preview` of the production build, because the service worker and the Content-Security-Policy exist only there. Run `npm run build` first.

### Layout

```
src/
  crypto/     Web Crypto: key derivation, data-key wrapping, AES-GCM sealing
  store/      Dexie schema, append-only guard, encrypted repository, session/lock, backup
  domain/     data model, entry validation, timeline logic, provenance spec, department form
    workflow/ the 30-task catalogue, registers, worksheet progress, readiness checks, identifier check
  i18n/       English and Arabic strings, clinical term glossary
  ui/         React screens and components (patient-file intake, redaction editor, Clinical Modules)
tests/unit/   unit tests
e2e/          end-to-end tests
docs/m1/      milestone report and screenshots
```
