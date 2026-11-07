# WorldFiled Desk — Idempotency and Editorial UX Architecture Decision

Status: proposed design; implementation not yet complete.
Scope: PR #5 feature branch. No database migration applied and no production data changed.
Date: 7 November 2026.

## Decision summary

Use **database-backed, endpoint-specific transactional idempotency**, not a generic in-memory middleware cache. Keep the existing TypeScript/Netlify handlers as the HTTP and validation layer, but move each multi-write business operation into a narrowly scoped PostgreSQL function (RPC) so the business mutation, audit event and idempotency result commit together.

For the editor experience, use **one clear task per user intent**, explicit status, visible recovery, and version-aware approvals. Do not expose technical retry mechanics to the editor. If a save response is lost, the same action can be safely retried and the original result is returned.

## Benchmark: what established approaches teach us

### Idempotency

| Reference | Useful pattern | Limitation / adaptation |
|---|---|---|
| AWS Builders' Library — Making retries safe with idempotent APIs | Caller-generated request token expresses one logical intent; token and all side effects must commit atomically; same token returns the original result | Strong conceptual model; adapt to a single-editor app and Postgres |
| Stripe idempotent requests | Persist first status/body; replay exact result; reject same key with different parameters; distinguish validation failures and concurrent execution | Do not blindly copy payment-specific retention and error semantics; our editor actions need durable deduplication for approvals |
| Small Fastify/Postgres idempotency reference implementation | Stable body hash, unique scope, in-flight state, concurrent insert handling, stale-lock recovery and tests | Its Fastify/Prisma middleware stack does not match our Netlify Functions + Supabase REST stack; borrow the state machine, not the framework |
| Supabase database functions | Put data-intensive multi-row operations inside Postgres and call them via RPC | Prefer narrow invoker functions with explicit grants and fixed search path; do not create broad SECURITY DEFINER functions to bypass access controls |

### Editorial UX

| Reference | Useful pattern | Application to WorldFiled |
|---|---|---|
| Decap CMS editorial workflow | Clear Draft → Review → Approved/Publish progression; editor does not need to understand Git branches | Use familiar newsroom states and show the next permitted action |
| Payload CMS | Strong access controls, drafts/versions, extensible admin UI and review hooks | Keep evidence, editorial decisions and publication as separate versioned records |
| GitCMS editorial workflow | One task thread, inline comments, approval attached to a specific version, approval becomes stale after edits | Make approval freshness visible and explain exactly what changed since approval |

## Chosen idempotency contract

### Client contract

- Generate a cryptographically random UUID for each logical mutation, not for each network attempt.
- Send it in `Idempotency-Key`.
- Keep the same key while retrying the same unchanged action.
- Generate a new key only after the editor changes the submitted action/payload or deliberately starts a new action.
- Store pending action context in the current browser session so a reload does not silently create a new logical action.
- On an ambiguous timeout, show: **“We couldn't confirm whether this saved. Check status or retry safely.”** The Retry action reuses the same key.
- Never automatically retry a mutation with a new key.

### Server/database contract

Scope a key by authenticated actor, operation name, resource identifier and key. Store a canonical request hash, result status/body, creation time and expiry. Do not store secrets or full source passages in the idempotency ledger.

Required behaviour:

| Situation | Result |
|---|---|
| First request | Perform mutation once; save business changes, audit event and response in one database transaction |
| Same key + same payload after success | Replay original status and response; no second mutation |
| Same key + different payload | Return conflict; never reinterpret the old key |
| Concurrent same-key requests | Serialize/lock at database level; exactly one mutation executes |
| Database exception before commit | Entire transaction rolls back; no success response is persisted |
| Timeout after commit | Retry replays the committed result |
| Expired key | Apply a documented expiry policy; high-impact decisions remain protected by durable natural uniqueness/version constraints |

A proposed implementation may use an idempotency ledger with a unique constraint on `(actor, operation, resource_id, idempotency_key)`, a stable request hash, and stored response fields. Use a transaction-scoped PostgreSQL lock or equivalent row-locking strategy for concurrent requests. Do not rely on process memory, CDN cache, browser-only disabling, or a check-then-insert sequence.

### Transaction boundaries — implement one workflow at a time

1. **Story editorial decision:** decision history + story editorial status + audit event + idempotency result.
2. **Claim verification decision:** verification result + story verification status + audit event + idempotency result.
3. **Evidence/claim additions:** record + freshness invalidation/status update + audit event + idempotency result.
4. **Edition save:** edition metadata + complete ordered membership replacement + audit event + idempotency result.
5. **Edition approval/archive:** decision + membership/evidence version hash + audit event + idempotency result.
6. **Prompt creation:** allocate version atomically and persist prompt snapshot + audit event + idempotency result.

