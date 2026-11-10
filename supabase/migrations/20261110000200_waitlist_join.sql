-- THE WAITING LIST'S DATABASE HALF (CONNECT 2026-11-10; NEXT-CONNECT 206; Ryan's Q555 answer 2: "waiting list first, no listing while invite-only"). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- A person leaves an address and, if they like, a one-line reason. NOTHING is sent to them, NOBODY is let in by it (invite-only stays exactly as it is), no account is made. WEB builds the page.
-- Why a function and not the table insert the form uses today: a repeat address makes Postgres write 'Key (lower(email))=(a@b.c) already exists' into its own error log (the address in a log line), and that same error tells a stranger
-- whether an address is on the list. This function answers the SAME words for a new address and a repeat, never echoes the address or the reason, and its refusals never contain them.
-- Limits: one visitor (a hash of the caller's address and the day, never the address) may join 5 times an hour; the list takes at most 1000 new rows in 24 hours (the check comes before the repeat check, so a full list never tells a prober who is on it).
-- Ryan sees only COUNTS (admin_waitlist_counts) and has his own approve step (admin_waitlist_approve: the oldest N waiting rows are MARKED approved; it sends nothing, creates no account and invites nobody).
-- The table keeps its insert-only grants (ryagram-waitlist.sql); the direct insert stays open until WEB's page switches to this function, and one later row closes it. join_waitlist is for visitors (anon) only: a signed-in person does not need it.
-- Needs ryagram-waitlist.sql, 20261003000300_admin_waitlist_by_film.sql (is_app_admin) and 20261104000100_waiting_accounts.sql (the gate). Undo: supabase/rollbacks/20261110000200_waitlist_join_rollback.sql.

begin;

alter table public.ryagram_waitlist add column approved_at timestamptz, add column approved_by uuid references auth.users (id) on delete set null;

-- one row per visitor (a hash) per hour; nothing here can be read back to an address
create table public.ryagram_waitlist_hits (
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  hour timestamptz not null,
  n int not null default 1,
  primary key (key, hour)
);
alter table public.ryagram_waitlist_hits enable row level security;
revoke all on public.ryagram_waitlist_hits from public, anon, authenticated, service_role;

-- Ryan's approve steps (a number and a time; no address)
create table public.ryagram_waitlist_approvals (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_user uuid references auth.users (id) on delete set null,
  n int not null check (n >= 0)
);
alter table public.ryagram_waitlist_approvals enable row level security;
revoke all on public.ryagram_waitlist_approvals from public, anon, authenticated, service_role;

create function public.join_waitlist(p_email text, p_reason text default null, p_source text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  em text := lower(btrim(coalesce(p_email, '')));
  why text := nullif(btrim(coalesce(p_reason, '')), '');
  src text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'uselai.com/ryagram');
  hdr text; ip text; k text; hits int; today int;
begin
  if char_length(em) > 254 or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;
  if why is not null and (char_length(why) > 140 or why ~ '[[:cntrl:]]') then
    raise exception 'Keep the reason to one short line, at most 140 characters.' using errcode = '22023';
  end if;
  if char_length(src) > 100 or src !~ '^[A-Za-z0-9._~:/?&=%+#-]+$' then src := 'uselai.com/ryagram'; end if;       -- the film link's own label: a bad one falls back, it is never an error
  -- the visitor: a hash of the caller's address and the day. Without an address (no header) this limit is skipped and the daily cap below is the only brake.
  begin hdr := current_setting('request.headers', true)::json ->> 'x-forwarded-for'; exception when others then hdr := null; end;
  ip := btrim(split_part(coalesce(hdr, ''), ',', 1));
  if ip <> '' then
    k := encode(sha256(convert_to('waitlist:' || ip || ':' || current_date::text, 'utf8')), 'hex');
    delete from public.ryagram_waitlist_hits where hour < now() - interval '2 days';
    insert into public.ryagram_waitlist_hits (key, hour) values (k, date_trunc('hour', now()))
      on conflict (key, hour) do update set n = public.ryagram_waitlist_hits.n + 1 returning n into hits;
    if hits > 5 then
      raise exception 'The list is busy from where you are. Try again in an hour.' using errcode = 'PT429';
    end if;
  end if;
  select count(*) into today from public.ryagram_waitlist where created_at > now() - interval '24 hours';
  if today >= 1000 then
    raise exception 'The list is busy right now. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.ryagram_waitlist (email, use_case, source) values (em, why, src) on conflict (lower(email)) do nothing;       -- a repeat is not an error and is not told apart
  return jsonb_build_object('ok', true, 'message', 'You are on the list. Nothing is sent to you now; if you are invited, the invitation comes by email.');
end $$;

revoke all on function public.join_waitlist(text, text, text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, text) to anon;

-- counts only: never an address, a reason or a name
create function public.admin_waitlist_counts() returns table (waiting int, joined_24h int, approved int, invited int)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin();           -- an admin acts from the app, never through a connected AI (the repository's one admin guard)
begin
  return query select (count(*) filter (where w.approved_at is null and w.invited_at is null))::int,
                      (count(*) filter (where w.created_at > now() - interval '24 hours'))::int,
                      (count(*) filter (where w.approved_at is not null))::int,
                      (count(*) filter (where w.invited_at is not null))::int
                 from public.ryagram_waitlist w;
end $$;

-- Ryan's approve step: mark the oldest N waiting rows approved. It sends nothing, makes no account and invites nobody; a later, separate step may read the approved rows.
create function public.admin_waitlist_approve(p_count int) returns int
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_admin(); n int;     -- an admin acts from the app, never through a connected AI
begin
  if coalesce(p_count, 0) not between 1 and 500 then
    raise exception 'Choose 1 to 500 people to approve.' using errcode = '22023';
  end if;
  with pick as (
    select id from public.ryagram_waitlist where approved_at is null and invited_at is null order by created_at, id limit p_count for update skip locked)
  update public.ryagram_waitlist w set approved_at = now(), approved_by = me from pick where w.id = pick.id;
  get diagnostics n = row_count;
  insert into public.ryagram_waitlist_approvals (by_user, n) values (me, n);
  return n;
end $$;

revoke all on function public.admin_waitlist_counts(), public.admin_waitlist_approve(int) from public, anon, authenticated;
grant execute on function public.admin_waitlist_counts(), public.admin_waitlist_approve(int) to authenticated;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list: the gate covers what a signed-in account can run

commit;
