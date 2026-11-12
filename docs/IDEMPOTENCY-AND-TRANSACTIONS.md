# WorldFiled Desk — Idempotency and mutation transaction design

Status: design only; no migration applied and no live database changes.
Prepared: 7 November 2026

## Decision and reference patterns

The design follows durable replay semantics from Stripe's idempotent request model and AWS Builders' Library guidance on safe retries: a key identifies one logical operation, the canonical request payload is bound to it, and a repeated request replays the recorded result rather than repeating the side effect. We adapt this to PostgreSQL transactions and the existing Supabase REST + Netlify function architecture.

We will not use process memory, browser-only deduplication, timing windows, or a cache as the source of truth. Serverless instances can restart or run concurrently; cache eviction must never permit a duplicate editor decision.

## User experience principles

- The editor clicks once and receives a clear pending/saved/failed state.
- Disable only the action being submitted; preserve the rest of the page and entered content.
- Generate one random key per logical user action and retain it through timeout/retry.
- A retry uses the same key and identical payload. A changed payload is a new action and gets a new key.
- If the outcome is unknown after a timeout, show "Checking whether this was saved…" and query/replay by key before inviting a new submission.
- Never display "Saved" until the server confirms the committed result.
- On a replay, show the original success result with a subtle "Already saved — no duplicate created" explanation.
- On a same-key/different-payload conflict, explain that the request changed and offer a safe new attempt; do not silently generate a new key.
- Keyboard access, clear focus, inline validation, accessible status announcements and mobile layouts are required.
- Avoid global page locks, spinners that hide useful content, destructive auto-clears, or generic error messages that discard editor work.

## Proposed database model

A private schema table (prefer private.idempotency_records; schema exposure and permissions to be reviewed) stores:
- id UUID primary key;
- actor_key stable authenticated editor identity;
- endpoint_key constrained operation name;
- idempotency_key UUID/text with bounded length;
- request_hash SHA-256 of canonical validated payload;
- resource_type and resource_id where known;
- response_status and JSON response body;
- created_at, completed_at, expires_at;
- optional request/correlation ID for diagnostics.

Unique constraint: (actor_key, endpoint_key, idempotency_key).
Never store passphrases, cookies, service keys, or unnecessary evidence text in this table. Store only the minimum response needed to replay the same client-visible outcome. Apply strict access: no anon/authenticated direct table access; only a reviewed server-side transaction function may read/write it.

Canonical request hash is computed server-side after schema validation and normalization. Same key + same hash returns the original status/body. Same key + different hash returns 409. Concurrent requests serialize on the unique key; exactly one transaction performs the mutation.

Retention is operation-specific. Keep editor decision, approval, correction, and publication deduplication records durably; only low-risk transient operations may have an expiry, and expiry must not re-open a duplicate window for a high-impact action.

## Transactional operation API

Use narrowly scoped PostgreSQL functions with explicit parameters and SECURITY INVOKER by default. Avoid broad generic SQL execution and avoid SECURITY DEFINER unless a reviewed privilege model proves it necessary. If definer rights are necessary, use a private schema, fixed safe search_path, explicit actor authorization, and minimal grants.

A function should:
1. Validate actor, action, resource relationship and allowed state transition.
2. Acquire/insert the idempotency key under the unique constraint.
3. Compare request hash and replay or reject as appropriate.
4. Perform the business mutation.
5. Write the audit event in the same transaction.
6. Store the exact response and completion status.
7. Commit all together.

If any step fails, the transaction rolls back. A later retry can safely execute the operation.

### First operation: story editorial decision

Replace the current three independent calls (append editorial_decisions, update stories.editorial_status, insert audit_events) with one transaction function. Preserve append-only decision history. Ensure only the authenticated editor can decide and verify the story exists. Return the decision ID, status and recorded timestamp. No silent overwrite.

### Second operation: claim verification decision

Replace the current verification result insert + story status update with one transaction. Re-check claim/story relationship, evidence set, latest evidence timestamp, contradiction status and reconciliation rationale inside the transaction. The transaction must refuse SUPPORTED if conditions are not met. Record editor decision and update story status atomically.

### Third operation: edition membership replacement

Validate all member IDs and maximum counts; ensure all stories exist; update edition metadata, replace membership rows, invalidate prior approval/prompt validity, and write audit event atomically. Preserve the existing order positions. A failed transaction must leave the previous edition and membership unchanged.

### Fourth operation: prompt version creation

Use a unique (edition_id, version) constraint plus transactional version allocation and idempotency. Persist generated prompt, input/evidence/membership hashes, prompt policy version, deliverable type, and audit event atomically. Same-key retry returns the original prompt version, never creates version N+1 again.

## Retry and error contract

- Retry only network failures, timeouts, 429 and transient 5xx responses, with bounded exponential backoff and jitter, and only with the same idempotency key.
- Do not retry validation, authentication, authorization, conflict, or editorial-rule errors automatically.
- If a connection drops after commit, the retry reads the committed idempotency record and replays the original response.
- If no completed record exists, a safe transactional retry may proceed with the same key.
- Never interpret a timeout as proof of failure.
- Return a correlation ID for support/debugging, but never expose internal secrets.

## Caching and invalidation

Idempotency records are durable database state, not a cache. Do not put replay results in shared CDN caches. Authenticated mutation responses and status queries remain Cache-Control: no-store. Client state may temporarily hold the pending key and request body, but should be scoped to the in-flight operation and cleared only after confirmed completion or explicit user cancellation. Do not persist sensitive evidence or auth data to local storage.

Invalidate/recompute derived edition readiness when story evidence, verification decisions, editorial status, membership, source lineage, or prompt policy changes. Readiness is versioned against its exact inputs; never cache a green gate beyond those versions.

## Required tests

- First request commits exactly one mutation, one audit event and one idempotency result.
- Same key + same body replays identical response and creates no second mutation.
- Same key + different body returns 409 and creates no mutation.
- Two concurrent identical requests create exactly one mutation.
- Timeout after commit followed by retry replays committed result.
- Failure before commit leaves no mutation, audit event or completed key.
- Audit insertion failure rolls back business mutation.
- Actor/resource mismatch is rejected.
- Expired low-risk key behaviour is explicit; high-impact actions remain durably deduplicated.
- Edition membership replacement failure leaves original ordered membership unchanged.
- Verification decision and story status never diverge.
- Prompt retry does not increment version twice.
- Private idempotency data is not accessible from public client roles.

## Rollout sequence

1. Schema/function proposal and local tests; migration reviewed but not applied.
2. Implement story decision transaction on feature branch and integration tests.
3. Implement claim decision transaction.
4. Implement edition membership transaction.
5. Implement prompt version transaction.
6. Add a small reusable frontend mutation helper and retry-aware UI states.
7. Test against an isolated staging database and authenticated preview.
8. Ask the owner to approve the migration and staging test before any production application.

## Non-goals

- No automatic retries of arbitrary POSTs.
- No in-memory deduplication.
- No use of CDN/cache as idempotency storage.
- No hidden changes to existing records or migration ledger.
- No weakening of claim clearance, contradiction review, human editorial approval or publish/export gates.
