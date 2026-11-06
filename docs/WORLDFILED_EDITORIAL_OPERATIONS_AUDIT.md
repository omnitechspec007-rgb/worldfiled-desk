# WorldFiled Editorial Operations Audit
**Audit date:** 6 November 2026  
**Repository:** `omnitechspec007-rgb/worldfiled-desk`  
**Scope:** Read-only review of selected `main` application code and live Supabase schema/data.

## Executive finding

WorldFiled Desk has a substantial research, selection, edition-approval and prompt-generation foundation. It does **not yet demonstrate a functioning claim-level verification pipeline**. The live database currently contains 1,249 stories, all marked `unverified`; the `claims`, `claim_evidence` and `verification_results` tables each contain zero rows. Retrieved source records are all `metadata_only` (1,298 rows). Editorial approval must not be represented as factual verification.

**Current operating rule:** use the application for research discovery and editorial preparation; do not treat its current approval state as verified-publication clearance.

## Evidence observed

### Live database snapshot

| Measure | Observed result |
|---|---:|
| Stories | 1,249 |
| Stories marked unverified | 1,249 |
| Editorially approved / in review / pending | 20 / 4 / 1,225 |
| Retrieved source records | 1,298 |
| Retrieved sources with metadata only | 1,298 |
| Claims / claim-evidence links / verification results | 0 / 0 / 0 |
| Stories with one linked source | 1,212 |
| Stories with two linked sources | 32 |
| Stories with three or more linked sources | 5 |
| Source registry | 38 healthy/enabled; 1 degraded/disabled; 3 failing/disabled; 3 disabled |
| Saved editions | 3 video drafts, 1 text draft |

These are live counts at audit time. Multiple outlets do not by themselves prove independent corroboration.

### Migration / schema drift

The live migration ledger lists only `20261106092726 daily_edition_profiles`. The live schema nevertheless contains edition, cycle, story, evidence and verification-related objects. Migration files 004 and 005 describe prerequisite edition/cycle structures, while migration 006 adds video/text profiles. The exact history of how prerequisite objects were introduced is not established by the migration ledger. Treat this as **migration-history drift** and reconcile it before future schema work. Do not rerun 004/005 blindly.

Migration 006 is reflected in the live schema: `editions.edition_kind` exists, and live edition rows include both `video` and `text`.

### Application workflow observed

1. Research results are represented as developments with source metadata, editorial reasoning, uncertainty notes and a heuristic evidence-strength label.
2. Edition Desk lets an editor select, order and save developments into separate video and text profiles.
3. The editor can record an edition decision. The application checks whether approval matches the current member list.
4. Prompt generation is tied to the approved edition and stores an evidence snapshot with source references and bounded snippets.
5. The static roundup builder renders a 1080×1920 canvas, allows editing/reordering/removal, exports PNG and records a six-second static video as WebM in the browser.

An edition approval for a member list is not a claim-level fact-check. Current database status supports no claim that any story has passed claim verification.

## Priority findings

### P0 — Verification is not operational

The schema has `claims`, `claim_evidence` and `verification_results`, but all are empty. Source intake stores metadata only. The scoring documentation explicitly caps evidence and source-independence scores because only headlines and short summaries are collected. Evidence labels and corroboration indicators are discovery heuristics, not completed fact-checks.

**Required repair:** introduce a human-reviewed claim register per development. Each material factual claim needs precise wording; claim type; supporting and contradicting source references; source role (primary, independent reporting, wire/republication, interested party); independence assessment; status (unverified, supported, contradicted, disputed, not independently confirmable); reviewer/time/notes; and a visible unresolved-claims list.

Do not auto-mark a story verified because it has multiple links, an official source, an approved edition or an AI-generated summary.

### P0 — Publication gate must distinguish editorial approval from verification

The edition workflow has a member-list approval gate and immutable prompt/evidence history. This audit has not established a corresponding claim-level verification gate. The all-unverified live state makes this a practical blocker.

**Required repair:** keep editorial decision and verification status separate. For factual publication, block final export/package approval while a material claim is unverified, contradicted or unresolved, unless an editor explicitly chooses a clearly labelled limited-evidence treatment and records why. Static roundup must not inherit a false verified label from edition approval.

### P1 — Static roundup export is not a finished media pipeline

