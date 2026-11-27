-- OWNER-ONLY TEST CREDIT TOP-UP, SERVER HALF (BUILDER 2026-11-27; Claude's wave-6 order of 11-26 23:00 for Ryan). NOT APPLIED: Ryan applies it (live step 78). Undo: supabase/rollbacks/20261127000100_owner_test_topup_rollback.sql.
-- Ryan runs films on his own test accounts and they run out of credits. Today the only refill is a hand-typed grant_credits in the SQL Editor. This adds ONE admin call that refills an account, and ONLY an account on a list Ryan keeps:
--   * ryagram_private.test_topup_accounts: the owner list. EMPTY when applied. Only the dashboard (the table owner) can add or remove a row: live steps 78c (add one account by email) and 78d (remove one). No API role can read or write it.
--   * public.admin_test_topup(email, credits, note): an admin from the app only (require_admin: an admin connected through an AI is refused). Refuses in words, and grants NOTHING, when the account is not on the list (the same words whether or
--     not the address has an account, so it never says who has one), when the credits are not 1 to 100, when this account's top-ups in the last 24 hours would pass 200, or when the note is not 3 to 200 characters.
--     The credits go ONLY through public.grant_credits (a 'grant' into the 'granted' pool, created_by 'test-topup:<admin id>'), so every existing rule on grants still holds. Every top-up is a row in the log below. Returns the log row id.
--   * public.admin_test_topup_undo(id, note): the undo. Takes back what is still UNSPENT of that one top-up (at most its credits, at most the account's 'granted' pool balance), through public.adjust_credits (a signed 'adjustment' row:
--     the ledger stays append-only). Once per top-up. Says in words when nothing is left to take back. Works even after the account is taken off the list (an undo only ever takes credits away).
--   * public.admin_test_topup_list(): the last 100 top-ups, newest first, with the account's email, for the admin page and for picking an id to undo.
--   * ryagram_private.test_topups: the log (who, how many, why, which ledger row, and the undo). Closed to every API role; nothing deletes from it but the rollback.
-- Nobody else's credits can change: no stranger is on the list, and the list has no API writer.
-- Apply AFTER: phase-2b/credits_ledger.sql (grant_credits, adjust_credits, lock_owner, pool_balance; live), 20261017000600_pipe1_orders.sql (require_admin), 20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
-- The ledger functions are named only inside function bodies, so this file also applies where the ledger comes later (the local test template).
begin;

create table ryagram_private.test_topup_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by text not null default current_user check (char_length(added_by) between 1 and 100)
);
revoke all on ryagram_private.test_topup_accounts from public, anon, authenticated, service_role;

create table ryagram_private.test_topups (
  id bigint generated always as identity primary key,
  owner_id uuid not null,                                                           -- no foreign key: the ledger already keeps the account from being deleted while it has rows
  credits int not null check (credits between 1 and 100),
  note text not null check (char_length(note) between 3 and 200),
  by_admin uuid not null,
  ledger_id bigint not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  undo_note text check (undo_note is null or char_length(undo_note) between 3 and 200),
  undo_ledger_id bigint,
  taken_back int check (taken_back is null or taken_back between 0 and credits),
  check ((undone_at is null) = (taken_back is null) and (undone_at is null) = (undone_by is null) and (undone_at is null) = (undo_note is null))
);
create index test_topups_owner_idx on ryagram_private.test_topups (owner_id, created_at);
revoke all on ryagram_private.test_topups from public, anon, authenticated, service_role;

create function public.admin_test_topup(p_email text, p_credits int, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();           -- an admin acts from the app, never through a connected AI
        target uuid; recent int; lid bigint; tid bigint;
begin
  if p_credits is null or p_credits not between 1 and 100 then
    raise exception 'A test top-up is 1 to 100 credits.' using errcode = '22023';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 3 and 200 then
    raise exception 'Say what the credits are for, in a few words.' using errcode = '22023';
  end if;
  select a.user_id into target from ryagram_private.test_topup_accounts a join auth.users u on u.id = a.user_id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if target is null then
    raise exception 'That address is not on the owner test-account list, so nothing was given. Only Ryan adds accounts to the list (live step 78c).' using errcode = '42501';
  end if;
  perform ryagram_private.lock_owner(target);                  -- the same lock the ledger takes: two top-ups for one account never both pass the day's limit
  recent := coalesce((select sum(t.credits - coalesce(t.taken_back, 0)) from ryagram_private.test_topups t
                       where t.owner_id = target and t.created_at > now() - interval '24 hours'), 0);
  if recent + p_credits > 200 then
    raise exception 'This account has had % test credits in the last 24 hours; at most 200 a day.', recent using errcode = '22023';
  end if;
  lid := public.grant_credits(target, 'grant', p_credits, 'Owner test top-up: ' || btrim(p_note), 'test-topup:' || me::text);
  if lid is null then
    raise exception 'The credits ledger did not take the grant, so nothing was given.' using errcode = '55000';
  end if;
  insert into ryagram_private.test_topups (owner_id, credits, note, by_admin, ledger_id)
    values (target, p_credits, btrim(p_note), me, lid) returning id into tid;
  return tid;
end $$;

create function public.admin_test_topup_undo(p_topup_id bigint, p_note text) returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
        t ryagram_private.test_topups; left_over int; back int; lid bigint;
begin
  if p_note is null or char_length(btrim(p_note)) not between 3 and 200 then
    raise exception 'Say why it is being undone, in a few words.' using errcode = '22023';
  end if;
  select * into t from ryagram_private.test_topups where id = p_topup_id;
  if t.id is null then
    raise exception 'No test top-up with that number.' using errcode = 'PT404';
  end if;
  perform ryagram_private.lock_owner(t.owner_id);
  select * into t from ryagram_private.test_topups where id = p_topup_id for update;     -- read again under the lock: two undos never both take credits back
  if t.undone_at is not null then
    raise exception 'That top-up was already undone.' using errcode = '22023';
  end if;
  left_over := greatest(ryagram_private.pool_balance(t.owner_id, 'granted'), 0);
  back := least(t.credits, left_over);
  if back > 0 then
    lid := public.adjust_credits(t.owner_id, 'granted', -back, 'Undo of owner test top-up ' || t.id || ': ' || btrim(p_note), 'test-topup:' || me::text);
  end if;
  update ryagram_private.test_topups set undone_at = now(), undone_by = me, undo_note = btrim(p_note), undo_ledger_id = lid, taken_back = back where id = t.id;
  return back;                                                 -- 0 means every credit of it was already spent: nothing was taken back, and it is marked undone
end $$;

create function public.admin_test_topup_list() returns table (id bigint, user_email text, credits int, note text, created_at timestamptz, undone_at timestamptz, taken_back int)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();
begin
  return query select t.id, u.email::text, t.credits, t.note, t.created_at, t.undone_at, t.taken_back
                 from ryagram_private.test_topups t left join auth.users u on u.id = t.owner_id
                order by t.id desc limit 100;
end $$;

revoke execute on function public.admin_test_topup(text, int, text), public.admin_test_topup_undo(bigint, text), public.admin_test_topup_list() from public, anon, service_role;
grant execute on function public.admin_test_topup(text, int, text), public.admin_test_topup_undo(bigint, text), public.admin_test_topup_list() to authenticated;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
