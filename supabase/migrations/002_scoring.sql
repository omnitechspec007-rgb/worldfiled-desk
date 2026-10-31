-- WorldFiled Desk: migration 002 (scoring and shortlist)
-- ADDITIVE ONLY: creates two new tables. Nothing existing is changed, renamed or deleted,
-- so all current runs, sources, stories and links are preserved. Safe to re-run.
-- Paste into Supabase -> SQL Editor -> New snippet -> Run (choose "Run and enable RLS").

-- One row per story per scoring dimension, with the reason in plain words.
create table if not exists story_scores (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  model_version text not null,
  dimension text not null,
  score numeric not null,
  max_score numeric not null,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (story_id, model_version, dimension)
);
create index if not exists idx_story_scores_story on story_scores(story_id);

-- The ranked shortlist for each research run, including stories held back and why.
create table if not exists shortlist (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_runs(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  selected boolean not null,
  rank integer,
  priority numeric not null,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, story_id)
);
create index if not exists idx_shortlist_run on shortlist(run_id, rank);

-- Same lock-down as every other table: browser keys can read and write nothing.
alter table story_scores enable row level security;
alter table shortlist enable row level security;
revoke all on story_scores from anon, authenticated;
revoke all on shortlist from anon, authenticated;
