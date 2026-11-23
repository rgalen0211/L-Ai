-- AFTER 20261123000200_queue_cap_per_owner.sql (A15) and 20261123000300_blocked_story_views.sql (A16) (GEO 2026-11-23; BUILDER builder-queue-cap-1123).
-- One SELECT, read-only, changes nothing; every column is named. After BOTH migrations every ok must be true. If one is false: STOP, tell CC1.
-- After A15 alone rows 1 and 2 are true and rows 3 and 4 false; before A15 rows 1 to 4 are false; never an error. Row 5 is true at every stage.
-- What it promises a stranger: one person can have at most 2 sheets or previews waiting for the render PC, and at most 2 open orders ('You have 2 films waiting...'),
-- and a sheet or preview of a film the engine is known to fail is refused before it queues ('This film is not available yet...').
select 'the waiting-films limit is a setting (ops_settings.queue_cap_per_owner, built in as 2)' as check_name,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings'
                and column_name = 'queue_cap_per_owner' and column_default = '2') as ok
union all select 'a person''s own new sheet or preview, and a new order, are checked against the limit (queue_cap_check, order_cap_check)' as check_name,
       coalesce((select p.prosrc like '%queue_cap_check%' from pg_proc p
                  where p.oid = to_regprocedure('ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)')), false)
         and to_regprocedure('ryagram_private.submit_job_for_base(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)') is not null
         and coalesce((select bool_or(p.prosrc like '%order_cap_check%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'ryagram_private' and p.proname = 'order_submit'), false) as ok
union all select 'the blocked-film list is there and closed to every API role (its 58 pairs are proven by BUILDER''s test)' as check_name,
       coalesce(to_regclass('ryagram_private.blocked_story_views') is not null
         and not has_table_privilege('anon', to_regclass('ryagram_private.blocked_story_views'), 'select')
         and not has_table_privilege('authenticated', to_regclass('ryagram_private.blocked_story_views'), 'select')
         and not has_table_privilege('service_role', to_regclass('ryagram_private.blocked_story_views'), 'select'), false) as ok
union all select 'new sheets, previews and orders are checked against the blocked list' as check_name,
       coalesce((select p.prosrc like '%blocked_view_check%' from pg_proc p
                  where p.oid = to_regprocedure('ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)')), false)
         and coalesce((select bool_or(p.prosrc like '%blocked_view_check%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'ryagram_private' and p.proname = 'order_submit'), false) as ok
union all select 'no signed-in person, visitor or service key can call the private checks directly' as check_name,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'ryagram_private'
                      and p.proname in ('queue_cap_check', 'order_cap_check', 'blocked_view_check', 'blocked_view_in', 'submit_job_for', 'submit_job_for_base', 'order_submit', 'order_submit_base')
                      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                           or has_function_privilege('service_role', p.oid, 'execute'))) as ok;
