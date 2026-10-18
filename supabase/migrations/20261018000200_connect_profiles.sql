-- Connect your own AI: ENGINE's look-and-flow profiles, for the user's own assistant (CONNECT, 2026-10-18).
-- APPLY AFTER 20261017000300_engine_profiles.sql AND 20261018000100_connect_ai.sql. One transaction.
--
-- Four functions, the same shape as every other connect function: the first argument is the token's SHA-256 hash, the person is resolved inside
-- (ryagram_private.connect_actor: live token, still invited, not an admin, grant and scope), no argument names an owner, and only connect_runner may
-- execute them. The profile rules themselves are ENGINE's (set_engine_profile checks the key tree and the 20-profile cap; the Edge Function checks the
-- values with the same profile.ts the app uses); nothing is copied here.
begin;

create function public.connect_list_profiles(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'title', p.title, 'based_on', p.based_on, 'is_default', p.is_default,
                                                       'updated_at', p.updated_at) order by p.is_default desc, p.name)
                   from public.engine_profiles p where p.owner_id = me), '[]'::jsonb);
end $$;

-- p_name null = the person's default profile. null when there is none.
create function public.connect_get_profile(p_token_hash text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); r public.engine_profiles;
begin
  if p_name is not null and p_name !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$' then return null; end if;
  select * into r from public.engine_profiles p
    where p.owner_id = me and ((p_name is null and p.is_default) or (p_name is not null and p.name = p_name)) limit 1;
  if not found then return null; end if;
  return jsonb_build_object('spec', r.spec, 'is_default', r.is_default);
end $$;

create function public.connect_set_profile(p_token_hash text, p_spec jsonb, p_make_default boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'write'); id uuid;
begin
  -- The engine's own function, as the owner: it refuses an unknown key at any depth, a spec over 16 KB, a bad name, and a 21st profile.
  select public.set_engine_profile(p_spec, coalesce(p_make_default, false)) into id;
  return jsonb_build_object('name', p_spec ->> 'name');
end $$;

-- A free contact sheet of a profile applied to ENGINE's sample story, on the person's own "Profile preview (sample)" project.
-- The project, the story and the job all go through the connect functions above and the app's own submit_job, so everything that refuses a
-- costing job, a locked version or a second job in progress refuses here too.
create function public.connect_profile_sample_preview(p_token_hash text, p_story jsonb, p_periods text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'render_free'); pid uuid; vid uuid; st public.version_state; running uuid; job jsonb; nv public.versions;
begin
  if jsonb_typeof(p_story) is distinct from 'object' or octet_length(p_story::text) > 262144 then
    raise exception 'The sample story must be a JSON object of at most 256 KB.' using errcode = '22023';
  end if;
  select p.id into pid from public.projects p where p.owner_id = me and p.archived_at is null and p.title = 'Profile preview (sample)' order by p.created_at limit 1;
  if pid is null then
    insert into public.projects (owner_id, title) values (me, 'Profile preview (sample)') returning id into pid;
    select * into nv from public.create_version(pid);
    vid := nv.id;
  else
    select v.id, v.state into vid, st from public.versions v where v.project_id = pid and v.owner_id = me order by v.number desc limit 1;
    if st not in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
      select * into nv from public.create_version(pid, vid);       -- a finished version never becomes editable: work on a copy
      vid := nv.id;
    end if;
  end if;
  -- a sheet for this version is already waiting or running: that is the answer (never a second)
  select j.id into running from public.jobs j where j.version_id = vid and j.job_type = 'contact_sheet'
    and j.state in ('queued', 'claimed', 'running', 'validating', 'uploading') limit 1;
  if running is not null then return jsonb_build_object('job_id', running, 'project_id', pid); end if;
  update public.versions set story_spec = p_story where id = vid;
  job := public.connect_submit_job(p_token_hash, vid, 'contact_sheet', jsonb_build_object('periods', to_jsonb(p_periods)), null, null);
  return jsonb_build_object('job_id', job ->> 'id', 'project_id', pid);
end $$;

revoke all on function public.connect_list_profiles(text), public.connect_get_profile(text, text), public.connect_set_profile(text, jsonb, boolean),
  public.connect_profile_sample_preview(text, jsonb, text[]) from public, anon, authenticated, connect_runner;
grant execute on function public.connect_list_profiles(text), public.connect_get_profile(text, text), public.connect_set_profile(text, jsonb, boolean),
  public.connect_profile_sample_preview(text, jsonb, text[]) to connect_runner;

commit;
