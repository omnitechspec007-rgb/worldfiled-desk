# WorldFiled Desk

Evidence-first global news research desk for **The World, Filed.**
*What happened. What changed. What matters.*

## Status

- Working in simulated tests (`npm test`, 78 checks): one-click run, 34 built-in sources across 7 regions, automatic source testing, resumable stages, duplicate-click safety, story grouping, rule-based scoring and diverse shortlist, approve/reject with audit trail, approval-gated draft export.
- Verified live: sign-in, database connection, real feed retrieval (first run reached 30 of 34 sources).
- One-time setup for scoring: run `supabase/migrations/002_scoring.sql` in the Supabase SQL Editor.
- NOT built: full-text evidence, claim checking, original-source tracing, AI. See `docs/SCORING.md` for scoring limits.

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
