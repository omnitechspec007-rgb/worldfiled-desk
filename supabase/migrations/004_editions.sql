-- WorldFiled Desk: migration 004 (Editions: thematic editions, their approvals, and integrated edition prompts)
-- STATUS: DRAFT. NOT RUN. Do not paste into Supabase until you are ready (independent of migration 003).
--
-- ADDITIVE ONLY. Creates 4 new tables and 5 new functions/triggers that act only on those tables.
-- It does not alter, rename, drop or read-modify any existing table, column, trigger, policy or row.
-- (It READS editorial_decisions and stories inside one trigger, to check that member stories are still acceptable.)
-- Safe to re-run: every statement is IF NOT EXISTS / CREATE OR REPLACE / DROP-IF-EXISTS on NEW objects only.
-- Runs as one transaction: if any statement fails, nothing is kept and the database is as before.

begin;

-- 1) An edition: a set of developments that belong together, with its recorded coherence and curiosity assessment.
create table if not exists editions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  theme text not null default '',
  structure text not null check (structure in ('multi_country','single_country','event_roundup','news_roundup')),
  narrative_angle text not null default '' check (char_length(narrative_angle) <= 1000),
  status text not null default 'draft' check (status in ('draft','archived')),
  coherence jsonb not null default '{}'::jsonb,
  curiosity jsonb not null default '{}'::jsonb,
  created_by text not null default 'editor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(coherence::text) <= 60000 and octet_length(curiosity::text) <= 60000)
);
drop trigger if exists trg_editions_updated on editions;
create trigger trg_editions_updated before update on editions for each row execute function set_updated_at();

-- 2) Which developments (stories) are in an edition, and in what order.
create table if not exists edition_developments (
  edition_id uuid not null references editions(id) on delete cascade,
  story_id uuid not null references stories(id) on delete cascade,
  position integer not null check (position between 1 and 12),
  added_at timestamptz not null default now(),
  primary key (edition_id, story_id),
  unique (edition_id, position) deferrable initially deferred
);
create index if not exists idx_edition_dev_story on edition_developments(story_id);

-- The identity of an edition's member list: md5 of the story ids in position order, comma-separated.
-- The app computes the same value (membersKey), so approvals and prompts can be tied to the exact member list.
create or replace function edition_members_hash(eid uuid) returns text as $$
  select coalesce(md5(string_agg(story_id::text, ',' order by position)), md5(''))
  from edition_developments where edition_id = eid
$$ language sql stable;

-- 3) Human decisions on an edition. Append-only. The database stamps the member list the decision was made on.
create table if not exists edition_decisions (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected','needs_changes')),
  decided_by text not null,
  notes text check (notes is null or char_length(notes) <= 2000),
  members_hash text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_edition_decisions on edition_decisions(edition_id, created_at desc);

create or replace function stamp_edition_decision() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'edition_decisions are append-only; record a new decision instead';
  end if;
  new.members_hash := edition_members_hash(new.edition_id);  -- the caller cannot choose this value
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_edition_decision_stamp on edition_decisions;
create trigger trg_edition_decision_stamp before insert or update on edition_decisions
  for each row execute function stamp_edition_decision();

-- 4) Prompt history for editions. Every generated edition prompt, tied to the exact members and evidence it used.
-- Evidence is stored copyright-aware (publisher, URL, headline, date, snippet of at most 400 characters; no full text).
-- Size limits REFUSE an oversized record; nothing is silently shortened.
create table if not exists edition_prompts (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  version integer not null check (version between 1 and 50),
  parent_id uuid references edition_prompts(id) on delete set null,
  approval_decision_id uuid references edition_decisions(id) on delete cascade,  -- set by the database, never trusted from the caller
  members jsonb not null,           -- story ids in order
  members_hash text not null,
  evidence_hash text not null,
  structure text not null check (structure in ('multi_country','single_country','event_roundup','news_roundup')),
  title text not null,
  deliverable text not null,
  roles jsonb not null default '[]'::jsonb,
  rationale jsonb not null default '{}'::jsonb,
  coherence jsonb not null default '{}'::jsonb,
  tools jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null,
  style_rule_ids uuid[] not null default '{}',
  brand_spec_version text not null,
  prompt_text text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (edition_id, version),
  check (char_length(prompt_text) between 200 and 200000),
  check (octet_length(evidence_snapshot::text) <= 600000),
  check (octet_length(roles::text) <= 30000 and octet_length(rationale::text) <= 60000 and octet_length(tools::text) <= 30000 and octet_length(coherence::text) <= 60000),
  check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) between 1 and 12),
  check (evidence_snapshot ?& array['developments','evidence_limits'])
);
create index if not exists idx_edition_prompts on edition_prompts(edition_id, version desc);

