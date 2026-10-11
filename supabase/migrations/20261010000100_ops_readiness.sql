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
  abuse_hide_per_reporter_day int not null default 3,
  backups_expected boolean not null default false,      -- Ryan sets true once the daily backup is installed: then a stale backup alerts
  backup_max_age_hours int not null default 48            -- newest good daily backup older than this = alert (Ryan, 2026-10-10: 2 days)
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
  perform ryagram_private.ai_budget_alerts();
  perform ryagram_private.backup_alerts();
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
  -- Stripe's needs_review count lives in phase-2b/stripe_test_mode.sql (not a migration yet); it is added once that is applied.
  return jsonb_build_object(
    'rendering', ryagram_private.service_state(),
    'last_check_in', (select max(last_seen_at) from public.workers),
    'free_gb', (select min(free_gb) from public.workers where enabled),
    'queued', (select count(*) from public.jobs where state = 'queued'),
    'running', (select count(*) from public.jobs where state in ('claimed', 'running', 'validating', 'uploading')),
    'oldest_queued_min', (select floor(extract(epoch from now() - min(created_at)) / 60) from public.jobs where state = 'queued'),
    'stuck', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'job_type', job_type, 'state', state, 'attempt', attempt, 'lease_expired_at', lease_expires_at)
                                         order by lease_expires_at)
                         from public.jobs where state in ('claimed', 'running', 'validating', 'uploading') and lease_expires_at < now()), '[]'::jsonb),
    -- Jobs that ended without a film in the last 7 days. Their credits are released by the ledger (failed, gate-stopped, or cancelled
    -- before they started); the per-job amounts live in the ledger, which the app shows to the owner.
    'ended', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'job_type', job_type, 'state', state, 'error_code', error_code, 'ended_at', ended_at)
                                        order by ended_at desc)
                        from (select * from public.jobs where state in ('failed', 'cancelled', 'editorial_action_required')
                                and ended_at > now() - interval '7 days' order by ended_at desc limit 20) e), '[]'::jsonb),
    'ai', ryagram_private.ai_budget() || jsonb_build_object('enabled', (select ai_enabled from public.control where id)),
    'outbox', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'kind', kind, 'mode', mode, 'subject', subject) order by id desc)
                          from (select * from public.ops_outbox order by id desc limit 10) o), '[]'::jsonb),
    'backups', jsonb_build_object(
      'expected', (select backups_expected from public.ops_settings),
      'last_daily_ok', (select max(created_at) from public.ops_backups where kind = 'daily' and ok),
      'last_daily_bytes', (select bytes from public.ops_backups where kind = 'daily' and ok order by created_at desc limit 1),
      'last_failure', (select max(created_at) from public.ops_backups where not ok),
      'last_restore_test', (select max(created_at) from public.ops_backups where kind = 'restore_test'),
      'last_restore_ok', (select ok from public.ops_backups where kind = 'restore_test' order by created_at desc limit 1)),
    'open_alerts', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'detail', detail, 'since', first_seen) order by first_seen)
                               from public.ops_alerts where resolved_at is null), '[]'::jsonb),
    'support_open', (select count(*) from public.support_requests where answered_at is null),
    'support', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'topic', topic, 'email', email, 'job_id', job_id,
                                                           'job_state', job_state, 'job_error_code', job_error_code, 'message', left(message, 300))
                                          order by id)
                           from (select * from public.support_requests where answered_at is null order by id limit 20) q), '[]'::jsonb),
    'abuse_waiting', (select count(*) from public.abuse_reports where reviewed_at is null),
    'abuse', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'slug', slug, 'reason', reason,
                                                         'auto_held', auto_held, 'details', left(details, 300)) order by id)
                         from (select * from public.abuse_reports where reviewed_at is null order by id limit 20) r), '[]'::jsonb));
end $$;

