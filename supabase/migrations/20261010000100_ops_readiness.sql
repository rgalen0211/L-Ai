-- Hands-off operations (WEB, 2026-10-10). NOT APPLIED. For Claude's review first; Ryan applies it.
-- Design and audit: Ryagram-logs/proposals/WEB-OPS-READINESS.md. Needs the 2A core, film_pages and app_admins migrations.
--
--   worker_ping(free_gb)      the worker calls it once a minute (WORKER adds the call; until then status is 'unknown').
--   service_status()          anyone: 'ok' | 'delayed' | 'unknown' + the last check-in. Drives the "rendering is delayed" banner
--                             and the external monitor (public key only; it returns nothing private).
--   reap_lost_leases()        the lease-expiry block of claim_next_job, runnable WITHOUT a polling worker.
--   expire_stale_queue()      while the service is delayed, a job queued longer than ops_settings.queue_timeout_min is cancelled
--                             (it never started, so the ledger releases its hold: section 3a).
--   ops_alerts / ops_tick()   one row per incident; ops_tick() (run every 5 minutes by the ops-tick Edge Function) returns only
--                             the alerts that are NEW, so Ryan is told ONCE per incident.
--   submit_support(...)       help form intake with the job/receipt id attached; honeypot, length caps, rate limits.
--   report_film_page(...)     takedown/abuse intake; for the serious categories the page is held (hidden) at once, pending review.
--   admin_ops()               Ryan only: one summary for the Ops screen and the digest.
--
-- Nothing here reads a film's content or a person's data beyond what each function says.

begin;

-- ---------------------------------------------------------------- worker liveness
alter table public.workers add column last_seen_at timestamptz, add column free_gb numeric;

create function public.worker_ping(p_free_gb numeric default null) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  update public.workers set last_seen_at = now(), free_gb = coalesce(p_free_gb, free_gb) where user_id = w.user_id;
end $$;

create table public.ops_settings (
  id boolean primary key default true check (id),
  stale_after_s int not null default 180 check (stale_after_s >= 60),         -- no check-in this long = delayed
  queue_timeout_min int not null default 60 check (queue_timeout_min >= 10),  -- queued this long while delayed = cancelled and refunded
  support_reply_hours int not null default 48,
  abuse_hide_per_reporter_day int not null default 3
);
insert into public.ops_settings default values;
alter table public.ops_settings enable row level security;
revoke all on table public.ops_settings from anon, authenticated, service_role;      -- the dashboard (table owner) only

create function ryagram_private.service_state() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.workers where enabled and last_seen_at is not null) then 'unknown'   -- never pinged: no false alarm
    when exists (select 1 from public.workers w, public.ops_settings s
                  where w.enabled and w.last_seen_at > now() - make_interval(secs => s.stale_after_s)) then 'ok'
    else 'delayed' end;
$$;

create function public.service_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('rendering', ryagram_private.service_state(),
                            'last_check_in', (select max(last_seen_at) from public.workers where enabled));
$$;

