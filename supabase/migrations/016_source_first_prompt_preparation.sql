-- WorldFiled Desk migration 016: source-first draft preparation without manual claim-register gates.
-- Prompt generation is a production-preparation action. Human editorial approval remains required
-- for publishing, but neither it nor a manually completed claim register may block draft creation.
-- A story explicitly rejected or sent back for research remains excluded from prompt generation.

begin;

create or replace function public.enforce_edition_prompt_gate() returns trigger as $$
declare
  cur text;
  bad uuid;
begin
  cur := public.edition_members_hash(new.edition_id);
  if new.members_hash is distinct from cur then
    raise exception 'Edition prompt blocked: the prompt was built from a different member list';
  end if;

  select ed.story_id into bad
  from public.edition_developments ed
  where ed.edition_id = new.edition_id
    and (
      select decision
      from public.editorial_decisions x
      where x.story_id = ed.story_id
      order by created_at desc, id desc
      limit 1
    ) in ('rejected', 'needs_research')
  limit 1;

  if bad is not null then
    raise exception 'Edition prompt blocked: member story % was rejected or sent back for research', bad;
  end if;

  -- Drafts are not publication approvals. Keep the legacy nullable column for history compatibility.
  new.approval_decision_id := null;
  return new;
end;
$$ language plpgsql;

comment on function public.enforce_edition_prompt_gate() is
'Allows source-screened production drafts before publication approval; still binds prompts to the exact member list and excludes explicitly rejected or research-required stories.';

commit;