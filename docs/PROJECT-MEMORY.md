# PRECEPTOR — project memory (state as of 23 Oct 2026)

Read this first in any new session. No secrets are stored here (never write the Gemini key or access code in the repo or in chat).

## 1. What the project is
- PRECEPTOR: a PWA for a clinical-pharmacy trainee (React 18 + TypeScript strict + Vite + Dexie with AES-GCM sealed rows + Vitest + Playwright). AI goes only through a relay (Netlify Function, `relay/`, `netlify/functions/model.mts`); the browser never holds a key.
- Owner: murss2030 (communicates in Arabic; prefers simple step-by-step instructions, screenshots for guidance).
- Repo: `murss2030-ui/Mursal`, working branch `claude/preceptor-build-prompt-v4-slhq8k` (always develop and push here; no PR unless asked).
- Version 0.9.0, milestone M9 built. **Release gate NOT met** (`RELEASE_GATE_MET = false`): synthetic Teaching Cases only.

## 2. Standing rules (Section 24 and owner instructions)
- No commercial references (no UpToDate/Medscape links), no keys in the browser, no model-produced doses or citations, no bulk approval, nothing sent to the care team, never presented as replacing a clinical pharmacist, never claim a milestone complete when it is not.
- Every value the model reads waits for the trainee's confirmation; every statement is verified (verdict gate + literal quote).
- Owner's autonomy instruction (22 Oct): decide engineering questions, document the reasons in the milestone report instead of stopping; report only when phases complete.

## 3. Milestones
| | State |
|---|---|
| M1–M4 | accepted by the owner |
| M5 evidence (library, open connectors, Research this question) | accepted; built with mocks only, never run live |
| M6 export (print-to-PDF + text, export gate, monitoring_due and reconciliation rules) | built, awaiting review |
| M7 monthly presentation from the verified record | built, awaiting review |
| M8 learning modes (deterministic, no model) + portfolio by competency | built, awaiting review |
| M9 clinical fixture library (15 synthetic fixtures, runner, expert sheet `docs/m9/CLINICAL-FIXTURES.md`) | built; **expert review still pending** |
- The M6–M9 spec text was unavailable; interpretations are documented in `docs/m6..m9/*-REPORT.md` and `docs/FINAL-REPORT.md`. The owner should review them.
- Backlog: Task 23 (protocols drafted from the library only).

## 4. Quick analysis (added 23 Oct)
- On the Analyse screen a card with one button that always does the next step: read the file → (trainee confirms values) → draft only the `review` and `plan` modules (Problem Cards, PCNE) with the verifier → open "Problems & plan". About 4–5 model calls instead of dozens. Full 30-task path remains.
- Code: `src/ui/screens/Analyse.tsx` (`QUICK_MODULES`, `quickNext`, `quickGo`), i18n keys `quick.*`, e2e assertions in `e2e/m3-ai.spec.ts`.
- Reference the owner likes: another app "Rotation Copilot" (single HTML file, key in the browser, DRP cards with condition / patient evidence / significance / suggested intervention / monitoring / follow-up). Differences kept deliberately: numbers not in the case data are removed, no Medscape/UpToDate links (use Research this question: PubMed, openFDA, MedlinePlus, library), review decisions instead of "log as intervention". Possible follow-up: compare real output cards against Rotation Copilot's and adjust the card layout.

## 4b. Why the first live attempt failed (22 Oct)
- Not an app defect: Gemini free-tier quota ("quota used up for today", "limiting requests"). Quota is per Google project (all 9 keys share "Default Gemini Project"), ~20 requests/day/model. "Draft the 30 tasks" was pressed before reading/confirming and fired ~8 parallel calls.

## 5. Deployment on Netlify (done)
- Site `velvety-shortbread-d3829b`, deploys from the branch above; `netlify.toml` gives build `npm run build`, publish `dist`.
- First deploy failed with "Exposed secrets detected" (Netlify scans for env-var values in the build; `free` is a common word). Fixed with env var `SECRETS_SCAN_OMIT_KEYS=PRECEPTOR_KEY_CLASS`. Do not disable scanning wholesale.
- Environment variables set: `GEMINI_API_KEY` (secret), `PRECEPTOR_ACCESS_CODE`, `PRECEPTOR_KEY_CLASS=free`, `SECRETS_SCAN_OMIT_KEYS`, `PRECEPTOR_MODELS=gemini-3.5-flash:1.50:9.00,gemini-3.8-flash:1.50:9.00,gemini-flash-latest:1.50:9.00`, `PRECEPTOR_SUGGESTED=extract=gemini-3.5-flash,analyse=gemini-3.8-flash`, optional `PRECEPTOR_THINKING=extract=low,analyse=low`. Env changes apply only on the next deploy.
- In the app: Settings → AI service → enter the same access code (a wrong/over-long value gave "access code is missing or wrong"), choose reading model `gemini-3.5-flash`, analysis model `gemini-3.8-flash`, second check `gemini-flash-latest`. Status showed Connected, free-tier key (Clinical Cases refused).
- Full guide: `docs/deploy/NETLIFY.md`, README section "AI service".

## 6. Next steps
1. Confirm the new deploy is Published and the "Quick analysis" card appears on Analyse.
2. Fix the quota: wait for the daily reset, or enable billing in Google AI Studio and then set `PRECEPTOR_KEY_CLASS=paid` and redeploy (still synthetic cases only while the gate is closed).
3. Live test on one synthetic Teaching Case: Quick analysis → confirm values → Quick analysis again → Problems & plan; send screenshots; compare with Rotation Copilot's cards and tune.
4. Never run M5 connectors/Research live without the owner's go-ahead (earlier instruction); a live probe plan exists in `docs/m5/M5-LIVE-PROBE.md`.
5. Gate conditions still open: expert signature on `docs/m9/CLINICAL-FIXTURES.md`, written authorisation from the department head, a paid key.

## 7. Working notes
- Verify with `npx tsc -b`, `npx vitest run` (825 tests), `npm run build`, then `NODE_USE_ENV_PROXY=1 npx playwright test` (e2e uses the built `dist`, so rebuild first). Page reload locks the app; navigate by hash in e2e.
- Commit messages end with the Co-Authored-By and Claude-Session lines given in the session reminder.
