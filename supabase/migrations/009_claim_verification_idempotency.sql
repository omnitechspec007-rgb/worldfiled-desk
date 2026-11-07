-- WorldFiled Desk migration 009: atomic claim-verification decisions.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- Requires migration 008 (idempotency_records and story-decision RPC).
-- One claim decision, story status, audit event and replay record commit together.

begin;

create or replace function public.record_claim_verification_decision(
  p_idempotency_key uuid,
  p_request_hash text,
  p_story_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_reviewer_notes text,
  p_contradiction_resolution text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing public.idempotency_records%rowtype;
  inserted_id uuid;
  result_id uuid;
  prior_status text;
  has_support boolean;
  has_contradiction boolean;
  stored_notes text;
  result_body jsonb;
begin
  if p_idempotency_key is null
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_story_id is null
     or p_claim_id is null
     or p_outcome is null
     or p_outcome not in ('SUPPORTED','PARTIALLY_SUPPORTED','CONTRADICTED','INSUFFICIENT_EVIDENCE','UNVERIFIED','NOT_APPLICABLE')
     or coalesce(char_length(p_reviewer_notes), 0) > 400
     or coalesce(char_length(p_contradiction_resolution), 0) > 1000 then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid_claim_decision'));
  end if;

  -- Serialize changes for this story and claim before inspecting evidence.
  select verification_status into prior_status
  from public.stories where id = p_story_id for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'not_found'));
  end if;

  perform 1 from public.claims
  where id = p_claim_id and story_id = p_story_id
  for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'claim_not_found'));
  end if;

  -- The claim row lock also prevents concurrent evidence inserts through its FK from
  -- slipping between the evidence check and the decision write.
  select * into existing
  from public.idempotency_records
  where actor_key = 'editor'
    and endpoint_key = 'claim_verification_decision'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing.request_hash <> p_request_hash then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'idempotency_key_reused'));
    end if;
    if existing.completed_at is null then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'operation_incomplete'));
    end if;
    return jsonb_build_object('status', existing.response_status, 'body', existing.response_body, 'replayed', true);
  end if;

  select
    coalesce(bool_or(passage is not null and btrim(passage) <> '' and extraction_status = 'extracted' and not is_contradiction), false),
    coalesce(bool_or(passage is not null and btrim(passage) <> '' and extraction_status = 'extracted' and is_contradiction), false)
  into has_support, has_contradiction
  from public.claim_evidence
  where claim_id = p_claim_id;

  if p_outcome = 'SUPPORTED' and not has_support then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'supported_claim_requires_checked_passage'));
  end if;

  if p_outcome = 'SUPPORTED' and has_contradiction
     and char_length(btrim(coalesce(p_contradiction_resolution, ''))) < 80 then
    return jsonb_build_object('status', 409, 'body', jsonb_build_object(
      'error', 'contradiction_review_required',
      'detail', 'A specific reconciliation of at least 80 characters is required for contradictory evidence.'
    ));
  end if;

  insert into public.idempotency_records (actor_key, endpoint_key, idempotency_key, request_hash)
  values ('editor', 'claim_verification_decision', p_idempotency_key, p_request_hash)
  on conflict (actor_key, endpoint_key, idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing from public.idempotency_records
    where actor_key = 'editor'
      and endpoint_key = 'claim_verification_decision'
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

  stored_notes := coalesce(nullif(btrim(p_reviewer_notes), ''), '');
  if p_outcome = 'SUPPORTED' and has_contradiction then
    stored_notes := 'CONTRADICTION RECONCILIATION:' || chr(10)
      || btrim(p_contradiction_resolution)
      || case when stored_notes <> '' then chr(10)||chr(10)||'EDITOR NOTES:'||chr(10)||stored_notes else '' end;
  end if;

  insert into public.verification_results (claim_id, outcome, determined_by, reviewer_notes)
  values (p_claim_id, p_outcome, 'editor', nullif(stored_notes, ''))
  returning id into result_id;

  update public.stories
  set verification_status = case when p_outcome = 'CONTRADICTED' then 'failed' else 'in_progress' end,
      updated_at = now()
  where id = p_story_id;

  insert into public.audit_events (event_type, entity_type, entity_id, actor, detail)
  values (
    'claim_verification_' || lower(p_outcome),
    'claim',
    p_claim_id::text,
    'editor',
    jsonb_build_object(
      'story_id', p_story_id,
      'claim_id', p_claim_id,
      'outcome', p_outcome,
      'has_supporting_passage', has_support,
      'has_contradictory_passage', has_contradiction,
      'idempotency_key', p_idempotency_key
    )
  );

  result_body := jsonb_build_object(
    'result', jsonb_build_object(
      'id', result_id,
      'claim_id', p_claim_id,
      'outcome', p_outcome,
      'determined_by', 'editor',
      'reviewer_notes', nullif(stored_notes, ''),
      'created_at', now()
    ),
    'note', 'Decision recorded atomically. Story-level clearance remains a separate step.'
  );

  update public.idempotency_records
  set response_status = 200, response_body = result_body, completed_at = now()
  where id = inserted_id;

  return jsonb_build_object('status', 200, 'body', result_body, 'replayed', false);
end;
$function$;

revoke all on function public.record_claim_verification_decision(uuid,text,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_claim_verification_decision(uuid,text,uuid,uuid,text,text,text) to service_role;
grant select, update on public.stories to service_role;
-- SELECT FOR UPDATE on a claim requires UPDATE privilege; the RPC uses it only to serialize evidence inserts.
grant select, update on public.claims to service_role;
grant select on public.claim_evidence to service_role;
-- INSERT ... RETURNING id also requires SELECT on the returned verification row.
grant select, insert on public.verification_results to service_role;
grant insert on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;


create or replace function public.complete_story_verification(
  p_idempotency_key uuid,
  p_request_hash text,
  p_story_id uuid,
  p_acknowledged boolean
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing public.idempotency_records%rowtype;
  inserted_id uuid;
  claim_count integer;
  unresolved_count integer;
  result_body jsonb;
  prefix text := 'CONTRADICTION RECONCILIATION:' || chr(10);
begin
  if p_idempotency_key is null
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_story_id is null
     or p_acknowledged is distinct from true then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid_clearance_request'));
  end if;

  -- Serialize all claim/evidence mutations for this story.
  perform 1 from public.stories where id = p_story_id for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'not_found'));
  end if;

  select * into existing
  from public.idempotency_records
  where actor_key = 'editor'
    and endpoint_key = 'story_verification_clearance'
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if existing.request_hash <> p_request_hash then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'idempotency_key_reused'));
    end if;
    if existing.completed_at is null then
      return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'operation_incomplete'));
    end if;
    return jsonb_build_object('status', existing.response_status, 'body', existing.response_body, 'replayed', true);
  end if;

  -- Lock every recorded claim in a stable order. FK inserts for claims/evidence must wait.
  perform 1 from public.claims
  where story_id = p_story_id
  order by id
  for update;

  select count(*) into claim_count
  from public.claims where story_id = p_story_id;

  if claim_count = 0 then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'no_material_claims_recorded'));
  end if;

  select count(*) into unresolved_count
  from public.claims c
  left join lateral (
    select vr.outcome, vr.reviewer_notes, vr.created_at
    from public.verification_results vr
    where vr.claim_id = c.id
    order by vr.created_at desc, vr.id desc
    limit 1
  ) d on true
  where c.story_id = p_story_id
    and (
      d.outcome is distinct from 'SUPPORTED'
      or not exists (
        select 1 from public.claim_evidence e
        where e.claim_id = c.id
          and e.passage is not null
          and btrim(e.passage) <> ''
          and e.extraction_status = 'extracted'
          and e.is_contradiction = false
      )
      or (
        exists (
          select 1 from public.claim_evidence e
          where e.claim_id = c.id
            and e.passage is not null
            and btrim(e.passage) <> ''
            and e.extraction_status = 'extracted'
            and e.is_contradiction = true
        )
        and (
          d.reviewer_notes is null
          or left(d.reviewer_notes, char_length(prefix)) <> prefix
          or char_length(btrim(split_part(
            substring(d.reviewer_notes from char_length(prefix) + 1),
            chr(10) || chr(10) || 'EDITOR NOTES:' || chr(10),
            1
          ))) < 80
        )
      )
      or d.created_at < (
        select max(e.created_at)
        from public.claim_evidence e
        where e.claim_id = c.id
      )
    );

  if unresolved_count > 0 then
    return jsonb_build_object('status', 409, 'body', jsonb_build_object(
      'error', 'claims_unresolved',
      'unresolvedCount', unresolved_count,
      'note', 'Every recorded material claim needs a current SUPPORTED decision, an extracted supporting passage, and a specific reconciliation for any contradictory passage.'
    ));
  end if;

  insert into public.idempotency_records (actor_key, endpoint_key, idempotency_key, request_hash)
  values ('editor', 'story_verification_clearance', p_idempotency_key, p_request_hash)
  on conflict (actor_key, endpoint_key, idempotency_key) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select * into existing from public.idempotency_records
    where actor_key = 'editor'
      and endpoint_key = 'story_verification_clearance'
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

  update public.stories
  set verification_status = 'verified', updated_at = now()
  where id = p_story_id;

  insert into public.audit_events (event_type, entity_type, entity_id, actor, detail)
  values (
    'story_verification_verified',
    'story',
    p_story_id::text,
    'editor',
    jsonb_build_object(
      'claim_count', claim_count,
      'acknowledged_material_claim_register', true,
      'idempotency_key', p_idempotency_key
    )
  );

  result_body := jsonb_build_object(
    'verificationStatus', 'verified',
    'note', 'Story marked verified for the claims recorded. The editor confirmed the material-claim list is complete.'
  );

  update public.idempotency_records
  set response_status = 200, response_body = result_body, completed_at = now()
  where id = inserted_id;

  return jsonb_build_object('status', 200, 'body', result_body, 'replayed', false);
end;
$function$;

revoke all on function public.complete_story_verification(uuid,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.complete_story_verification(uuid,text,uuid,boolean) to service_role;

commit;