The static builder creates a 1080×1920 canvas and PNG. Browser video export is six seconds and static, but output is WebM; MP4 conversion is not implemented. Main-branch builder includes the two-note sound by default. The open quality-controls branch adds a sound toggle and character-count warnings, but those warnings are heuristics, not actual rendered-layout measurements. The renderer truncates overflow with an ellipsis, so warning-free export is not guaranteed to preserve all intended text.

**Required repair:**
- Preserve the exact one-frame, six-second, no-motion format.
- Default to silent; make the optional two-note effect explicitly enabled by the editor.
- Measure actual rendered line count and text bounds using the same canvas font metrics as export.
- Prevent silent truncation; require editor shortening or a smaller story count.
- Export PNG and silent WebM reliably.
- Add MP4 only through a tested conversion path with codec/capability checks.
- Verify duration, dimensions, audio presence/absence and frame stability on produced files.
- Attach a source/verification manifest to each edition package.

### P1 — Editorial labels and source independence

Deterministic scoring is transparent and its documentation appropriately states limitations. Outlet count and wording similarity cannot reliably identify shared wire copy, common press releases or copied reporting. The source-relationship table exists but currently has no rows.

**Required repair:** store known republication/citation/original-source relationships; show outlet count separately from independent-source count; identify primary source, original reporting, syndication and interested parties. Where independence is unknown, say so.

### P1 — Data security findings need access-model review

Supabase Security Advisor reports 28 public-schema tables with RLS enabled but no policies, plus 14 functions with mutable search paths. Migration code explicitly revokes browser-role grants on some tables and the application uses server-side functions, so an RLS-without-policy finding is not automatically an exploitable exposure. Verify grants, exposed schemas, views, function privileges and actual server-only access before changing policies. Do not apply blanket policies or grant browser access as a shortcut.

**Required repair:** inventory grants and exposure table-by-table; confirm service-role secrets remain server-only; set explicit safe search paths on affected functions after inspecting each definition; rerun advisors and application access tests.

### P2 — Documentation is materially stale

The root README and `docs/EDITIONS.md` still describe later features as local-only or migrations as not run, while current application contains daily video/text profiles and the live database has migration 006's edition-kind column. Reconcile documentation against deployed code and live schema after migration-history drift is understood.

## What should be preserved

- Shared research pool feeding independent video and text selections.
- Human-controlled selection, ordering and approval.
- Append-only decision history and member-list approval hash.
- Prompt snapshots tied to selected members and evidence references.
- Explicit multi-topic roundup when stories do not genuinely connect.
- Honest evidence limitations in prompts and scoring documentation.
- No auto-publishing.
- Static six-second visual as a separate product from narrated programmes and written briefings.

## Repair sequence

1. Freeze scope and document the live baseline. Keep production stable while inspecting deployed commit, open PR checks and export behavior.
2. Map retrieval → source record → story cluster → claims → evidence links → verification decision → editorial decision → edition approval → export. Identify existing API/UI entry points before migrations.
3. Implement a small, testable claim-verification workflow. Reuse existing tables where sound; only propose additive schema changes after reviewing constraints, triggers, grants and migration history.
4. Enforce the publication gate. Separate editorial approval from verification. Test that unverified material cannot be presented as verified.
5. Repair static export quality: silent default, actual text-fit measurement, overflow prevention and output validation. Keep MP4 unavailable until conversion is implemented and tested.
6. Complete one controlled editorial cycle: select current stories, verify material claims against primary and independent sources, create the static roundup and a separate written briefing, then inspect both outputs and evidence manifests.
7. Update documentation and prepare distribution: public archive, newsletter, media kit, analytics and sponsor outreach.

## Acceptance criteria before calling the newsroom publication-ready

- Every material factual claim has traceable source support and a visible status.
- Source independence is assessed, not inferred from outlet count.
- Editorial approval and factual verification remain distinct.
- Material unresolved contradictions cannot silently pass as verified.
- Edition approvals are invalidated when members or evidence change.
- Static roundup text is never silently truncated.
- Six-second export is measured and tested; silent export is available by default.
- PNG and WebM are verified; MP4 is labelled unavailable until verified.
- Written briefing is independently written, not a video transcript.
- Corrections and updates are recorded and visible.
- No database migration or production deployment occurs without appropriate approval.

## Audit limitations

This pass inspected selected application files, documentation, migration files, live schema/table metadata, selected aggregate data and Supabase security findings. It did not yet execute a complete browser workflow, inspect every API function or function body, test a real exported media file, audit every grant/policy, inspect the full PR #4 check logs, or test public access to the production URL. Those remain work items; no claim is made that they have passed.
