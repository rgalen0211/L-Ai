-- Cost ledger (Ryan, 2026-10-16): every $-bearing event in one closed table, a daily rollup and alarms for #/admin/ops, thresholds Ryan sets.
-- Apply AFTER 20261010000100_ops_readiness.sql (it uses that file's alert ledger and is_app_admin) and after the 2A core (job_metering, artifacts).
-- Review only; nothing here is applied by the web session. Design and Ryan's setup steps: proposals/WEB-COST-LEDGER.md and supabase/README.md.
--
-- Rules this file keeps:
--   * amount_usd NULL means UNKNOWN. It is never added as zero: the rollup shows the known sum AND how many events have an unknown cost.
--   * mode: 'live' (real money), 'test' (Stripe test mode, synthetic lines) or 'unknown' (the source gave NO live/test flag, Ryan 2026-10-16). Only 'live' is
--     ever counted as money or toward an alarm; 'test' and 'unknown' are recorded and shown apart. A missing flag is never defaulted to live.
--   * The tables are closed to every role (RLS on, every grant revoked, service_role included). The writers are the functions below:
--     service-role only for the automatic ones, is_app_admin() for Ryan's.
--   * Nothing here can spend or move money. It only records and alerts.

create table public.cost_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  vendor text not null check (vendor in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other')),
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),        -- stripe_fee, email_sent, storage_gauge, plan_fee, render_compute, manual_invoice ...
  amount_usd numeric(14, 6) check (amount_usd >= 0),          -- NULL = UNKNOWN
  quantity numeric check (quantity >= 0),                      -- what the cost was for: dollars charged on, emails, bytes, cpu seconds, days
  unit text check (unit is null or char_length(unit) <= 20),
  mode text not null default 'unknown' check (mode in ('live', 'test', 'unknown')),
  ref text not null check (char_length(ref) between 1 and 200),   -- the source's own id: txn_..., day:2026-10-16, job:<id>:<attempt>, plan:<id>:<date>
  detail jsonb not null default '{}' check (pg_column_size(detail) <= 6000),
  unique (vendor, kind, ref, mode)
);
create index cost_events_time_idx on public.cost_events (occurred_at);
alter table public.cost_events enable row level security;
revoke all on table public.cost_events from anon, authenticated, service_role;

