-- WorldFiled Desk: database schema v1
-- Run once in Supabase -> SQL Editor. Safe to re-run (uses IF NOT EXISTS).
-- Security: row-level security is ON for every table with NO public policies,
-- so the browser (anon/authenticated keys) can read or write nothing.
-- Only the server-side function (service role key) can access data.

create extension if not exists pgcrypto;

-- ---------- helpers ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------- research runs ----------
create table if not exists research_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  status text not null default 'created'
    check (status in ('created','running','incomplete','completed','failed','cancelled')),
  current_stage text,
  config jsonb not null default '{}'::jsonb,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists research_run_stages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_runs(id) on delete cascade,
  stage text not null,
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed','skipped')),
  attempt integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, stage)
);

-- ---------- sources ----------
create table if not exists source_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  publisher text,
  country_scope text,
  category text,
  source_url text,
  feed_url text,
  source_type text not null default 'feed'
    check (source_type in ('feed','api','official','dataset','other')),
  access_restrictions text,
  reliability_note text,
  enabled boolean not null default false,
  retrieval_status text not null default 'untested'
    check (retrieval_status in ('untested','healthy','degraded','failing','disabled')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists retrieved_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references research_runs(id) on delete set null,
  registry_id uuid references source_registry(id) on delete set null,
  url text not null,
  url_hash text not null unique,
  title text,
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  http_status integer,
  content_status text not null default 'metadata_only'
    check (content_status in ('metadata_only','extracted','inaccessible','failed')),
  extract text,
  created_at timestamptz not null default now()
);
create index if not exists idx_retrieved_sources_run on retrieved_sources(run_id);
create index if not exists idx_retrieved_sources_registry on retrieved_sources(registry_id);

create table if not exists source_relationships (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references retrieved_sources(id) on delete cascade,
  related_source_id uuid not null references retrieved_sources(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('republishes','cites','original_of','independent')),
  note text,
  created_at timestamptz not null default now(),
  check (source_id <> related_source_id),
  unique (source_id, related_source_id, relationship_type)
);

-- ---------- stories ----------
create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  cluster_key text not null unique,
  first_run_id uuid references research_runs(id) on delete set null,
  headline text not null,
  category text,
  region text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','in_progress','verified','failed')),
  editorial_status text not null default 'pending'
    check (editorial_status in ('pending','in_review','needs_research','approved','rejected')),
  duplicate_of uuid references stories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stories_editorial on stories(editorial_status);
create index if not exists idx_stories_verification on stories(verification_status);

create table if not exists story_source_links (
  story_id uuid not null references stories(id) on delete cascade,
  source_id uuid not null references retrieved_sources(id) on delete cascade,
  role text not null default 'coverage' check (role in ('original','coverage')),
  created_at timestamptz not null default now(),
  primary key (story_id, source_id)
);

-- ---------- claims and evidence ----------
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  claim_text text not null,
  claim_hash text not null,
  category text,
  extraction_status text not null default 'extracted'
    check (extraction_status in ('extracted','pending','failed')),
  created_at timestamptz not null default now(),
  unique (story_id, claim_hash)
);
create index if not exists idx_claims_story on claims(story_id);

create table if not exists claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  source_id uuid not null references retrieved_sources(id) on delete cascade,
  passage text,
  passage_hash text not null,
  passage_location text,
  source_published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  extraction_status text not null default 'extracted'
    check (extraction_status in ('extracted','inaccessible','failed')),
  is_contradiction boolean not null default false,
  created_at timestamptz not null default now(),
  unique (claim_id, source_id, passage_hash)
);
create index if not exists idx_claim_evidence_claim on claim_evidence(claim_id);

-- Verification history is append-only in practice: the newest row is the current outcome.
create table if not exists verification_results (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  outcome text not null
    check (outcome in ('SUPPORTED','PARTIALLY_SUPPORTED','CONTRADICTED','INSUFFICIENT_EVIDENCE','UNVERIFIED','NOT_APPLICABLE')),
  determined_by text not null check (determined_by in ('system','editor')),
  reviewer_notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_verification_claim on verification_results(claim_id, created_at desc);

-- ---------- editorial ----------
create table if not exists editorial_assessments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  dimension text not null check (dimension in (
    'evidence_quality','source_independence','geographic_significance','public_impact',
    'novelty','timeliness','consequence','editorial_clarity','duplication_risk')),
  score smallint check (score between 0 and 5),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (story_id, dimension)
);

create table if not exists story_versions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  version integer not null,
  content jsonb not null,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  unique (story_id, version)
);

create table if not exists editorial_decisions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected','needs_research')),
  decided_by text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_decisions_story on editorial_decisions(story_id, created_at desc);

create table if not exists export_records (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  story_version_id uuid references story_versions(id) on delete set null,
  format text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- Database-level export gate: refuse an export unless the newest decision is "approved".
create or replace function enforce_export_approval() returns trigger as $$
declare latest text;
begin
  select decision into latest from editorial_decisions
    where story_id = new.story_id order by created_at desc limit 1;
  if latest is distinct from 'approved' then
    raise exception 'Export blocked: story % has no current human approval', new.story_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_export_approval on export_records;
create trigger trg_export_approval before insert on export_records
  for each row execute function enforce_export_approval();

-- ---------- audit, settings, usage ----------
create table if not exists audit_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  entity_type text,
  entity_id text,
  actor text not null default 'system',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_events(entity_type, entity_id);

-- Audit log cannot be edited or deleted.
create or replace function block_audit_changes() returns trigger as $$
begin
  raise exception 'audit_events is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_audit_no_update on audit_events;
create trigger trg_audit_no_update before update or delete on audit_events
  for each row execute function block_audit_changes();

create table if not exists system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists usage_records (
  id uuid primary key default gen_random_uuid(),
  period text not null,          -- e.g. '2026-10'
  metric text not null,          -- e.g. 'function_invocations'
  amount bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (period, metric)
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['research_runs','research_run_stages','source_registry','stories','system_settings','usage_records']
  loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s', t);
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ---------- security: RLS on, no policies, no public grants ----------
do $$
declare t text;
begin
  foreach t in array array[
    'research_runs','research_run_stages','source_registry','retrieved_sources','source_relationships',
    'stories','story_source_links','claims','claim_evidence','verification_results',
    'editorial_assessments','story_versions','editorial_decisions','audit_events',
    'export_records','system_settings','usage_records']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- defaults ----------
insert into system_settings (key, value) values
  ('ai_enabled', 'false'::jsonb),
  ('max_sources_per_run', '50'::jsonb)
on conflict (key) do nothing;