-- Ryan marks a ticket answered (he answers from his inbox; this only clears it from the queue and the 48-hour alert).
create function public.admin_answer_support(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can answer support requests.' using errcode = '42501';
  end if;
  update public.support_requests set answered_at = now() where id = p_id and answered_at is null;
  perform ryagram_private.ops_clear('support:' || p_id);
end $$;

-- ---------------------------------------------------------------- AI editor hard spend caps (Ryan, 2026-10-10)
-- Enforced here, in the database, BEFORE every Anthropic call (the Edge Function asks ai_budget_ok before each call). The
-- Anthropic console limit stays the outer wall. At 80% of a cap ONE alert is raised; at 100% the editor pauses with a friendly
-- message and the rest of the app (renders, library, account) is untouched. Spend = ai_usage.cost_usd. A call whose model has
-- NO price in ai_prices (cost_usd NULL) is counted at the MOST EXPENSIVE known price of each kind of token (never as 0, so a
-- missing price can only over-count and the caps stay safe), and one alert 'ai_price_missing:<model>' says to add the price.
alter table public.control
  add column ai_daily_usd_cap numeric not null default 5.00 check (ai_daily_usd_cap > 0),      -- New York calendar day
  add column ai_monthly_usd_cap numeric not null default 60.00 check (ai_monthly_usd_cap > 0), -- New York calendar month
  add column ai_project_cap_usd numeric not null default 5.00 check (ai_project_cap_usd > 0);  -- HARD limit per project;
                                                                                              -- ai_project_alert_usd (3.00) stays the early warning
create function ryagram_private.ai_row_cost(p_cost numeric, p_in int, p_out int, p_cr int, p_cw int) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(p_cost, (coalesce(p_in, 0) * max(input_per_mtok) + coalesce(p_out, 0) * max(output_per_mtok)
                           + coalesce(p_cr, 0) * max(cache_read_per_mtok) + coalesce(p_cw, 0) * max(cache_write_5m_per_mtok)) / 1000000.0)
  from public.ai_prices;
$$;

create function ryagram_private.ai_budget() returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select * from public.control where id),
  d as (select coalesce(sum(ryagram_private.ai_row_cost(cost_usd, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens)), 0) as spent from public.ai_usage
         where (created_at at time zone 'EST5EDT')::date = (now() at time zone 'EST5EDT')::date),
  m as (select coalesce(sum(ryagram_private.ai_row_cost(cost_usd, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens)), 0) as spent from public.ai_usage
         where date_trunc('month', created_at at time zone 'EST5EDT') = date_trunc('month', now() at time zone 'EST5EDT'))
  select jsonb_build_object(
    'day_spent', d.spent, 'day_cap', c.ai_daily_usd_cap, 'month_spent', m.spent, 'month_cap', c.ai_monthly_usd_cap,
    'day', to_char(now() at time zone 'EST5EDT', 'YYYY-MM-DD'), 'month', to_char(now() at time zone 'EST5EDT', 'YYYY-MM'),
    'state', case when d.spent >= c.ai_daily_usd_cap or m.spent >= c.ai_monthly_usd_cap then 'paused'
                  when d.spent >= 0.8 * c.ai_daily_usd_cap or m.spent >= 0.8 * c.ai_monthly_usd_cap then 'warn' else 'ok' end)
  from c, d, m;
$$;

-- One alert per cap per period (the key carries the day or month, so tomorrow can alert again).
create function ryagram_private.ai_budget_alerts() returns void
language plpgsql security definer set search_path = '' as $$
declare b jsonb := ryagram_private.ai_budget(); m text;
begin
  for m in select distinct u.model from public.ai_usage u
            where u.cost_usd is null and u.model is not null and u.input_tokens is not null
              and not exists (select 1 from public.ai_prices p where p.model = u.model)
  loop
    perform ryagram_private.ops_raise('ai_price_missing:' || m,
      'AI calls to model "' || m || '" have no price in ai_prices; they are counted at the most expensive known price. Add the price row.');
  end loop;
  if (b->>'day_spent')::numeric >= 0.8 * (b->>'day_cap')::numeric then
    perform ryagram_private.ops_raise('ai_day_80:' || (b->>'day'),
      'AI editor spend today is $' || round((b->>'day_spent')::numeric, 2) || ' of the $' || (b->>'day_cap') || ' daily cap (80% reached).');
  end if;
  if (b->>'day_spent')::numeric >= (b->>'day_cap')::numeric then
    perform ryagram_private.ops_raise('ai_day_100:' || (b->>'day'), 'The AI editor is PAUSED for today: the $' || (b->>'day_cap') || ' daily cap was reached.');
  end if;
  if (b->>'month_spent')::numeric >= 0.8 * (b->>'month_cap')::numeric then
    perform ryagram_private.ops_raise('ai_month_80:' || (b->>'month'),
      'AI editor spend this month is $' || round((b->>'month_spent')::numeric, 2) || ' of the $' || (b->>'month_cap') || ' monthly cap (80% reached).');
  end if;
  if (b->>'month_spent')::numeric >= (b->>'month_cap')::numeric then
    perform ryagram_private.ops_raise('ai_month_100:' || (b->>'month'), 'The AI editor is PAUSED for the month: the $' || (b->>'month_cap') || ' monthly cap was reached.');
  end if;
end $$;

create function ryagram_private.ai_project_spent(p_project uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(ryagram_private.ai_row_cost(cost_usd, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens)), 0) from public.ai_usage where project_id = p_project;
$$;

