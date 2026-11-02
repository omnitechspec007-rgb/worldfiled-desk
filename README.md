# WorldFiled Desk

Evidence-first global news research desk for **The World, Filed.**
*What happened. What changed. What matters.*

## Status

WorldFiled Desk researches, verifies, scores and selects stories, then writes a story-specific production prompt that you paste into Claude. It does not render, voice or publish anything.

- Working in simulated tests (`npm test`): one-click run, built-in global sources, resumable stages, story grouping, rule-based scoring and diverse shortlist, approve/reject with audit trail, and the Creative Prompt Architect (treatment and role selection, evidence classes, per-deliverable tool selection, brand block, approval gate, prompt history, reference library).
- Verified live earlier: sign-in, database connection, real feed retrieval (30 of 34 sources on the first run).
- One-time setup: `supabase/migrations/002_scoring.sql` (done) and `003_creative_prompts.sql` (Prompt History and Reference Library). Until 003 is run, prompts still work but are clearly marked NOT saved.
- NOT built: full-text evidence, claim extraction, original-source tracing, automatic conflict detection, AI. See `docs/SCORING.md` and `docs/CREATIVE.md`.
- Optional real-database test of migration 003: `tests/db/migration003.test.mjs` (see its header; not part of `npm test`).

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


## Edition Desk (local build, not yet pushed)
See `docs/EDITIONS.md`. Needs migration `004_editions.sql` (not run). Without it the desk still suggests editions and builds prompts, clearly marked NOT saved.
