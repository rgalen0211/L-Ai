-- A PAYING CUSTOMER'S DELETE REQUEST ENDS THEIR AI CONNECTIONS (GEO, 2026-11-21; CC1 12:1x number 000550; split from 000600 after
-- GAMES 12:12 so it does not depend on Q634's prepared data). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- account_request_deletion (its only version, 20260929000900, copied; lines added) is called by delete-account ONLY for an
-- account with credit history, right after the erase step; the login then stays blocked until Ryan closes the account by hand.
-- Now it also revokes that person's AI connection grants and tokens. ORDER: 20261121000600_prepared_tombstone.sql (if applied)
-- redefines this function again, copied from THIS body plus its own lines, so applying in version order (000550, then 000600)
-- ends with both; a test checks 000600 still carries every line of this one. Grants kept (create or replace). Service role only.
begin;
create or replace function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
  -- GEO 11-21 (CC1 12:1x; GAMES 12:12): a paying customer's login stays (blocked) until Ryan's hand close, so nothing
  -- cascades yet. The auth ban stops a sign-in, but connect_actor reads only the connector's own tokens and grants:
  -- without this their AI could keep acting on the account. A revoked grant also refuses a refresh and a code exchange.
  update public.connect_grants set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = p_owner and revoked_at is null;
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;
