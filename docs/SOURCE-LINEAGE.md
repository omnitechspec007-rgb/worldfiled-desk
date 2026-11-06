# WorldFiled source lineage and independence model

## Current rule

A count of publisher labels is not a count of independent sources. The current evidence pack therefore uses `MULTI_OUTLET_REPORTED` rather than `INDEPENDENTLY_CORROBORATED`. It does not infer independent reporting from different outlet names.

The live registry currently contains 45 source entries (38 enabled, 7 disabled). Seven BBC regional feeds share the publisher label BBC News, and two RNZ feeds share Radio New Zealand. The application now normalizes publisher labels when counting sources, but ownership, syndication and article-level origin are not fully recorded.

## What must be distinguished

1. **Outlet / feed** — the specific publication or feed that delivered the item.
2. **Publisher group** — the organisation or parent group controlling the outlet.
3. **Article origin** — original reporting, wire-service copy, press release, official publication, syndicated copy, or unknown.
4. **Claim-level evidence** — the exact passage and source that supports or challenges a material claim.

These are different facts. A publisher can own multiple outlets; multiple publishers can republish one wire story; one article can cite a primary document without independently verifying it.

## Proposed future metadata (not applied)

For `source_registry`:
- `publisher_group_key` — stable normalized group identifier, nullable until verified.
- `ownership_status` — `verified`, `unverified`, or `disputed`.
- `ownership_source` — reference or note supporting the ownership relationship.
- `ownership_checked_at` and `ownership_checked_by` — audit trail.

For `retrieved_sources`:
- `origin_type` — `original_reporting`, `wire_service`, `press_release`, `official_publication`, `syndicated`, or `unknown`.
- `origin_publisher` — known original reporting or distribution organisation.
- `origin_url` — original report or primary document when known.
- `origin_checked_at` and `origin_checked_by` — audit trail.

This is a proposal only. No database migration, schema change or live data update is included in this PR.

## Classification policy

- `SINGLE_SOURCE`: only one known publisher group is represented for the relevant reporting.
- `MULTI_OUTLET_REPORTED`: more than one publisher label is represented, but independence has not been established.
- `INDEPENDENTLY_CORROBORATED`: only after the relevant sources have distinct verified publisher groups, no shared wire/syndicated/press-release origin is identified, and the material claim is supported by separately checked passages.
- `OFFICIALLY_DOCUMENTED`: an official source establishes only what it itself records or announces. It does not independently prove outcomes, causes or third-party claims.
- `CONFLICTING`: an editor records conflicting checked passages and keeps the disagreement visible.
- `UNKNOWN`: source material does not establish the claim.

A story-wide source count must never automatically upgrade every claim in the story. Independence is assessed per material claim and its evidence.

## Operational workflow

1. Maintain a source registry entry for each feed/outlet.
2. Verify publisher group from a reliable ownership source before assigning a group key.
3. For each retrieved article, record wire, syndication, press-release or original-reporting lineage only when the article or its source trail supports that conclusion.
4. Link exact passages to material claims in the Evidence Room.
5. Reassess a claim whenever new evidence is added.
6. Keep unknown lineage visible; do not infer it from similar headlines alone.

## Release gates

- Do not display an independent-source count while ownership/origin metadata is unknown.
- Do not use `INDEPENDENTLY_CORROBORATED` for multiple publisher labels alone.
- Do not equate RSS snippets with full-article verification.
- Do not apply the proposed metadata until a reviewed migration is explicitly approved and a backfill plan is agreed.
