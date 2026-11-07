-- WorldFiled Desk migration 013: atomic, idempotent provenance review and cache revision.
-- REVIEW ONLY on this feature branch. Do not apply to production without separate approval.
-- Requires migrations 008 and 012.

begin;

create table if not exists public.source_provenance_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);
insert into public.source_provenance_state(singleton, revision)
values (true, 0)
on conflict (singleton) do nothing;

alter table public.source_provenance_state enable row level security;
revoke all on public.source_provenance_state from public, anon, authenticated;
grant select, update on public.source_provenance_state to service_role;

alter table public.article_lineage_review_events
  add column if not exists previous_origin_type text
    check (previous_origin_type is null or previous_origin_type in ('original_reporting','wire_copy','syndicated','republished','press_release','official_document','aggregator','other','unknown')),
  add column if not exists new_origin_type text
    check (new_origin_type is null or new_origin_type in ('original_reporting','wire_copy','syndicated','republished','press_release','official_document','aggregator','other','unknown'));

create or replace function public.review_publication_relationship(
  p_idempotency_key uuid,
  p_request_hash text,
  p_relationship_id uuid,
  p_review_status text,
  p_evidence_url text,
  p_review_notes text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_request public.idempotency_records%rowtype;
  current_row public.publication_relationships%rowtype;
  inserted_id uuid;
  revision_value bigint;
  result_body jsonb;
begin
  if p_idempotency_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_relationship_id is null
     or p_review_status not in ('unverified','verified','disputed','rejected')
     or coalesce(char_length(p_evidence_url),0)>2000
     or coalesce(char_length(p_review_notes),0)>1200
     or (nullif(btrim(p_evidence_url),'') is null and nullif(btrim(p_review_notes),'') is null) then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','invalid_publication_relationship_review'));
  end if;

  select * into current_row from public.publication_relationships where id=p_relationship_id for update;
  if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('error','relationship_not_found')); end if;

  select * into existing_request from public.idempotency_records
  where actor_key='editor' and endpoint_key='publication_relationship_review' and idempotency_key=p_idempotency_key
  for update;
  if found then
    if existing_request.request_hash<>p_request_hash then return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused')); end if;
    if existing_request.completed_at is null then return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete')); end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  insert into public.idempotency_records(actor_key,endpoint_key,idempotency_key,request_hash)
  values('editor','publication_relationship_review',p_idempotency_key,p_request_hash)
  on conflict(actor_key,endpoint_key,idempotency_key) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    select * into existing_request from public.idempotency_records
    where actor_key='editor' and endpoint_key='publication_relationship_review' and idempotency_key=p_idempotency_key for update;
    if existing_request.request_hash<>p_request_hash then return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused')); end if;
    if existing_request.completed_at is null then return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete')); end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  update public.publication_relationships
  set review_status=p_review_status,
      evidence_url=nullif(btrim(p_evidence_url),''),
      review_notes=nullif(btrim(p_review_notes),''),
      reviewed_at=now(), reviewed_by='editor', updated_at=now()
  where id=p_relationship_id;

  insert into public.publication_relationship_review_events(relationship_id,previous_status,new_status,evidence_url,review_notes,reviewed_by)
  values(p_relationship_id,current_row.review_status,p_review_status,nullif(btrim(p_evidence_url),''),nullif(btrim(p_review_notes),''),'editor');

  update public.source_provenance_state set revision=revision+1,updated_at=now() where singleton returning revision into revision_value;

  insert into public.audit_events(event_type,entity_type,entity_id,actor,detail)
  values('publication_relationship_reviewed','publication_relationship',p_relationship_id::text,'editor',
    jsonb_build_object('previous_status',current_row.review_status,'new_status',p_review_status,'provenance_revision',revision_value,'idempotency_key',p_idempotency_key));

  result_body:=jsonb_build_object('relationshipId',p_relationship_id,'reviewStatus',p_review_status,'provenanceRevision',revision_value);
  update public.idempotency_records set response_status=200,response_body=result_body,completed_at=now() where id=inserted_id;
  return jsonb_build_object('status',200,'body',result_body,'replayed',false);
end;
$function$;

