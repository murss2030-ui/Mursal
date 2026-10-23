# PRECEPTOR — guidance for Claude sessions

Full state and history: `docs/PROJECT-MEMORY.md` (read it first), `docs/FINAL-REPORT.md`, milestone reports in `docs/m*/`.

## Project
Clinical-pharmacy-trainee PWA. React 18 + TypeScript strict + Vite + Dexie (AES-GCM sealed rows) + Vitest + Playwright. All AI calls go through the relay (`relay/`, `netlify/functions/model.mts`); the browser never holds a key. Version 0.9.0, milestone M9 built; the release gate is NOT met (`RELEASE_GATE_MET = false`): synthetic Teaching Cases only.

## People and branch
- Owner writes Arabic; answer in simple Arabic, step by step, one thing at a time; screenshots guide support.
- Develop and push only on `claude/preceptor-build-prompt-v4-slhq8k` (repo `murss2030-ui/Mursal`). No pull request unless asked.
- Commit messages end with the Co-Authored-By and Claude-Session lines from the session reminder.

## Never (Section 24 and owner decisions)
- No commercial references (no UpToDate/Medscape links); no keys in the browser; no model-produced doses, thresholds or citations; no bulk approval; nothing sent to the care team; never present the app as replacing a clinical pharmacist; never claim a milestone complete when it is not.
- Every model-read value waits for the trainee's confirmation; every statement passes the verifier gate (literal quote). Keep these in any new feature (e.g. Quick analysis).
- Never write the Gemini key or the access code in the repo or in chat; never disable Netlify secrets scanning (use `SECRETS_SCAN_OMIT_KEYS`).
- Do not run live model/connector tests (M5 research, probes) without the owner's go-ahead; the free key's quota is shared per Google project (~20 requests/day/model).

## Working rules
- Engineering decisions are delegated: decide, implement, document reasons in the milestone report rather than stopping to ask.
- Verify before claiming done: `npx tsc -b`, `npx vitest run` (825 tests), `npm run build`, then `NODE_USE_ENV_PROXY=1 npx playwright test` (e2e serves the built `dist`: rebuild first). Reload locks the app: navigate by hash in e2e.
- Match surrounding code: bilingual i18n keys in `src/i18n/en.ts` and `ar.ts` (the i18n test requires both, with Arabic text), versioned append-only records, hash-only audit entries.

## Where things are
- Analyse screen and Quick analysis: `src/ui/screens/Analyse.tsx`; drafting `src/ai/analysis/`; verifier `src/ai/verification/`; research `src/ai/research/`.
- Rules engine `src/rules/`; fixtures `src/fixtures/clinical.ts` (`npm run docs:clinical`); form export `src/domain/form/export.ts`.
- Deployment: `docs/deploy/NETLIFY.md`, `netlify.toml`.

## Open items
1. Confirm Netlify deploy shows the Quick analysis card; fix Gemini quota (wait for reset or enable billing then `PRECEPTOR_KEY_CLASS=paid`).
2. Live test on one synthetic case; compare cards with the owner's reference app "Rotation Copilot" and tune.
3. Expert signature on `docs/m9/CLINICAL-FIXTURES.md`, department-head authorisation, paid key (release gate).
4. Owner to review my M6–M9 spec interpretations; Backlog: Task 23.
