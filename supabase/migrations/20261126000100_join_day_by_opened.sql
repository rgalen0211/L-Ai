-- SIGN-UP: THE DAY'S SIZE COUNTS OPENED EMAILS, NOT ADDRESSES ASKED FOR (BUILDER 11-26, building CONNECT's 11-25 09:11 design; GAMES 11-25 09:04
-- MEDIUM-HIGH; CC1 11-25 09:05 ruling: branch only, after launch). Branch only; never on a head without CC1 and Ryan.
-- THE PROBLEM: public.join_reserve counted the day's size (ops_settings.join_daily_max, live step 52, 35 on launch day) as DISTINCT ADDRESSES ASKED
-- FOR in 24 hours, before anything is verified. One visitor typing made-up addresses from a few networks fills the day in minutes, and every real
-- stranger after that reads 'Sign-up is full for now'.
-- THE FIX: (1) join_attempts.confirmed_at, set when that address OPENS its email (auth.users.email_confirmed_at goes from empty to set, or an account
-- is made already confirmed), by a trigger that can never stop a sign-in (its body is inside its own exception block, as 20261123000600's); (2) the
-- day's size counts DISTINCT OPENED addresses asked for in 24 hours; (3) a separate ceiling on ASKS, ops_settings.join_asks_max, empty by default =
-- 2 x the day's size (35 -> 70, so GEO's email sum 35 x 2 + 20 alerts = 90 stays under Resend's 100 a day), past it the same 'full'; (4) an address
-- that already asked today still passes both. 0 still shuts sign-up. LIMIT, said plainly: a visitor with enough networks can still reach the ASK ceiling
-- (70 made-up addresses need at least 7 networks at 10 a day each), so the day can still be closed that way, only it takes twice as much and shows in
-- the watch (GEO's row: asks vs opened; step 48 stops it at once). It MOVES the line, it does not close it, and Resend's free 100 a day can still run
-- out first. The levers that close it: a lower per-network day limit (10 -> 3 or 4 makes 70 asks need about 20 networks), and a captcha token on join
-- (Supabase Auth supports one; Ryan's later call, CC1 11-25 09:05). GAMES 11-26 15:01.
-- HOW: join_reserve is changed by TWO SHORT exact-text edits of its LIVE text (the 20261113000400 / 20261125000100 method), each refused in words if
-- its piece is not there exactly once; everything else in it stays as 20261121000800 wrote it. The pieces are short on purpose, so a planted fault in
-- 20261121000800's join_reserve still reaches tests/connect_join_open_mutants.mjs's suite (tests/mutant_blind_check.py's class).
-- Undo: rollbacks/20261126000100_join_day_by_opened_rollback.sql.
begin;

alter table public.join_attempts add column if not exists confirmed_at timestamptz;
alter table public.ops_settings add column if not exists join_asks_max integer check (join_asks_max is null or join_asks_max >= 0);
-- BACKFILL (BUILDER 11-26, found writing live step 74): addresses that ALREADY opened their email before this file is applied are marked now, so
-- the day's size does not forget the people who came in earlier today (without it the size would undercount them for up to 24 hours).
update public.join_attempts j set confirmed_at = now()
  where j.confirmed_at is null
    and exists (select 1 from auth.users u where u.email_confirmed_at is not null and btrim(coalesce(u.email, '')) <> ''
                  and encode(sha256(convert_to('ryagram-join:' || lower(btrim(u.email)), 'UTF8')), 'hex') = j.email_hash);

create or replace function ryagram_private.join_attempt_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.email_confirmed_at is null or btrim(coalesce(new.email, '')) = '' then return new; end if;
    if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;                    -- only the moment the email is opened
    update public.join_attempts set confirmed_at = coalesce(confirmed_at, now())
      where email_hash = encode(sha256(convert_to('ryagram-join:' || lower(btrim(new.email)), 'UTF8')), 'hex');
  exception when others then
    raise warning 'join_attempts confirmation not recorded: %', sqlstate;      -- never stops a sign-in
  end;
  return new;
end $$;
revoke execute on function ryagram_private.join_attempt_confirmed() from public, anon, authenticated, service_role;
drop trigger if exists join_attempt_confirmed_trg on auth.users;
create trigger join_attempt_confirmed_trg after insert or update of email_confirmed_at on auth.users
  for each row execute function ryagram_private.join_attempt_confirmed();

do $do$
declare
  def text; n int;
  p1_old constant text := E'from public.join_attempts where at > now() - interval ''1 day'')';
  p1_new constant text := E'from public.join_attempts where at > now() - interval ''1 day'' and confirmed_at is not null)';
  anchor constant text := E'  if (select count(*) from public.join_attempts where ip_hash = left(';
  asks   constant text := E'  -- the ceiling on ASKS (BUILDER 11-26): every different address asked for in 24 hours, opened or not; empty = 2 x the day''s size\n  if (select count(distinct email_hash) from public.join_attempts where at > now() - interval ''1 day'')\n       >= coalesce((select o.join_asks_max from public.ops_settings o limit 1), 2 * coalesce((select o.join_daily_max from public.ops_settings o limit 1), 200))\n     and not exists (select 1 from public.join_attempts a where a.email_hash = eh and a.at > now() - interval ''1 day'') then\n    return jsonb_build_object(''ok'', false, ''reason'', ''full'');\n  end if;\n';
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.join_reserve(text, text)');
  if def is null then
    raise exception 'public.join_reserve is not on this database; this change expects it (nothing was changed).';
  end if;
  def := replace(def, chr(13), '');
  if position(asks in def) > 0 then
    raise notice 'join_reserve: already counts opened emails, left alone.';
    return;
  end if;
  n := (length(def) - length(replace(def, p1_old, ''))) / length(p1_old);
  if n <> 1 or (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'public.join_reserve is not the one this change expects (20261121000800); nothing was changed. Send this sentence to BUILDER.';
  end if;
  execute replace(replace(def, p1_old, p1_new), anchor, asks || anchor);
end $do$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