-- ---------------------------------------------------------------- stuck jobs, even with no worker polling
-- Same rule as the top of claim_next_job (2A core): record the lost attempt, then retry (attempt < 3) or fail. The ledger trigger
-- releases the hold on failure. Returns how many jobs it put back or failed.
create function ryagram_private.reap_lost_leases() returns int
language plpgsql security definer set search_path = '' as $$
declare lost public.jobs; n int := 0;
begin
  for lost in
    select * from public.jobs
    where state in ('claimed', 'running', 'validating', 'uploading') and lease_expires_at < now()
    for update skip locked
  loop
    insert into public.job_metering (job_id, attempt, owner_id, project_id, version_id, job_type, error_code)
      values (lost.id, lost.attempt, lost.owner_id, lost.project_id, lost.version_id, lost.job_type, 'worker_lost')
      on conflict (job_id, attempt) do update set error_code = coalesce(public.job_metering.error_code, 'worker_lost');
    update public.jobs set
        state = case when lost.cancel_requested then 'cancelled'::public.job_state
                     when lost.attempt < 3 then 'queued'::public.job_state
                     else 'failed'::public.job_state end,
        attempt = case when not lost.cancel_requested and lost.attempt < 3 then lost.attempt + 1 else lost.attempt end,
        error_code = case when lost.cancel_requested then 'cancelled' else 'worker_lost' end,
        error_class = case when lost.cancel_requested then 'cancelled'::public.error_class
                           else 'infrastructure'::public.error_class end,
        error_detail = case when not lost.cancel_requested then 'The worker stopped responding.' end,
        ended_at = case when lost.cancel_requested or lost.attempt >= 3 then now() end,
        claimed_at = null, started_at = null, lease_expires_at = null, heartbeat_at = null,
        worker_id = null, worker_user_id = null, progress = null, progress_note = null
      where id = lost.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create function ryagram_private.expire_stale_queue() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if ryagram_private.service_state() <> 'delayed' then
    return 0;
  end if;
  with c as (
    update public.jobs j set state = 'cancelled', error_code = 'queue_timeout', error_class = 'cancelled',
           error_detail = 'Rendering was delayed, so this film was cancelled before it started. Your credits were returned.',
           ended_at = now()
      from public.ops_settings s
      where j.state = 'queued' and j.created_at < now() - make_interval(mins => s.queue_timeout_min)
      returning j.id)
  select count(*) into n from c;
  return n;
end $$;

-- ---------------------------------------------------------------- one alert per incident
create table public.ops_alerts (
  key text primary key,                        -- e.g. 'worker_stale', 'stuck_jobs', 'abuse_report:<id>'
  detail text not null default '',
  first_seen timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz
);
alter table public.ops_alerts enable row level security;
revoke all on table public.ops_alerts from anon, authenticated, service_role;

-- True only when this call opens a NEW incident (or reopens a resolved one): that is the only time anyone is told.
create function ryagram_private.ops_raise(p_key text, p_detail text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.ops_alerts;
begin
  select * into r from public.ops_alerts where key = p_key for update;
  if not found then
    insert into public.ops_alerts (key, detail) values (p_key, p_detail);
    return true;
  elsif r.resolved_at is not null then
    update public.ops_alerts set detail = p_detail, first_seen = now(), notified_at = null, resolved_at = null where key = p_key;
    return true;
  end if;
  return false;
end $$;

create function ryagram_private.ops_clear(p_key text) returns void
language sql security definer set search_path = '' as $$
  update public.ops_alerts set resolved_at = now() where key = p_key and resolved_at is null;
$$;

-- Run every 5 minutes (Edge Function ops-tick, service role). Returns {reaped, expired, new_alerts: [...]}; the caller emails the
-- new alerts once and then marks them notified.
create function public.ops_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  reaped int; expired int; st text; stuck int; sup int; ab int; s public.ops_settings;
begin
-- the scheduler only: execute is granted to service_role alone (below), like the other service functions.
  select * into s from public.ops_settings;
  reaped := ryagram_private.reap_lost_leases();
  st := ryagram_private.service_state();
  if st = 'delayed' then
    perform ryagram_private.ops_raise('worker_stale', 'Rendering has not checked in for over ' || s.stale_after_s / 60 || ' minutes.');
  else
    perform ryagram_private.ops_clear('worker_stale');
  end if;
  expired := ryagram_private.expire_stale_queue();
  select count(*) into stuck from public.jobs
    where state in ('claimed', 'running', 'validating', 'uploading') and lease_expires_at < now() - interval '15 minutes';
  if stuck > 0 then perform ryagram_private.ops_raise('stuck_jobs', stuck || ' jobs have an expired lease for 15+ minutes.');
  else perform ryagram_private.ops_clear('stuck_jobs'); end if;
  select count(*) into sup from public.support_requests
    where answered_at is null and created_at < now() - make_interval(hours => s.support_reply_hours);
  if sup > 0 then perform ryagram_private.ops_raise('support_overdue', sup || ' support requests are unanswered after ' || s.support_reply_hours || ' hours.');
  else perform ryagram_private.ops_clear('support_overdue'); end if;
  select count(*) into ab from public.abuse_reports where reviewed_at is null;
  if ab > 0 then perform ryagram_private.ops_raise('abuse_waiting', ab || ' abuse reports are waiting for review.');
  else perform ryagram_private.ops_clear('abuse_waiting'); end if;
  return jsonb_build_object('rendering', st, 'reaped', reaped, 'expired', expired,
    'new_alerts', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'detail', detail))
                              from public.ops_alerts where resolved_at is null and notified_at is null), '[]'::jsonb));
