# WorldFiled Desk

Evidence-first global news research desk for **The World, Filed.**
*What happened. What changed. What matters.*

## Status (Milestone 1 — foundation)

- Built: app shell, navigation, brand styling, System Health page with a database connectivity check.
- NOT built yet: research runs, discovery, evidence pipeline, editorial workflow, production exports.
- No AI is used. No paid service is required.

## Environment variables (set in the Netlify dashboard, never in code)

| Name | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key. Mark as secret. Never use in browser code. |

Netlify: Site configuration → Environment variables.
