-- WELCOME CREDITS: PAY THE PEOPLE WHO CONFIRMED WHILE THE LEVER WAS 0, OR WHOSE GRANT FAILED (CONNECT 2026-11-23; CC1 18:02, GAMES 18:02). Run it ONLY when CC1 names it (never as a hand grant: it records the address too, so nobody can be paid twice).
-- WHY: the welcome trigger (20261123000600) fires only at the MOMENT an email is verified. While ops_settings.welcome_credits is 0 it returns before it records anything, so people who confirm in that gap get nothing and are never paid later; a grant that failed (only a Postgres warning) is the same.
-- WHAT IT DOES, three parts, run one at a time in the live SQL Editor:
--   PART 1 (read-only): how many accounts verified in the last <hours> hours WOULD be paid (not a worker, an administrator or an invite-code account, and their scrambled address has no record yet), and the lever now.
--   PART 2 (the one write, a single DO block): for each of those accounts, in the order they verified, it records the scrambled address and gives ops_settings.welcome_credits through public.grant_credits (created_by 'welcome-repair'), EXACTLY the trigger's rule.
--     It REFUSES, changing nothing, if the lever is 0 (put it back to 8 first). All or nothing: any error undoes the whole block. Safe to run twice: the record makes the second run pay nobody.
--   PART 3 (read-only): how many were paid in the last 10 minutes, and the lever.
-- CHANGE THE WINDOW in PART 1 and PART 2 TOGETHER (the number after 'hours'): 48 covers everyone who confirmed since Monday's launch prep; make it the number of hours since the lever went to 0.
-- UNDO: none needed for the grant itself (credits are credits); to stop everything first set the lever to 0 again. It never touches an account that already has a record.

-- PART 1 (read-only)
select count(*) as accounts_that_would_be_paid,
       (select o.welcome_credits from public.ops_settings o limit 1) as lever_now
  from auth.users u
 where u.email_confirmed_at > now() - interval '48 hours'
   and btrim(coalesce(u.email, '')) <> ''
   and not exists (select 1 from public.workers x where x.user_id = u.id)
   and not exists (select 1 from public.app_admins a where a.user_id = u.id)
   and not exists (select 1 from public.invite_redemptions r where r.email = lower(btrim(u.email)))
   and coalesce(u.raw_user_meta_data ->> 'adult_source', '') <> 'invite'
   and not exists (select 1 from ryagram_private.welcome_credit_grants g
                    where g.email_hash = encode(sha256(convert_to('ryagram-welcome:' || lower(btrim(u.email)), 'UTF8')), 'hex'));

-- PART 2 (the write: run only after PART 1 shows the people you expect and the lever is above 0)
do $do$
declare n int; r record; eh text; paid int := 0;
begin
  n := coalesce((select o.welcome_credits from public.ops_settings o limit 1), 0);
  if n <= 0 then
    raise exception 'Not run: the welcome lever is 0. Put it back (update public.ops_settings set welcome_credits = 8) and run this again.';
  end if;
  for r in
    select u.id, lower(btrim(u.email)) as mail
      from auth.users u
     where u.email_confirmed_at > now() - interval '48 hours'
       and btrim(coalesce(u.email, '')) <> ''
       and not exists (select 1 from public.workers x where x.user_id = u.id)
       and not exists (select 1 from public.app_admins a where a.user_id = u.id)
       and not exists (select 1 from public.invite_redemptions q where q.email = lower(btrim(u.email)))
       and coalesce(u.raw_user_meta_data ->> 'adult_source', '') <> 'invite'
     order by u.email_confirmed_at, u.id
  loop
    eh := encode(sha256(convert_to('ryagram-welcome:' || r.mail, 'UTF8')), 'hex');
    insert into ryagram_private.welcome_credit_grants (email_hash) values (eh) on conflict (email_hash) do nothing;
    if found then
      perform public.grant_credits(r.id, 'grant', n, 'Welcome credits (email verified)', 'welcome-repair');
      paid := paid + 1;
    end if;
  end loop;
end $do$;

-- PART 3 (read-only)
select count(*) as paid_in_the_last_10_minutes,
       (select o.welcome_credits from public.ops_settings o limit 1) as lever_now
  from public.credit_ledger l
 where l.created_by = 'welcome-repair' and l.created_at > now() - interval '10 minutes';
