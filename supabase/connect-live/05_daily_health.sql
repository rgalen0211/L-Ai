-- READ-ONLY daily health check of the connector. Run in the SQL Editor of the project (live or proof) as the project owner. It changes nothing.
-- One grid, four named columns: check_name, value, status, what_to_do. status is ok, look (read it, no rush) or act (do what the last column says today).
-- The purge job's own last runs are in 05b_purge_last_run.sql (it needs pg_cron). The worst rows come first. See proposals/CONNECT-OPERATIONS.md for what each row means.
with
flags as (select connections_enabled, full_render_enabled from public.connect_flags where id),
calls24 as (select * from public.connect_calls where at > now() - interval '24 hours'),
runner as (
  select ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE') and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype) and not (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin')
              and n.nspname not in ('pg_catalog', 'information_schema') and not (n.nspname = 'public' and p.proname like 'connect\_%'))
          + (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r', 'v', 'm', 'p', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and has_schema_privilege('connect_runner', n.oid, 'USAGE')
                and (has_table_privilege('connect_runner', c.oid, 'SELECT') or has_table_privilege('connect_runner', c.oid, 'INSERT')
                  or has_table_privilege('connect_runner', c.oid, 'UPDATE') or has_table_privilege('connect_runner', c.oid, 'DELETE')))) as n
),
rows as (
  select 1 as sort, 'master switch (connect_flags.connections_enabled)'::text as check_name,
         case when f.connections_enabled then 'ON' else 'OFF' end as value,
         case when f.connections_enabled then 'ok' else 'look' end as status,
         case when f.connections_enabled then 'Nothing to do.' else 'Connections are switched OFF: every call is refused. If that is not on purpose, run 91_switch_on.sql.' end as what_to_do
    from flags f
  union all
  select 0, 'full renders from a connection (must stay off)',
         case when f.full_render_enabled then 'ON' else 'off' end,
         case when f.full_render_enabled then 'act' else 'ok' end,
         case when f.full_render_enabled then 'This must be off. Run 90_switch_off.sql now, then tell CONNECT: update public.connect_flags set full_render_enabled = false.' else 'Nothing to do.' end
    from flags f
  union all
  select 0, 'realtime tables WITHOUT the exact client_id guard policy',
         (select count(*)::text from ryagram_private.connect_unguarded_published_tables()),
         case when (select count(*) from ryagram_private.connect_unguarded_published_tables()) = 0 then 'ok' else 'act' end,
         case when (select count(*) from ryagram_private.connect_unguarded_published_tables()) = 0 then 'Nothing to do.'
              else 'A table was added to the Realtime publication after the migration. Run: select ryagram_private.connect_guard_published_tables(); then run this check again. Tables: '
                   || (select string_agg(schema_name || '.' || table_name, ', ') from ryagram_private.connect_unguarded_published_tables()) end
  union all
  select 0, 'connect_no_oauth_select policies that are permissive (must be none)',
         (select count(*)::text from pg_policy where polname = 'connect_no_oauth_select' and polpermissive),
         case when exists (select 1 from pg_policy where polname = 'connect_no_oauth_select' and polpermissive) then 'act' else 'ok' end,
         'If not zero: someone replaced a guard policy with a permissive one. Run select ryagram_private.connect_guard_published_tables(); it repairs only tables whose policy is not exact, so drop the permissive policy first, or tell CONNECT.'
  union all
  select 0, 'policies on realtime.messages (a private channel needs one; the app uses none)',
         (select count(*)::text from pg_policy where polrelid = to_regclass('realtime.messages')),
         case when exists (select 1 from pg_policy where polrelid = to_regclass('realtime.messages')) then 'act' else 'ok' end,
         'If not zero: a private Realtime channel was added. Tell CONNECT before anything else; connections must be proven unable to read it.'
  union all
  select 0, 'connect_runner: functions it can call outside public.connect_*, plus table privileges it can reach',
         rr.n::text, case when rr.n = 0 then 'ok' else 'act' end,
         'If not zero: the connector login can do more than it should (a new function or table was granted to everyone, in a schema it can enter). Run 04_runner_privilege_report.sql, then tell CONNECT; consider 90_switch_off.sql until fixed.'
    from runner rr
  union all
  select 1, 'ACCEPTED RESIDUAL (Ryan, RYAN-QUEUE Q55, typed to Claude 2026-10-18 21:38): pg_net functions in schema net that connect_runner can reach',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE')
             and (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin')),
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind in ('f', 'p') and has_schema_privilege('connect_runner', n.oid, 'USAGE') and has_function_privilege('connect_runner', p.oid, 'EXECUTE')
             and (n.nspname = 'net' and p.proname in ('http_get', 'http_post', 'http_delete', 'http_collect_response', '_await_response', '_encode_url_with_params_array', '_http_collect_response', '_urlencode_string', 'check_worker_is_up', 'wait_until_running', 'wake', 'worker_restart') and pg_get_userbyid(p.proowner) = 'supabase_admin')) then 'look' else 'ok' end,
         'Not zero is the residual Ryan accepted: the connector login can make the database send web requests (it cannot read tables). When Supabase support removes PUBLIC usage on schema net this reads 0 and the tolerance in 01 and 05 can be deleted.'
  union all
  select 0, 'redirect addresses that are loopback and ON (live must keep this at 0)',
         (select count(*)::text from public.connect_redirect_allowlist where kind = 'loopback' and enabled),
         case when exists (select 1 from public.connect_redirect_allowlist where kind = 'loopback' and enabled) then 'act' else 'ok' end,
         'On live this must be 0. Run: update public.connect_redirect_allowlist set enabled = false where kind = ''loopback'';'
  union all
  select 2, 'things the purge should already have removed (old requests, expired tokens, old call rows)',
         ((select count(*) from public.connect_requests where expires_at < now() - interval '3 days')
          + (select count(*) from public.connect_tokens where refresh_expires_at < now() - interval '3 days')
          + (select count(*) from public.connect_calls where at < now() - interval '32 days'))::text,
         case when ((select count(*) from public.connect_requests where expires_at < now() - interval '3 days')
          + (select count(*) from public.connect_tokens where refresh_expires_at < now() - interval '3 days')
          + (select count(*) from public.connect_calls where at < now() - interval '32 days')) = 0 then 'ok' else 'look' end,
         'If not zero for more than a day the daily purge is not running: run 05b_purge_last_run.sql (it shows the last runs of the purge job; it needs the pg_cron extension).'
  union all
  select 3, 'tool calls in the last 24 hours (ok / refused / error)',
         (select count(*) filter (where result = 'ok') || ' / ' || count(*) filter (where result = 'refused') || ' / ' || count(*) filter (where result = 'error') from calls24),
         case when (select count(*) filter (where result = 'error') from calls24) = 0 then 'ok' else 'look' end,
         'Refused is normal (a check said no, in words the AI shows). Error is not: see the rows below, one per tool and code.'
  union all
  select 1, 'errors in 24 hours: ' || e.tool || ' / ' || e.code,
         e.n::text,
         case when e.n >= 10 then 'act' else 'look' end,
         'Something failed inside the connector for ' || e.n || ' call(s). Look at the newest: select at, tool, code, result from public.connect_calls where result = ''error'' order by id desc limit 20; if it keeps happening, tell CONNECT with the tool and code (never the person''s text; none is logged).'
    from (select tool, code, count(*) as n from calls24 where result = 'error' group by tool, code) e
  union all
  select 3, 'refusals in 24 hours that mean a rule was hit twice or more: ' || r.tool || ' / ' || r.code,
         r.n::text, 'look',
         'The AI tried something a rule refuses, ' || r.n || ' times. Usually it learns from the plain-words answer. If one person''s AI does it constantly, you can disconnect it (Account, Connected AIs) or end all with 98_end_all_connections.sql.'
    from (select tool, code, count(*) as n from calls24 where result = 'refused' group by tool, code having count(*) >= 20) r
  union all
  select 4, 'sign-in requests open right now (not decided, not expired)',
         (select count(*)::text from public.connect_requests where decided_at is null and expires_at > now()),
         case when (select count(*) from public.connect_requests where decided_at is null and expires_at > now()) >= 50 then 'act' else 'ok' end,
         '50 or more open at once is not people: someone is hammering the sign-in start. The per-caller limit slows it; if it continues run 90_switch_off.sql and tell CONNECT.'
  union all
  select 4, 'sign-in requests started in the last 24 hours (decided / never decided)',
         (select count(*) filter (where decided_at is not null) || ' / ' || count(*) filter (where decided_at is null) from public.connect_requests where created_at > now() - interval '24 hours'),
         'ok', 'For reading only. Many never decided means people give up on the consent page, or it expires (30 minutes) before they finish.'
  union all
  select 4, 'assistant registrations in the last 24 hours that never got a grant',
         (select count(*)::text from public.connect_clients c where c.created_at > now() - interval '24 hours' and not exists (select 1 from public.connect_grants g where g.client_id = c.client_id)),
         case when (select count(*) from public.connect_clients c where c.created_at > now() - interval '24 hours' and not exists (select 1 from public.connect_grants g where g.client_id = c.client_id)) >= 100 then 'act' else 'ok' end,
         '100 or more is a flood of registrations. Unused ones are removed after 7 days by the purge. If it continues run 90_switch_off.sql and tell CONNECT.'
  union all
  select 5, 'live connections (active grants) and invited people',
         (select count(*)::text from public.connect_grants where revoked_at is null) || ' connections, ' || (select count(*)::text from public.connect_access where enabled) || ' invited',
         'ok', 'For reading only. Account, Connected AIs shows each person their own; to end one now see CONNECT-OPERATIONS.md.'
  union all
  select 5, 'connections not used for 25 days or more (they end at 30 unused days)',
         (select count(*)::text from public.connect_grants g where g.revoked_at is null
            and coalesce((select max(t.last_used_at) from public.connect_tokens t where t.owner_id = g.owner_id and t.client_id = g.client_id), g.created_at) < now() - interval '25 days'),
         'ok', 'For reading only. Those people will be asked to sign in again from their assistant when they next use it.'
  union all
  select 5, 'retry graces used in the last 24 hours (a repeated refresh within 60 seconds)',
         (select count(*)::text from public.connect_tokens where grace_used_at > now() - interval '24 hours'),
         case when (select count(*) from public.connect_tokens where grace_used_at > now() - interval '24 hours') >= 20 then 'look' else 'ok' end,
         'A few are normal (a lost answer). Many from one connection can mean a stolen refresh token being replayed: the second replay already disconnects that connection.'
)
select check_name, value, status, what_to_do
  from rows
 order by case status when 'act' then 0 when 'look' then 1 else 2 end, sort, check_name;