-- A plan Ryan pays for (Supabase Pro, Resend Pro, Workspace ...). Accrued per day as monthly_usd / days in that month.
create table public.cost_plans (
  id bigint generated always as identity primary key,
  vendor text not null check (vendor in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other')),
  plan text not null check (char_length(plan) between 1 and 60),
  monthly_usd numeric(10, 2) not null check (monthly_usd >= 0),
  starts_on date not null,
  ends_on date,
  included jsonb not null default '{}' check (pg_column_size(included) <= 600),   -- e.g. {"storage_gb": 100}: lets the storage gauge price its overage
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
alter table public.cost_plans enable row level security;
revoke all on table public.cost_plans from anon, authenticated, service_role;

-- A unit price Ryan states (e.g. render / cpu_hour = what one core-hour costs him). Without one, those events stay UNKNOWN.
create table public.cost_rates (
  vendor text not null check (vendor in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other')),
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  unit_usd numeric(14, 8) not null check (unit_usd >= 0),
  note text not null default '' check (char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (vendor, kind)
);
alter table public.cost_rates enable row level security;
revoke all on table public.cost_rates from anon, authenticated, service_role;

-- The limits Ryan sets. vendor NULL = everything. period 'day' / 'month' are New York calendar periods.
create table public.cost_thresholds (
  id bigint generated always as identity primary key,
  vendor text check (vendor is null or vendor in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other')),
  period text not null check (period in ('day', 'month')),
  limit_usd numeric(10, 2) not null check (limit_usd > 0),
  warn_pct int not null default 80 check (warn_pct between 1 and 99),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index cost_thresholds_scope_key on public.cost_thresholds (coalesce(vendor, '*'), period);
alter table public.cost_thresholds enable row level security;
revoke all on table public.cost_thresholds from anon, authenticated, service_role;

-- Ryan's starting decisions (2026-10-16), as data he can change on #/admin/ops: ALERTS ONLY (nothing here can block or stop anything), $5 a day and
-- $50 a month across every vendor, warning at 80%; and renders on his own PC cost $0 in cash (the cloud rate comes later, from BUILDER's trial).
insert into public.cost_thresholds (vendor, period, limit_usd, warn_pct)
  select null, 'day', 5, 80 where not exists (select 1 from public.cost_thresholds where vendor is null and period = 'day');
insert into public.cost_thresholds (vendor, period, limit_usd, warn_pct)
  select null, 'month', 50, 80 where not exists (select 1 from public.cost_thresholds where vendor is null and period = 'month');
insert into public.cost_rates (vendor, kind, unit_usd, note)
  values ('render', 'cpu_hour', 0, 'Ryan 2026-10-16: $0 in cash for renders on his own PC; the cloud rate comes from BUILDER''s trial')
  on conflict (vendor, kind) do nothing;

-- The sync function's bookmark (where the Stripe pull got to).
create table public.cost_sync_state (
  key text primary key check (char_length(key) <= 60),
  value text not null check (char_length(value) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.cost_sync_state enable row level security;
revoke all on table public.cost_sync_state from anon, authenticated, service_role;

create view ryagram_private.cost_events_day as
  select e.*, (e.occurred_at at time zone 'EST5EDT')::date as day from public.cost_events e;
revoke all on ryagram_private.cost_events_day from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- recording (service role only)

-- Events from outside (the cost-sync function: Stripe's balance transactions). Idempotent on (vendor, kind, ref, mode). The JSON field livemode (true / false) sets the mode; anything else, or no field, is 'unknown'.
-- Returns how many were NEW.
create function public.cost_record_events(p_events jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare e jsonb; n int := 0; ins int;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Events must be a list.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'Too many events in one call.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
      values ((e->>'occurred_at')::timestamptz, e->>'vendor', e->>'kind', (e->>'amount_usd')::numeric, (e->>'quantity')::numeric, e->>'unit',
              case when e->'livemode' = 'true'::jsonb then 'live' when e->'livemode' = 'false'::jsonb then 'test' else 'unknown' end, e->>'ref', coalesce(e->'detail', '{}'::jsonb))
      on conflict (vendor, kind, ref, mode) do nothing;
    get diagnostics ins = row_count;
    n := n + ins;
  end loop;
  return n;
end $$;

-- Render cost lines from the engine's renders.jsonl (BUILDER's cost_meter). The exact line format is NOT defined yet (UNKNOWN: BUILDER has not
-- published it), so this takes the fields below, all optional except an id, stores the whole raw line, and ignores anything else:
--   render_id (text, REQUIRED, the line's own id)  finished_at (ISO time)  wall_s  cpu_s  or  cpu_user_s + cpu_kernel_s  cost_usd  job_id
-- A line with a job_id is SKIPPED: the app's jobs are already recorded from job_metering, and counting both would double the cost.
-- amount: the line's own cost_usd when present, else cpu_s / 3600 x the render / cpu_hour rate Ryan set, else UNKNOWN.
create function public.cost_ingest_render_meter(p_lines jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare l jsonb; n int := 0; ins int; cpu numeric; amt numeric; rate numeric;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 500 then
    raise exception 'Lines must be a list of at most 500.' using errcode = 'P0001';
  end if;
  select unit_usd into rate from public.cost_rates where vendor = 'render' and kind = 'cpu_hour';
  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) is distinct from 'object' or coalesce(l->>'render_id', '') = '' or l ? 'job_id' and coalesce(l->>'job_id', '') <> '' then
      continue;
    end if;
    cpu := coalesce((l->>'cpu_s')::numeric, coalesce((l->>'cpu_user_s')::numeric, 0) + coalesce((l->>'cpu_kernel_s')::numeric, 0));
    amt := case when l->>'cost_usd' is not null then (l->>'cost_usd')::numeric
                when rate is not null and cpu is not null and cpu > 0 then round(cpu / 3600.0 * rate, 6) end;
    insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
      values (coalesce((l->>'finished_at')::timestamptz, now()), 'render', 'render_compute', amt, nullif(cpu, 0), case when cpu > 0 then 'cpu_s' end, 'live',
              'meter:' || left(l->>'render_id', 150),
              jsonb_build_object('source', 'renders_jsonl', 'wall_s', (l->>'wall_s')::numeric, 'raw', left(l::text, 3500)))
      on conflict (vendor, kind, ref, mode) do nothing;
    get diagnostics ins = row_count;
    n := n + ins;
  end loop;
  return n;
end $$;

-- What counts toward a limit, in ONE place (the alarms and the screen both use it): LIVE-mode events only, known amounts summed, unknown-cost
-- charges counted separately (a usage reading is not a charge), for this New York day or month.
create function ryagram_private.cost_spent(p_vendor text, p_period text, p_today date) returns table (spent numeric, unk_n int)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(e.amount_usd), 0), (count(*) filter (where e.amount_usd is null and e.kind not in ('email_sent', 'storage_gauge')))::int
    from ryagram_private.cost_events_day e
   where e.mode = 'live' and (p_vendor is null or e.vendor = p_vendor)
     and case p_period when 'day' then e.day = p_today else date_trunc('month', e.day::timestamp) = date_trunc('month', p_today::timestamp) end
$$;
revoke all on function ryagram_private.cost_spent(text, text, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the periodic pass (service role only; the cost-sync function calls it)

create function ryagram_private.cost_alarms() returns int
language plpgsql security definer set search_path = '' as $$
declare t public.cost_thresholds; today date := (now() at time zone 'EST5EDT')::date; pk text; spent numeric; unk int; raised int := 0;
        label text; a record; keep boolean;
begin
  for t in select * from public.cost_thresholds where enabled loop
    pk := case t.period when 'day' then today::text else to_char(today, 'YYYY-MM') end;
    select c.spent, c.unk_n into spent, unk from ryagram_private.cost_spent(t.vendor, t.period, today) c;
    label := (case t.period when 'day' then 'today''s' else 'this month''s' end) || ' spend' || case when t.vendor is null then '' else ' on ' || t.vendor end;
    if spent >= t.limit_usd then
      if ryagram_private.ops_raise('cost:' || t.id || ':over:' || pk,
           'Cost alarm: ' || label || ' is $' || to_char(spent, 'FM999990.00') || ', over your $' || to_char(t.limit_usd, 'FM999990.00') || ' limit.'
           || case when unk > 0 then ' (' || unk || ' events have an unknown cost and are not counted.)' else '' end) then raised := raised + 1; end if;
    elsif spent >= t.limit_usd * t.warn_pct / 100.0 then
      if ryagram_private.ops_raise('cost:' || t.id || ':warn:' || pk,
           'Cost warning: ' || label || ' is $' || to_char(spent, 'FM999990.00') || ', ' || t.warn_pct || '% of your $' || to_char(t.limit_usd, 'FM999990.00') || ' limit.'
           || case when unk > 0 then ' (' || unk || ' events have an unknown cost and are not counted.)' else '' end) then raised := raised + 1; end if;
    end if;
  end loop;
  -- Clear alerts of a past period, a deleted or disabled threshold, or a warning that was replaced by the over-limit alert.
  for a in select key from public.ops_alerts where key like 'cost:%' and resolved_at is null loop
    select * into t from public.cost_thresholds where id = nullif(split_part(a.key, ':', 2), '')::bigint and enabled;
    keep := found and split_part(a.key, ':', 4) = case t.period when 'day' then today::text else to_char(today, 'YYYY-MM') end;
    if keep then
      select c.spent into spent from ryagram_private.cost_spent(t.vendor, t.period, today) c;
      keep := case split_part(a.key, ':', 3) when 'over' then spent >= t.limit_usd
                                              else spent < t.limit_usd and spent >= t.limit_usd * t.warn_pct / 100.0 end;
    end if;
    if not keep then perform ryagram_private.ops_clear(a.key); end if;
  end loop;
  return raised;
end $$;

create function public.cost_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; plan_rows int; render_rows int; revalued int := 0; gb numeric; incl numeric; srate numeric;
        dim numeric; emails int; d date; raised int;
begin
  -- 1. plan fees, accrued one day at a time (monthly price / days in that month), the last 35 days at most; re-runs add nothing.
  insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
    select ((s.d::timestamp + interval '12 hours') at time zone 'EST5EDT'), s.vendor, 'plan_fee',
           round(s.monthly_usd / extract(day from (date_trunc('month', s.d::timestamp) + interval '1 month' - interval '1 day'))::numeric, 6), 1, 'day', 'live',
           'plan:' || s.id || ':' || s.d::text, jsonb_build_object('plan', s.plan, 'monthly_usd', s.monthly_usd, 'accrued', true)
    from (select p.id, p.vendor, p.plan, p.monthly_usd, greatest(p.starts_on, today - 35) + i as d
            from public.cost_plans p
            cross join lateral generate_series(0, least(coalesce(p.ends_on, today), today) - greatest(p.starts_on, today - 35)) i) s
    on conflict (vendor, kind, ref, mode) do nothing;
  get diagnostics plan_rows = row_count;

  -- 2. the app's renders, from job_metering (cpu seconds); priced only when Ryan has stated a render / cpu_hour rate, else UNKNOWN.
  insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
    select m.recorded_at, 'render', 'render_compute',
           case when r.unit_usd is not null then round((coalesce(m.cpu_user_s, 0) + coalesce(m.cpu_kernel_s, 0)) / 3600.0 * r.unit_usd, 6) end,
           coalesce(m.cpu_user_s, 0) + coalesce(m.cpu_kernel_s, 0), 'cpu_s', 'live', 'job:' || m.job_id || ':' || m.attempt,
           jsonb_build_object('source', 'job_metering', 'job_type', m.job_type, 'wall_s', m.wall_s, 'encode_s', m.encode_s)
    from public.job_metering m left join public.cost_rates r on r.vendor = 'render' and r.kind = 'cpu_hour'
    where m.recorded_at > now() - interval '35 days' and (m.cpu_user_s is not null or m.cpu_kernel_s is not null)
    on conflict (vendor, kind, ref, mode) do nothing;
  get diagnostics render_rows = row_count;
  -- Ryan states the rate after the fact: price the render events that were UNKNOWN (and say so in the row).
  update public.cost_events e set amount_usd = round(e.quantity / 3600.0 * r.unit_usd, 6), detail = e.detail || jsonb_build_object('priced_later_at', now())
    from public.cost_rates r
    where r.vendor = 'render' and r.kind = 'cpu_hour' and e.vendor = 'render' and e.kind = 'render_compute' and e.amount_usd is null and e.quantity is not null;
  get diagnostics revalued = row_count;

  -- 3. daily gauges: emails our own ops mail really sent (alerts and digests; the sign-up emails go through Supabase and Resend and are NOT counted here),
  --    and the bytes of stored films.
  for d in select today - 1 union all select today loop
    select count(*) into emails from public.ops_outbox where mode = 'live' and (created_at at time zone 'EST5EDT')::date = d;
    insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
      values (((d::timestamp + interval '12 hours') at time zone 'EST5EDT'), 'resend', 'email_sent', null, emails, 'emails', 'live', 'day:' || d::text,
              jsonb_build_object('source', 'ops_outbox live rows only', 'note', 'covered by the plan fee; overage unknown'))
      on conflict (vendor, kind, ref, mode) do update set quantity = excluded.quantity, recorded_at = now();
  end loop;
  select coalesce(sum(bytes), 0) / 1073741824.0 into gb from public.artifacts where deleted_at is null;
  select nullif(p.included->>'storage_gb', '')::numeric into incl from public.cost_plans p
    where p.vendor = 'supabase' and p.starts_on <= today and (p.ends_on is null or p.ends_on >= today) order by p.starts_on desc limit 1;
  select unit_usd into srate from public.cost_rates where vendor = 'supabase' and kind = 'storage_gb_month';
  dim := extract(day from (date_trunc('month', today::timestamp) + interval '1 month' - interval '1 day'));
  insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
    values (((today::timestamp + interval '12 hours') at time zone 'EST5EDT'), 'supabase', 'storage_gauge',
            case when incl is not null and gb <= incl then 0
                 when incl is not null and srate is not null then round((gb - incl) * srate / dim, 6) end,
            round((gb * 1073741824.0)::numeric), 'bytes', 'live', 'day:' || today::text,
            jsonb_build_object('source', 'artifacts (films, sheets, previews) only; uploaded datasets are not counted', 'included_gb', incl, 'overage_rate_per_gb_month', srate))
    on conflict (vendor, kind, ref, mode) do update set amount_usd = excluded.amount_usd, quantity = excluded.quantity, detail = excluded.detail, recorded_at = now();

  raised := ryagram_private.cost_alarms();
  return jsonb_build_object('plan_fee_rows', plan_rows, 'render_rows', render_rows, 'render_priced_later', revalued, 'emails_today', emails, 'storage_gb', round(gb, 3), 'alarms_raised', raised);
end $$;

-- The sync function's bookmark for the Stripe pull.
create function public.cost_sync_get(p_key text) returns text
language sql stable security definer set search_path = '' as $$ select value from public.cost_sync_state where key = p_key $$;
create function public.cost_sync_set(p_key text, p_value text) returns void
language sql security definer set search_path = '' as $$
  insert into public.cost_sync_state (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value, updated_at = now() $$;

-- ---------------------------------------------------------------- Ryan's screen and settings (is_app_admin is the gate)

create function public.admin_cost_rollup(p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; n int := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see costs.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', today,
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'total_usd', coalesce(x.total, 0), 'unknown_events', coalesce(x.unk, 0),
                                                         'by_vendor', coalesce(x.bv, '{}'::jsonb)) order by g.day desc)
                        from (select today - i as day from generate_series(0, n - 1) i) g
                        left join lateral (
                          select sum(e.amount_usd) as total, count(*) filter (where e.amount_usd is null and e.kind not in ('email_sent', 'storage_gauge')) as unk,
                                 (select jsonb_object_agg(q.vendor, q.s) from (select vendor, sum(amount_usd) as s from ryagram_private.cost_events_day
                                    where day = g.day and mode = 'live' group by vendor having sum(amount_usd) is not null) q) as bv
                          from ryagram_private.cost_events_day e where e.day = g.day and e.mode = 'live') x on true), '[]'::jsonb),
    'month', (select jsonb_build_object('key', to_char(today, 'YYYY-MM'), 'total_usd', coalesce(sum(amount_usd), 0), 'unknown_events', count(*) filter (where amount_usd is null and kind not in ('email_sent', 'storage_gauge')),
                     'by_vendor', coalesce((select jsonb_object_agg(q.vendor, q.s) from (select vendor, sum(amount_usd) as s from ryagram_private.cost_events_day
                        where mode = 'live' and date_trunc('month', day::timestamp) = date_trunc('month', today::timestamp) group by vendor having sum(amount_usd) is not null) q), '{}'::jsonb))
                from ryagram_private.cost_events_day where mode = 'live' and date_trunc('month', day::timestamp) = date_trunc('month', today::timestamp)),
    'usage', jsonb_build_object(
      'emails_today', (select quantity from public.cost_events where vendor = 'resend' and kind = 'email_sent' and mode = 'live' and ref = 'day:' || today::text),
      'storage_bytes', (select quantity from public.cost_events where vendor = 'supabase' and kind = 'storage_gauge' and mode = 'live' order by occurred_at desc limit 1)),
    'test', (select jsonb_build_object('events', count(*), 'total_usd', coalesce(sum(amount_usd), 0)) from ryagram_private.cost_events_day
               where mode = 'test' and date_trunc('month', day::timestamp) = date_trunc('month', today::timestamp)),
    'unknown_mode', (select jsonb_build_object('events', count(*), 'total_usd', coalesce(sum(amount_usd), 0)) from ryagram_private.cost_events_day
               where mode = 'unknown' and date_trunc('month', day::timestamp) = date_trunc('month', today::timestamp)),
    'thresholds', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'vendor', t.vendor, 'period', t.period, 'limit_usd', t.limit_usd, 'warn_pct', t.warn_pct, 'enabled', t.enabled,
                     'spent_usd', s.spent, 'status', case when not t.enabled then 'off' when s.spent >= t.limit_usd then 'over' when s.spent >= t.limit_usd * t.warn_pct / 100.0 then 'warn' else 'ok' end)
                     order by t.period, t.vendor nulls first)
                    from public.cost_thresholds t
                    cross join lateral (select c.spent from ryagram_private.cost_spent(t.vendor, t.period, today) c) s), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'vendor', vendor, 'plan', plan, 'monthly_usd', monthly_usd, 'starts_on', starts_on, 'ends_on', ends_on, 'included', included)
                         order by vendor, starts_on desc) from public.cost_plans where ends_on is null or ends_on >= today), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('vendor', vendor, 'kind', kind, 'unit_usd', unit_usd, 'note', note) order by vendor, kind) from public.cost_rates), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'occurred_at', occurred_at, 'vendor', vendor, 'kind', kind, 'amount_usd', amount_usd, 'quantity', quantity,
                         'unit', unit, 'mode', mode) order by id desc)
                         from (select * from public.cost_events order by id desc limit 15) r), '[]'::jsonb));