-- Same checks as 2A-8 plus the two cap kinds. (create or replace: this migration comes after 20260929000600.)
create or replace function public.ai_reserve_turn(p_owner uuid, p_session uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ctl public.control; s public.ai_sessions; turn uuid; b jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
  select * into ctl from public.control where id;
  if not ctl.ai_enabled then
    raise exception 'The AI editor is switched off.' using errcode = 'PT503';
  end if;
  b := ryagram_private.ai_budget();
  perform ryagram_private.ai_budget_alerts();
  if b->>'state' = 'paused' then
    raise exception 'The editor is paused to keep costs in check. It will be back soon. The rest of Ryagram works as usual.' using errcode = 'PT503';
  end if;
  select * into s from public.ai_sessions where id = p_session and owner_id = p_owner;
  if not found then
    raise exception 'Session not found.' using errcode = 'PT404';
  end if;
  if ryagram_private.ai_project_spent(s.project_id) >= ctl.ai_project_cap_usd then
    raise exception 'The editor has done a lot of work on this film. Please continue by hand, or write to ryagram@uselai.com.' using errcode = 'PT429';
  end if;
  if (select count(*) from public.ai_turns
      where owner_id = p_owner and created_at > now() - interval '24 hours') >= ctl.ai_turns_per_day then
    raise exception 'You have reached today''s limit for the editor. It resets over the next 24 hours.'
      using errcode = 'PT429';
  end if;
  insert into public.ai_turns (owner_id, session_id, project_id) values (p_owner, s.id, s.project_id)
    returning id into turn;
  return turn;
end $$;

-- Asked before EVERY Anthropic call in a turn (a turn can make several). false = do not call.
create function public.ai_budget_ok(p_turn uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t public.ai_turns; ctl public.control;
begin
  select * into t from public.ai_turns where id = p_turn and status = 'running';
  if not found then return false; end if;
  select * into ctl from public.control where id;
  perform ryagram_private.ai_budget_alerts();
  return ctl.ai_enabled and ryagram_private.ai_budget()->>'state' <> 'paused'
    and ryagram_private.ai_project_spent(t.project_id) < ctl.ai_project_cap_usd;
end $$;

-- ---------------------------------------------------------------- outbox and digest data (ops-tick / ops-digest)
-- Every message the ops functions send is recorded here. mode 'dry_run' = NOT sent, only written (until Ryan sets up email);
-- 'live' = handed to the real sender. Ryan can read dry-run mail in the Table Editor or #/admin/ops.
create table public.ops_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('alert', 'digest', 'ack')),
  mode text not null check (mode in ('dry_run', 'live')),
  to_addr text not null,
  subject text not null check (char_length(subject) <= 200),
  body text not null check (char_length(body) <= 20000),
  day text                                   -- New York day, set for digests: at most ONE digest per day
);
create unique index ops_outbox_one_digest_a_day on public.ops_outbox (day) where kind = 'digest';
alter table public.ops_outbox enable row level security;
revoke all on table public.ops_outbox from anon, authenticated, service_role;

-- Records a message. Returns false (and writes nothing) when a digest for that day already exists.
create function public.ops_outbox_add(p_kind text, p_mode text, p_to text, p_subject text, p_body text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare d text := case when p_kind = 'digest' then to_char(now() at time zone 'EST5EDT', 'YYYY-MM-DD') end;
begin
  insert into public.ops_outbox (kind, mode, to_addr, subject, body, day)
    values (p_kind, p_mode, p_to, left(p_subject, 200), left(p_body, 20000), d);
  return true;
exception when unique_violation then
  return false;
end $$;

-- What the daily digest says. {actionable: bool, items: [...], lines: [...]}: actionable is false when nothing needs Ryan, and
-- then the digest sends NOTHING. Resolved incidents are listed only as "back to normal" alongside real items.
create function public.ops_digest_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare items jsonb; recovered jsonb; sup int; ab int; b jsonb := ryagram_private.ai_budget();
begin
  select coalesce(jsonb_agg(detail order by first_seen), '[]'::jsonb) into items from public.ops_alerts where resolved_at is null;
  select coalesce(jsonb_agg(detail order by resolved_at), '[]'::jsonb) into recovered
    from public.ops_alerts where resolved_at > now() - interval '26 hours';
  select count(*) into sup from public.support_requests where answered_at is null;
  select count(*) into ab from public.abuse_reports where reviewed_at is null;
  return jsonb_build_object(
    'actionable', jsonb_array_length(items) > 0 or sup > 0 or ab > 0,
    'items', items, 'recovered', recovered, 'support_open', sup, 'abuse_waiting', ab,
    'rendering', ryagram_private.service_state(),
    'digest_sent_today', exists (select 1 from public.ops_outbox where kind = 'digest' and day = to_char(now() at time zone 'EST5EDT', 'YYYY-MM-DD')),
    'ai_day_spent', b->'day_spent', 'ai_day_cap', b->'day_cap', 'ai_month_spent', b->'month_spent', 'ai_month_cap', b->'month_cap');
end $$;

-- ---------------------------------------------------------------- backups report in (Ryan, 2026-10-10)
-- The daily pg_dump and the monthly restore test run on Ryan's PC (proposals/WEB-BACKUP-DESIGN.md) and report here through the
-- worker login already on that PC (require_worker, like worker_ping). Nothing about the data is sent: a kind, ok, a size, a short note.
create table public.ops_backups (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('daily', 'restore_test')),
  ok boolean not null,
  bytes bigint check (bytes >= 0),
  detail text not null default '' check (char_length(detail) <= 500)
);
alter table public.ops_backups enable row level security;
revoke all on table public.ops_backups from anon, authenticated, service_role;