create or replace function public.review_article_lineage(
  p_idempotency_key uuid,
  p_request_hash text,
  p_lineage_id uuid,
  p_origin_type text,
  p_review_status text,
  p_upstream_retrieved_source_id uuid,
  p_upstream_source_registry_id uuid,
  p_upstream_url text,
  p_evidence_url text,
  p_review_notes text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_request public.idempotency_records%rowtype;
  current_row public.article_lineage%rowtype;
  inserted_id uuid;
  revision_value bigint;
  result_body jsonb;
begin
  if p_idempotency_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_lineage_id is null
     or p_origin_type not in ('original_reporting','wire_copy','syndicated','republished','press_release','official_document','aggregator','other','unknown')
     or p_review_status not in ('unverified','verified','disputed','rejected')
     or coalesce(char_length(p_upstream_url),0)>2000
     or coalesce(char_length(p_evidence_url),0)>2000
     or coalesce(char_length(p_review_notes),0)>1200
     or (nullif(btrim(p_evidence_url),'') is null and nullif(btrim(p_review_notes),'') is null)
     or (p_review_status='verified' and p_origin_type<>'original_reporting'
       and p_upstream_retrieved_source_id is null and p_upstream_source_registry_id is null and nullif(btrim(p_upstream_url),'') is null) then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','invalid_article_lineage_review'));
  end if;

  select * into current_row from public.article_lineage where id=p_lineage_id for update;
  if not found then return jsonb_build_object('status',404,'body',jsonb_build_object('error','article_lineage_not_found')); end if;

  select * into existing_request from public.idempotency_records
  where actor_key='editor' and endpoint_key='article_lineage_review' and idempotency_key=p_idempotency_key
  for update;
  if found then
    if existing_request.request_hash<>p_request_hash then return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused')); end if;
    if existing_request.completed_at is null then return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete')); end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  insert into public.idempotency_records(actor_key,endpoint_key,idempotency_key,request_hash)
  values('editor','article_lineage_review',p_idempotency_key,p_request_hash)
  on conflict(actor_key,endpoint_key,idempotency_key) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    select * into existing_request from public.idempotency_records
    where actor_key='editor' and endpoint_key='article_lineage_review' and idempotency_key=p_idempotency_key for update;
    if existing_request.request_hash<>p_request_hash then return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused')); end if;
    if existing_request.completed_at is null then return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete')); end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  update public.article_lineage
  set origin_type=p_origin_type,
      review_status=p_review_status,
      upstream_retrieved_source_id=p_upstream_retrieved_source_id,
      upstream_source_registry_id=p_upstream_source_registry_id,
      upstream_url=nullif(btrim(p_upstream_url),''),
      evidence_url=nullif(btrim(p_evidence_url),''),
      review_notes=nullif(btrim(p_review_notes),''),
      reviewed_at=now(),reviewed_by='editor',updated_at=now()
  where id=p_lineage_id;

  insert into public.article_lineage_review_events(lineage_id,previous_status,new_status,evidence_url,review_notes,reviewed_by,previous_origin_type,new_origin_type)
  values(p_lineage_id,current_row.review_status,p_review_status,nullif(btrim(p_evidence_url),''),nullif(btrim(p_review_notes),''),'editor',current_row.origin_type,p_origin_type);

  update public.source_provenance_state set revision=revision+1,updated_at=now() where singleton returning revision into revision_value;

  insert into public.audit_events(event_type,entity_type,entity_id,actor,detail)
  values('article_lineage_reviewed','article_lineage',p_lineage_id::text,'editor',
    jsonb_build_object('previous_origin_type',current_row.origin_type,'new_origin_type',p_origin_type,'previous_status',current_row.review_status,'new_status',p_review_status,'provenance_revision',revision_value,'idempotency_key',p_idempotency_key));

  result_body:=jsonb_build_object('lineageId',p_lineage_id,'originType',p_origin_type,'reviewStatus',p_review_status,'provenanceRevision',revision_value);
  update public.idempotency_records set response_status=200,response_body=result_body,completed_at=now() where id=inserted_id;
  return jsonb_build_object('status',200,'body',result_body,'replayed',false);
end;
$function$;

create or replace function public.review_source_content_policy(
  p_idempotency_key uuid,
  p_request_hash text,
  p_source_id uuid,
  p_policy text,
  p_evidence_url text,
  p_policy_reason text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_request public.idempotency_records%rowtype;
  current_row public.source_content_policies%rowtype;
  inserted_id uuid;
  previous_policy text;
  revision_value bigint;
  result_body jsonb;
begin
  if p_idempotency_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_source_id is null
     or p_policy not in ('blocked','metadata_only','extraction_allowed')
     or coalesce(char_length(p_evidence_url),0)>2000
     or coalesce(char_length(p_policy_reason),0)>1200
     or (nullif(btrim(p_evidence_url),'') is null and nullif(btrim(p_policy_reason),'') is null) then
    return jsonb_build_object('status',400,'body',jsonb_build_object('error','invalid_source_content_policy'));
  end if;

  select * into current_row from public.source_content_policies where source_id=p_source_id for update;
  if found then previous_policy:=current_row.policy; else previous_policy:='metadata_only'; end if;

  select * into existing_request from public.idempotency_records
  where actor_key='editor' and endpoint_key='source_content_policy_review' and idempotency_key=p_idempotency_key
  for update;
  if found then
    if existing_request.request_hash<>p_request_hash then return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused')); end if;
    if existing_request.completed_at is null then return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete')); end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  insert into public.idempotency_records(actor_key,endpoint_key,idempotency_key,request_hash)
  values('editor','source_content_policy_review',p_idempotency_key,p_request_hash)
  on conflict(actor_key,endpoint_key,idempotency_key) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    select * into existing_request from public.idempotency_records
    where actor_key='editor' and endpoint_key='source_content_policy_review' and idempotency_key=p_idempotency_key for update;
    if existing_request.request_hash<>p_request_hash then return jsonb_build_object('status',409,'body',jsonb_build_object('error','idempotency_key_reused')); end if;
    if existing_request.completed_at is null then return jsonb_build_object('status',409,'body',jsonb_build_object('error','operation_incomplete')); end if;
    return jsonb_build_object('status',existing_request.response_status,'body',existing_request.response_body,'replayed',true);
  end if;

  insert into public.source_content_policies(source_id,policy,evidence_url,policy_reason,reviewed_at,reviewed_by,updated_at)
  values(p_source_id,p_policy,nullif(btrim(p_evidence_url),''),nullif(btrim(p_policy_reason),''),now(),'editor',now())
  on conflict(source_id) do update set policy=excluded.policy,evidence_url=excluded.evidence_url,policy_reason=excluded.policy_reason,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by,updated_at=now();

  insert into public.source_content_policy_events(source_id,previous_policy,new_policy,evidence_url,policy_reason,reviewed_by)
  values(p_source_id,previous_policy,p_policy,nullif(btrim(p_evidence_url),''),nullif(btrim(p_policy_reason),''),'editor');

  update public.source_provenance_state set revision=revision+1,updated_at=now() where singleton returning revision into revision_value;

  insert into public.audit_events(event_type,entity_type,entity_id,actor,detail)
  values('source_content_policy_reviewed','source_registry',p_source_id::text,'editor',
    jsonb_build_object('previous_policy',previous_policy,'new_policy',p_policy,'provenance_revision',revision_value,'idempotency_key',p_idempotency_key));

  result_body:=jsonb_build_object('sourceId',p_source_id,'policy',p_policy,'provenanceRevision',revision_value);
  update public.idempotency_records set response_status=200,response_body=result_body,completed_at=now() where id=inserted_id;
  return jsonb_build_object('status',200,'body',result_body,'replayed',false);
end;
$function$;

revoke all on function public.review_publication_relationship(uuid,text,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.review_article_lineage(uuid,text,uuid,text,text,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.review_source_content_policy(uuid,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.review_publication_relationship(uuid,text,uuid,text,text,text) to service_role;
grant execute on function public.review_article_lineage(uuid,text,uuid,text,text,uuid,uuid,text,text,text) to service_role;
grant execute on function public.review_source_content_policy(uuid,text,uuid,text,text,text) to service_role;

grant select, insert, update on public.publication_relationships, public.article_lineage, public.source_content_policies to service_role;
grant select, insert on public.publication_relationship_review_events, public.article_lineage_review_events, public.source_content_policy_events to service_role;
grant select, update on public.source_provenance_state to service_role;
grant insert on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

commit;
