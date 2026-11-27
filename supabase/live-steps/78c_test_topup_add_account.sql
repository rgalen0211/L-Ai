-- OWNER-ONLY TEST CREDIT TOP-UP: put ONE of Ryan's own test accounts on the owner list (only after 78b says PASS).
-- FIRST replace PUT-THE-TEST-ACCOUNT-ADDRESS-HERE below with the account's sign-in address (keep the quotes), then Run. ONE statement. It answers in one row:
--   'added' / 'already on the list' / 'STOP: type the address first' / 'STOP: no account with that address' / 'STOP: a worker account cannot be on the list'.
-- Only accounts YOU own go on this list: every account on it can be given test credits by an admin. Take one off again with 78d. Check the count with step 78 (row 1).
with addr as (select lower(btrim('PUT-THE-TEST-ACCOUNT-ADDRESS-HERE')) as a),
     target as (select u.id from auth.users u, addr where lower(u.email) = addr.a),
     ins as (insert into ryagram_private.test_topup_accounts (user_id, added_by)
               select t.id, 'live step 78c' from target t where not exists (select 1 from public.workers w where w.user_id = t.id)
               on conflict (user_id) do nothing returning user_id)
select case when (select a from addr) = lower('PUT-THE-TEST-' || 'ACCOUNT-ADDRESS-HERE') then 'STOP: type the address first'
            when not exists (select 1 from target) then 'STOP: no account with that address'
            when exists (select 1 from public.workers w join target t on t.id = w.user_id) then 'STOP: a worker account cannot be on the list'
            when exists (select 1 from ins) then 'added'
            else 'already on the list' end as result;
