-- WorldFiled Desk migration 017: source-first Creative Prompt Architect.
-- Keep a snapshot of the latest editorial decision for invalidation, but do not require approval.
-- Explicit rejection or a "needs research" decision still blocks prompt creation.

begin;

create or replace function public.enforce_prompt_approval() returns trigger as $$
declare
  latest_id uuid;
  latest text;
begin
  select id, decision into latest_id, latest
  from public.editorial_decisions
  where story_id = new.story_id
  order by created_at desc, id desc
  limit 1;

  if latest in ('rejected', 'needs_research') then
    raise exception 'Prompt blocked: story % was rejected or sent back for research', new.story_id;
  end if;

  -- Legacy column retained for compatibility. It now snapshots the latest editorial decision,
  -- whether pending, approved or absent; it is not a publication approval requirement.
  new.approval_decision_id := latest_id;
  return new;
end;
$$ language plpgsql;

comment on function public.enforce_prompt_approval() is
'Source-first prompt preparation: no manual claim verification or editorial approval is required to draft; explicit rejection/research holds remain enforced, and the latest decision ID is snapshotted for invalidation.';

commit;