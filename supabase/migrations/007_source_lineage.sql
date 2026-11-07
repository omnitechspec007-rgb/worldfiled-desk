-- WorldFiled Desk migration 007: source ownership and article-origin lineage.
-- Additive only. Existing rows remain explicitly unverified/unknown.
-- This file is for review on the feature branch; do not apply to production without separate approval.
begin;

alter table source_registry
  add column if not exists publisher_group_key text,
  add column if not exists ownership_status text not null default 'unverified',
  add column if not exists ownership_source text,
  add column if not exists ownership_checked_at timestamptz,
  add column if not exists ownership_checked_by text;

alter table source_registry
  drop constraint if exists source_registry_ownership_status_check;
alter table source_registry
  add constraint source_registry_ownership_status_check
  check (ownership_status in ('verified', 'unverified', 'disputed'));

alter table source_registry
  drop constraint if exists source_registry_verified_ownership_evidence_check;
alter table source_registry
  add constraint source_registry_verified_ownership_evidence_check
  check (
    ownership_status <> 'verified'
    or (
      nullif(btrim(publisher_group_key), '') is not null
      and nullif(btrim(ownership_source), '') is not null
      and ownership_checked_at is not null
    )
  );

alter table retrieved_sources
  add column if not exists origin_type text not null default 'unknown',
  add column if not exists origin_publisher text,
  add column if not exists origin_url text,
  add column if not exists origin_status text not null default 'unverified',
  add column if not exists origin_checked_at timestamptz,
  add column if not exists origin_checked_by text;

alter table retrieved_sources
  drop constraint if exists retrieved_sources_origin_type_check;
alter table retrieved_sources
  add constraint retrieved_sources_origin_type_check
  check (origin_type in (
    'original_reporting',
    'wire_service',
    'press_release',
    'official_publication',
    'syndicated',
    'unknown'
  ));

alter table retrieved_sources
  drop constraint if exists retrieved_sources_origin_status_check;
alter table retrieved_sources
  add constraint retrieved_sources_origin_status_check
  check (origin_status in ('verified', 'unverified', 'disputed'));

alter table retrieved_sources
  drop constraint if exists retrieved_sources_verified_origin_evidence_check;
alter table retrieved_sources
  add constraint retrieved_sources_verified_origin_evidence_check
  check (
    origin_status <> 'verified'
    or (
      origin_type <> 'unknown'
      and origin_checked_at is not null
      and (
        nullif(btrim(origin_url), '') is not null
        or nullif(btrim(origin_publisher), '') is not null
      )
    )
  );

create index if not exists idx_source_registry_publisher_group_key
  on source_registry (publisher_group_key)
  where publisher_group_key is not null;

create index if not exists idx_retrieved_sources_origin_type
  on retrieved_sources (origin_type, origin_status);

comment on column source_registry.publisher_group_key is
  'Stable publisher-group identifier; populate only after checking ownership evidence.';
comment on column source_registry.ownership_status is
  'Ownership verification state. Existing rows default to unverified; never infer from outlet name.';
comment on column source_registry.ownership_source is
  'URL or concise citation describing the ownership evidence reviewed.';
comment on column retrieved_sources.origin_type is
  'Article distribution/origin classification; unknown is the safe default.';
comment on column retrieved_sources.origin_status is
  'Whether article origin classification has been checked against evidence.';

commit;
