# WorldFiled Desk — source provenance and independence design

Status: design and implementation specification; no production schema or data changes.
Base: PR #5 code-tested head `59c3b32981058821b75a89f1ac069015d4c1b000`.
Prepared: 7 November 2026.

## Objective

Distinguish how many outlets mention a story from how many genuinely independent reporting origins support it. Preserve the path from a story claim to the article passage, the publisher, the publisher's ownership relationships, and any upstream wire, press release, or syndicated source.

A high article count is not proof of independent corroboration. Unknown relationships must remain unknown; the system must not infer independence from different publication names or domains.

## Expert references compared

| Reference | Useful design pattern | Why we will not copy it wholesale |
|---|---|---|
| Media Cloud Directory and Source Guide | Treat a source as a normalized publication/domain identity; retain feeds, root domain, country, media type, notes, and carefully bounded parent/child source entries. Its FAQ also separates URL metadata from copyrighted article text. | A global media directory and collection engine is far beyond our configured-source newsroom. We need a small local registry with reviewable relationships. |
| GDELT Cloud methodology | Explicit per-source content policies: blocked, metadata-only, or extraction allowed; retain language, country, provenance and policy separately from raw article metadata; disclose coverage gaps and withhold unsupported measures. | It is a large structured-data platform, not a dependency. We borrow its provenance and abstention discipline, not its proprietary event pipeline. |
| Jadro | Self-hosted RSS reader that clusters across outlets with multilingual embeddings and pgvector; ranks by coverage, source diversity, recency and velocity; keeps the article list available for inspection. | It is a separate stack and clustering is not independence verification. We already have a clustering pipeline and should not add Redis/pgvector/ONNX just to solve source lineage. |
| NewsIntel | Keeps every derived cluster/event/graph object traceable to its bounded set of articles; authority-file thinking for canonical entities and aliases. | It targets a much larger self-hosted archive and adds several services. We need only the lineage and audit concepts. |
| News Deduplicator | Simple headline deduplication, clustering and ranking pipeline. | Too shallow for ownership, syndication and source-origin evidence; use only as a basic comparison. |

## Chosen WorldFiled approach

Build a small relational provenance layer in the existing Supabase/Postgres model. Keep the current configured RSS ingestion and metadata-only default. No new infrastructure, paid API, vector database or external source directory is required.

### 1. Separate four concepts

1. **Publication identity** — the outlet/domain represented by a source registry record.
2. **Ownership and affiliation** — verified relationships between publications (same owner, parent company, subsidiary, joint venture, partner, or unknown).
3. **Article origin** — whether an individual retrieved article is original reporting, wire copy, syndicated, republished, a press release, an official document, an aggregator item, or unknown.
4. **Evidence contribution** — whether a specific article passage actually supports, contradicts, or merely repeats a claim.

Do not collapse these into one "reliability score".

### 2. Proposed data model

#### source_relationships

Append-only, reviewable relationship records between two source-registry entries:
- source_id and related_source_id;
- relationship_type: same_owner, owned_by, subsidiary_of, syndicates_from, republishes, licensed_from, partner, aggregates, official_source_for, other;
- review_status: unverified, verified, disputed, rejected;
- evidence_url and reviewer_notes;
- checked_at, checked_by, created_at;
- unique relationship identity and an audit trail for changes.

Only verified relationships affect independence grouping. A shared parent group may be a verified relationship; a model's guess is only a candidate.

#### article_lineage

One or more lineage edges per retrieved source:
- retrieved_source_id;
- optional upstream_retrieved_source_id when the upstream article is already in our archive;
- upstream_url and optional upstream_source_registry_id for an external origin;
- origin_type: original_reporting, wire_copy, syndicated, republished, press_release, official_document, aggregator, other, unknown;
- review_status: unverified, verified, disputed, rejected;
- evidence_url, reviewer_notes, checked_at, checked_by;
- created_at and append-only revision history.

A story may have multiple articles that each have different lineage. A publisher may publish both original work and syndicated work; do not assign one origin label to every article from that publisher.

#### source_policy

Keep content-access permission separate from editorial reliability and independence:
- blocked;
- metadata_only;
- extraction_allowed;
- policy evidence, owner and last review.

The current metadata-only default remains. A source's presence in the registry is not permission to extract its full text.

### 3. Independence calculation: conservative, explainable and abstaining

For every story cluster or development, show separate counts:
- articles observed;
- distinct publication domains;
- verified ownership groups;
- confirmed independent reporting origins;
- known same-owner / syndicated / republished items;
- unresolved lineage items.

Rules:
- Same verified ownership group is not counted as independent publisher coverage.
- Multiple articles tracing to the same verified wire story or press release count as one upstream origin.
- A source with unknown ownership or unknown article origin contributes to the article/outlet count but not the confirmed-independent count.
- A verified independent origin requires a reviewable basis for both publication relationship and article origin. If either is unknown, independence is unknown.
- Do not convert "not known to be related" into "independent".
- Do not infer a wire-service origin merely because two headlines are similar.
- Distinguish "two outlets reported this" from "two independent reporting origins corroborated this".

Display a short explanation and the underlying articles/relationships. Never expose an opaque source-diversity score as a fact.

### 4. Editorial UX