end $$;

create function public.ops_mark_notified(p_keys text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.ops_alerts set notified_at = now() where key = any (p_keys) and notified_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- support intake
create table public.support_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users (id) on delete set null,
  email text not null check (char_length(email) between 3 and 200 and email like '%_@_%'),
  topic text not null check (topic in ('render', 'credits', 'account', 'upload', 'other')),
  message text not null check (char_length(message) between 5 and 4000),
  job_id uuid,                                    -- attached when the person is signed in and owns it
  job_state text, job_error_code text,
  answered_at timestamptz
);
alter table public.support_requests enable row level security;
revoke all on table public.support_requests from anon, authenticated, service_role;

-- Returns the ticket number. A non-empty p_website is the honeypot: reported as success, stored nowhere.
create function public.submit_support(p_email text, p_topic text, p_message text, p_job uuid default null, p_website text default '')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); j public.jobs; r public.support_requests; recent int;
begin
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;
  select count(*) into recent from public.support_requests
    where created_at > now() - interval '1 hour' and (owner_id is not distinct from uid and uid is not null or lower(email) = lower(p_email));
  if recent >= 5 or (select count(*) from public.support_requests where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Too many requests. Please try again later.' using errcode = 'P0001';
  end if;
  if p_job is not null and uid is not null then
    select * into j from public.jobs where id = p_job and owner_id = uid;          -- only the person's own job; never its content
  end if;
  insert into public.support_requests (owner_id, email, topic, message, job_id, job_state, job_error_code)
    values (uid, trim(p_email), p_topic, trim(p_message), j.id, j.state::text, j.error_code)
    returning * into r;
  perform ryagram_private.ops_raise('support:' || r.id, 'New support request #' || r.id || ' (' || r.topic || ')');
  return r.id;
end $$;

-- ---------------------------------------------------------------- takedown / abuse intake
alter table public.film_pages add column held_at timestamptz;
create table public.abuse_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  slug text not null check (slug ~ '^[A-Za-z0-9_-]{22}$'),
  reason text not null check (reason in ('child_safety', 'private_information', 'harassment', 'copyright', 'other')),
  details text not null default '' check (char_length(details) <= 4000),
  reporter_email text not null check (char_length(reporter_email) between 3 and 200 and reporter_email like '%_@_%'),
  version_id uuid, auto_held boolean not null default false,
  reviewed_at timestamptz, outcome text check (outcome in ('restored', 'removed', 'dismissed'))
);
alter table public.abuse_reports enable row level security;
revoke all on table public.abuse_reports from anon, authenticated, service_role;

-- A held page cannot be republished by its owner; only the dashboard / admin_review_report clears it.
create function ryagram_private.film_page_held() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.held_at is not null and new.published then
    new.published := false;
  end if;
  return new;
end $$;
create trigger film_pages_held before insert or update on public.film_pages
  for each row execute function ryagram_private.film_page_held();

