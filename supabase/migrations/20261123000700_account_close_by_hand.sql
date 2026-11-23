-- CLOSE AN ACCOUNT BY HAND (GEO, 2026-11-23; CC1 17:07: number 20261123000700 reserved, lands AFTER Wednesday's preview, not in Tuesday's head).
-- NOT APPLIED: Ryan applies it after 20261123000600_welcome_credits.sql. Rollback: supabase/rollbacks/20261123000700_account_close_by_hand_rollback.sql.
-- Check and use: supabase/live-steps/64_account_close_by_hand.sql.
--
-- WHY: an account with credit history (every verified stranger since the 8 welcome credits) cannot be hard-deleted: credit_ledger.owner_id is ON DELETE
-- RESTRICT, the ledger is the financial record. 'Delete my account' therefore already removes the person's files and uploads, takes their email out of
-- support and invite rows, blocks the login and records a request (delete-account/remove.ts). What was missing is the CLOSE: one checked step that ends
-- the login for good without deleting the row the ledger needs. This is it, following Supabase's own soft delete (auth's user.go SoftDeleteUser):
--   * auth.users: the email and the phone are set to NULL (no unique index can collide), the password and every sign-in token are emptied, the person's
--     own metadata (raw_user_meta_data) becomes '{}' (the app metadata, which only names the sign-in provider, stays), deleted_at is set where that
--     column exists; the ban stays;
--   * auth.identities (where it exists): identity_data becomes '{}' and provider_id becomes 'closed:' || the user id || ':' || provider (unique per row);
--   * live sessions end: auth.sessions rows go (refresh tokens follow by cascade), and auth.one_time_tokens and auth.mfa_factors rows go, where they exist;
--   * public.account_deletion_requests: the email is cleared and closed_at is set (a new column); the row stays as the record that the close was done.
-- It REFUSES an owner with no open request (nothing to close by accident) and NEVER touches the ledger, a film, or another person. Columns and tables are
-- touched only if they exist, so the same file runs on hosted Supabase and on the test stub. Only the database owner (the dashboard) may call it.
begin;

alter table public.account_deletion_requests add column closed_at timestamptz;

create function public.account_close_by_hand(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  req public.account_deletion_requests;
  col text;
  scrubbed text[] := '{}';
  sessions_ended int := 0;
  identities int := 0;
begin
  select * into req from public.account_deletion_requests where owner_id = p_owner for update;
  if not found or req.closed_at is not null then
    raise exception 'No open deletion request for this account: nothing was changed.' using errcode = 'PTCLS';
  end if;
  -- the login: NULL where a unique index could collide, '' for tokens (as Supabase's soft delete), '{}' for the person's metadata
  foreach col in array array['email', 'phone', 'encrypted_password'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = col) then
      execute format('update auth.users set %I = null where id = $1', col) using p_owner;
      scrubbed := scrubbed || col;
    end if;
  end loop;
  foreach col in array array['email_change', 'phone_change', 'confirmation_token', 'recovery_token', 'email_change_token_new',
                             'email_change_token_current', 'phone_change_token', 'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = col) then
      execute format('update auth.users set %I = %L where id = $1', col, '') using p_owner;
      scrubbed := scrubbed || col;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data') then
    update auth.users set raw_user_meta_data = '{}'::jsonb where id = p_owner;
    scrubbed := scrubbed || 'raw_user_meta_data'::text;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'deleted_at') then
    execute 'update auth.users set deleted_at = now() where id = $1' using p_owner;
  end if;
  -- the sign-in identities
  if to_regclass('auth.identities') is not null then
    execute $q$update auth.identities set identity_data = '{}'::jsonb, provider_id = 'closed:' || user_id::text || ':' || provider where user_id = $1$q$ using p_owner;
    get diagnostics identities = row_count;
  end if;
  -- live sessions and one-time links
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_owner;
    get diagnostics sessions_ended = row_count;
  end if;
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using p_owner;
  end if;
  if to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors where user_id = $1' using p_owner;
  end if;
  update public.account_deletion_requests set email = null, closed_at = now() where owner_id = p_owner;
  return jsonb_build_object('closed', true, 'login_fields_cleared', scrubbed, 'identities_cleared', identities, 'sessions_ended', sessions_ended);
end $$;

revoke execute on function public.account_close_by_hand(uuid) from public, anon, authenticated, service_role;   -- the dashboard (the owner) only

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
