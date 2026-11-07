-- WorldFiled Desk migration 014: idempotent creation of unverified publisher-relationship candidates.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- Requires migrations 008, 012 and 013. No relationships are inferred or backfilled.

begin;

create or replace function public.create_publication_relationship_candidate(
  p_idempotency_key uuid,
  p_request_hash text,
  p_source_id uuid,
  p_related_source_id uuid,
  p_relationship_type text,
  p_evidence_url text,
  p_review_notes text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_request public.idempotency_records%rowtype;
  inserted_request_id uuid;
  relationship_id uuid;
  revision_value bigint;
  first_source_id uuid := p_source_id;
  second_source_id uuid := p_related_source_id;
  result_body jsonb;
begin
  if p_idempotency_key is null
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_source_id is null or p_related_source_id is null
     or p_source_id = p_related_source_id
     or p_relationship_type is null
     or p_relationship_type not in ('same_owner','owned_by','subsidiary_of','syndicates_from','republishes','licensed_from','partner','aggregates','official_source_for','other')
     or coalesce(char_length(p_evidence_url),0)>2000
     or coalesce(char_length(p_review_notes),0)>1200
     or (nullif(btrim(p_evidence_url),'') is null and nullif(btrim(p_review_notes),'') is null) then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','invalid_publication_relationship_candidate'));
  end if;

  -- Same-owner edges are symmetric; canonical UUID order prevents reverse duplicates.
  if p_relationship_type='same_owner' and first_source_id>second_source_id then
    first_source_id:=p_related_source_id;
    second_source_id:=p_source_id;
  end if;

  -- Lock in stable order to avoid deadlocks between concurrent candidate submissions.
  perform id from public.source_registry
  where id in (first_source_id,second_source_id)
  order by id
  for update;
  if (select count(*) from public.source_registry where id in (first_source_id,second_source_id))<>2 then
    return jsonb_build_object('status',404,'body',jsonb_build_object('error','source_not_found'));
  end if;

  select * into existing_request
  from public.idempotency_records
  where actor_key='editor' and endpoint_key='publication_relationship_candidate'
    and idempotency_key=p_idempotency_key
  for update;
  if found then
    if existing_request.request_hash<>p_request_hash then
      return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused'));
    end if;
    if existing_request.completed_at is null then
      return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete'));
    end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  insert into public.idempotency_records(actor_key,endpoint_key,idempotency_key,request_hash)
  values('editor','publication_relationship_candidate',p_idempotency_key,p_request_hash)
  on conflict(actor_key,endpoint_key,idempotency_key) do nothing
  returning id into inserted_request_id;

  if inserted_request_id is null then
    select * into existing_request from public.idempotency_records
    where actor_key='editor' and endpoint_key='publication_relationship_candidate'
      and idempotency_key=p_idempotency_key
    for update;
    if existing_request.request_hash<>p_request_hash then
      return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused'));
    end if;
    if existing_request.completed_at is null then
      return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete'));
    end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  insert into public.publication_relationships(
    source_id,related_source_id,relationship_type,review_status,evidence_url,review_notes
  ) values (
    first_source_id,second_source_id,p_relationship_type,'unverified',
    nullif(btrim(p_evidence_url),''),nullif(btrim(p_review_notes),'')
  )
  on conflict(source_id,related_source_id,relationship_type) do nothing
  returning id into relationship_id;

  if relationship_id is null then
    result_body:=jsonb_build_object(
      'error','relationship_already_exists',
      'detail','A relationship with this direction and type is already recorded. Inspect the existing record instead of creating a duplicate.'
    );
    update public.idempotency_records
    set response_status=409,response_body=result_body,completed_at=now()
    where id=inserted_request_id;
    return jsonb_build_object('status',409,'body',result_body,'replayed',false);
  end if;

  update public.source_provenance_state
  set revision=revision+1,updated_at=now()
  where singleton
  returning revision into revision_value;

  insert into public.audit_events(event_type,entity_type,entity_id,actor,detail)
  values(
    'publication_relationship_candidate_created',
    'publication_relationship',
    relationship_id::text,
    'editor',
    jsonb_build_object(
      'relationship_type',p_relationship_type,
      'review_status','unverified',
      'provenance_revision',revision_value,
      'idempotency_key',p_idempotency_key
    )
  );

  result_body:=jsonb_build_object(
    'relationshipId',relationship_id,
    'relationshipType',p_relationship_type,
    'reviewStatus','unverified',
    'provenanceRevision',revision_value
  );
  update public.idempotency_records
  set response_status=201,response_body=result_body,completed_at=now()
  where id=inserted_request_id;

  return jsonb_build_object('status',201,'body',result_body,'replayed',false);
end;
$function$;

revoke all on function public.create_publication_relationship_candidate(uuid,text,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.create_publication_relationship_candidate(uuid,text,uuid,uuid,text,text,text) to service_role;

grant select on public.source_registry to service_role;
grant insert on public.publication_relationships, public.audit_events to service_role;
grant select, insert, update on public.idempotency_records to service_role;
grant update on public.source_provenance_state to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

commit;