Avoid a single generic RPC with a large untyped action switch. Prefer small typed functions with narrow parameters and explicit validation. A function should not silently change editorial policy or override a factual gate.

## Database security requirements

- Use `SECURITY INVOKER` unless a reviewed requirement proves otherwise.
- Set a fixed safe `search_path` and schema-qualify referenced objects.
- Revoke execution from `PUBLIC`, `anon` and `authenticated` where the function is intended only for the server-side service role; grant only the required role.
- Keep the Supabase service-role key server-side.
- Keep RLS enabled on exposed tables. Confirm actual grants and RLS behaviour before applying the migration.
- No function may accept an arbitrary actor identity from an untrusted browser; actor identity must be derived from the verified server session.
- No migration is to be applied to the live database without explicit approval.

## Editor UX: decisions from the benchmark

### Evidence Room

Current inspection shows a long, dense page: source list, claim creation, then a repeated evidence-entry and decision form for every claim. It works as a functional first version, but it asks the editor to understand too many fields at once.

Improve it progressively:
1. Start with a compact story header: headline, factual status, editorial status and a plain-language next step.
2. Show a claim register summary with counts: Needs evidence, Needs decision, Contradicted, Supported, Stale decision.
3. Keep each claim in a compact card. Expand only the selected claim's evidence and decision workspace.
4. Use a short guided sequence: **Record claim → Attach checked passage → Assess contradictions → Record decision**.
5. Label source depth clearly: metadata, snippet, full text, official document. Never imply the app read a full article when it did not.
6. Explain why a decision is stale after new evidence; keep the prior decision visible in history.
7. Show save state per action (Saving, Saved, Retry safely, Conflict) rather than one vague global busy state.
8. Preserve unsent text on network failure and after a safe refresh; never clear a form until the server confirms success.
9. Keep destructive or irreversible actions separated and confirmed. Use undo only when it is truly safe and auditable.
10. On mobile, use stacked cards, short labels, adequate tap targets and no wide tables.

### Edition Desk

- Keep Video and Text as clearly separate workspaces with independent selections.
- Show selected count, permitted range and remaining capacity persistently.
- Keep the current selection and saved edition visibly distinct.
- Explain recommendation vs factual verification vs human approval with separate labels.
- When a gate blocks an action, explain the exact missing requirement and link directly to the item needing attention.
- Preserve draft work across refresh, but never restore an old approval as current.
- Before a consequential action, show a concise change summary; after it, show a durable success state and a link to the resulting record.
- Avoid surprise resets, silent removal, hidden defaults and controls that appear clickable when a server gate will reject them.

### Global interaction rules

- Every action has one clear primary button and one clear next step.
- Use progressive disclosure rather than presenting every advanced setting at once.
- Preserve editor work on validation/network errors.
- Use inline field-level errors for fixable input; use page-level alerts for service failures.
- Explain status in plain language, not raw database enums.
- Keep the source/evidence panel close to the claim it supports.
- Use consistent loading, empty, success, warning and error states.
- Do not use colour alone to convey factual or approval status.
- Keyboard focus, labels, contrast and screen-reader status announcements are release criteria.

## Acceptance tests for idempotency

- Same key and same body returns identical result and creates one business record.
- Same key and different body returns a conflict and creates no additional record.
- Two concurrent identical requests produce one mutation and one replay.
- Timeout after commit followed by retry returns the committed response.
- Failure during audit insert rolls back the business mutation.
- Failure during membership replacement leaves the previous membership intact.
- Decision and story status cannot diverge.
- A changed evidence version invalidates old claim clearance and dependent approvals.
- The editor sees a safe retry state after ambiguous network failure.

## Rollout plan

**Phase A — Design and proof:** review current schemas, grants, RLS, migration history and handler semantics; write SQL/RPC proposal and tests against an isolated database.

**Phase B — First vertical slice:** implement story editorial decision transaction + idempotency end-to-end; test duplicate, mismatch, concurrency, rollback and timeout-after-commit.

**Phase C — Reuse proven pattern:** extend to claim verification and edition save/approval, one endpoint at a time.

**Phase D — UX integration:** add pending-action key reuse, per-action status and safe retry; then improve Evidence Room progressive disclosure.

**Phase E — Release:** verify authenticated browser workflows, deployed headers, migration history, backup/rollback plan and production migration approval.

## Non-goals

- No in-memory idempotency map.
- No automatic retry with a new key.
- No generic retry of ambiguous writes.
- No blanket database cache for authenticated data.
- No automatic factual clearance from model confidence or source count.
- No silent approval carry-over after content/evidence changes.
- No production migration, deployment or publishing under this ADR.
