-- LIVE STEP 75: NEW VERIFIED EMAILS GET 16 WELCOME CREDITS, NOT 8 (CONNECT 2026-11-26; Ryan 17:00 via Claude's burn note, CC1 17:01 plan, GAMES 17:01 read). ONE setting, no migration: the welcome trigger (migration 20261123000600) reads ops_settings.welcome_credits at the moment a person verifies their email. THE SERVER HALF ONLY: push the page words (16) right AFTER this, never before (a page must never promise 16 while the server still grants 8).
-- WHAT IT DOES: sets ops_settings.welcome_credits to 16. From then on every NEW verified email (once per address ever) gets 16. Nobody already granted changes: there is no back-fill. The column default stays 8 on purpose (live step 63 row 2 pins it), so step 63 stays all true and its row 8 then says 16.
-- PART 1 (read-only) before and after: the setting now, whether the trigger is there, how many people already got their welcome credits and how many credits that was.
-- PART 2 (the one write, one block): REFUSES (changing nothing) unless the welcome trigger exists, the setting is exactly 8 (not 0: a 0 means someone switched welcome credits off on purpose, do not override it here) and not already 16.
-- PART 3 (read-only): read-back: the setting must say 16, and the people already granted are the same number as before.
-- UNDO: live step 75b (back to 8, same checks).

-- PART 1 (read-only)
select (select o.welcome_credits from public.ops_settings o limit 1) as welcome_credits_now,
       exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'welcome_credits_trg' and not t.tgisinternal) as welcome_trigger_present,
       (select count(*) from public.credit_ledger l where l.created_by = 'welcome') as people_already_granted,
       (select coalesce(sum(l.amount), 0) from public.credit_ledger l where l.created_by = 'welcome') as credits_already_granted;

-- PART 2 (the write)
do $do$
declare n int;
begin
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'welcome_credits_trg' and not t.tgisinternal) then
    raise exception 'Not run: the welcome trigger is not there (migration 20261123000600 is not applied).';
  end if;
  n := (select o.welcome_credits from public.ops_settings o limit 1);
  if n = 16 then raise exception 'Not run: the setting is already 16.'; end if;
  if n is distinct from 8 then raise exception 'Not run: the setting is % (not 8). A 0 means welcome credits were switched off on purpose: set 16 by hand only if you mean to turn them on.', n; end if;
  update public.ops_settings set welcome_credits = 16;
  if (select o.welcome_credits from public.ops_settings o limit 1) is distinct from 16 then raise exception 'Not run: the setting did not change.'; end if;
end $do$;

-- PART 3 (read-only)
select (select o.welcome_credits from public.ops_settings o limit 1) as welcome_credits_now,
       (select count(*) from public.credit_ledger l where l.created_by = 'welcome') as people_already_granted,
       (select coalesce(sum(l.amount), 0) from public.credit_ledger l where l.created_by = 'welcome') as credits_already_granted;
