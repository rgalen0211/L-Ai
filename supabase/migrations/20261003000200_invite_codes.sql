-- Beta sign-up by invite code (Ryan issues codes; no open sign-up). NOT APPLIED.
--
-- Supabase's "Allow new users to sign up" stays OFF. A person with a code enters it with their
-- email; the redeem-invite Edge Function checks it here and then asks Supabase Auth to send an
-- invite email (auth.admin.inviteUserByEmail), so the person proves they own the address before
-- an account exists. That needs an email sender (custom SMTP): until there is one, the app keeps
-- the form hidden (inviteSignup: false).
--
-- Ryan, in the SQL Editor:
--   select public.invite_issue('Beta wave 1', 10, 14);   -- label, uses, days valid -> the code, shown ONCE
--   select label, uses, max_uses, expires_at, disabled from public.invite_codes order by created_at desc;
--   update public.invite_codes set disabled = true where label = 'Beta wave 1';
-- Only a SHA-256 of each code is stored, so a leaked table hands out no codes.

begin;

create table public.invite_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (char_length(label) between 1 and 120),
  max_uses int not null check (max_uses between 1 and 1000),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  check (uses <= max_uses)
);

create table public.invite_redemptions (
  id bigint generated always as identity primary key,
  code_hash text not null references public.invite_codes (code_hash) on delete cascade,
  email text not null check (char_length(email) <= 320),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'released')),
  created_at timestamptz not null default now()
);
create index invite_redemptions_code on public.invite_redemptions (code_hash);

-- Failed guesses, for throttling. ip_hash is a SHA-256 of the caller's address, kept a day.
create table public.invite_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index invite_attempts_recent on public.invite_attempts (at);

-- Codes are compared without case, spaces or dashes, and the RYA prefix is optional, so
-- "rya-k7m2 9qpx" and "K7M2-9QPX" are the same code.
create function ryagram_private.invite_normal(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case when length(n) = 8 then 'RYA' || n else n end
  from (select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) as n) x
$$;

create function ryagram_private.invite_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(ryagram_private.invite_normal(p_code), 'UTF8')), 'hex')
$$;

-- Ryan's: a new code, returned once. RYA-XXXX-XXXX from 31 unambiguous characters (no 0/O/1/I/L).
create function public.invite_issue(p_label text, p_max_uses int default 1, p_days int default 14) returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  body text := '';
  i int;
begin
  if coalesce(p_days, 0) not between 1 and 365 then
    raise exception 'A code is valid for 1 to 365 days.' using errcode = '22023';
  end if;
  for i in 0..7 loop
    body := body || substr(alphabet, (get_byte(raw, i) % 31) + 1, 1);
  end loop;
  insert into public.invite_codes (code_hash, label, max_uses, expires_at)
    values (ryagram_private.invite_hash('RYA' || body), btrim(p_label), p_max_uses, now() + make_interval(days => p_days));
  return 'RYA-' || substr(body, 1, 4) || '-' || substr(body, 5, 4);
end $$;

-- redeem-invite, step 1: is the code good? If so, take one use and open a pending redemption.
-- Returns {ok, redemption} or {ok: false, reason: 'invalid' | 'throttled'}. Every bad code counts
-- as an attempt; 10 an hour from one address, or 300 an hour overall, and guessing stops.
create function public.invite_reserve(p_code text, p_email text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.invite_codes;
  rid bigint;
begin
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 10
     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  if coalesce(p_email, '') !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$' then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;
  select * into c from public.invite_codes where code_hash = ryagram_private.invite_hash(p_code) for update;
  if not found or c.disabled or c.expires_at <= now() or c.uses >= c.max_uses
     or length(ryagram_private.invite_normal(p_code)) not between 8 and 16 then
    insert into public.invite_attempts (ip_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;
  insert into public.invite_redemptions (code_hash, email) values (c.code_hash, lower(btrim(p_email)))
    returning id into rid;
  return jsonb_build_object('ok', true, 'redemption', rid);
end $$;

-- Step 2a: the invite email went out.
create function public.invite_sent(p_redemption bigint, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update public.invite_redemptions set status = 'sent', user_id = p_user where id = p_redemption and status = 'pending'
$$;

-- Step 2b: it didn't (the address already has an account, or the email failed): the use comes back.
create function public.invite_release(p_redemption bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.invite_redemptions;
begin
  update public.invite_redemptions set status = 'released' where id = p_redemption and status = 'pending'
    returning * into r;
  if found then
    update public.invite_codes set uses = greatest(uses - 1, 0) where code_hash = r.code_hash;
  end if;
end $$;

alter table public.invite_codes enable row level security;
alter table public.invite_redemptions enable row level security;
alter table public.invite_attempts enable row level security;
revoke all on public.invite_codes, public.invite_redemptions, public.invite_attempts from anon, authenticated, service_role;

revoke execute on function ryagram_private.invite_normal(text), ryagram_private.invite_hash(text)
  from public, anon, authenticated;
revoke execute on function public.invite_issue(text, int, int), public.invite_reserve(text, text, text),
  public.invite_sent(bigint, uuid), public.invite_release(bigint) from public, anon, authenticated, service_role;
grant execute on function public.invite_reserve(text, text, text), public.invite_sent(bigint, uuid),
  public.invite_release(bigint) to service_role;
-- invite_issue is Ryan's alone (the SQL Editor runs as the owner); no role can mint codes over the API.

commit;
