-- WorldFiled Desk migration 012: source relationships and article-level provenance.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- No existing source is backfilled or labelled independent by this migration.

begin;

create table if not exists public.source_relationships (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.source_registry(id) on delete restrict,
  related_source_id uuid not null references public.source_registry(id) on delete restrict,
  relationship_type text not null check (relationship_type in (
    'same_owner','owned_by','subsidiary_of','syndicates_from','republishes',
    'licensed_from','partner','aggregates','official_source_for','other'
  )),
  review_status text not null default 'unverified'
    check (review_status in ('unverified','verified','disputed','rejected')),
  evidence_url text,
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_relationship_not_self check (source_id <> related_source_id),
  constraint source_relationship_same_owner_canonical check (relationship_type <> 'same_owner' or source_id < related_source_id),
  constraint source_relationship_review_has_basis check (
    review_status = 'unverified'
    or (
      reviewed_at is not null
      and nullif(btrim(reviewed_by), '') is not null
      and (
        nullif(btrim(evidence_url), '') is not null
        or nullif(btrim(review_notes), '') is not null
      )
    )
  ),
  unique (source_id, related_source_id, relationship_type)
);

create index if not exists idx_source_relationships_source
  on public.source_relationships(source_id, review_status);
create index if not exists idx_source_relationships_related
  on public.source_relationships(related_source_id, review_status);

create table if not exists public.source_relationship_review_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.source_relationships(id) on delete restrict,
  previous_status text not null check (previous_status in ('unverified','verified','disputed','rejected')),
  new_status text not null check (new_status in ('unverified','verified','disputed','rejected')),
  evidence_url text,
  review_notes text,
  reviewed_by text not null,
  created_at timestamptz not null default now(),
  constraint source_relationship_review_event_has_basis check (
    nullif(btrim(reviewed_by), '') is not null
    and (
      nullif(btrim(evidence_url), '') is not null
      or nullif(btrim(review_notes), '') is not null
    )
  )
);
create index if not exists idx_source_relationship_review_events_relationship
  on public.source_relationship_review_events(relationship_id, created_at desc);

create table if not exists public.article_lineage (
  id uuid primary key default gen_random_uuid(),
  retrieved_source_id uuid not null references public.retrieved_sources(id) on delete restrict,
  upstream_retrieved_source_id uuid references public.retrieved_sources(id) on delete restrict,
  upstream_source_registry_id uuid references public.source_registry(id) on delete restrict,
  upstream_url text,
  origin_type text not null default 'unknown'
    check (origin_type in (
      'original_reporting','wire_copy','syndicated','republished',
      'press_release','official_document','aggregator','other','unknown'
    )),
  review_status text not null default 'unverified'
    check (review_status in ('unverified','verified','disputed','rejected')),
  evidence_url text,
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint article_lineage_not_self check (
    upstream_retrieved_source_id is null
    or upstream_retrieved_source_id <> retrieved_source_id
  ),
  constraint article_lineage_review_has_basis check (
    review_status = 'unverified'
    or (
      reviewed_at is not null
      and nullif(btrim(reviewed_by), '') is not null
      and (
        nullif(btrim(evidence_url), '') is not null
        or nullif(btrim(review_notes), '') is not null
      )
    )
  ),
  constraint non_original_lineage_has_origin check (
    review_status <> 'verified'
    or origin_type = 'original_reporting'
    or upstream_retrieved_source_id is not null
    or upstream_source_registry_id is not null
    or nullif(btrim(upstream_url), '') is not null
  )
);
create index if not exists idx_article_lineage_retrieved_source
  on public.article_lineage(retrieved_source_id, review_status);
create index if not exists idx_article_lineage_upstream_article
  on public.article_lineage(upstream_retrieved_source_id)
  where upstream_retrieved_source_id is not null;
create index if not exists idx_article_lineage_upstream_source
  on public.article_lineage(upstream_source_registry_id)
  where upstream_source_registry_id is not null;

create table if not exists public.article_lineage_review_events (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references public.article_lineage(id) on delete restrict,
  previous_status text not null check (previous_status in ('unverified','verified','disputed','rejected')),
  new_status text not null check (new_status in ('unverified','verified','disputed','rejected')),
  evidence_url text,
  review_notes text,
  reviewed_by text not null,
  created_at timestamptz not null default now(),
  constraint article_lineage_review_event_has_basis check (
    nullif(btrim(reviewed_by), '') is not null
    and (
      nullif(btrim(evidence_url), '') is not null
      or nullif(btrim(review_notes), '') is not null
    )
  )
);
create index if not exists idx_article_lineage_review_events_lineage
  on public.article_lineage_review_events(lineage_id, created_at desc);

create table if not exists public.source_content_policies (
  source_id uuid primary key references public.source_registry(id) on delete restrict,
  policy text not null default 'metadata_only'
    check (policy in ('blocked','metadata_only','extraction_allowed')),
  policy_reason text,
  evidence_url text,
  reviewed_at timestamptz,
  reviewed_by text,
  updated_at timestamptz not null default now(),
  constraint source_content_policy_review_has_basis check (
    policy = 'metadata_only'
    or (
      reviewed_at is not null
      and nullif(btrim(reviewed_by), '') is not null
      and (
        nullif(btrim(evidence_url), '') is not null
        or nullif(btrim(policy_reason), '') is not null
      )
    )
  )
);

create table if not exists public.source_content_policy_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.source_registry(id) on delete restrict,
  previous_policy text check (previous_policy in ('blocked','metadata_only','extraction_allowed')),
  new_policy text not null check (new_policy in ('blocked','metadata_only','extraction_allowed')),
  evidence_url text,
  policy_reason text,
  reviewed_by text not null,
  created_at timestamptz not null default now(),
  constraint source_content_policy_event_has_basis check (
    nullif(btrim(reviewed_by), '') is not null
    and (
      nullif(btrim(evidence_url), '') is not null
      or nullif(btrim(policy_reason), '') is not null
    )
  )
);
create index if not exists idx_source_content_policy_events_source
  on public.source_content_policy_events(source_id, created_at desc);

alter table public.source_relationships enable row level security;
alter table public.source_relationship_review_events enable row level security;
alter table public.article_lineage enable row level security;
alter table public.article_lineage_review_events enable row level security;
alter table public.source_content_policies enable row level security;
alter table public.source_content_policy_events enable row level security;

revoke all on public.source_relationships, public.source_relationship_review_events,
  public.article_lineage, public.article_lineage_review_events,
  public.source_content_policies, public.source_content_policy_events from public, anon, authenticated;

grant select, insert, update on public.source_relationships, public.article_lineage, public.source_content_policies to service_role;
grant select, insert on public.source_relationship_review_events, public.article_lineage_review_events, public.source_content_policy_events to service_role;
revoke update, delete, truncate on public.source_relationship_review_events, public.article_lineage_review_events, public.source_content_policy_events from service_role;
revoke delete, truncate on public.source_relationships, public.article_lineage, public.source_content_policies from service_role;

commit;
