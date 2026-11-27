-- OWNER-ONLY TEST CREDIT TOP-UP (BUILDER branch builder-test-topup-1127; Claude's wave-6 order 11-26 23:00). Ryan's lever, ONLY on Ryan's yes. Not urgent: nothing breaks without it.
-- WHAT IT GIVES: one admin call that refills Ryan's OWN test accounts with test credits, and refuses every account that is not on a list only Ryan can change.
-- FIVE FILES, ONE STATEMENT EACH (each is a whole 'Copy ALL'):
--   78_test_topup.sql (THIS file): read-only, AFTER the migration only (before it, it says the table does not exist): accounts on the list, top-ups so far.
--   78b_test_topup_check.sql: read-only, before and after; its FIRST row says PASS (after) or STOP (before, expected).
--   78c_test_topup_add_account.sql: puts ONE account on the list (Ryan types the address into it first).
--   78d_test_topup_remove_account.sql: takes ONE account off the list again.
-- ORDER: (1) 78b (read-only; before the migration it says STOP, expected); (2) ONCE: paste ALL of supabase/migrations/20261127000100_owner_test_topup.sql into the SQL Editor and Run,
--   (3) 78b: its FIRST row must say PASS (STOP: tell CC1, and run the undo below); (4) 78c once for each of your test accounts; (5) THIS file: row 1 counts them.
-- USING IT: the three calls answer ONLY a signed-in admin in the app (not the SQL Editor, not an AI connection). The page button is the client half (WEB's, not built yet):
--   admin_test_topup(address, credits, note) returns the top-up number, admin_test_topup_list() shows the last 100, admin_test_topup_undo(number, why) takes back
--   what is still unspent of one top-up and says how many. Applying this file with no page button changes nothing anyone can see.
-- LIMITS: 1 to 100 credits a top-up, at most 200 a day for one account; an address not on the list gets nothing and the words say so.
-- UNDO OF THE WHOLE CHANGE (only if CC1 asks): paste supabase/rollbacks/20261127000100_owner_test_topup_rollback.sql. Credits already given stay given.

-- read-only, after the migration; prints no address.
select n, what, value from (
select 1 as n, 'accounts on the owner list' as what, (select count(*) from ryagram_private.test_topup_accounts)::text as value
union all
select 2, 'top-ups so far (undone ones included)', (select count(*) from ryagram_private.test_topups)::text
union all
select 3, 'test credits given in the last 24 hours, less what was taken back',
       (select coalesce(sum(t.credits - coalesce(t.taken_back, 0)), 0) from ryagram_private.test_topups t where t.created_at > now() - interval '24 hours')::text
) s order by n;
