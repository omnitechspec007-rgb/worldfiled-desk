# Source Provenance Desk — implementation stage

This stage adds a read-only, authenticated explorer for the provenance records introduced in migrations 012 and 013.

## What it shows
- Configured publisher identities and retrieval health.
- Content-access policy, defaulting visibly to metadata-only when no reviewed policy row exists.
- Publisher-to-publisher ownership, affiliation and syndication relationships.
- Article-level origin classifications and available upstream links.
- Explicit unreviewed states and provenance revision metadata.

## Safety
- No publisher ownership or article origin is inferred or backfilled.
- A different publisher name/domain is not treated as proof of independence.
- The endpoint is read-only and uses the existing server-side service-role helper.
- All responses are `Cache-Control: no-store`.
- If the new provenance schema is absent, the page explains that migrations are not installed. It does not run them.
- This stage does not yet create candidate relationships or mutate review decisions. Evidence-backed, idempotent editor actions are a separate next stage.

## Deployment generation
The single Vercel API router is generated from `netlify/functions/*.mts`. The production build and test command now run `npm run build:api` first so a newly added handler is included without adding another Vercel function.
