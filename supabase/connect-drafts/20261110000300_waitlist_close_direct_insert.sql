-- THE WAITING LIST: CLOSE THE DIRECT TABLE INSERT (CONNECT 2026-11-10; NEXT-CONNECT 206, CC1 09:25). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and ONLY TOGETHER WITH WEB's page that calls join_waitlist.
-- Today the page posts straight to /rest/v1/ryagram_waitlist with the public key. That path (1) writes a repeat address into Postgres's own error log ('Key (lower(email))=(a@b.c) already exists') and (2) answers 201 for a new address and 409 for a repeat,
-- so anyone can test whether an address is on the list. After 20261110000200_waitlist_join.sql the page calls join_waitlist instead; this file then removes the old door: no visitor or signed-in person may insert into the table directly.
-- ORDER: apply 20261110000200, deploy WEB's page, THEN this file. If this file is applied first, the live form fails (it says "We couldn't add you just now") until the page is deployed.
-- Lives in supabase/connect-drafts/ (not migrations/) because it must go live ONLY with WEB's page; Ryan runs it by hand in the SQL editor after the page is deployed. Needs 20261110000200_waitlist_join.sql. Undo: supabase/rollbacks/20261110000300_waitlist_close_direct_insert_rollback.sql (puts the insert grant and its policy back exactly as ryagram-waitlist.sql made them).
-- CHECK (read-only, after it): select not has_column_privilege('anon', 'public.ryagram_waitlist', 'email', 'insert') and not has_column_privilege('authenticated', 'public.ryagram_waitlist', 'email', 'insert') and not exists (select 1 from pg_policy where polrelid = 'public.ryagram_waitlist'::regclass and polcmd = 'a') as closed;   -- says true
begin;

drop policy if exists "Visitors can join the waitlist" on public.ryagram_waitlist;
revoke insert on table public.ryagram_waitlist from anon, authenticated;       -- a table-level revoke also removes the three column-level insert grants the old form used

do $g$ begin if to_regprocedure('ryagram_private.gate_apply()') is not null then perform ryagram_private.gate_apply(); end if; end $g$;      -- like every migration after the waiting list; where the gate is not applied yet this line does nothing

commit;
