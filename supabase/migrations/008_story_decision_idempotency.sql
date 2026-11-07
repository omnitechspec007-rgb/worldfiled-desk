-- WorldFiled Desk migration 008: durable idempotency for story editorial decisions.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- Additive: creates one private-by-privilege table and one narrowly scoped RPC.
-- No existing story, decision, or audit rows are rewritten.

begin;

create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null,
  endpoint_key text not null,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_status smallint,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_key, endpoint_key, idempotency_key),
  check (
    (response_status is null and response_body is null and completed_at is null)
    or
    (response_status between 100 and 599 and response_body is not null and completed_at is not null)
  )
);

alter table public.idempotency_records enable row level security;
revoke all on public.idempotency_records from public, anon, authenticated;
grant select, insert, update on public.idempotency_records to service_role;

comment on table public.idempotency_records is
  'Durable request replay records. Server-side service role only; never a CDN or in-memory cache.';
comment on column public.idempotency_records.request_hash is
  'SHA-256 of the canonical, validated request payload computed by the server endpoint.';
comment on column public.idempotency_records.response_body is
  'Minimal client-visible result to replay after a successful atomic operation.';

create or replace function public.record_story_editorial_decision(
  p_idempotency_key uuid,
  p_request_hash text,
  p_story_id uuid,
  p_decision text,
  p_notes text,
  p_acknowledged boolean
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing public.idempotency_records%rowtype;
  inserted_id uuid;
  previous_status text;
  result_body jsonb;
begin
  if p_idempotency_key is null
     or p_request_hash is null
     or p_decision is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_story_id is null
     or p_decision not in ('approved', 'rejected', 'needs_research')
     or p_notes is null
     or char_length(p_notes) > 1000
     or (p_decision = 'approved' and p_acknowledged is distinct from true) then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid_editorial_decision'));
  end if;

  -- Fast replay path. A committed key is durable even if the story is later edited or removed.
  select * into existing
  from public.idempotency_records
  where actor_key = 'editor'
    and endpoint_key = 'story_editorial_decision'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing.request_hash <> p_request_hash then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object(
        'error', 'idempotency_key_reused',
        'detail', 'This retry key was already used with different data. No new decision was created.'
      ));
    end if;
    if existing.completed_at is null then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object(
        'error', 'operation_incomplete',
        'detail', 'The original operation has no committed result. Retry the same request.'
      ));
    end if;
    return jsonb_build_object('status', existing.response_status, 'body', existing.response_body, 'replayed', true);
  end if;

  -- Serialize decisions on one story. This prevents simultaneous edits from reading the same prior status.
  select editorial_status into previous_status
  from public.stories
  where id = p_story_id
  for update;

  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'not_found'));
  end if;

  -- Concurrent requests with the same key are serialized by the unique constraint.
  insert into public.idempotency_records (
    actor_key, endpoint_key, idempotency_key, request_hash
  ) values (
    'editor', 'story_editorial_decision', p_idempotency_key, p_request_hash
  )
  on conflict (actor_key, endpoint_key, idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing
    from public.idempotency_records
    where actor_key = 'editor'
      and endpoint_key = 'story_editorial_decision'
      and idempotency_key = p_idempotency_key
    for update;

    if existing.request_hash <> p_request_hash then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'idempotency_key_reused'));
    end if;
    if existing.completed_at is null then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'operation_incomplete'));
    end if;
    return jsonb_build_object('status', existing.response_status, 'body', existing.response_body, 'replayed', true);
  end if;

  insert into public.editorial_decisions (
    story_id, decision, decided_by, notes
  ) values (
    p_story_id, p_decision, 'editor', nullif(p_notes, '')
  );

  update public.stories
  set editorial_status = p_decision, updated_at = now()
  where id = p_story_id;

  insert into public.audit_events (
    event_type, entity_type, entity_id, actor, detail
  ) values (
    'story_' || p_decision,
    'story',
    p_story_id::text,
    'editor',
    jsonb_build_object(
      'previous', previous_status,
      'notes', nullif(p_notes, ''),
      'acknowledged', p_acknowledged
    )
  );

  result_body := jsonb_build_object('ok', true, 'status', p_decision);
  update public.idempotency_records
  set response_status = 200,
      response_body = result_body,
      completed_at = now()
  where id = inserted_id;

  return jsonb_build_object('status', 200, 'body', result_body, 'replayed', false);
end;
$function$;

revoke all on function public.record_story_editorial_decision(uuid, text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_story_editorial_decision(uuid, text, uuid, text, text, boolean) to service_role;

-- service_role invokes this function as SECURITY INVOKER; it needs these exact table/sequence privileges.
grant select, update on public.stories to service_role;
grant insert on public.editorial_decisions, public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

commit;
