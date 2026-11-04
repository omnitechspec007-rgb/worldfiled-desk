-- WorldFiled Desk: migration 005 (News cycles: coverage windows, publishing schedule, per-edition story marks)
-- STATUS: DRAFT. NOT RUN. Do not paste into Supabase until you are ready.
--
-- ADDITIVE ONLY. Creates 2 new tables and 2 functions/triggers that act only on those tables.
-- It does not alter, rename, drop or modify any existing table, column, trigger, policy or row.
-- (It READS editions, edition_decisions and edition_developments inside one trigger, to check an approval before "published".)
-- The schedule settings themselves live in the existing system_settings table (key 'edition_schedule'); no new table for them.
-- Safe to re-run. Runs as one transaction: if any statement fails, nothing is kept.
-- Requires migration 004 (editions) to have been run first.

begin;

-- 1) A cycle = one planned edition: its coverage window (what news it covers) and its schedule (when it is due).
create table if not exists edition_cycles (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 80),
  mode text not null check (mode in ('continuous','rolling','custom')),
  planned_publish_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  coverage_start timestamptz not null,
  coverage_end timestamptz not null,           -- = research cutoff: news from this instant on belongs to the NEXT edition
  research_cutoff timestamptz not null,
  timeline jsonb not null default '{}'::jsonb, -- the stage times and allowances used when planned (for explaining the plan later)
  status text not null default 'open' check (status in ('open','published','skipped')),
  edition_id uuid references editions(id) on delete set null,
  stage_done jsonb not null default '{}'::jsonb,  -- {"production":"<iso>","review":"<iso>"}: marks the editor sets by hand
  previous_cycle_id uuid references edition_cycles(id) on delete set null,
  actual_published_at timestamptz,
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 1000),
  created_by text not null default 'editor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coverage_start < coverage_end),
  check (coverage_end = research_cutoff),
  check (coverage_end <= planned_publish_at),
  check (octet_length(timeline::text) <= 20000 and octet_length(stage_done::text) <= 2000),
  check (status <> 'published' or (edition_id is not null and actual_published_at is not null)),
  check (status <> 'skipped' or skip_reason is not null)
);
drop trigger if exists trg_edition_cycles_updated on edition_cycles;
create trigger trg_edition_cycles_updated before update on edition_cycles for each row execute function set_updated_at();
create index if not exists idx_edition_cycles_pub on edition_cycles(planned_publish_at desc);
-- Only one cycle can be open at a time (a second one must wait until the first is published or skipped).
create unique index if not exists uq_edition_cycles_one_open on edition_cycles((status)) where status = 'open';

-- Window and schedule are fixed once a cycle is closed, and a closed cycle never reopens. Publishing needs a CURRENT approval.
create or replace function guard_edition_cycle() returns trigger as $$
declare d record;
begin
  if tg_op = 'UPDATE' then
    if old.status in ('published','skipped') then
      raise exception 'A % cycle is closed and cannot be changed', old.status;
    end if;
    if new.coverage_start is distinct from old.coverage_start or new.coverage_end is distinct from old.coverage_end
       or new.research_cutoff is distinct from old.research_cutoff or new.mode is distinct from old.mode then
      if new.status = 'published' then raise exception 'The coverage window cannot change while publishing'; end if;
    end if;
    if new.status = 'published' then
      select id, decision, members_hash into d from edition_decisions
        where edition_id = new.edition_id order by created_at desc, id desc limit 1;
      if d.decision is distinct from 'approved' or d.members_hash is distinct from edition_members_hash(new.edition_id) then
        raise exception 'Publishing blocked: the linked edition has no current human approval';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_edition_cycle_guard on edition_cycles;
create trigger trg_edition_cycle_guard before update on edition_cycles for each row execute function guard_edition_cycle();

-- 2) What happened to each story in a cycle: published, held over, or rejected for that edition. Append-only history.
create table if not exists cycle_stories (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references edition_cycles(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  mark text not null check (mark in ('published','held_over','rejected')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists idx_cycle_stories_story on cycle_stories(story_id, created_at desc);
create index if not exists idx_cycle_stories_cycle on cycle_stories(cycle_id);

create or replace function block_cycle_story_edits() returns trigger as $$
begin
  raise exception 'cycle_stories are append-only; record a new mark instead';
end;
$$ language plpgsql;
drop trigger if exists trg_cycle_stories_append_only on cycle_stories;
create trigger trg_cycle_stories_append_only before update on cycle_stories
  for each row execute function block_cycle_story_edits();

alter table edition_cycles enable row level security;
alter table cycle_stories enable row level security;
revoke all on edition_cycles from anon, authenticated;
revoke all on cycle_stories from anon, authenticated;

commit;

-- ROLLBACK (only to undo this migration; deletes ONLY the two new tables' data):
--   drop table if exists cycle_stories; drop table if exists edition_cycles;
--   drop function if exists block_cycle_story_edits(); drop function if exists guard_edition_cycle();
