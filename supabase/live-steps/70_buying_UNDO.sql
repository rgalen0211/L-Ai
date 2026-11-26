-- LIVE STEP 70: THE UNDO OF STEP 69 (CONNECT 2026-11-24). Closes buying and, in a second part, puts the TEST price ids and the test setting back. Run PART 1 first, always (it is the stop switch and is safe to run any time, twice, in a hurry). PART 2 only when you really mean to go back to test mode.
-- PART 1 (the stop): buying closed. Nobody new can open a checkout: the SERVER closes at once (a click on Buy is refused with 'Buying is not open yet'); the page's own Buy buttons and prices stay on screen until the pages-undo push lands (GAMES 16:12: the page reads only its own config), so push the pages undo right after. The billing portal for an existing plan stays open; every purchase event that still arrives is held for review, not paid out.
-- PART 2 (back to test mode): restores the five test price ids saved by step 69 part 2 and sets live_ok false. It REFUSES if buying is still open (run part 1 first) or if a live Stripe event was recorded (then a real payment exists: do NOT go back, ask CC1). It cannot bring back the test customers and subscriptions part 2 of step 69 deleted (they were only test-mode records: the next test checkout makes a new one). Prices hidden again from the API: part 3.
-- PART 3 (hide prices again): signed-in people can no longer read price_cents (the same rule as migration 20261123000800).
-- READ THIS BEFORE USING ANY UNDO (RENDERER 16:06): most days 'off' means ONLY part 1: it is safe any time and nothing else is needed. (a) Part 3 and the rollback of migration 20261123000800 are OPPOSITES: part 3 HIDES price_cents, the 000800 rollback SHOWS it again for good (table-wide). Never run both; run the rollback only if you really want the old behaviour back.
-- (b) Before ANY rollback of migration 20261123000900 run live step 72b FIRST (Ryan runs it himself and saves the result ONLY in his own export folder, never in Ryagram-logs, a session folder, a chat, MAILBOX or git: it is customers' personal data) and SAVE its result: that rollback DROPS every person's stored business-or-personal answer, their place and its date, and after real sales they are your tax record. (c) The deployed stripe-checkout function has no undo in SQL: while buying is closed it is harmless (it refuses every checkout); to put the old version back, redeploy the commit before the paid switch from the function-undo table (GEO/ENGINE: proposals/ENGINE-FUNCTION-UNDO-1125.md) with the same deploy line, --no-verify-jwt included.

-- PART 1 (the stop)
update public.stripe_settings set buying_open = false where id returning buying_open as buying_open_now, live_ok as live_ok_now;

-- PART 2 (back to test mode)
do $do$
begin
  if (select s.buying_open from public.stripe_settings s where s.id) then raise exception 'Not run: buying is still open. Run part 1 first.'; end if;
  if exists (select 1 from public.stripe_events where livemode and outcome = 'applied') then raise exception 'Not run: a live Stripe event was applied, so a real payment exists. Do not go back to test mode: ask CC1.'; end if;
  if to_regclass('ryagram_private.stripe_prices_test_ids') is null then raise exception 'Not run: step 69 never saved the test price ids.'; end if;
  if (select count(*) from ryagram_private.stripe_prices_test_ids) = 0 then raise exception 'Not run: step 69 never saved the test price ids.'; end if;
  update public.stripe_prices p set stripe_price_id = t.stripe_price_id from ryagram_private.stripe_prices_test_ids t where t.price_code = p.price_code;
  update public.stripe_settings set live_ok = false where id;
end $do$;

-- PART 3 (hide prices again). Works only if migration 20261123000800 (the column grant without price_cents) is applied; without it the table-wide read was never narrowed and this line changes nothing.
revoke select (price_cents) on public.credit_prices from authenticated;
