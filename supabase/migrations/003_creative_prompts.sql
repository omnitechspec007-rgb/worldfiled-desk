-- WorldFiled Desk: migration 003 (Creative Prompt Architect, Reference Library, Prompt History)
-- STATUS: DRAFT FOR REVIEW. NOT RUN. Do not paste into Supabase until approved.
--
-- ADDITIVE ONLY. Creates 3 new tables and 4 new functions/triggers that act only on those tables.
-- It does not alter, rename, drop or read any existing table, column, trigger, policy or row.
-- Safe to re-run: every statement is IF NOT EXISTS / CREATE OR REPLACE / DROP-IF-EXISTS on NEW objects only.
-- Runs as one transaction: if any statement fails, nothing is kept and the database is as before.

begin;

-- 1) Reference videos: metadata about each reference file. The video itself is NEVER stored here.
create table if not exists reference_videos (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  original_filename text not null,
  duration_seconds numeric,
  width integer,
  height integer,
  fps numeric,
  inspection_level text not null
    check (inspection_level in ('fully_inspected','partially_inspected','reference_only')),
  inspection_notes text not null default '',
  unknowns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (original_filename)
);

-- 2) Style rules: versioned, human-approved. A rule is born PROPOSED; only a person moves it on.
create table if not exists style_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version integer not null default 1,
  category text not null,
  statement text not null,
  evidence_basis text not null
    check (evidence_basis in ('file_probe','visual_observation','inference','user_stated')),
  evidence_note text not null default '',
  reference_video_ids uuid[] not null default '{}',
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED')),
  supersedes_id uuid references style_rules(id) on delete set null,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rule_key, version)
);
create index if not exists idx_style_rules_status on style_rules(status, category);

-- 3) Prompt history: every generated Claude prompt, with the evidence it carried. Never edited afterwards.
-- Evidence is stored copyright-aware: only what the app already retrieved (publisher, URL, headline,
-- publication date, and a feed snippet of at most 400 characters). Full article text is never stored here.
-- Size limits REFUSE an oversized record; nothing is ever silently shortened.
create table if not exists creative_prompts (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories(id) on delete cascade,
  version integer not null check (version between 1 and 50),
  parent_id uuid references creative_prompts(id) on delete set null,
  -- Filled in by the database itself (Gate A), never trusted from the caller: the exact human
  -- approval this prompt relied on. Lets the app prove later whether that approval is still current.
  approval_decision_id uuid references editorial_decisions(id) on delete cascade,
  treatment_key text not null,
  roles jsonb not null default '[]'::jsonb,
  rationale jsonb not null default '{}'::jsonb,
  tools jsonb not null default '{"needed":[],"note":""}'::jsonb,
  evidence_snapshot jsonb not null,
  style_rule_ids uuid[] not null default '{}',
  brand_spec_version text not null,
  prompt_text text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (story_id, version),
  check (char_length(prompt_text) between 200 and 120000),
  check (octet_length(evidence_snapshot::text) <= 300000),
  check (octet_length(roles::text) <= 30000 and octet_length(rationale::text) <= 30000 and octet_length(tools::text) <= 30000),
  -- The snapshot must say what it leaves out and what its evidence cannot show.
  check (evidence_snapshot ?& array['sources','omitted_sources','evidence_limits','claim_classes'])
);
create index if not exists idx_creative_prompts_story on creative_prompts(story_id, version desc);

-- Gate A: a prompt can only be created if the story's NEWEST human decision is "approved".
-- "Newest" is decided inside the database at the moment of insert, using the stored decision rows, so an
-- earlier approval that was later rejected, sent back for research, or superseded by any newer decision
-- authorizes nothing. The deciding row is recorded in approval_decision_id (the caller cannot set it).
-- (Same rule as the existing export gate; that function is not touched.)
create or replace function enforce_prompt_approval() returns trigger as $$
declare latest_id uuid; latest text;
begin
  select id, decision into latest_id, latest from editorial_decisions
    where story_id = new.story_id order by created_at desc, id desc limit 1;
  if latest is distinct from 'approved' then
    raise exception 'Prompt blocked: story % has no current human approval', new.story_id;
  end if;
  new.approval_decision_id := latest_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_prompt_approval on creative_prompts;
create trigger trg_prompt_approval before insert on creative_prompts
  for each row execute function enforce_prompt_approval();

-- Gate B: saved prompts are history, so their content cannot be edited. Regenerate to get a new version.
create or replace function block_prompt_edits() returns trigger as $$
begin
  raise exception 'creative_prompts rows are immutable; create a new version instead';
end;
$$ language plpgsql;

drop trigger if exists trg_prompt_immutable on creative_prompts;
create trigger trg_prompt_immutable before update on creative_prompts
  for each row execute function block_prompt_edits();

-- Gate C: style rules are born PROPOSED, and only the decision fields may change afterwards.
-- Editing wording means inserting a NEW version (supersedes_id), which is again PROPOSED.
create or replace function guard_style_rules() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PROPOSED' then
      raise exception 'A style rule must start as PROPOSED';
    end if;
    return new;
  end if;
  if new.rule_key is distinct from old.rule_key or new.version is distinct from old.version
     or new.category is distinct from old.category or new.statement is distinct from old.statement
     or new.evidence_basis is distinct from old.evidence_basis or new.evidence_note is distinct from old.evidence_note then
    raise exception 'Style rule wording is fixed; create a new version instead';
  end if;
  if old.status <> 'PROPOSED' and new.status is distinct from old.status then
    raise exception 'A decided style rule cannot be changed; create a new version instead';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_style_rules_guard on style_rules;
create trigger trg_style_rules_guard before insert or update on style_rules
  for each row execute function guard_style_rules();

-- Gate D: copyright-aware evidence. Every stored source snippet must be 400 characters or fewer, and no
-- source may carry full article text fields. A violating record is REFUSED, never trimmed.
create or replace function guard_prompt_evidence() returns trigger as $$
begin
  if jsonb_typeof(new.evidence_snapshot->'sources') is distinct from 'array' then
    raise exception 'Evidence refused: sources must be a list';
  end if;
  if exists (select 1 from jsonb_array_elements(new.evidence_snapshot->'sources') s
             where char_length(coalesce(s->>'snippet','')) > 400) then
    raise exception 'Evidence refused: a source snippet exceeds 400 characters (full text is not stored)';
  end if;
  if exists (select 1 from jsonb_array_elements(new.evidence_snapshot->'sources') s
             where s ?| array['full_text','body','content']) then
    raise exception 'Evidence refused: full article text is not stored';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_prompt_evidence on creative_prompts;
create trigger trg_prompt_evidence before insert on creative_prompts
  for each row execute function guard_prompt_evidence();

-- Same lock-down as every other table: browser keys (anon / authenticated) can read and write nothing.
-- No policies are created, so RLS denies by default. Only the server function (service role) can access them.
alter table reference_videos enable row level security;
alter table style_rules enable row level security;
alter table creative_prompts enable row level security;
revoke all on reference_videos from anon, authenticated;
revoke all on style_rules from anon, authenticated;
revoke all on creative_prompts from anon, authenticated;

commit;

-- ROLLBACK (only if you ever want to undo this migration; it deletes ONLY the new tables' data):
--   drop table if exists creative_prompts;  drop table if exists style_rules;  drop table if exists reference_videos;
--   drop function if exists enforce_prompt_approval();  drop function if exists block_prompt_edits();
--   drop function if exists guard_style_rules();  drop function if exists guard_prompt_evidence();
