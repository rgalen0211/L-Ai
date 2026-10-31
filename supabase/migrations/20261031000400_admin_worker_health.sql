-- Worker health for Ryan's Operations screen (NEXT-WORKER 72). NOT APPLIED. For CC1's review first; Ryan applies it.
-- Needs 20261010000100_ops_readiness (workers.last_seen_at, free_gb, ops_settings), 20261017000600_pipe1_orders (require_admin) and
-- 20261021000100_r9_render_node (jobs.run_on). The page that reads it is behind the workerHealth switch (assets/ryagram-config.js), OFF.
--
--   admin_worker_health()   admin only (require_admin: an admin, from the app). One object:
--     checked_at, stale_after_s, claims_enabled, disabled_job_types, and per worker (enabled or not):
--       name, enabled, state ('off' | 'unknown' | 'ok' | 'delayed', the same rule as service_state), last_seen_at, free_gb,
--       running   the house job it holds now (type, state, claimed_at) or null,
--       last_claim_at, last_engine_commit (the newest house job it took that recorded a commit, with that job's end time).
--   Only house jobs (run_on = 'house'): a tester's own computer is on WEB's Tester computers page.
--   It reads job ids' types, states, times and commits only: no story, no owner, no person's data.
--
-- WHY NO PAUSE COLUMN: the worker's disk pause would arrive as worker_ping(p_free_gb, p_paused), which the live database does not have yet
-- (Ryagram worker-ping-paused sends p_paused only when its ping_paused switch is on, and falls back without it). The page derives the
-- likely reason instead (switched off, claims off, under the 10 GB floor as last reported, not checking in) and says it is derived.

begin;

create function public.admin_worker_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.ops_settings;
        c public.control;
begin
  perform ryagram_private.require_admin();
  select * into s from public.ops_settings where id;
  select * into c from public.control where id;
  return jsonb_build_object(
    'checked_at', now(),
    'stale_after_s', s.stale_after_s,
    'claims_enabled', c.claims_enabled,
    'disabled_job_types', to_jsonb(c.disabled_job_types),
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', w.name,
               'enabled', w.enabled,
               'state', case when not w.enabled then 'off'
                             when w.last_seen_at is null then 'unknown'
                             when w.last_seen_at > now() - make_interval(secs => s.stale_after_s) then 'ok'
                             else 'delayed' end,
               'last_seen_at', w.last_seen_at,
               'free_gb', w.free_gb,
               'running', (select jsonb_build_object('job_type', j.job_type, 'state', j.state, 'claimed_at', j.claimed_at)
                             from public.jobs j
                            where j.worker_user_id = w.user_id and j.run_on = 'house'
                              and j.state in ('claimed', 'running', 'validating', 'uploading')
                            order by j.claimed_at desc nulls last limit 1),
               'last_claim_at', (select max(j.claimed_at) from public.jobs j where j.worker_user_id = w.user_id and j.run_on = 'house'),
               'last_engine_commit', (select jsonb_build_object('commit', j.engine_commit, 'ended_at', j.ended_at)
                                        from public.jobs j
                                       where j.worker_user_id = w.user_id and j.run_on = 'house' and j.engine_commit is not null
                                       order by coalesce(j.ended_at, j.claimed_at) desc nulls last limit 1))
             order by w.name)
      from public.workers w), '[]'::jsonb));
end $$;

revoke all on function public.admin_worker_health() from public, anon;
grant execute on function public.admin_worker_health() to authenticated;      -- require_admin() refuses anyone but an admin

commit;
