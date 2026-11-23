-- READ-ONLY, any time (suggested: Wednesday's watch list, once an hour): invite-code redemptions whose email WENT OUT but whose recording (public.invite_sent: the account active and the welcome credits) failed. Changes nothing.
-- The redeem-invite function tries the recording twice, then logs and tells the person the truth (the mail is on its way); a redemption left 'pending' for more than 10 minutes whose email already has an account is one of those.
-- Every column is named. No rows with a repair statement = nothing stuck. To repair one: run its repair_statement as the project owner (invite_sent acts only on a 'pending' redemption, so running it twice is harmless).
select 'stuck redemptions: pending for more than 10 minutes and the email has an account' as what,
       count(*)::text as count_or_redemption_id, null::text as email, null::text as user_id, null::text as created_at, null::text as repair_statement
  from public.invite_redemptions r join auth.users u on lower(u.email) = r.email
 where r.status = 'pending' and r.created_at < now() - interval '10 minutes'
union all
select 'one stuck redemption', r.id::text, r.email, u.id::text, r.created_at::text,
       'select public.invite_sent(' || r.id || ', ''' || u.id || '''::uuid);'
  from public.invite_redemptions r join auth.users u on lower(u.email) = r.email
 where r.status = 'pending' and r.created_at < now() - interval '10 minutes';