end $$;

create function public.admin_cost_set_threshold(p_vendor text, p_period text, p_limit_usd numeric, p_warn_pct int default 80) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(trim(coalesce(p_vendor, '')), ''); id bigint;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can set cost limits.' using errcode = '42501';
  end if;
  if p_period not in ('day', 'month') then raise exception 'Choose day or month.' using errcode = 'P0001'; end if;
  if p_limit_usd is null or p_limit_usd <= 0 or p_limit_usd > 100000 then raise exception 'The limit must be more than $0.' using errcode = 'P0001'; end if;
  if p_warn_pct is null or p_warn_pct not between 1 and 99 then raise exception 'The warning percentage must be 1 to 99.' using errcode = 'P0001'; end if;
  if v is not null and v not in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other') then raise exception 'Unknown vendor.' using errcode = 'P0001'; end if;
  update public.cost_thresholds set limit_usd = round(p_limit_usd, 2), warn_pct = p_warn_pct, enabled = true
    where coalesce(vendor, '*') = coalesce(v, '*') and period = p_period returning cost_thresholds.id into id;
  if id is null then
    insert into public.cost_thresholds (vendor, period, limit_usd, warn_pct) values (v, p_period, round(p_limit_usd, 2), p_warn_pct) returning cost_thresholds.id into id;
  end if;
  perform ryagram_private.cost_alarms();
  return id;
