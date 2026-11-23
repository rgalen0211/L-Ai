-- WELCOME CREDITS (CONNECT, 2026-11-23; Ryan's 15:46 answer to Q679 B: "8 welcome credits, one per verified email").
-- NOT APPLIED: Ryan applies it, AFTER the credits ledger (phase-2b/credits_ledger.sql, live: Q673 check 1), 20261104000100_waiting_accounts.sql and 20261121000800_join_open.sql. Rollback: supabase/rollbacks/20261123000600_welcome_credits_rollback.sql. Check: supabase/live-steps/63_welcome_credits_check.sql.
--
-- WHAT IT DOES: when a person's email is VERIFIED (auth.users.email_confirmed_at goes from empty to set, or a row is made already confirmed), they get ops_settings.welcome_credits credits (8 unless Ryan changes it; 0 = off) in the credit ledger, ONCE for each email
-- address EVER. An unopened sign-up email gets nothing (nothing is verified); an account verified before this file is applied is not touched (the trigger sees only a change from empty to set).
-- ONCE PER ADDRESS: ryagram_private.welcome_credit_grants keeps only a SCRAMBLED copy of the address (sha256 of 'ryagram-welcome:' + the lower-cased, trimmed address), no user id and no foreign key, so deleting the account does not forget it: a deleted and remade account does not get them again.
-- THE GRANT goes ONLY through public.grant_credits (the ledger's own function: a positive grant into the 'granted' pool; for a WAITING account the existing guard holds it and pays it at activation).
-- NOT GIVEN TO: an invite-code account (an invite_redemptions row for the address, or adult_source 'invite' in its metadata: it keeps its own credits and is not given 8 more), an administrator, a worker.
-- IT NEVER STOPS A SIGN-UP OR A LINK CLICK: the whole body is inside a block that turns any error into a warning (a missing ledger, a failed grant); the once-per-address record rolls back with a failed grant, so nothing is half done.
-- The migration touches no existing function and no existing row. Only the dashboard (the table owner) can change the setting.
begin;

alter table public.ops_settings add column welcome_credits integer not null default 8 check (welcome_credits between 0 and 100);        -- Ryan's lever: credits given at verification; 0 = off

create table ryagram_private.welcome_credit_grants (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz not null default now()
);
revoke all on ryagram_private.welcome_credit_grants from public, anon, authenticated, service_role;

create function ryagram_private.welcome_credits_on_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mail text; eh text; n int;
begin
  begin
    if new.email_confirmed_at is null or btrim(coalesce(new.email, '')) = '' then return new; end if;
    if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;                  -- only the moment of verification
    n := coalesce((select o.welcome_credits from public.ops_settings o limit 1), 0);
    if n <= 0 then return new; end if;
    mail := lower(btrim(new.email));
    if exists (select 1 from public.workers w where w.user_id = new.id) or exists (select 1 from public.app_admins a where a.user_id = new.id) then return new; end if;
    if coalesce(new.raw_user_meta_data ->> 'adult_source', '') = 'invite' or exists (select 1 from public.invite_redemptions r where r.email = mail) then return new; end if;     -- an invite-code account keeps its own credits
    eh := encode(sha256(convert_to('ryagram-welcome:' || mail, 'UTF8')), 'hex');
    insert into ryagram_private.welcome_credit_grants (email_hash) values (eh) on conflict (email_hash) do nothing;
    if not found then return new; end if;                                                               -- this address has had its welcome credits already, whichever account it was
    perform public.grant_credits(new.id, 'grant', n, 'Welcome credits (email verified)', 'welcome');
  exception when others then
    raise warning 'welcome credits not granted: %', sqlstate;                                           -- never a failed sign-up or link click
  end;
  return new;
end $$;
revoke execute on function ryagram_private.welcome_credits_on_verified() from public, anon, authenticated, service_role;

create trigger welcome_credits_trg after insert or update of email_confirmed_at on auth.users for each row execute function ryagram_private.welcome_credits_on_verified();

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