-- Gate A: a prompt can only be created if
--   (1) the edition's NEWEST human decision is "approved",
--   (2) that approval was made on the CURRENT member list (changing members invalidates it),
--   (3) the prompt was built from that same member list, and
--   (4) no member story's newest human decision is "rejected" or "needs_research".
-- Checked inside the database at insert time. The deciding row is recorded in approval_decision_id.
create or replace function enforce_edition_prompt_gate() returns trigger as $$
declare d record; cur text; bad uuid;
begin
  select id, decision, members_hash into d from edition_decisions
    where edition_id = new.edition_id order by created_at desc, id desc limit 1;
  if d.decision is distinct from 'approved' then
    raise exception 'Edition prompt blocked: edition % has no current human approval', new.edition_id;
  end if;
  cur := edition_members_hash(new.edition_id);
  if d.members_hash is distinct from cur then
    raise exception 'Edition prompt blocked: the members changed after approval; approve the edition again';
  end if;
  if new.members_hash is distinct from cur then
    raise exception 'Edition prompt blocked: the prompt was built from a different member list';
  end if;
  select ed.story_id into bad from edition_developments ed
    where ed.edition_id = new.edition_id
      and (select decision from editorial_decisions x where x.story_id = ed.story_id order by created_at desc, id desc limit 1) in ('rejected','needs_research')
    limit 1;
  if bad is not null then
    raise exception 'Edition prompt blocked: member story % was rejected or sent back for research', bad;
  end if;
  new.approval_decision_id := d.id;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_edition_prompt_gate on edition_prompts;
create trigger trg_edition_prompt_gate before insert on edition_prompts
  for each row execute function enforce_edition_prompt_gate();

-- Gate B: saved prompts are history and cannot be edited. Regenerate to get a new version.
create or replace function block_edition_prompt_edits() returns trigger as $$
begin
  raise exception 'edition_prompts rows are immutable; create a new version instead';
end;
$$ language plpgsql;
drop trigger if exists trg_edition_prompt_immutable on edition_prompts;
create trigger trg_edition_prompt_immutable before update on edition_prompts
  for each row execute function block_edition_prompt_edits();

-- Gate C: copyright-aware evidence. Every stored source snippet must be 400 characters or fewer and no source may
-- carry full article text. A violating record is REFUSED, never trimmed.
create or replace function guard_edition_prompt_evidence() returns trigger as $$
begin
  if jsonb_typeof(new.evidence_snapshot->'developments') is distinct from 'array' then
    raise exception 'Evidence refused: developments must be a list';
  end if;
  if exists (select 1 from jsonb_array_elements(new.evidence_snapshot->'developments') d,
                  jsonb_array_elements(coalesce(d->'pack'->'sources','[]'::jsonb)) s
             where char_length(coalesce(s->>'snippet','')) > 400) then
    raise exception 'Evidence refused: a source snippet exceeds 400 characters (full text is not stored)';
  end if;
  if exists (select 1 from jsonb_array_elements(new.evidence_snapshot->'developments') d,
                  jsonb_array_elements(coalesce(d->'pack'->'sources','[]'::jsonb)) s
             where s ?| array['full_text','body','content']) then
    raise exception 'Evidence refused: full article text is not stored';
  end if;
  return new;
end;
$$ language plpgsql;
drop trigger if exists trg_edition_prompt_evidence on edition_prompts;
create trigger trg_edition_prompt_evidence before insert on edition_prompts
  for each row execute function guard_edition_prompt_evidence();

-- Same lock-down as every other table: browser keys (anon / authenticated) can read and write nothing.
alter table editions enable row level security;
alter table edition_developments enable row level security;
alter table edition_decisions enable row level security;
alter table edition_prompts enable row level security;
revoke all on editions from anon, authenticated;
revoke all on edition_developments from anon, authenticated;
revoke all on edition_decisions from anon, authenticated;
revoke all on edition_prompts from anon, authenticated;

commit;

-- ROLLBACK (only if you ever want to undo this migration; it deletes ONLY the new tables' data):
--   drop table if exists edition_prompts; drop table if exists edition_decisions; drop table if exists edition_developments; drop table if exists editions;
--   drop function if exists enforce_edition_prompt_gate(); drop function if exists block_edition_prompt_edits();
--   drop function if exists guard_edition_prompt_evidence(); drop function if exists stamp_edition_decision(); drop function if exists edition_members_hash(uuid);
