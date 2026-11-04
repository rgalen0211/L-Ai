-- OPEN EVERYONE WHO IS WAITING (Ryan's decision, e.g. when access opens to all). Each account is opened through the same function an approval uses, so it is audited (source 'approved', no admin named)
-- and whatever credits were HELD for it while it waited are paid now. NO welcome credits are added here (0): approve someone on the waiting list if they should get the welcome credits.
-- Counts before and after, so you see what happened. Only unconfirmed addresses are left alone.
select count(*) as waiting_before from public.account_status where status = 'waiting';
select ryagram_private.activate_account(s.user_id, 'approved', null, 0, 'opened with everyone who was waiting') as opened, s.user_id
  from public.account_status s join auth.users u on u.id = s.user_id
 where s.status = 'waiting' and u.email_confirmed_at is not null;
select count(*) as waiting_after from public.account_status where status = 'waiting';
