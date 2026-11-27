-- GAME ROOMS, THE SERVER HALF (BUILDER branch builder-games-rooms-1127; Ryan's 11:42 launch order). Ryan's yes. Design: proposals/BUILDER-GAMES-ROOMS-1127.md.
-- WHAT IT GIVES: a host registers a room and gets a 12-letter code Ryagram keeps only as a hash; phones join through Ryagram (wrong codes counted per caller first: 10 a minute
--   per address, 30 for all requests with no address; 300 a minute from everyone close the door as a backstop), a seat token to come back with, seats (12, the host may
--   lower), lock, remove, and a room nobody beats for 15 minutes closes by itself.
-- ONE read-only SELECT (this file): changes nothing, never errors, prints no address. Its FIRST row says PASS or STOP.
-- It cannot call the functions (they may not exist yet, and join writes), so rows 2 to 6 check grants and shapes, and rows 7 to 9 read the function text.
-- NOT CHECKABLE FROM SQL: whether two phones on different networks get different caller keys on live (design doc, live checklist).
-- ORDER: (1) step 82 (20261127000250, the department switches) must already say PASS: row 10 here checks it. (2) THIS file: before the change it says STOP, as expected.
--   (3) ONCE: paste ALL of supabase/migrations/20261127001000_game_rooms.sql into the SQL Editor and Run. (4) THIS file again: the FIRST row must say PASS.
--   (5) the Games page push that calls these functions (GAMES names it). PASS here proves the database half only.
-- UNDO (only if CC1 asks): put the Games page back first, then paste supabase/rollbacks/20261127001000_game_rooms_rollback.sql.
with c as (
select 2 as n, 'the four game tables have row security on, no policy, and no grant to anon, signed-in people or the service role' as check_name,
       coalesce((select count(*) from pg_class k join pg_namespace s on s.oid = k.relnamespace
                  where s.nspname = 'public' and k.relname in ('game_rooms', 'game_room_players', 'game_room_limits', 'game_room_misses') and k.relrowsecurity) = 4
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('game_rooms', 'game_room_players', 'game_room_limits', 'game_room_misses'))
         and not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public'
                          and g.table_name in ('game_rooms', 'game_room_players', 'game_room_limits', 'game_room_misses')
                          and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), false) as ok
union all select 3, 'a room code and a seat token are kept only as their sha256 (no code or token column), and the room keeps a secret channel name and the host key',
       coalesce((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'game_rooms') = 11
         and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_rooms' and column_name = 'code_sha256')
         and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_rooms' and column_name = 'code')
         and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_room_players' and column_name = 'token_sha256')
         and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_room_players'
                          and column_name in ('token', 'seat_token')), false)
union all select 4, 'the phone''s join (code, player id, name, seat token) is reachable without signing in and by nobody else, and no older join is left',
       coalesce(to_regprocedure('public.game_room_join(text,text,text,text)') is not null
         and to_regprocedure('public.game_room_join(text,text,text)') is null
         and (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'game_room_join') = 1
         and has_function_privilege('anon', to_regprocedure('public.game_room_join(text,text,text,text)'), 'execute')
         and not has_function_privilege('authenticated', to_regprocedure('public.game_room_join(text,text,text,text)'), 'execute')
         and not has_function_privilege('service_role', to_regprocedure('public.game_room_join(text,text,text,text)'), 'execute'), false)
union all select 5, 'the host''s seven calls are for a signed-in person in the app only, and the waiting gate guards each',
       coalesce((select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                  where s.nspname = 'public' and p.proname in ('game_room_open', 'game_room_beat', 'game_room_lock', 'game_room_seats', 'game_room_kick', 'game_room_allow', 'game_room_close')
                    and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                    and not has_function_privilege('service_role', p.oid, 'execute')
                    and p.prosrc like '%require_app_session()%' and p.prosrc like '%perform ryagram_private.require_active()%') = 7, false)
union all select 6, 'a host must have games working in their own top bar, an active account, and never be a worker (games_on), and no game helper can be run from outside',
       coalesce(to_regprocedure('ryagram_private.games_on(uuid)') is not null
         and pg_get_functiondef(to_regprocedure('ryagram_private.games_on(uuid)')) like '%ryagram_private.departments_for(p_person)%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.games_on(uuid)')) like '%public.workers w where w.user_id = p_person%'
         and pg_get_functiondef(to_regprocedure('ryagram_private.games_on(uuid)')) like '%ryagram_private.account_active(p_person)%'
         and not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'ryagram_private'
                          and (p.proname like 'game%' or p.proname = 'games_on')
                          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), false)
union all select 7, 'a room with no beat for 15 minutes is closed when anyone next reads it',
       coalesce(to_regprocedure('ryagram_private.game_room_fresh(timestamp with time zone)') is not null
         and pg_get_functiondef(to_regprocedure('ryagram_private.game_room_fresh(timestamp with time zone)')) like '%interval ''15 minutes''%'
         and (select p.prosrc like '%closed_reason = ''idle''%' from pg_proc p where p.oid = to_regprocedure('public.game_room_join(text,text,text,text)')), false)
union all select 8, 'guessing is limited per caller first (10 a minute, 30 for the shared unknown bucket), the door is a 300 a minute backstop, all counted under one lock, IPv6 cut to its /64, and the host''s beat shows no site-wide count',
       coalesce((select p.prosrc like '%pg_advisory_xact_lock%'
                    and p.prosrc like '%m.caller = who and m.at > now() - interval ''60 seconds'') >= 10 then%'
                    and p.prosrc like '%m.caller = ''unknown'' and m.at > now() - interval ''60 seconds'') >= 30 then%'
                    and p.prosrc like '%interval ''60 seconds'') >= 300 then%'
                    and p.prosrc like '%insert into public.game_room_misses (caller) values (bucket)%'
                  from pg_proc p where p.oid = to_regprocedure('public.game_room_join(text,text,text,text)'))
         and (select p.prosrc like '%set_masklen(a, 64)%' from pg_proc p where p.oid = to_regprocedure('ryagram_private.game_caller()'))
         and (select p.prosrc not like '%game_room_misses%' from pg_proc p where p.oid = to_regprocedure('ryagram_private.game_roster(uuid)')), false)
union all select 9, 'seats, lock and remove are checked at join (full, locked, removed), and a seated player comes back only with the matching seat token',
       coalesce((select p.prosrc like '%''problem'', ''full''%' and p.prosrc like '%''problem'', ''locked''%' and p.prosrc like '%''problem'', ''removed''%'
                    and p.prosrc like '%p.token_sha256 <> th%' and p.prosrc like '%''seat_token''%'
                  from pg_proc p where p.oid = to_regprocedure('public.game_room_join(text,text,text,text)'))
         and (select p.prosrc like '%token_sha256 = null%' from pg_proc p where p.oid = to_regprocedure('public.game_room_kick(uuid,text)')), false)
union all select 10, 'the games switch is there (step 82, 20261127000250, applied first)',
       coalesce(to_regprocedure('ryagram_private.department_switch_on(uuid,text)') is not null, false)
)
select 1 as n, case when (select bool_and(ok) from c) then 'PASS: game rooms are registered by Ryagram' else 'STOP: a row below is false (before the change this is expected)' end as check_name,
       (select bool_and(ok) from c) as ok
union all select n, check_name, ok from c
order by n;
