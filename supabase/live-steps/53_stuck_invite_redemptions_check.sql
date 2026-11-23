-- READ-ONLY, any time (Wednesday's watch list, once an hour): invite-code redemptions whose email WENT OUT but whose recording (public.invite_sent: the account active and the welcome credits) failed. Changes nothing.
-- The redeem-invite function tries the recording twice, then logs and tells the person the truth (the mail is on its way). A redemption left 'pending' for more than 10 minutes whose email has an account made AFTER the redemption is one of those.
-- Filters (GEO's review 11-23, so that a repair line can never grant twice or activate the wrong account): only the NEWEST pending row of an email is listed; an email that already has a 'sent' redemption is left out
-- (invite_sent grants the code's credits each time it is run on a pending row, with a new reference each time); an account that existed BEFORE the redemption is left out (it is not the person who was just invited).
-- A redemption that was RELEASED is never listed and invite_sent cannot repair it: redeem-invite releases only when the email could NOT be sent (or the address already had an account), never after a mail went out.
-- Every column is named. First row: the count (0 = nothing to do). Then one row per stuck redemption with its repair_statement: run it as the project owner (invite_sent acts only on a 'pending' redemption, so running it twice is harmless).
with newest as (
  select distinct on (r.email) r.id, r.email, r.created_at
    from public.invite_redemptions r
   where r.status = 'pending'
     and not exists (select 1 from public.invite_redemptions s where s.email = r.email and s.status = 'sent')
   order by r.email, r.created_at desc, r.id desc
), stuck as (
  select n.id, n.email, n.created_at, u.id as user_id
    from newest n join auth.users u on lower(u.email) = n.email and u.created_at >= n.created_at
)
select 'stuck redemptions: pending for more than 10 minutes and the email has an account made after it' as what,
       count(*)::text as count_or_redemption_id, null::text as email, null::text as user_id, null::text as created_at, null::text as repair_statement
  from stuck where created_at < now() - interval '10 minutes'
union all
select 'one stuck redemption', k.id::text, k.email, k.user_id::text, k.created_at::text,
       'select public.invite_sent(' || k.id || ', ''' || k.user_id || '''::uuid);'
  from stuck k where k.created_at < now() - interval '10 minutes';
