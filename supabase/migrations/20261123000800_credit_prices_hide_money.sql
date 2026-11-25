-- CREDIT PRICES: A SIGNED-IN STRANGER NO LONGER READS THE MONEY (CONNECT 2026-11-23; GAMES 18:47 LOW, CC1 18:54). NOT APPLIED. AFTER WEDNESDAY unless Ryan says otherwise.
-- WHY: Ryan's answer (Q679): credit prices stay hidden while buying is closed. The page hides them, but phase-2b/credits_ledger.sql:605-609 let ANY signed-in person read public.credit_prices (every column) with their own token, so price_cents (1200 / 3000 / 6000 / 2400 / 6900) was readable by calling the API by hand.
-- WHAT: authenticated may still read every column EXCEPT price_cents (price_version, code, credits, monthly, effective_from). The page's film-cost line (app-data.js filmPrices) selects only credits, so it keeps working. The page's shop (shopOffers) selects price_cents and runs only when buying is on: when Ryan opens buying live step 69 part 4 (the one that opens buying) grants price_cents back.
-- NOT CHANGED: the policy "Signed-in people read prices" (rows stay visible), credit_view_prices and stripe_prices (no money in them), service_role and the edge functions (they read with their own role).
-- UNDO: rollbacks/20261123000800_credit_prices_hide_money_rollback.sql (puts the table-wide grant back).
begin;
revoke select on public.credit_prices from authenticated;
grant select (price_version, code, credits, monthly, effective_from) on public.credit_prices to authenticated;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
