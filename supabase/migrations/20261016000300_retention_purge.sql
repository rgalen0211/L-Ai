-- Retention purge (Ryan, 2026-10-16): the promises the Privacy Policy makes, kept by a job that actually deletes. Review only; nothing here is applied by the web session.
--   * creator beta applications: 12 months after the decision (decided_at), together with the invite code made for them (its label holds the person's name and its
--     redemption holds their email) and the scrambled address value stored in the application row;
--   * help requests: 3 years after they were answered;
--   * reports (abuse_reports): 3 years after they were reviewed, EXCEPT child-safety reports, which are NEVER deleted by this job (they are kept as the law's
--     preservation requirements say: counsel to confirm the rule, then change it here if it needs a period);
--   * an application nobody has decided, a report nobody has reviewed and a request nobody has answered are never touched: they still need Ryan.
-- Apply AFTER 20261010000100_ops_readiness.sql, 20261014000100_creator_beta.sql, 20261016000200_creator_flow.sql (it removes invite codes by their label) and
-- 20261003000200_invite_codes.sql. The ops-tick function calls retention_purge() every minute; the function does real work once per New York day.

create table public.retention_runs (
  id boolean primary key default true check (id),
  last_run_on date
);
insert into public.retention_runs default values;
alter table public.retention_runs enable row level security;
revoke all on table public.retention_runs from anon, authenticated, service_role;

-- Service role only (the ops-tick Edge Function). Returns what it removed, or {skipped: true} when today's run is done.
create function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; apps int := 0; codes int := 0; helps int := 0; reps int := 0; ids bigint[];
begin
  perform pg_advisory_xact_lock(hashtext('retention_purge'));
  if (select last_run_on from public.retention_runs) = today then
    return jsonb_build_object('skipped', true);
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.creator_applications where decided_at is not null and decided_at < now() - interval '12 months';
  if cardinality(ids) > 0 then
    delete from public.invite_codes where exists (select 1 from unnest(ids) i where invite_codes.label like 'creator #' || i || ' %');   -- redemptions go with them (on delete cascade)
    get diagnostics codes = row_count;
    delete from public.creator_applications where id = any (ids);
    get diagnostics apps = row_count;
    delete from public.ops_alerts where key in (select 'creator:' || i from unnest(ids) i);
  end if;
  delete from public.support_requests where answered_at is not null and answered_at < now() - interval '3 years';
  get diagnostics helps = row_count;
  delete from public.abuse_reports where reason <> 'child_safety' and reviewed_at is not null and reviewed_at < now() - interval '3 years';
  get diagnostics reps = row_count;
  update public.retention_runs set last_run_on = today;
  return jsonb_build_object('skipped', false, 'applications', apps, 'invite_codes', codes, 'help_requests', helps, 'reports', reps);
end $$;

revoke execute on function public.retention_purge() from public, anon, authenticated;
grant execute on function public.retention_purge() to service_role;
