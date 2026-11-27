-- WHAT WOULD THE WAITING-ACCOUNT GATE CHANGE? (BUILDER branch builder-gate-preview-1127; RENDERER 11-27 08:47 item 5). ONE read-only SELECT: changes nothing, never errors, prints no address.
-- WHY: every migration since 20261104000100 ends with select ryagram_private.gate_apply(). That call rewrites EVERY public function a signed-in person can run that does not yet carry the gate's
--   require_active line (and wraps a SQL one), and adds the account_gate policy to every table with a policy for signed-in people. So pasting ANY migration could also change a function or table
--   that was added since the last gate run (for example by hand in the dashboard), not only the migration's own new ones.
-- WHEN: run THIS file BEFORE pasting any migration that ends with gate_apply. Its FIRST row should say NOTHING. If it says LOOK, read the list: every line is something the gate would change now,
--   on top of the migration's own new functions. If you do not recognise a line, STOP and send the list to CC1 before pasting. After pasting, run it again: it should say NOTHING again.
-- It reads the gate's own two lists (the allowed functions and the open tables) from the live gate_apply text, so it stays in step with the gate. If it cannot read them it says STOP.
with g as (
  select pg_get_functiondef(to_regprocedure('ryagram_private.gate_apply()')) as def
), lists as (
  select array(select m[1] from g, regexp_matches(coalesce((regexp_match(g.def, 'allowed constant text\[\] := array\[([^\]]*)\]'))[1], ''), '''([a-z_]+)''', 'g') m) as allowed,
         array(select m[1] from g, regexp_matches(coalesce((regexp_match(g.def, 'open_tables constant text\[\] := array\[([^\]]*)\]'))[1], ''), '''([a-z_]+)''', 'g') m) as open_tables
), would as (
  select 'function ' || p.oid::regprocedure::text || ' (' || l.lanname || ')' as item
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang, lists
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname <> all (lists.allowed) and p.prosrc not like '%perform ryagram_private.require_active()' || chr(59) || '%' and p.proname not like '%\_\_ungated'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union
  select distinct 'table ' || pc.schemaname || '.' || pc.tablename
    from pg_policies pc, lists
   where pc.schemaname in ('public', 'storage') and pc.permissive = 'PERMISSIVE' and ('authenticated' = any (pc.roles) or 'public' = any (pc.roles))
     and pc.tablename <> all (lists.open_tables)
     and not exists (select 1 from pg_policies q where q.schemaname = pc.schemaname and q.tablename = pc.tablename and q.policyname = 'account_gate')
)
select 0 as n,
       case when (select def from g) is null then 'STOP: there is no ryagram_private.gate_apply on this database'
            when (select cardinality(allowed) from lists) = 0 or (select cardinality(open_tables) from lists) = 0 then 'STOP: the gate''s two lists could not be read from its text, so this preview cannot be trusted. Tell CC1.'
            when (select count(*) from would) = 0 then 'NOTHING: the gate would change nothing already on the database'
            else 'LOOK: the gate would change ' || (select count(*) from would) || ' things, listed below: each must be one of the new functions of the migration you are about to paste' end as what
union all
select row_number() over (order by item) as n, item from would
order by n;