In Evidence Room and Story detail:
- each source card shows publication, root domain, source policy, article origin and review state;
- show "unreviewed" clearly rather than a green independence badge;
- provide a source-relationship inspector with the evidence link and reviewer rationale;
- show lineage chains (publisher → wire service / press release / upstream article);
- offer model-generated candidate matches only as suggestions, clearly marked unverified;
- allow an editor to confirm, reject or dispute a candidate with evidence;
- preserve the previous decision and who changed it;
- never auto-merge sources or overwrite a reviewed relationship;
- use keyboard-accessible controls, concise labels and mobile-friendly detail panels.

### 5. AI and anti-manipulation rules

- Source pages, RSS content, article text and metadata are untrusted data, not instructions.
- AI may suggest a possible shared origin, ownership link or duplicated passage, but cannot confirm it.
- No fabricated owner, wire source, upstream URL, publication time, quote, or source relationship.
- No inferred independence from a unique domain, different masthead, headline similarity, or different article wording.
- Missing evidence returns unknown; conflicting evidence returns disputed.
- Sponsor, traffic, engagement or editorial ranking goals cannot change source lineage or independence labels.
- Every model suggestion records the evidence inputs and model/rule version; the editor's decision remains separate.
- A new lineage review invalidates dependent source-diversity calculations and cached edition-quality results.

### 6. Caching and idempotency

- Cache source/lineage summaries by story ID plus source-registry version, relationship-review version, article-lineage version and policy version.
- Any verified relationship or article-lineage update invalidates dependent cluster and edition summaries.
- Never cache an "independent" result after its underlying relationship version changes.
- Relationship mutations require request-level idempotency and an audit event in the same transaction.
- Same request key + same payload replays; same key + changed payload conflicts.
- Keep review history append-only; no destructive overwrite of prior verification decisions.

### 7. Backfill policy

The live source registry currently contains existing source metadata but no explicit ownership-group or article-origin verification fields. Existing records must begin as **unknown/unreviewed**.

Do not infer relationships for the existing registry in bulk. Build a review queue ranked by:
1. sources frequently co-occurring in the same clusters;
2. obvious wire-service or press-release patterns that can be checked against source pages;
3. ownership links supported by publisher disclosures or corporate filings;
4. high-impact stories where independence affects editorial clearance.

Record the evidence URL and the reviewer decision. If evidence is unavailable, leave the relationship unknown.

## KPIs and release gates

- 100% of material evidence references resolve to an archived article/source ID.
- 100% of source cards show an explicit origin state, including unknown.
- 0 model-generated relationship guesses are promoted to verified without editor confirmation.
- 0 unknown relationships counted as confirmed independent coverage.
- Every verified relationship has an evidence URL or an explicit documented reason why the evidence is internal.
- Source-lineage changes invalidate dependent cached summaries.
- Every change can be reconstructed from the audit history.
- Measure the share of story clusters with confirmed independent coverage, but do not optimize that metric by guessing.

## Implementation stages

1. **Schema and constraints:** add source_relationships, article_lineage and source-policy history tables with safe defaults and RLS review.
2. **Read-only audit view:** show current source metadata and unknown lineage without changing editorial scoring.
3. **Editor review workflow:** confirm/dispute ownership and syndication links with evidence and immutable history.
4. **Cluster lineage panel:** show article origin chains and distinguish article count from independent origin count.
5. **Conservative coverage metrics:** use only verified relationships; publish unknown counts beside confirmed counts.
6. **Cache invalidation and idempotent mutations:** version every derived summary and protect all writes.
7. **Manual backfill:** review the highest-impact sources first; never auto-label the existing registry.

## Implementation checkpoint

The first schema slice is now present on this feature branch as migration 012:
- `source_relationships` stores publication-to-publication relationships with an explicit review state.
- `source_relationship_review_events` preserves the review history.
- `article_lineage` stores per-article upstream/origin links.
- `article_lineage_review_events` preserves article-origin review history.
- `source_content_policies` separates blocked / metadata-only / extraction-allowed from reliability and independence.
- `source_content_policy_events` preserves policy changes.

New relationships default to `unverified`; new article lineage defaults to `unknown/unverified`; source content policy defaults to `metadata_only`. Verified/disputed/rejected states require reviewer identity and an evidence URL or written rationale. Browser roles receive no table access; review-history tables are append-only for the service role.

Real-Postgres migration tests are being added before any UI or scoring integration. This migration has not been applied to the live database, and existing source records are not backfilled.

## Explicit non-goals

- Do not rebuild the ingestion pipeline.
- Do not scrape publisher full text by default.
- Do not use source reputation as a substitute for claim evidence.
- Do not treat source ownership as proof that every article is non-independent.
- Do not treat different publishers as independent without lineage review.
- Do not add a vector database or a new AI vendor for the MVP.
- Do not change live database schema or data without separate approval.

## References

- Media Cloud Source Guide: https://www.mediacloud.org/documentation/source-guide
- Media Cloud FAQs: https://www.mediacloud.org/documentation/faqs
- GDELT Cloud methodology: https://gdeltcloud.com/methodology
- Jadro: https://github.com/MatejGadjo/jadro
- NewsIntel: https://github.com/itheCreator1/newsintel
- News Deduplicator: https://github.com/mundano17/news-deduplicator
