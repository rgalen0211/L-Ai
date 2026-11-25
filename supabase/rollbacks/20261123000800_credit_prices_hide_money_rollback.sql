-- THE EXACT UNDO of migrations/20261123000800_credit_prices_hide_money.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts back the table-wide select for signed-in people (phase-2b/credits_ledger.sql:605), so price_cents is readable through the API again. Nothing is deleted. Ends with gate_apply.
begin;
do $g$ begin
  if to_regclass('public.credit_prices') is not null then
    revoke select on public.credit_prices from authenticated;
    grant select on public.credit_prices to authenticated;
  end if;
end $g$;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;
