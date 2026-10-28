-- AFTER 20261027000800_invite_email.sql (Q302 B, invite email sent by Ryagram): one SELECT, read-only. Every ok must be true.
select 'the table invite_sends exists with row level security on' as check_name,
       (select count(*) from pg_class c where c.oid = 'public.invite_sends'::regclass and c.relrowsecurity) = 1 as ok
union all select 'nobody can touch invite_sends directly (not signed-in people, not the public, not the service role)',
       not has_table_privilege('authenticated', 'public.invite_sends', 'select,insert,update,delete') and not has_table_privilege('anon', 'public.invite_sends', 'select,insert,update,delete')
       and not has_table_privilege('service_role', 'public.invite_sends', 'select,insert,update,delete')
union all select 'the two send functions exist and signed-in people can run them, the public cannot',
       (select count(*) from unnest(array['public.admin_invite_send_begin(text,text)', 'public.admin_invite_send_undo(text)']) f
         where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) = 2
union all select 'the address helper is closed to every login (only the two definer functions call it)',
       to_regprocedure('ryagram_private.invite_address(text)') is not null
       and not has_function_privilege('authenticated', 'ryagram_private.invite_address(text)', 'execute') and not has_function_privilege('anon', 'ryagram_private.invite_address(text)', 'execute')
union all select 'the outbox accepts the new kind invite and still the four old ones',
       (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.ops_outbox'::regclass and c.conname = 'ops_outbox_kind_check') like '%invite%'
       and (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.ops_outbox'::regclass and c.conname = 'ops_outbox_kind_check') like '%digest%'
union all select 'nothing was sent by applying it (no invite_sends row and no invite row in the outbox yet)',
       (select count(*) from public.invite_sends) = 0 and (select count(*) from public.ops_outbox where kind = 'invite') = 0;
