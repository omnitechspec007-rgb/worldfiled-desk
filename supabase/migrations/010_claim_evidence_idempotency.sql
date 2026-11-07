-- WorldFiled Desk migration 010: atomic, idempotent claim-evidence intake.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- Requires migration 008 (idempotency_records).
-- Evidence insert, story clearance invalidation, audit event and replay response commit together.

begin;

create or replace function public.add_claim_evidence(
  p_idempotency_key uuid,
  p_request_hash text,
  p_story_id uuid,
  p_claim_id uuid,
  p_source_id uuid,
  p_passage text,
  p_passage_hash text,
  p_passage_location text,
  p_is_contradiction boolean
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_request public.idempotency_records%rowtype;
  existing_evidence public.claim_evidence%rowtype;
  source_published timestamptz;
  inserted_id uuid;
  evidence_is_new boolean := false;
  result_body jsonb;
  evidence_status text;
begin
  if p_idempotency_key is null
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_story_id is null
     or p_claim_id is null
     or p_source_id is null
     or p_passage_hash is null
     or p_passage_hash !~ '^[0-9a-f]{64}$'
     or coalesce(char_length(p_passage), 0) > 4000
     or coalesce(char_length(p_passage_location), 0) > 300
     or p_is_contradiction is null then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid_evidence_request'));
  end if;

  -- Serialize all evidence and clearance changes for the story.
  perform 1 from public.stories where id = p_story_id for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'not_found'));
  end if;

  select * into existing_request
  from public.idempotency_records
  where actor_key = 'editor'
    and endpoint_key = 'claim_evidence_add'
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

  perform 1 from public.claims
  where id = p_claim_id and story_id = p_story_id
  for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'claim_not_found'));
  end if;

  if not exists (
    select 1 from public.story_source_links
    where story_id = p_story_id and source_id = p_source_id
  ) then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'source_not_linked_to_story'));
  end if;

  select published_at into source_published
  from public.retrieved_sources
  where id = p_source_id;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'source_not_found'));
  end if;

  evidence_status := case
    when nullif(btrim(coalesce(p_passage, '')), '') is null then 'inaccessible'
    else 'extracted'
  end;

  select * into existing_evidence
  from public.claim_evidence
  where claim_id = p_claim_id
    and source_id = p_source_id
    and passage_hash = p_passage_hash;

  if found then
    if coalesce(existing_evidence.passage, '') is distinct from coalesce(p_passage, '')
       or coalesce(existing_evidence.passage_location, '') is distinct from coalesce(p_passage_location, '')
       or existing_evidence.is_contradiction is distinct from p_is_contradiction
       or existing_evidence.extraction_status is distinct from evidence_status then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object(
        'error', 'evidence_fingerprint_conflict',
        'detail', 'This source and passage fingerprint already exists with different evidence attributes. No existing evidence was overwritten.'
      ));
    end if;
  else
    insert into public.claim_evidence (
      claim_id, source_id, passage, passage_hash, passage_location,
      source_published_at, extraction_status, is_contradiction, created_at
    ) values (
      p_claim_id, p_source_id, nullif(btrim(coalesce(p_passage, '')), ''),
      p_passage_hash, nullif(btrim(coalesce(p_passage_location, '')), ''),
      source_published, evidence_status, p_is_contradiction, now()
    )
    returning * into existing_evidence;
    evidence_is_new := true;

    update public.stories
    set verification_status = 'in_progress', updated_at = now()
    where id = p_story_id;

    insert into public.audit_events (event_type, entity_type, entity_id, actor, detail)
    values (
      'claim_evidence_added',
      'claim',
      p_claim_id::text,
      'editor',
      jsonb_build_object(
        'story_id', p_story_id,
        'claim_id', p_claim_id,
        'source_id', p_source_id,
        'passage_hash', p_passage_hash,
        'extraction_status', evidence_status,
        'is_contradiction', p_is_contradiction,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  insert into public.idempotency_records (actor_key, endpoint_key, idempotency_key, request_hash)
  values ('editor', 'claim_evidence_add', p_idempotency_key, p_request_hash)
  on conflict (actor_key, endpoint_key, idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing_request from public.idempotency_records
    where actor_key = 'editor'
      and endpoint_key = 'claim_evidence_add'
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
    'evidence', jsonb_build_object(
      'id', existing_evidence.id,
      'claim_id', existing_evidence.claim_id,
      'source_id', existing_evidence.source_id,
      'passage', existing_evidence.passage,
      'passage_location', existing_evidence.passage_location,
      'is_contradiction', existing_evidence.is_contradiction,
      'extraction_status', existing_evidence.extraction_status,
      'created_at', existing_evidence.created_at
    ),
    'note', case when evidence_is_new
      then case when evidence_status = 'extracted'
        then 'Evidence passage saved atomically. The editor must assess what it supports.'
        else 'Source linked without an extracted passage. This is a lead, not supporting evidence.'
      end
      else 'This exact evidence passage was already recorded. No duplicate evidence or audit event was created.'
    end
  );

  update public.idempotency_records
  set response_status = 200, response_body = result_body, completed_at = now()
  where id = inserted_id;

  return jsonb_build_object('status', 200, 'body', result_body, 'replayed', false);
end;
$function$;

revoke all on function public.add_claim_evidence(uuid,text,uuid,uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.add_claim_evidence(uuid,text,uuid,uuid,uuid,text,text,text,boolean) to service_role;
grant select, update on public.stories, public.claims to service_role;
grant select on public.story_source_links, public.retrieved_sources, public.claim_evidence to service_role;
grant insert on public.claim_evidence, public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

commit;
