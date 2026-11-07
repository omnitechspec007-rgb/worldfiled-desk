# Source Provenance Desk — implementation stage

This stage adds an authenticated provenance desk for the records introduced in migrations 012 and 013. Publisher relationships and article lineage are reviewed through narrow, audited RPCs; content-access policies are reviewed through the same transactional pattern and enforced by the research pipeline.

## What it shows
- Configured publisher identities and retrieval health.
- Content-access policy, defaulting visibly to metadata-only when no reviewed policy row exists.
- Publisher-to-publisher ownership, affiliation and syndication relationships.
- Article-level origin classifications and available upstream links.
- Explicit unreviewed states and provenance revision metadata.

## Safety
- No publisher ownership or article origin is inferred or backfilled.
- A different publisher name/domain is not treated as proof of independence.
- Provenance reads and review mutations use the existing server-side service-role helper. Mutations are limited to the explicit idempotent RPC actions; no generic table-write endpoint is exposed.
- All responses are `Cache-Control: no-store`.
- If the new provenance schema is absent, the page explains that migrations are not installed. It does not run them.
- Editors can submit a publisher-relationship candidate with an HTTPS evidence URL or written rationale. The candidate is always created as `unverified`; no candidate is automatically promoted or counted as independent coverage.
- Candidate creation uses a narrow `SECURITY INVOKER` Postgres RPC, request hashing, durable idempotency, an append-only audit event and provenance-revision increment in one transaction. Same key + same payload replays; same key + changed payload conflicts; duplicate symmetric same-owner edges are rejected.
- Editors can now review existing publisher relationships and article-origin records as verified, disputed, rejected or still unverified. Each review requires an evidence URL or written rationale, uses a durable idempotency key, and appends review history and audit data transactionally.
- Content-access policy changes require an HTTPS evidence URL or written rationale and are saved through `review_source_content_policy`, with durable idempotency, append-only policy history, audit event and provenance revision update in one transaction. The UI does not expose direct table writes.
- A missing policy row defaults to `metadata_only`. Unknown or malformed policy values fail closed as `blocked`. A database error other than a missing pre-migration table stops research instead of bypassing the policy read.
- `blocked` sources are skipped before the feed request and excluded from clustering and scoring, including previously retrieved rows. `metadata_only` permits feed metadata and short summaries. `extraction_allowed` records a reviewed permission state but does not cause article-text extraction: the current pipeline remains metadata-only.
- Policy changes apply on the next research stage. Already stored records are preserved for audit/history, but blocked sources are filtered out of downstream editorial candidate generation.

## Content-access policy enforcement

The research pipeline reads the policy registry before discovery. Missing rows are treated as `metadata_only`; an unknown policy value is treated as `blocked`. If the policy table is present but cannot be read for a reason other than a pre-migration 404, the stage fails closed.

- `blocked`: do not request the feed; exclude that publisher's previously retrieved records from clustering and scoring.
- `metadata_only`: read the configured feed and retain only the feed's title, publication metadata and capped summary.
- `extraction_allowed`: record the reviewed state, but still retain metadata only. No full-article fetcher exists in this pipeline stage.

The provenance page exposes an evidence-backed policy review form. Every policy change requires an HTTPS evidence URL or written rationale and uses the existing idempotent Postgres RPC. The policy is applied on the next research stage; historical retrieved rows are not deleted.

## Deployment generation
The single Vercel API router is generated from `netlify/functions/*.mts`. The production build and test command now run `npm run build:api` first so a newly added handler is included without adding another Vercel function.
