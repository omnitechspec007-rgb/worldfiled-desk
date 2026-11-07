-- WorldFiled Desk migration 011: atomic, idempotent material-claim intake.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- Requires migration 008 (idempotency_records).
-- Claim insert, story clearance invalidation, audit event and replay response commit together.

begin;

create or replace function public.add_material_claim(
  p_idempotency_key uuid,
  p_request_hash text,
  p_story_id uuid,
  p_claim_text text,
  p_claim_hash text,
  p_category text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_request public.idempotency_records%rowtype;
  existing_claim public.claims%rowtype;
  inserted_id uuid;
  claim_is_new boolean := false;
  result_body jsonb;
begin
  if p_idempotency_key is null
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_story_id is null
     or p_claim_text is null
     or char_length(btrim(p_claim_text)) < 8
     or char_length(p_claim_text) > 1200
     or p_claim_hash is null
     or p_claim_hash !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(p_category, '')) > 80 then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid_material_claim'));
  end if;

  perform 1 from public.stories where id = p_story_id for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'not_found'));
  end if;

  select * into existing_request
  from public.idempotency_records
  where actor_key = 'editor'
    and endpoint_key = 'material_claim_add'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing_request.request_hash <> p_request_hash then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'idempotency_key_reused'));
    end if;
    if existing_request.completed_at is null then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'operation_incomplete'));
    end if;
    return jsonb_build_object('status', existing_request.response_status, 'body', existing_request.response_body, 'replayed', true);
  end if;

  select * into existing_claim
  from public.claims
  where story_id = p_story_id and claim_hash = p_claim_hash
  for update;

  if found then
    if existing_claim.claim_text is distinct from p_claim_text
       or coalesce(existing_claim.category, '') is distinct from coalesce(p_category, 'factual') then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object(
        'error', 'claim_fingerprint_conflict',
        'detail', 'A claim with this normalized fingerprint already exists with different text or category. The existing claim was not overwritten.'
      ));
    end if;
  else
    insert into public.claims (story_id, claim_text, claim_hash, category, extraction_status)
    values (p_story_id, p_claim_text, p_claim_hash, coalesce(nullif(btrim(p_category), ''), 'factual'), 'pending')
    returning * into existing_claim;
    claim_is_new := true;

    update public.stories
    set verification_status = 'in_progress', updated_at = now()
    where id = p_story_id;

    insert into public.audit_events (event_type, entity_type, entity_id, actor, detail)
    values (
      'material_claim_added',
      'claim',
      existing_claim.id::text,
      'editor',
      jsonb_build_object(
        'story_id', p_story_id,
        'claim_id', existing_claim.id,
        'category', existing_claim.category,
        'claim_hash', p_claim_hash,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  insert into public.idempotency_records (actor_key, endpoint_key, idempotency_key, request_hash)
  values ('editor', 'material_claim_add', p_idempotency_key, p_request_hash)
  on conflict (actor_key, endpoint_key, idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing_request from public.idempotency_records
    where actor_key = 'editor'
      and endpoint_key = 'material_claim_add'
      and idempotency_key = p_idempotency_key
    for update;
    if existing_request.request_hash <> p_request_hash then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'idempotency_key_reused'));
    end if;
    if existing_request.completed_at is null then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'operation_incomplete'));
    end if;
    return jsonb_build_object('status', existing_request.response_status, 'body', existing_request.response_body, 'replayed', true);
  end if;

  result_body := jsonb_build_object(
    'claim', jsonb_build_object(
      'id', existing_claim.id,
      'claim_text', existing_claim.claim_text,
      'category', existing_claim.category,
      'created_at', existing_claim.created_at
    ),
    'note', case when claim_is_new
      then 'Claim saved atomically. It remains unverified until sources and an editor decision are recorded.'
      else 'This exact claim was already recorded. No duplicate claim or audit event was created.'
    end
  );

  update public.idempotency_records
  set response_status = 200, response_body = result_body, completed_at = now()
  where id = inserted_id;

  return jsonb_build_object('status', 200, 'body', result_body, 'replayed', false);
end;
$function$;

revoke all on function public.add_material_claim(uuid,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.add_material_claim(uuid,text,uuid,text,text,text) to service_role;
grant select, update, insert on public.claims to service_role;
grant select, update on public.stories to service_role;
grant insert on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

commit;
