-- THE APP LINK IN THE INVITE EMAIL (NEXT-CONNECT 162; Ryan 10-26 wanted the download delivered through the invite, a link just for that person that expires). NOT APPLIED: a migration for CC1's review;
-- applying it is a live step Ryan takes. It is behind TWO more switches that are OFF: the send-invite function adds a link only when INVITE_APP_LINK=1 AND the admin asked for it for that invite, and the
-- app-link function answers only when APP_LINK_ON=1. Mail itself stays OFF until Ryan's OPS_MAIL_MODE=resend.
--
-- WHAT IT IS. When an admin sends an invite and asks for the app link, the database makes ONE random token for that invite and keeps only its SHA-256. The email carries the token in a link to the app-link
-- function. The link is a page with a Download button (a mail program's link checker that merely opens the link cannot use it up); pressing the button turns the token into a 15-minute signed link to the app and
-- the token is dead. The token also dies when it expires (7 days, or when the invite code expires if sooner), when the invite code is disabled or used up elsewhere, or when the admin sends the invite again (a
-- new link replaces the old one). Anyone later who wants the app signs in and uses the Windows card as before.
--
--   invite_app_links                    code_hash (the invite), token_hash (SHA-256 of the token; the token itself is never stored), expires_at, used_at. RLS on; nobody but the definer functions below touches it.
--   admin_invite_app_link_make(code)    admin only (the caller's own login; an AI's token is refused upstream): the invite must have been SENT (invite_sends) and still be usable; replaces older unused links for
--                                       that invite; returns {token, expires_at} ONCE. The token goes only into the email.
--   peek_invite_app_link(token_hash)    service role only: is this link good? Returns {ok, file_name, size_bytes} or {ok:false}; changes nothing (so the page can say what it is before the button).
--   redeem_invite_app_link(token_hash)  service role only: the button. One atomic step: the link must be unused and unexpired, its invite code not disabled, an active 'app' release must exist; marks it used and
--                                       returns the release exactly as request_app_download does (object key, 900 seconds), and writes NO app_downloads row (that table belongs to signed-in accounts).
-- Requires: 20261026000500_app_downloads.sql, 20261027000800_invite_email.sql (invite_sends), 20261003000200_invite_codes.sql. Undo: supabase/rollbacks/20261030000100_invite_app_links_rollback.sql.

begin;

create table public.invite_app_links (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null references public.invite_codes (code_hash) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at));
create index invite_app_links_code_idx on public.invite_app_links (code_hash);
alter table public.invite_app_links enable row level security;
revoke all on public.invite_app_links from public, anon, authenticated, service_role;

-- The token is 64 hex letters (two random UUIDs); only its hash is kept.
create function public.admin_invite_app_link_make(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h text := ryagram_private.invite_hash(p_code); c public.invite_codes; token text; exp timestamptz;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can send invites.' using errcode = '42501';
  end if;
  select * into c from public.invite_codes where code_hash = h;
  if not found or c.label not like 'invite: %' then
    raise exception 'That invite code is not one you can send from here.' using errcode = 'P0001';
  end if;
  if c.disabled or c.expires_at <= now() or c.uses >= c.max_uses then
    raise exception 'That invite code has expired or was already used.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invite_sends s where s.code_hash = h) then
    raise exception 'Send the invite first; the app link belongs to a sent invite.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.app_releases r where r.kind = 'app' and r.active) then
    raise exception 'The app download is not ready yet, so there is nothing to link to.' using errcode = 'P0001';
  end if;
  delete from public.invite_app_links where code_hash = h and used_at is null;             -- a newer link replaces an older unused one
  token := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
  exp := least(c.expires_at, now() + interval '7 days');
  insert into public.invite_app_links (token_hash, code_hash, expires_at) values (encode(sha256(convert_to(token, 'UTF8')), 'hex'), h, exp);
  return jsonb_build_object('token', token, 'expires_at', exp);
end $$;

create function public.peek_invite_app_link(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.invite_app_links; r public.app_releases;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false); end if;
  select * into l from public.invite_app_links where token_hash = p_token_hash;
  if not found or l.used_at is not null or l.expires_at <= now() then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from public.invite_codes c where c.code_hash = l.code_hash and not c.disabled) then return jsonb_build_object('ok', false); end if;
  select * into r from public.app_releases where kind = 'app' and active;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'file_name', r.file_name, 'size_bytes', r.size_bytes);
end $$;

create function public.redeem_invite_app_link(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.invite_app_links; r public.app_releases;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'That link is not good.' using errcode = 'PT404';
  end if;
  select * into r from public.app_releases where kind = 'app' and active;
  if not found then
    raise exception 'The download is not ready yet.' using errcode = 'PT404';
  end if;
  update public.invite_app_links x set used_at = now()
    where x.token_hash = p_token_hash and x.used_at is null and x.expires_at > now()
      and exists (select 1 from public.invite_codes c where c.code_hash = x.code_hash and not c.disabled)
    returning * into l;
  if not found then
    raise exception 'That link has been used, has expired, or is no longer good.' using errcode = 'PT404';
  end if;
  return jsonb_build_object('kind', r.kind, 'file_name', r.file_name, 'size_bytes', r.size_bytes, 'sha256', r.sha256, 'object_key', r.object_key, 'expires_seconds', 900);
end $$;

revoke all on function public.admin_invite_app_link_make(text) from public, anon;
grant execute on function public.admin_invite_app_link_make(text) to authenticated;
revoke all on function public.peek_invite_app_link(text), public.redeem_invite_app_link(text) from public, anon, authenticated;
grant execute on function public.peek_invite_app_link(text), public.redeem_invite_app_link(text) to service_role;

commit;