end $$;

create function public.admin_cost_delete_threshold(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can remove cost limits.' using errcode = '42501';
  end if;
  delete from public.cost_thresholds where id = p_id;
  perform ryagram_private.cost_alarms();
end $$;

-- Ryan states what he pays for a plan from a date (the previous plan of that vendor ends the day before).
create function public.admin_cost_set_plan(p_vendor text, p_plan text, p_monthly_usd numeric, p_starts_on date, p_included jsonb default '{}') returns bigint
language plpgsql security definer set search_path = '' as $$
declare id bigint;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can set plans.' using errcode = '42501';
  end if;
  if p_vendor not in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other') then raise exception 'Unknown vendor.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_plan), '') = '' or char_length(p_plan) > 60 then raise exception 'Name the plan.' using errcode = 'P0001'; end if;
  if p_monthly_usd is null or p_monthly_usd < 0 or p_monthly_usd > 100000 then raise exception 'Enter the monthly price in dollars.' using errcode = 'P0001'; end if;
  if p_starts_on is null then raise exception 'Enter the date it starts.' using errcode = 'P0001'; end if;
  update public.cost_plans set ends_on = p_starts_on - 1 where vendor = p_vendor and ends_on is null and starts_on < p_starts_on;
  delete from public.cost_plans where vendor = p_vendor and ends_on is null and starts_on >= p_starts_on;
  insert into public.cost_plans (vendor, plan, monthly_usd, starts_on, included) values (p_vendor, trim(p_plan), round(p_monthly_usd, 2), p_starts_on, coalesce(p_included, '{}'::jsonb))
    returning cost_plans.id into id;
  return id;
