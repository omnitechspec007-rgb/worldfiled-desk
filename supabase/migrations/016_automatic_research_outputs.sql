-- WorldFiled Desk migration 016: idempotent post-research production packages.
-- Additive only. This stores draft package setup; it does NOT verify, approve, export or publish content.
-- REVIEW ONLY on the feature branch. Do not apply to production without separate approval.

begin;

create table if not exists public.research_output_batches (
  research_run_id uuid primary key references public.research_runs(id) on delete restrict,
  status text not null check (status in ('prepared','empty')),
  package_count smallint not null check (package_count between 0 and 5),
  selection_hash text not null check (selection_hash ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  check ((status = 'empty' and package_count = 0) or (status = 'prepared' and package_count > 0))
);

create table if not exists public.research_output_packages (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_output_batches(research_run_id) on delete restrict,
  package_key text not null check (package_key in ('text_card_1','text_card_2','text_card_3','text_roundup','daily_narrated')),
  edition_id uuid not null references public.editions(id) on delete restrict,
  content_format text not null check (content_format in ('text_card','text_roundup','narrated_video')),
  duration_seconds smallint,
  selection_hash text not null check (selection_hash ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  unique (research_run_id, package_key),
  unique (edition_id),
  check (
    (content_format = 'narrated_video' and duration_seconds in (60,90,120))
    or (content_format in ('text_card','text_roundup') and duration_seconds is null)
  ),
  check (
    (package_key like 'text_card_%' and content_format = 'text_card')
    or (package_key = 'text_roundup' and content_format = 'text_roundup')
    or (package_key = 'daily_narrated' and content_format = 'narrated_video')
  )
);

create index if not exists research_output_packages_run_idx
  on public.research_output_packages(research_run_id, created_at);
create index if not exists research_output_packages_edition_idx
  on public.research_output_packages(edition_id);

-- The API calls this once the research run is complete. The run row lock serialises retries.
-- Existing batches are immutable: a retry returns the first set rather than rewriting an editor's work.
create or replace function public.prepare_research_output_packages(
  p_run_id uuid,
  p_packages jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $function$
declare
  v_run public.research_runs%rowtype;
  v_batch public.research_output_batches%rowtype;
  v_package jsonb;
  v_key text;
  v_format text;
  v_duration integer;
  v_title text;
  v_theme text;
  v_structure text;
  v_angle text;
  v_story_ids uuid[];
  v_story_count integer;
  v_matches integer;
  v_edition_id uuid;
  v_hash text;
  v_results jsonb := '[]'::jsonb;
  v_existing jsonb;
  v_status text;
begin
  if p_run_id is null then
    raise exception using errcode = '22023', message = 'run_id_required';
  end if;
  if jsonb_typeof(p_packages) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'packages_must_be_array';
  end if;
  if jsonb_array_length(p_packages) > 5 then
    raise exception using errcode = '22023', message = 'too_many_packages';
  end if;
  if (
    select count(distinct value->>'key')
    from jsonb_array_elements(p_packages)
  ) <> jsonb_array_length(p_packages) then
    raise exception using errcode = '22023', message = 'duplicate_package_key';
  end if;

  select * into v_run
  from public.research_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'research_run_not_found';
  end if;
  if v_run.status <> 'completed' then
    raise exception using errcode = '55000', message = 'research_run_not_completed';
  end if;

  select * into v_batch
  from public.research_output_batches
  where research_run_id = p_run_id;

  if found then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.edition_id,
        'key', p.package_key,
        'format', p.content_format,
        'durationSeconds', p.duration_seconds,
        'title', e.title,
        'storyIds', coalesce((
          select jsonb_agg(ed.story_id order by ed.position)
          from public.edition_developments ed
          where ed.edition_id = e.id
        ), '[]'::jsonb)
      ) order by p.created_at, p.package_key
    ), '[]'::jsonb)
    into v_existing
    from public.research_output_packages p
    join public.editions e on e.id = p.edition_id
    where p.research_run_id = p_run_id;

    return jsonb_build_object(
      'status', v_batch.status,
      'packageCount', v_batch.package_count,
      'packages', coalesce(v_existing, '[]'::jsonb),
      'replayed', true,
      'requestChanged', v_batch.selection_hash <> md5(p_packages::text)
    );
  end if;

  v_status := case when jsonb_array_length(p_packages) = 0 then 'empty' else 'prepared' end;
  insert into public.research_output_batches(research_run_id, status, package_count, selection_hash)
  values (p_run_id, v_status, jsonb_array_length(p_packages), md5(p_packages::text));

  for v_package in select value from jsonb_array_elements(p_packages)
  loop
    if jsonb_typeof(v_package) is distinct from 'object'
       or jsonb_typeof(v_package->'storyIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'invalid_package_shape';
    end if;

    v_key := v_package->>'key';
    v_format := v_package->>'format';
    v_duration := nullif(v_package->>'durationSeconds', '')::integer;
    v_title := btrim(coalesce(v_package->>'title', ''));
    v_theme := coalesce(v_package->>'theme', '');
    v_structure := v_package->>'structure';
    v_angle := coalesce(v_package->>'angle', '');

    if v_key is null or v_key not in ('text_card_1','text_card_2','text_card_3','text_roundup','daily_narrated') then
      raise exception using errcode = '22023', message = 'invalid_package_key';
    end if;
    if v_format is null or v_format not in ('text_card','text_roundup','narrated_video') then
      raise exception using errcode = '22023', message = 'invalid_package_format';
    end if;
    if v_title = '' or char_length(v_title) > 300 or char_length(v_angle) > 1000 then
      raise exception using errcode = '22023', message = 'invalid_package_text';
    end if;
    if v_structure is null or v_structure not in ('multi_country','single_country','event_roundup','news_roundup') then
      raise exception using errcode = '22023', message = 'invalid_package_structure';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_package->'storyIds') as x(value)
      where x.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
      raise exception using errcode = '22023', message = 'invalid_story_id';
    end if;

    select coalesce(array_agg(x.value::uuid order by x.ordinality), '{}'::uuid[]), count(*), count(distinct x.value::uuid)
    into v_story_ids, v_story_count, v_matches
    from jsonb_array_elements_text(v_package->'storyIds') with ordinality as x(value, ordinality);

    if v_story_count < 1 or v_story_count > 7 or v_story_count <> v_matches then
      raise exception using errcode = '22023', message = 'invalid_package_story_count';
    end if;
    if v_format = 'text_card' and (v_story_count <> 1 or v_key not like 'text_card_%' or v_duration is not null) then
      raise exception using errcode = '22023', message = 'invalid_text_card_profile';
    end if;
    if v_format = 'text_roundup' and (v_story_count < 5 or v_story_count > 7 or v_key <> 'text_roundup' or v_duration is not null) then
      raise exception using errcode = '22023', message = 'invalid_text_roundup_profile';
    end if;
    if v_format = 'narrated_video' and (v_story_count > 5 or v_key <> 'daily_narrated' or (v_duration is null or v_duration not in (60,90,120))) then
      raise exception using errcode = '22023', message = 'invalid_narrated_video_profile';
    end if;

    select count(distinct s.story_id) into v_matches
    from public.shortlist s
    where s.run_id = p_run_id and s.story_id = any(v_story_ids);
    if v_matches <> v_story_count then
      raise exception using errcode = '22023', message = 'story_not_in_run_shortlist';
    end if;

    v_hash := md5(jsonb_build_object(
      'key', v_key, 'format', v_format, 'durationSeconds', v_duration, 'storyIds', to_jsonb(v_story_ids)
    )::text);

    insert into public.editions(
      title, theme, structure, narrative_angle, status, coherence, curiosity, created_by, edition_kind
    ) values (
      v_title, v_theme, v_structure, v_angle, 'draft',
      coalesce(v_package->'coherence', '{}'::jsonb),
      coalesce(v_package->'curiosity', '{}'::jsonb),
      'automatic_research_prep', 'video'
    ) returning id into v_edition_id;

    insert into public.edition_developments(edition_id, story_id, position)
    select v_edition_id, x.story_id, x.ordinality::integer
    from unnest(v_story_ids) with ordinality as x(story_id, ordinality);

    insert into public.research_output_packages(
      research_run_id, package_key, edition_id, content_format, duration_seconds, selection_hash
    ) values (
      p_run_id, v_key, v_edition_id, v_format, v_duration, v_hash
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_edition_id,
      'key', v_key,
      'format', v_format,
      'durationSeconds', v_duration,
      'title', v_title,
      'storyIds', to_jsonb(v_story_ids)
    ));
  end loop;

  insert into public.audit_events(event_type, entity_type, entity_id, actor, detail)
  values (
    'research_output_packages_prepared',
    'research_run',
    p_run_id::text,
    'system',
    jsonb_build_object('package_count', jsonb_array_length(p_packages), 'package_keys', coalesce((select jsonb_agg(value->>'key') from jsonb_array_elements(p_packages)), '[]'::jsonb))
  );

  return jsonb_build_object(
    'status', v_status,
    'packageCount', jsonb_array_length(p_packages),
    'packages', v_results,
    'replayed', false,
    'requestChanged', false
  );
end;
$function$;

alter table public.research_output_batches enable row level security;
alter table public.research_output_packages enable row level security;
revoke all on public.research_output_batches, public.research_output_packages from public, anon, authenticated;
grant select, insert on public.research_output_batches to service_role;
grant select, insert on public.research_output_packages to service_role;
revoke all on function public.prepare_research_output_packages(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.prepare_research_output_packages(uuid, jsonb) to service_role;

commit;
