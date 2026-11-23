-- READ-ONLY (GEO 2026-11-23, CC1 08:45 from GAMES' 08:43 review of redeem-invite): invite-code redemptions still 'pending' more than
-- 10 minutes after the code was used, although an account with that email already exists. That happens when the invite email went out
-- and the account was made, but the step that records it (public.invite_sent) did not run: the person is not marked active and gets
-- no welcome credits. Every column is named. NO ROWS = nothing to do.
-- To repair ONE row: copy its repair_sql cell into a new query and run it (it marks the redemption sent, makes the account active and
-- grants the code's welcome credits once; running it twice does nothing). Then run this check again: that row is gone.
select r.id as redemption_id,
       r.created_at as redeemed_at,
       u.id as account_id,
       'select public.invite_sent(' || r.id || ', ''' || u.id || ''');' as repair_sql
  from public.invite_redemptions r
  join auth.users u on lower(u.email) = lower(r.email)
 where r.status = 'pending'
   and r.created_at < now() - interval '10 minutes'
 order by r.created_at;