end $$;

create function public.admin_cost_set_rate(p_vendor text, p_kind text, p_unit_usd numeric, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can set rates.' using errcode = '42501';
  end if;
  if p_vendor not in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other') or coalesce(p_kind, '') !~ '^[a-z_]{2,40}$' then
    raise exception 'Unknown vendor or kind.' using errcode = 'P0001';
  end if;
  if p_unit_usd is null or p_unit_usd < 0 or p_unit_usd > 100000 then raise exception 'Enter the price in dollars.' using errcode = 'P0001'; end if;
  insert into public.cost_rates (vendor, kind, unit_usd, note) values (p_vendor, p_kind, p_unit_usd, left(coalesce(p_note, ''), 300))
    on conflict (vendor, kind) do update set unit_usd = excluded.unit_usd, note = excluded.note, updated_at = now();
end $$;

-- A cost no automation can see (a domain renewal, an invoice, a cloud bill). One event per call, dated by Ryan.
create function public.admin_cost_record(p_vendor text, p_amount_usd numeric, p_on date, p_note text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare id bigint;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can record costs.' using errcode = '42501';
  end if;
  if p_vendor not in ('stripe', 'resend', 'supabase', 'domain', 'cloud', 'anthropic', 'render', 'other') then raise exception 'Unknown vendor.' using errcode = 'P0001'; end if;
  if p_amount_usd is null or p_amount_usd < 0 or p_amount_usd > 1000000 then raise exception 'Enter the amount in dollars.' using errcode = 'P0001'; end if;
  if p_on is null or p_on > (now() at time zone 'EST5EDT')::date + 1 then raise exception 'Enter the date it was charged.' using errcode = 'P0001'; end if;
  insert into public.cost_events (occurred_at, vendor, kind, amount_usd, quantity, unit, mode, ref, detail)
    values (((p_on::timestamp + interval '12 hours') at time zone 'EST5EDT'), p_vendor, 'manual_invoice', round(p_amount_usd, 6), null, null, 'live',
            'manual:' || gen_random_uuid()::text, jsonb_build_object('note', left(coalesce(p_note, ''), 300), 'source', 'typed by Ryan'))
    returning cost_events.id into id;
  perform ryagram_private.cost_alarms();
  return id;
end $$;

-- ---------------------------------------------------------------- grants

revoke execute on function public.cost_record_events(jsonb), public.cost_ingest_render_meter(jsonb), public.cost_tick(), public.cost_sync_get(text),
  public.cost_sync_set(text, text) from public, anon, authenticated;
grant execute on function public.cost_record_events(jsonb), public.cost_ingest_render_meter(jsonb), public.cost_tick(), public.cost_sync_get(text),
  public.cost_sync_set(text, text) to service_role;
revoke execute on function ryagram_private.cost_alarms() from public, anon, authenticated;
revoke execute on function public.admin_cost_rollup(int), public.admin_cost_set_threshold(text, text, numeric, int), public.admin_cost_delete_threshold(bigint),
  public.admin_cost_set_plan(text, text, numeric, date, jsonb), public.admin_cost_set_rate(text, text, numeric, text), public.admin_cost_record(text, numeric, date, text)
  from public, anon;
grant execute on function public.admin_cost_rollup(int), public.admin_cost_set_threshold(text, text, numeric, int), public.admin_cost_delete_threshold(bigint),
  public.admin_cost_set_plan(text, text, numeric, date, jsonb), public.admin_cost_set_rate(text, text, numeric, text), public.admin_cost_record(text, numeric, date, text)
  to authenticated;   -- is_app_admin() is the gate
