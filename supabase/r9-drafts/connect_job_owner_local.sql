-- NEXT-CONNECT 101 (r9 M5, connector part). DRAFT, NEVER APPLIED, NOT TESTED AGAINST POSTGRES by CONNECT. For CC1 and WORKER.
-- Needs WORKER's r9_node_draft (jobs.run_on, public.node_tokens with user_id / computer_name / last_used_at / revoked_at / expires_at) to exist first.
-- Two CREATE OR REPLACE of the connector's own functions; each is the live body (20261018000100_connect_ai.sql) plus the lines marked r9.
-- What the tools do with it (tested in tests/connect-local-jobs.test.mjs against an in-memory stand-in): an owner_local job is described as waiting for the person's
-- Ryagram app on their computer, with the time any of their computers was last seen, and is never called failed for waiting.
-- The computer name is whatever the sign-in typed; the tools wrap it as untrusted text and cut it. No token, hash or id of a computer is returned.
-- Must-fails for the SQL test when it is written: (1) a person sees only THEIR OWN computers' last_seen (another owner's job returns null as before);
-- (2) a revoked or expired computer is not counted; (3) a house job returns run_on 'house', node null, and its queue_position as before.

create or replace function public.connect_job(p_token_hash text, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); j public.jobs;
begin
  select * into j from public.jobs where id = p_job and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', j.id, 'version_id', j.version_id, 'job_type', j.job_type, 'state', j.state, 'attempt', j.attempt,
    'created_at', j.created_at, 'story_sha256', j.story_sha256, 'engine_commit', j.engine_commit, 'error_class', j.error_class,
    'error_code', j.error_code, 'error_detail', j.error_detail, 'progress', j.progress, 'note', j.progress_note,
    'queue_position', case when j.run_on = 'owner_local' then null else public.queue_position(j.id) end,
    'run_on', j.run_on,                                                                  -- r9: WORKER's jobs.run_on
    'node', case when j.run_on = 'owner_local' then (                                    -- r9: when ANY of this person's signed-in computers last called the site, and what it calls itself
      select jsonb_build_object('last_seen_at', max(t.last_used_at),
        'computer_name', (select t2.computer_name from public.node_tokens t2
                          where t2.user_id = me and t2.revoked_at is null and t2.expires_at > now() order by t2.last_used_at desc nulls last limit 1))
      from public.node_tokens t where t.user_id = me and t.revoked_at is null and t.expires_at > now()) end);
end $$;

create or replace function public.connect_submit_job(p_token_hash text, p_version uuid, p_job_type text, p_params jsonb,
                                          p_sheet uuid, p_preview uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; j public.jobs;
begin
  if p_job_type = 'final_render' then
    -- Never started from a connection until PIPE's approve queue exists. (The tool says so in words.)
    me := ryagram_private.connect_actor(p_token_hash, 'render_final');
    raise exception 'Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.' using errcode = '42501';
  end if;
  if p_job_type not in ('contact_sheet', 'preview') then raise exception 'Unknown job type.' using errcode = '22023'; end if;
  me := ryagram_private.connect_actor(p_token_hash, 'render_free');
  -- "Free" means free: a connection cannot spend credits in v1, so a job that would cost any is refused here, whatever the AI sends.
  -- (The tool says so in words first.) Credits are spent only by the person, in the Ryagram app.
  if coalesce((public.connect_quote(p_token_hash, p_version, p_job_type) ->> 'credits')::int, 0) > 0 then
    raise exception 'This would cost credits. Credits can only be spent from the Ryagram app for now; start it there.' using errcode = '42501';
  end if;
  select * into j from public.submit_job(p_version, p_job_type::public.job_type, coalesce(p_params, '{}'::jsonb));   -- the app's function, as the owner
  -- The check above is a look before the act: two calls at once can both be quoted as free when only one free preview is left, and the second
  -- is then charged. So look at what the job was ACTUALLY charged (the app's own trigger fills credits_quoted inside submit_job); if it is
  -- above zero, raise: this runs in the same transaction, so the job and its hold are rolled back with it. (to_jsonb because the column
  -- exists only once the credits ledger is installed.)
  if coalesce((to_jsonb(j) ->> 'credits_quoted')::int, 0) > 0 then
    raise exception 'This would cost credits. Credits can only be spent from the Ryagram app for now; start it there.' using errcode = '42501';
  end if;
  return jsonb_build_object('id', j.id, 'state', j.state, 'run_on', j.run_on);                -- r9: the tool says 'will be made on your computer'
end $$;