create function public.report_film_page(p_slug text, p_reason text, p_email text, p_details text default '', p_website text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare fp public.film_pages; hold boolean; held_today int; id bigint; s public.ops_settings;
begin
  if coalesce(p_website, '') <> '' then
    return;                                                                       -- honeypot
  end if;
  select * into s from public.ops_settings;
  select * into fp from public.film_pages where slug = p_slug;
  if not found then
    return;                                                                       -- same silence for a slug that does not exist
  end if;
  if (select count(*) from public.abuse_reports where lower(reporter_email) = lower(p_email) and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many reports. Please try again later.' using errcode = 'P0001';
  end if;
  hold := p_reason in ('child_safety', 'private_information', 'harassment', 'copyright') and fp.held_at is null and fp.owner_id is distinct from auth.uid();
  if hold then
    select count(*) into held_today from public.abuse_reports
      where lower(reporter_email) = lower(p_email) and auto_held and created_at > now() - interval '1 day';
    hold := held_today < s.abuse_hide_per_reporter_day;                           -- griefing guard: a few auto-hides a day per reporter
  end if;
  insert into public.abuse_reports (slug, reason, details, reporter_email, version_id, auto_held)
    values (p_slug, p_reason, coalesce(p_details, ''), trim(p_email), fp.version_id, hold) returning abuse_reports.id into id;
  if hold then
    update public.film_pages set held_at = now(), published = false where slug = p_slug;
  end if;
  perform ryagram_private.ops_raise('abuse:' || id, 'Abuse report #' || id || ' (' || p_reason || ')' || case when hold then ' - page held' else '' end);
end $$;

-- Ryan decides. 'restored' lifts the hold (the owner may republish); 'removed' deletes the page; 'dismissed' = no action needed.
create function public.admin_review_report(p_id bigint, p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.abuse_reports;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can review reports.' using errcode = '42501';
  end if;
  select * into r from public.abuse_reports where id = p_id;
  if not found or p_outcome not in ('restored', 'removed', 'dismissed') then
    raise exception 'No such report or outcome.' using errcode = 'P0001';
  end if;
  update public.abuse_reports set reviewed_at = now(), outcome = p_outcome where id = p_id;
  if p_outcome = 'removed' then
    delete from public.film_pages where slug = r.slug;
  elsif p_outcome in ('restored', 'dismissed') then
    update public.film_pages set held_at = null where slug = r.slug;
  end if;
  perform ryagram_private.ops_clear('abuse:' || p_id);
end $$;

-- ---------------------------------------------------------------- Ryan's summary
create function public.admin_ops() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see operations.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rendering', ryagram_private.service_state(),
    'last_check_in', (select max(last_seen_at) from public.workers),
    'free_gb', (select min(free_gb) from public.workers where enabled),
    'queued', (select count(*) from public.jobs where state = 'queued'),
    'running', (select count(*) from public.jobs where state in ('claimed', 'running', 'validating', 'uploading')),
    'open_alerts', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'detail', detail, 'since', first_seen) order by first_seen)
                               from public.ops_alerts where resolved_at is null), '[]'::jsonb),
    'support_open', (select count(*) from public.support_requests where answered_at is null),
    'abuse_waiting', (select count(*) from public.abuse_reports where reviewed_at is null));
  -- Stripe's needs_review count lives in phase-2b/stripe_test_mode.sql (not a migration yet); the digest reads it once that is applied.
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.worker_ping(numeric), public.service_status(), public.ops_tick(), public.ops_mark_notified(text[]),
  public.submit_support(text, text, text, uuid, text), public.report_film_page(text, text, text, text, text),
  public.admin_review_report(bigint, text), public.admin_ops() from public, anon;
revoke execute on function ryagram_private.service_state(), ryagram_private.reap_lost_leases(), ryagram_private.expire_stale_queue(),
  ryagram_private.ops_raise(text, text), ryagram_private.ops_clear(text), ryagram_private.film_page_held() from public, anon, authenticated;
grant execute on function public.worker_ping(numeric) to authenticated;                    -- require_worker() is the gate
grant execute on function public.service_status() to anon, authenticated;
grant execute on function public.submit_support(text, text, text, uuid, text), public.report_film_page(text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_review_report(bigint, text), public.admin_ops() to authenticated;   -- is_app_admin() is the gate
grant execute on function public.ops_tick(), public.ops_mark_notified(text[]) to service_role;

commit;
