# WorldFiled Desk

Evidence-first global news research desk for **The World, Filed.**
*What happened. What changed. What matters.*

## Status (Stage 1 of the one-button rebuild)

- Working in tests (simulated feeds and database): one-click run, 34 built-in sources across 7 regions, automatic source testing, resumable stages, duplicate-click safety, story grouping.
- NOT yet verified live: real feed retrieval from Netlify. First click on the deployed site is the live test.
- NOT built: full-text evidence, claim checking, scoring, curiosity engine, approval and export.
- Run the simulated-engine tests with `npm test`.

## Earlier status (Milestone 1 — foundation)

- Built: app shell, navigation, brand styling, System Health page with a database connectivity check.
- NOT built yet: research runs, discovery, evidence pipeline, editorial workflow, production exports.
- No AI is used. No paid service is required.

## Environment variables (set in the Netlify dashboard, never in code)

| Name | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key. Mark as secret. Never use in browser code. |

Netlify: Site configuration → Environment variables.
