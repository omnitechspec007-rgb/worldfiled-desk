-- WorldFiled Desk migration 015: publication records and performance snapshots.
-- REVIEW ONLY on the feature branch. Do not apply to production without separate approval.
-- Metrics are manually recorded or explicitly imported; no platform API is assumed.
-- This migration stores observations, not predictions or automatic editorial decisions.

begin;

create table if not exists public.publication_records (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete restrict,
  platform text not null check (platform in ('facebook','tiktok','youtube','instagram','other')),
  content_format text not null check (content_format in ('narrated_video','text_card','text_roundup','other')),
  status text not null default 'published' check (status in ('draft','published','removed','unknown')),
  published_at timestamptz,
  post_url text,
  platform_post_id text,
  account_label text,
  notes text,
  recorded_by text not null default 'editor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_records_post_url_length check (post_url is null or char_length(post_url) <= 2000),
  constraint publication_records_post_id_length check (platform_post_id is null or char_length(platform_post_id) <= 300),
  constraint publication_records_account_length check (char_length(account_label) <= 120),
  constraint publication_records_notes_length check (char_length(notes) <= 2000),
  constraint publication_records_recorded_by_length check (char_length(recorded_by) <= 120)
);

create unique index if not exists publication_records_platform_post_unique
  on public.publication_records(platform, platform_post_id)
  where platform_post_id is not null and btrim(platform_post_id) <> '';

create index if not exists publication_records_edition_idx
  on public.publication_records(edition_id, published_at desc);

create index if not exists publication_records_platform_date_idx
  on public.publication_records(platform, published_at desc)
  where status = 'published';

create table if not exists public.publication_story_attributions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publication_records(id) on delete restrict,
  story_id uuid not null references public.stories(id) on delete restrict,
  position integer not null check (position between 1 and 30),
  editorial_role text not null default 'supporting' check (editorial_role in ('lead','supporting','context')),
  created_at timestamptz not null default now(),
  unique(publication_id, story_id),
  unique(publication_id, position)
);

create index if not exists publication_story_attributions_story_idx
  on public.publication_story_attributions(story_id, publication_id);

create table if not exists public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publication_records(id) on delete restrict,
  captured_at timestamptz not null default now(),
  capture_method text not null default 'manual' check (capture_method in ('manual','platform_api','imported')),
  views bigint check (views is null or views >= 0),
  reach bigint check (reach is null or reach >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  watch_time_seconds numeric(16,2) check (watch_time_seconds is null or watch_time_seconds >= 0),
  average_view_duration_seconds numeric(12,2) check (average_view_duration_seconds is null or average_view_duration_seconds >= 0),
  completion_rate numeric(6,5) check (completion_rate is null or completion_rate between 0 and 1),
  likes bigint check (likes is null or likes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  saves bigint check (saves is null or saves >= 0),
  follower_delta bigint,
  source_note text,
  created_at timestamptz not null default now(),
  constraint performance_snapshots_source_note_length check (char_length(source_note) <= 1000),
  unique(publication_id, captured_at, capture_method)
);

create index if not exists performance_snapshots_publication_time_idx
  on public.performance_snapshots(publication_id, captured_at desc);

-- All access is mediated by authenticated server functions using the service role.
-- RLS is enabled as defence in depth; no browser roles receive table privileges.
alter table public.publication_records enable row level security;
alter table public.publication_story_attributions enable row level security;
alter table public.performance_snapshots enable row level security;

revoke all on public.publication_records, public.publication_story_attributions, public.performance_snapshots from public, anon, authenticated;
grant select, insert, update on public.publication_records to service_role;
grant select, insert on public.publication_story_attributions to service_role;
grant select, insert on public.performance_snapshots to service_role;

commit;