create function public.record_backup(p_kind text, p_ok boolean, p_bytes bigint default null, p_detail text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers := ryagram_private.require_worker();
begin
  insert into public.ops_backups (kind, ok, bytes, detail) values (p_kind, p_ok, p_bytes, left(coalesce(p_detail, ''), 500));
end $$;

-- Alerts, once backups_expected is true: no good daily dump within backup_max_age_hours (2 days); the latest restore test failed;
-- or the oldest good dump is over 45 days old and no restore test has passed in 45 days.
create function ryagram_private.backup_alerts() returns void
language plpgsql security definer set search_path = '' as $$
declare s public.ops_settings; last_ok timestamptz; first_ok timestamptz; last_test record; last_test_ok timestamptz;
begin
  select * into s from public.ops_settings;
  if not s.backups_expected then
    perform ryagram_private.ops_clear('backup_stale'); perform ryagram_private.ops_clear('restore_test_failed');
    return;
  end if;
  select max(created_at), min(created_at) into last_ok, first_ok from public.ops_backups where kind = 'daily' and ok;
  if last_ok is null or last_ok < now() - make_interval(hours => s.backup_max_age_hours) then
    perform ryagram_private.ops_raise('backup_stale', 'No good database backup in the last ' || s.backup_max_age_hours / 24 || ' days'
      || case when last_ok is null then ' (none has ever been recorded).' else ' (the newest was ' || to_char(last_ok at time zone 'EST5EDT', 'Mon DD HH24:MI') || ').' end);
  else
    perform ryagram_private.ops_clear('backup_stale');
  end if;
  select * into last_test from public.ops_backups where kind = 'restore_test' order by created_at desc limit 1;
  select max(created_at) into last_test_ok from public.ops_backups where kind = 'restore_test' and ok;
  if (last_test.id is not null and not last_test.ok)
     or (first_ok is not null and first_ok < now() - interval '45 days' and coalesce(last_test_ok, '-infinity') < now() - interval '45 days') then
    perform ryagram_private.ops_raise('restore_test_failed', 'The monthly backup restore test failed or has not passed in 45 days.');
  else
    perform ryagram_private.ops_clear('restore_test_failed');
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.record_backup(text, boolean, bigint, text), public.admin_answer_support(bigint) from public, anon;
revoke execute on function ryagram_private.backup_alerts() from public, anon, authenticated;
revoke execute on function public.worker_ping(numeric), public.service_status(), public.ops_tick(), public.ops_mark_notified(text[]),
  public.submit_support(text, text, text, uuid, text), public.report_film_page(text, text, text, text, text),
  public.admin_review_report(bigint, text), public.admin_ops() from public, anon;
revoke execute on function public.ops_outbox_add(text, text, text, text, text), public.ops_digest_data() from public, anon, authenticated;
revoke execute on function ryagram_private.ai_row_cost(numeric, int, int, int, int), ryagram_private.ai_budget(), ryagram_private.ai_budget_alerts(), ryagram_private.ai_project_spent(uuid), public.ai_budget_ok(uuid) from public, anon, authenticated;
revoke execute on function ryagram_private.service_state(), ryagram_private.reap_lost_leases(), ryagram_private.expire_stale_queue(),
  ryagram_private.ops_raise(text, text), ryagram_private.ops_clear(text), ryagram_private.film_page_held() from public, anon, authenticated;
grant execute on function public.worker_ping(numeric), public.record_backup(text, boolean, bigint, text) to authenticated;                    -- require_worker() is the gate
grant execute on function public.service_status() to anon, authenticated;
grant execute on function public.submit_support(text, text, text, uuid, text), public.report_film_page(text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_review_report(bigint, text), public.admin_ops(), public.admin_answer_support(bigint) to authenticated;   -- is_app_admin() is the gate
grant execute on function public.ops_tick(), public.ops_mark_notified(text[]), public.ai_budget_ok(uuid),
  public.ops_outbox_add(text, text, text, text, text), public.ops_digest_data() to service_role;

commit;
