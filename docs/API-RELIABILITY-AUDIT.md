# WorldFiled Desk — API reliability audit (PR #5)

Assessment: 6 November 2026
Scope: read-only review of server handlers and shared DB/session helpers on the feature branch. Findings below are not a full penetration test.

## Confirmed protections
- The reviewed claim-verification, editions, edition-prompt, creative, stories, creative-config, decide and auth handlers return `Cache-Control: no-store` on JSON responses.
- The shared database helper uses an 8-second abort timeout, keeps the service key server-side, validates the Supabase HTTPS origin, and throws on non-2xx responses. It fails closed rather than reporting a failed database write as saved.
- Editor sessions use an HMAC-signed, 12-hour cookie with HttpOnly, Secure and SameSite=Strict attributes; signature comparison is timing-safe.
- Claim and evidence creation use database unique constraints with PostgREST merge-on-conflict.
- Prompt version creation handles a database 409 as a version conflict rather than silently overwriting an existing prompt.
- The claim verification endpoint now rejects overlong claim text, evidence passages, location text, reviewer notes and contradiction rationale instead of silently truncating them.
- The same endpoint rejects non-boolean `isContradiction` values; it no longer converts truthy strings such as `"false"` into a true contradiction flag.
- Automated tests were added for overlong values and string booleans.

## Gaps requiring implementation or further proof
1. **Endpoint idempotency — NOT IMPLEMENTED.** Claim decisions append records; edition saves update membership through separate delete/insert calls; prompt creation calculates the next version before insert. A client retry after a timeout can repeat or partially repeat these operations. Unique constraints reduce some duplicates but do not provide request-level replay semantics.
2. **Atomic edition membership updates — NOT PROVEN.** Updating an edition, deleting old membership rows, inserting new rows and writing audit events are separate requests. A mid-sequence failure may leave partial state. Move the operation to a database transaction/RPC after schema review and approval.
3. **Atomic verification decision + story status — NOT PROVEN.** The decision insert and story status update are separate database calls. A partial failure can leave status inconsistent with decision history.
4. **Audit-event atomicity — NOT PROVEN.** Several handlers write the business record and audit event separately. A failure between them can leave a mutation without its audit record.
5. **CSRF and origin checks — INCOMPLETE.** SameSite=Strict is helpful, but state-changing cookie-authenticated endpoints need explicit Origin/Host validation or a CSRF token strategy and tests. Do not assume SameSite alone is a complete defence.
6. **Rate limiting — NOT IMPLEMENTED/NOT VERIFIED.** Login uses a fixed one-second delay for invalid passwords; that is not a persistent per-IP/account rate limiter. Mutation and retrieval routes also need abuse controls.
7. **Retry policy — LIMITED.** The database helper times out and fails closed but does not implement bounded retry/backoff. Add retries only for safe reads or writes carrying durable idempotency keys; never blindly retry an ambiguous write.
8. **Cache policy — PARTIALLY VERIFIED.** The reviewed JSON handlers set no-store. Confirm every route and CDN/proxy configuration, and add automated assertions. Do not add shared caching for authenticated data.
9. **Prompt version races — PARTIALLY PROTECTED.** A 409 is handled, but the editor must refresh and retry intentionally. This is not idempotent replay.
10. **Dependency security — NEEDS TRIAGE.** The observed CI install reported four dependency vulnerabilities (three moderate, one high). Run a full dependency audit, identify direct/transitive packages and compatible fixes; do not apply force upgrades without compatibility review.
11. **Source fetch safety — NEEDS SEPARATE REVIEW.** Verify allowlisted hosts, redirect handling, private-address blocking, response size limits, content-type checks and decompression limits in the ingestion path.
12. **Browser acceptance — NOT COMPLETED.** Automated tests and deployment checks do not replace an authenticated user workflow test.

## Next implementation sequence
- Add an explicit Origin/Host validation helper and negative tests for missing, hostile and mismatched origins.
- Design persistent idempotency storage and atomic mutation RPCs. Do not improvise a serverless in-memory key cache.
- Move edition membership replacement and decision/status/audit writes into transactions.
- Add a complete route-level no-store test.
- Add a rate-limit strategy compatible with the hosting environment.
- Triage the four dependency advisories and review source-fetch SSRF protections.
- Run browser acceptance against an isolated test database.

## Release rule
This audit does not certify the application as secure, fully idempotent or production-ready. No database schema changes or live data changes were performed. Any transactional/idempotency migration must be separately reviewed and approved before production use.
