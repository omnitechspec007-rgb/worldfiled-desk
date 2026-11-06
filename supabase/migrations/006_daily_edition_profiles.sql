-- WorldFiled Desk migration 006: daily video and text edition profiles.
-- Additive only. Run AFTER migrations 004 (Editions) and 005 (Edition cycles).
-- Existing editions/prompts remain video by default; no historical rows are rewritten.
begin;

alter table editions add column if not exists edition_kind text not null default 'video';
alter table editions drop constraint if exists editions_edition_kind_check;
alter table editions add constraint editions_edition_kind_check check (edition_kind in ('video','text'));

alter table edition_prompts add column if not exists edition_kind text not null default 'video';
alter table edition_prompts drop constraint if exists edition_prompts_edition_kind_check;
alter table edition_prompts add constraint edition_prompts_edition_kind_check check (edition_kind in ('video','text'));

-- Text briefings can contain up to 18 developments; the flagship video remains editorially
-- targeted at 6-8, with a hard technical ceiling of 18 for unusual breaking-news days.
alter table edition_developments drop constraint if exists edition_developments_position_check;
alter table edition_developments add constraint edition_developments_position_check check (position between 1 and 18);

do $
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'edition_prompts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%jsonb_array_length(members)%'
  loop
    execute format('alter table edition_prompts drop constraint %I', c.conname);
  end loop;
end $;
alter table edition_prompts add constraint edition_prompts_members_limit_check
  check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) between 1 and 18);

create index if not exists idx_editions_kind_updated on editions(edition_kind, updated_at desc);
commit;
