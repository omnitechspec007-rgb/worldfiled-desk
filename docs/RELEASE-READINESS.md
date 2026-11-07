# WorldFiled Desk — release readiness assessment

Assessment date: 2026-11-06
Scope: repository state on `feat/claim-verification-desk`, PR #5. This is a code/release assessment, not a claim that the authenticated browser workflow has been exercised.

## Current branch and checks

- Pull request: https://github.com/omnitechspec007-rgb/worldfiled-desk/pull/5
- Branch: `feat/claim-verification-desk`
- Reviewed head at assessment: `9e5286b162806cd47f48f2053003ade707767b20`
- PR state: open, draft, not merged.
- GitHub Actions: `Phase 1A checks` and `WorldFiled quality gates` completed successfully for the reviewed head.
- Vercel preview and Netlify deploy-preview status checks were successful for the reviewed head.
- No production deployment or live database mutation is part of this PR assessment.

## What the application currently supports

### Research and story review
- Authenticated Story Desk list and story detail.
- Story-source links, source metadata, feed extracts, editorial decisions and scoring dimensions where installed.
- A provisional story ordering based on outlet count and recency. The API explicitly labels this ordering provisional; it must not be mistaken for a final quality ranking.
- Shortlist view backed by the latest shortlist run, with selected and held-back stories and scoring details.

### Edition preparation
- Shared story/development pool for video and text editions.
- Freshness windows: 72 hours generally and up to 14 days for stories with primary/official sources.
- Older stories remain browseable and manually selectable; rejected stories are excluded from suggestions.
- Suggested edition groupings, coherence assessment, weak-connection warnings and unmatched developments.
- Saved editions, human approval decisions, member ordering and approval invalidation when members change.
- Separate video and text edition types. The editor selection limits and API compatibility limits are not identical; verify these in the UI before relying on counts.

### Evidence and factual verification on PR #5
- Authenticated claim register per story.
- Evidence passages linked to sources already connected to that story.
- Editor decisions with a history of outcomes.
- Contradictory evidence requires a dedicated reconciliation rationale before a claim can be marked supported.
- New evidence makes an older decision stale.
- Edition approval and prompt generation are blocked unless every included story has recorded material claims, current supported decisions and extracted supporting passages.
- This is a human-led claim review process. It does not automatically read and verify full articles.

### Creative and static roundup workflow
- The Static Roundup Builder renders one vertical 1080×1920 composition.
- It can export a PNG poster and a six-second static WebM video; the frame does not animate.
- It can add a very subtle two-note sound signature. It does not create narration, a presenter, scenes or a music bed.
- The current browser exporter does not produce MP4.
- Text and cards are editable in the builder, but a true automated pixel-level overflow/legibility acceptance test has not yet been independently demonstrated.
- The separate creative prompt workflow supports longer narrated programme/storyboard production; it is not the six-second static roundup.

### Written edition
- Text editions can be separately selected and saved.
- The prompt architect can generate a written briefing prompt with editorial targets (approximately 12–18 stories and 1,500–2,200 words), not a quota.
- A complete end-to-end publishing, newsletter delivery and public archive workflow is not yet verified.

## Known limitations and release blockers

1. Authenticated browser acceptance of the Evidence Room and edition/export gates has not been independently completed.
2. Migration `007_source_lineage.sql` is present on this feature branch only. It has not been applied to the live Supabase project.
3. Publisher ownership and article-origin lineage are not yet backfilled or fully operationally reviewed. Multiple outlet labels must not be presented as independent corroboration.
4. Existing story records have not been fully backfilled with material claims and evidence. The strict clearance gate may therefore block many historical stories until reviewed.
5. The export preflight protects the normal application path but is not a non-bypassable server-side media publishing/export service.
6. Static roundup video export is WebM, not MP4. No claim of MP4 readiness should be made until a real MP4 conversion pipeline is implemented and tested.
7. Corrections/update history, immutable publication snapshots, public archive, newsletter delivery, sponsor workflow and publishing integrations remain incomplete or unverified.
8. The production application and PR #5 feature branch are different release states. Do not describe PR #5 functionality as already available in production.

## Safe path to first use

### Controlled internal pilot
Target: 3–7 working days after the remaining access and acceptance checks are available.
- Confirm the preview is connected to an isolated/test database or use a safe test project.
- Complete authenticated browser tests for claim entry, evidence entry, contradiction handling, stale-decision invalidation, edition approval and export preflight.
- Test migration 007 on a disposable database and inspect rollback/recovery.
- Confirm a small number of current stories can pass the complete human verification process.
- Keep human approval mandatory and publish manually.

This is a planning estimate, not a promise. It depends on preview access, safe test-database availability and no new critical defects.

### Dependable operational release
Planning estimate: 2–4 weeks after the controlled pilot, depending on the amount of historical claim backfill and whether MP4, corrections, public archive or newsletter delivery are required before launch.
- Complete security and release review.
- Decide how to backfill current stories without inventing evidence.
- Apply approved schema migration through a separately approved production change.
- Add and verify the required publication/correction workflow.
- Implement MP4 only if it is required for the selected distribution channels.
- Run a short supervised publishing pilot and review quality/correction metrics.

## Release policy

- No merge or production deployment solely because CI is green.
- No live database migration or data backfill without separate approval.
- No auto-publishing.
- No claim of independent corroboration without verified publisher and article-origin lineage.
- No claim of MP4 export until an actual MP4 file is produced and technically inspected.
- Keep human editorial and factual approval as separate decisions.
