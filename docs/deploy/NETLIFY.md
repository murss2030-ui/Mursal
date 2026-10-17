# Deploying PRECEPTOR on Netlify

About five minutes in Netlify's website. The API key is entered there by you; it never goes into the repository, the app or a chat.

## 1. Create the site from GitHub

1. Sign in at **app.netlify.com** (a free account is enough; "Sign up with GitHub" is simplest).
2. **Add new site → Import an existing project → GitHub**, allow Netlify to read the repository, and choose **murss2030-ui/Mursal**.
3. **Branch to deploy:** `claude/preceptor-build-prompt-v4-slhq8k`. Leave the build settings as Netlify shows them: they come from `netlify.toml` (`npm run build`, publish `dist`, functions in `netlify/functions`).
4. Before the first deploy, open **Add environment variables** (or, after creating the site: **Site configuration → Environment variables → Add a variable → Import from a .env file**) and paste the block below.

## 2. Settings to paste

Replace the two marked values first.

```
GEMINI_API_KEY=PASTE-YOUR-GEMINI-KEY-HERE
PRECEPTOR_ACCESS_CODE=CHOOSE-A-LONG-PRIVATE-PHRASE
PRECEPTOR_MODELS=gemini-3.5-flash:1.50:9.00,gemini-3.8-flash:1.50:9.00,gemini-flash-latest:1.50:9.00
PRECEPTOR_SUGGESTED=extract=gemini-3.5-flash,analyse=gemini-3.8-flash
PRECEPTOR_THINKING=extract=low,analyse=low
PRECEPTOR_KEY_CLASS=free
PRECEPTOR_MONTHLY_BUDGET_USD=5
```

- **GEMINI_API_KEY** — your key from Google AI Studio. If Netlify offers "Contains secret values", tick it.
- **PRECEPTOR_ACCESS_CODE** — the site is public; with this code only someone who knows it can use your key. You enter the same code in the app (Settings → AI service).
- **PRECEPTOR_MODELS / SUGGESTED** — checked with your key on 16–17 October 2026, all at the "low" thinking level. Reading uses one model and drafting another, so each has its own free daily allowance (20 requests per model): about two test cases a day. Prices are published Flash prices used for the budget estimate; a free-tier key is not charged.
- **PRECEPTOR_KEY_CLASS=free** — keeps Clinical Cases refused. Change to `paid` only with a billing-enabled key, and only after the release gate.

## 3. Deploy and check

1. Press **Deploy** and wait for "Published" (about two minutes).
2. Optional: **Site configuration → Change site name** (e.g. `preceptor-mursal`), giving `https://preceptor-mursal.netlify.app`.
3. Open **`https://<your-site>.netlify.app/api/status`** in the browser. With an access code set, the expected answer is `{"error":{"code":"access_denied", …}}`: the relay is running, and it refuses anyone without the code. (Without an access code it shows the full status.)
   - `not_configured`: a variable is missing or misspelt. Fix it, then **Deploys → Trigger deploy → Deploy site** (Netlify applies variable changes on the next deploy).
   - A Netlify "Page not found": the function was not deployed (see the table below).
4. The full status is in the app: **Settings → AI service**, after entering the access code — "Connected", "Free-tier key", the budget and the models.
5. Open `https://<your-site>.netlify.app` on the phone. "Add to Home screen" installs it as an app.

## If something goes wrong

| The app says | What to do |
|---|---|
| "No AI service is deployed with this copy of the app" | The function was not deployed: check **Logs → Functions** for `model`, and that the deploy used this branch. |
| "The access code is missing or wrong" | Enter the code in Settings → AI service and save. |
| "This model's quota at the provider is used up for today" | The free tier's 20 requests per model per day are spent: try tomorrow, or choose the third model in Settings. |
| "The model service is not available right now" | Google's "high demand"; the app already retried once. Try again in a minute. |
| "The model took too long to answer" | Check that `PRECEPTOR_THINKING=extract=low,analyse=low` is set, then try again. |
