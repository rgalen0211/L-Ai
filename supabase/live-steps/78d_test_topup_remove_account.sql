-- OWNER-ONLY TEST CREDIT TOP-UP: take ONE account OFF the owner list. Credits it already has stay (to take back one top-up, use the undo call, see step 78).
-- FIRST replace PUT-THE-TEST-ACCOUNT-ADDRESS-HERE below with the account's sign-in address (keep the quotes), then Run. ONE statement. It answers in one row:
--   'removed' / 'was not on the list' / 'STOP: type the address first'.
with addr as (select lower(btrim('PUT-THE-TEST-ACCOUNT-ADDRESS-HERE')) as a),
     del as (delete from ryagram_private.test_topup_accounts l using auth.users u, addr
              where u.id = l.user_id and lower(u.email) = addr.a returning l.user_id)
select case when (select a from addr) = lower('PUT-THE-TEST-' || 'ACCOUNT-ADDRESS-HERE') then 'STOP: type the address first'
            when exists (select 1 from del) then 'removed'
            else 'was not on the list' end as result;
