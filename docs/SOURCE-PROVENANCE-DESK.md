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
- Editors can submit a publisher-relationship candidate with an HTTPS evidence URL or written rationale. The candidate is always created as `unverified`; no candidate is automatically promoted or counted as independent coverage.
- Candidate creation uses a narrow `SECURITY INVOKER` Postgres RPC, request hashing, durable idempotency, an append-only audit event and provenance-revision increment in one transaction. Same key + same payload replays; same key + changed payload conflicts; duplicate symmetric same-owner edges are rejected.
- Editors can now review existing publisher relationships and article-origin records as verified, disputed, rejected or still unverified. Each review requires an evidence URL or written rationale, uses a durable idempotency key, and appends review history and audit data transactionally.
- Content-policy records remain read-only in the UI and mutation API until the retrieval pipeline enforces those policies. The page explicitly warns that the registry is not yet an enforcement mechanism; `extraction_allowed` is not exposed as an editor action.

## Deployment generation
The single Vercel API router is generated from `netlify/functions/*.mts`. The production build and test command now run `npm run build:api` first so a newly added handler is included without adding another Vercel function.
