-- Connect your own AI (CONNECT, option B): an authorization server of our own, and the tool functions an AI
-- assistant uses, for the REMOTE connector (Edge Function `connect`). Design: CONNECT-DESIGN.md, REVISION 2.
--
-- Why our own: a token from Supabase's OAuth server is a full Supabase credential (it can change the password and
-- enrol 2FA through /auth/v1, proven on a throwaway project). A connect token is NOT a JWT and means nothing to
-- Supabase Auth, PostgREST, GraphQL, Storage or Realtime.
--
-- Who may call what:
--   * connect_runner  (a LOGIN role with NO table, sequence or schema privileges of its own; its only privilege is
--                      EXECUTE on the connect_* functions below). The `connect` Edge Function connects as it.
--     - authorization-server functions (register / begin / exchange / refresh / revoke)
--     - tool functions. EVERY one takes p_token_hash (SHA-256 hex of the opaque access token) and resolves the owner
--       INSIDE, in the same transaction, from connect_tokens: not revoked, not expired, owner still invited, not an
--       admin, the grant for that client not revoked, the scope granted. NO connect_* function takes an owner id, so a
--       leaked connect_runner connection string alone acts as nobody; it also needs a live token.
--   * authenticated (an app session; NEVER a connect token): the consent and settings functions, and the admin ones.
-- The app's own rules are not copied: after the actor is resolved, a tool function sets request.jwt.claims for THIS
-- TRANSACTION ONLY (set_config(..., true)) so auth.uid() is the owner, then calls the same functions the app calls.
--
-- The role's login and password are set by the person who owns the project, from a file that lives OUTSIDE every repo
-- (D:\Ryagram-scratch\secrets-staging\connect_runner_login.sql, runbook in docs/connect-runbook.md): a password is never in a migration, a repo or a chat.

-- ------------------------------------------------------------------------------------------------------ role
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'connect_runner') then
    create role connect_runner nologin noinherit;
  end if;
end $$;
grant usage on schema public to connect_runner;

-- ---------------------------------------------------------------------------------------------------- tables
-- All have row security ON with no policies and no grants to the API roles: only the definer functions below touch them.

create table public.connect_access (                       -- invited accounts (friends test)
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now());

create table public.connect_clients (                      -- dynamic client registration (RFC 7591)
  client_id text primary key default ('rgc_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null check (char_length(name) between 1 and 80),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  created_at timestamptz not null default now());

create table public.connect_redirect_allowlist (           -- Ryan's list; nothing else may be registered or reach consent
  redirect_uri text primary key check (char_length(redirect_uri) <= 300),
  kind text not null default 'exact' check (kind in ('exact', 'loopback')),   -- loopback: http://localhost|127.0.0.1|[::1], any port
  label text not null,
  enabled boolean not null default true);

create table public.connect_requests (                     -- an authorization waiting for the person's decision
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.connect_clients (client_id) on delete cascade,
  redirect_uri text not null,
  state text check (char_length(state) <= 512),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),   -- S256 of a 32-byte verifier; never "plain"
  scopes text[] not null,
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  decided_at timestamptz);

create table public.connect_codes (                        -- authorization codes, hashed, single use, 5 minutes
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null references public.connect_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null,
  family_id uuid,
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz);

create table public.connect_tokens (                       -- opaque tokens, stored only as SHA-256 hashes
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null references public.connect_clients (client_id) on delete cascade,
  scopes text[] not null,
  access_hash text not null unique check (access_hash ~ '^[0-9a-f]{64}$'),
  access_expires_at timestamptz not null,
  refresh_hash text not null unique check (refresh_hash ~ '^[0-9a-f]{64}$'),
  refresh_expires_at timestamptz not null,
  refresh_used_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz);
create index connect_tokens_family_idx on public.connect_tokens (family_id);
create index connect_tokens_owner_idx on public.connect_tokens (owner_id, client_id);

create table public.connect_grants (                       -- what a person allowed a client to do (scopes live HERE, not in a token)
  owner_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null references public.connect_clients (client_id) on delete cascade,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (owner_id, client_id));

create table public.connect_calls (                        -- one row per tool call; NO arguments, story text or tokens
  id bigserial primary key,
  at timestamptz not null default now(),
  owner_id uuid references auth.users (id) on delete set null,
  client_id text,
  tool text not null check (tool ~ '^[a-z0-9_]{1,40}$'),
  credits int not null default 0,
  result text not null check (result in ('ok', 'refused', 'error')),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  failed_checks int not null default 0);
create index connect_calls_at_idx on public.connect_calls (at);

create table public.connect_buckets (                      -- fixed-window rate counters
  who text not null,
  bucket text not null,
  window_start timestamptz not null,
  n int not null default 0,
  primary key (who, bucket, window_start));

create table public.connect_flags (
  id boolean primary key default true check (id),
  full_render_enabled boolean not null default false);     -- full renders from a connection: OFF; also refused in SQL until PIPE's approve queue exists
insert into public.connect_flags (id) values (true);

alter table public.connect_access enable row level security;
alter table public.connect_clients enable row level security;
alter table public.connect_redirect_allowlist enable row level security;
alter table public.connect_requests enable row level security;
alter table public.connect_codes enable row level security;
alter table public.connect_tokens enable row level security;
alter table public.connect_grants enable row level security;
alter table public.connect_calls enable row level security;
alter table public.connect_buckets enable row level security;
alter table public.connect_flags enable row level security;
revoke all on public.connect_access, public.connect_clients, public.connect_redirect_allowlist, public.connect_requests,
  public.connect_codes, public.connect_tokens, public.connect_grants, public.connect_calls, public.connect_buckets,
  public.connect_flags from public, anon, authenticated;
revoke all on sequence public.connect_calls_id_seq from public, anon, authenticated;

-- -------------------------------------------------------------------------------------------------- helpers
create function ryagram_private.connect_pct(s text) returns text      -- percent-encode (RFC 3986) for a redirect query
language plpgsql immutable set search_path = '' as $$
declare b bytea := convert_to(coalesce(s, ''), 'UTF8'); out text := ''; i int; c int;
begin
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if (c between 48 and 57) or (c between 65 and 90) or (c between 97 and 122) or c in (45, 46, 95, 126) then
      out := out || chr(c);
    else
      out := out || '%' || upper(lpad(to_hex(c), 2, '0'));
    end if;
  end loop;
  return out;
end $$;

create function ryagram_private.connect_uri_ok(p_uri text) returns boolean   -- exact allowlist row, or loopback when allowed
language sql stable set search_path = '' as $$
  select p_uri is not null and char_length(p_uri) <= 300 and p_uri !~ '[#[:space:]]' and (
    exists (select 1 from public.connect_redirect_allowlist a
            where a.enabled and a.kind = 'exact' and a.redirect_uri = p_uri and p_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[^#[:space:]]*$')
    or (p_uri ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'
        and exists (select 1 from public.connect_redirect_allowlist a where a.enabled and a.kind = 'loopback')))
$$;

-- Offered scopes for a person: render_final is never offered from a connection yet.
create function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free']::text[] $$;

-- The consent and settings functions are for the person's OWN app session. A Supabase-issued OAuth token (it carries client_id)
-- must never reach them, even though connect tokens are not JWTs at all (defence in depth, and the live project may one day
-- register OAuth clients of its own).
create function ryagram_private.connect_app_session() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if nullif(auth.jwt() ->> 'client_id', '') is not null then
    raise exception 'This is only available from your own Ryagram session.' using errcode = '42501';
  end if;
  return ryagram_private.require_signed_in();
end $$;

-- Can this person use connections at all? (invited, enabled, not an admin)
create function ryagram_private.connect_person_ok(p_owner uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.connect_access a where a.user_id = p_owner and a.enabled)
     and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
$$;

-- THE ACTOR. Resolves the owner from the token and re-checks everything, on every call. p_scope null = any valid token.
-- Then makes auth.uid() the owner for THIS TRANSACTION ONLY, so the app's own functions can be called unchanged.
create function ryagram_private.connect_actor(p_token_hash text, p_scope text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.connect_tokens;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Sign in to Ryagram to use this connection.' using errcode = 'PT401';
  end if;
  select * into t from public.connect_tokens k
    where k.access_hash = p_token_hash and k.revoked_at is null and k.access_expires_at > now();
  if not found then
    raise exception 'Sign in to Ryagram to use this connection.' using errcode = 'PT401';
  end if;
  if not ryagram_private.connect_person_ok(t.owner_id)
     or not exists (select 1 from public.connect_grants g where g.owner_id = t.owner_id and g.client_id = t.client_id
                    and g.revoked_at is null and (p_scope is null or p_scope = any (g.scopes)))
     or (p_scope is not null and not (p_scope = any (t.scopes))) then
    raise exception 'This account is not enabled for AI connections, or the connection was revoked or does not allow that.'
      using errcode = 'PT403';
  end if;
  perform set_config('request.jwt.claim.sub', t.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim', json_build_object('sub', t.owner_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', t.owner_id, 'role', 'authenticated')::text, true);
  update public.connect_tokens set last_used_at = now() where id = t.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return t.owner_id;
end $$;

-- ------------------------------------------------------------------------- authorization server (connect_runner)
create function public.connect_register_client(p_name text, p_redirect_uris text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare uri text; id text; n int;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]' then
    raise exception 'invalid_client_metadata: a client name is required' using errcode = 'PT400'; end if;
  if p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 5 then
    raise exception 'invalid_redirect_uri: one to five redirect URIs' using errcode = 'PT400'; end if;
  foreach uri in array p_redirect_uris loop
    if not ryagram_private.connect_uri_ok(uri) then
      raise exception 'invalid_redirect_uri: that address is not on Ryagram''s list of allowed sign-in return addresses' using errcode = 'PT400';
    end if;
  end loop;
  -- a global backstop on registrations: 600 an hour (the Edge function limits each caller far lower, see connect_anon_hit)
  insert into public.connect_buckets (who, bucket, window_start, n)
    values ('global', 'register', date_trunc('hour', now()), 1)
    on conflict (who, bucket, window_start) do update set n = public.connect_buckets.n + 1
    returning public.connect_buckets.n into n;
  if n > 600 then raise exception 'slow_down: too many registrations' using errcode = 'PT429'; end if;
  insert into public.connect_clients (name, redirect_uris) values (btrim(p_name), p_redirect_uris) returning client_id into id;
  return id;
end $$;

create function public.connect_begin_authorization(p_client_id text, p_redirect_uri text, p_state text, p_code_challenge text,
                                                    p_method text, p_scope text, p_resource text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.connect_clients; want text[]; id uuid;
begin
  select * into c from public.connect_clients where client_id = p_client_id;
  if not found then raise exception 'invalid_client' using errcode = 'PT400'; end if;
  if p_redirect_uri is null or not (p_redirect_uri = any (c.redirect_uris)) or not ryagram_private.connect_uri_ok(p_redirect_uri) then
    raise exception 'invalid_redirect_uri' using errcode = 'PT400'; end if;
  if p_method is distinct from 'S256' then raise exception 'invalid_request: code_challenge_method must be S256' using errcode = 'PT400'; end if;
  if (select count(*) from public.connect_requests q where q.client_id = p_client_id and q.decided_at is null and q.expires_at > now()) >= 20 then
    raise exception 'slow_down: too many sign-ins waiting for this assistant' using errcode = 'PT429'; end if;
  if p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid_request: bad code_challenge' using errcode = 'PT400'; end if;
  want := coalesce(nullif(regexp_split_to_array(btrim(coalesce(p_scope, '')), '\s+'), array['']), array['read']);
  -- OAuth scope words the assistants send (openid, offline_access, profile, email) are ignored; ours are the tool scopes.
  -- Asking for nothing we know means the least we have: read.
  want := array(select s from unnest(want) s where s = any (ryagram_private.connect_offered_scopes()));
  if cardinality(want) = 0 then want := array['read']; end if;
  insert into public.connect_requests (client_id, redirect_uri, state, code_challenge, scopes, resource)
    values (p_client_id, p_redirect_uri, left(p_state, 512), p_code_challenge, want, left(p_resource, 300)) returning connect_requests.id into id;
  return id;
end $$;

-- Grant failures are RETURNED, not raised: a raise would roll back the revocation done on a replay or a reuse.
-- {"error": "invalid_grant"} -> the Edge function answers 400 invalid_grant.
create function public.connect_exchange_code(p_code_hash text, p_client_id text, p_redirect_uri text, p_verifier text,
                                              p_access_hash text, p_refresh_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k public.connect_codes; fam uuid := gen_random_uuid(); bad jsonb := jsonb_build_object('error', 'invalid_grant');
begin
  select * into k from public.connect_codes where code_hash = p_code_hash for update;
  if not found then return bad; end if;
  if k.used_at is not null then      -- a replayed code: everything issued from it dies (RFC 6749 4.1.2)
    update public.connect_tokens set revoked_at = now() where family_id = k.family_id and revoked_at is null;
    return bad;
  end if;
  if k.expires_at < now() or k.client_id is distinct from p_client_id or k.redirect_uri is distinct from p_redirect_uri
     or p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
     or translate(rtrim(encode(sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '='), '+/', '-_') <> k.code_challenge then
    update public.connect_codes set used_at = now() where code_hash = p_code_hash;      -- a failed attempt burns the code (OAuth 2.1)
    return bad;
  end if;
  if not ryagram_private.connect_person_ok(k.owner_id)
     or not exists (select 1 from public.connect_grants g where g.owner_id = k.owner_id and g.client_id = k.client_id and g.revoked_at is null) then
    return bad;
  end if;
  update public.connect_codes set used_at = now(), family_id = fam where code_hash = p_code_hash;
  insert into public.connect_tokens (family_id, owner_id, client_id, scopes, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
    values (fam, k.owner_id, k.client_id, k.scopes, p_access_hash, now() + interval '1 hour', p_refresh_hash, now() + interval '30 days');
  return jsonb_build_object('scope', array_to_string(k.scopes, ' '), 'expires_in', 3600);
end $$;

create function public.connect_refresh(p_refresh_hash text, p_client_id text, p_access_hash text, p_new_refresh_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.connect_tokens; bad jsonb := jsonb_build_object('error', 'invalid_grant');
begin
  select * into t from public.connect_tokens where refresh_hash = p_refresh_hash for update;
  if not found or t.client_id is distinct from p_client_id then return bad; end if;
  if t.refresh_used_at is not null or t.revoked_at is not null then   -- reuse of a rotated or revoked token: kill the whole family
    update public.connect_tokens set revoked_at = now() where family_id = t.family_id and revoked_at is null;
    return bad;
  end if;
  if t.refresh_expires_at < now() or not ryagram_private.connect_person_ok(t.owner_id)
     or not exists (select 1 from public.connect_grants g where g.owner_id = t.owner_id and g.client_id = t.client_id and g.revoked_at is null) then
    return bad;
  end if;
  update public.connect_tokens set refresh_used_at = now(), revoked_at = now() where id = t.id;      -- the old pair is spent
  insert into public.connect_tokens (family_id, owner_id, client_id, scopes, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
    values (t.family_id, t.owner_id, t.client_id, t.scopes, p_access_hash, now() + interval '1 hour', p_new_refresh_hash, t.refresh_expires_at);
  return jsonb_build_object('scope', array_to_string(t.scopes, ' '), 'expires_in', 3600);
end $$;

create function public.connect_revoke(p_hash text) returns void       -- RFC 7009: always quietly succeeds
language sql security definer set search_path = '' as $$
  update public.connect_tokens set revoked_at = now()
   where revoked_at is null and family_id in (select family_id from public.connect_tokens where access_hash = p_hash or refresh_hash = p_hash)
$$;

-- ------------------------------------------------------------------------ consent and settings (an app session)
create function public.connect_consent_check(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session(); r public.connect_requests; c public.connect_clients; why text;
begin
  select * into r from public.connect_requests where id = p_request;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'This sign-in request was not found. Start again from your assistant.',
                                               'offered_scopes', ryagram_private.connect_offered_scopes(), 'credit_scopes', '[]'::jsonb, 'invited', ryagram_private.connect_person_ok(me)); end if;
  select * into c from public.connect_clients where client_id = r.client_id;
  if r.decided_at is not null or r.expires_at < now() then why := 'This sign-in request has expired. Start again from your assistant.';
  elsif not ryagram_private.connect_uri_ok(r.redirect_uri) then why := 'This assistant''s return address is not on Ryagram''s allowed list.';
  elsif exists (select 1 from public.app_admins where user_id = me) then why := 'Administrator accounts cannot be connected to an AI assistant.';
  elsif not ryagram_private.connect_person_ok(me) then why := 'This Ryagram account is not enabled for AI assistants yet (invite-only for now).';
  end if;
  return jsonb_build_object('allowed', why is null, 'reason', why, 'client_name', c.name,
    'redirect_label', case when r.redirect_uri ~ '^http://(localhost|127\.0\.0\.1|\[::1\])' then 'A program on this computer'
                           else coalesce((select a.label from public.connect_redirect_allowlist a where a.enabled and a.kind = 'exact' and a.redirect_uri = r.redirect_uri), 'An address Ryagram does not recognise') end,
    'redirect_uri', r.redirect_uri, 'redirect_host', substring(r.redirect_uri from '^[a-z]+://([^/:]+)'),
    'requested_scopes', r.scopes, 'offered_scopes', ryagram_private.connect_offered_scopes(),
    'credit_scopes', '[]'::jsonb,                       -- v1: nothing offered can spend credits without asking (full renders are not offered)
    'invited', ryagram_private.connect_person_ok(me), 'expires_at', r.expires_at);
end $$;

-- Returns {redirect_to}: the client's redirect URI with a code, or with error=access_denied. It always begins with the redirect_uri
-- that connect_consent_check showed. Nothing is recorded or issued before this is called by a button press.
create function public.connect_consent_decide(p_request uuid, p_approve boolean, p_scopes text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session(); r public.connect_requests; code text; got text[]; sep text;
begin
  select * into r from public.connect_requests where id = p_request for update;
  if not found or r.decided_at is not null or r.expires_at < now() then
    raise exception 'This sign-in request has expired. Start again from your assistant.' using errcode = '42501'; end if;
  sep := case when position('?' in r.redirect_uri) > 0 then '&' else '?' end;
  update public.connect_requests set decided_at = now() where id = p_request;
  if not ryagram_private.connect_uri_ok(r.redirect_uri) then
    raise exception 'This assistant''s return address is not on Ryagram''s allowed list.' using errcode = '42501'; end if;
  if not coalesce(p_approve, false) then
    return jsonb_build_object('redirect_to', r.redirect_uri || sep || 'error=access_denied' || case when r.state is null then '' else '&state=' || ryagram_private.connect_pct(r.state) end);
  end if;
  if not ryagram_private.connect_uri_ok(r.redirect_uri) or exists (select 1 from public.app_admins where user_id = me)
     or not ryagram_private.connect_person_ok(me) then
    raise exception 'This account or this assistant cannot be connected.' using errcode = '42501'; end if;
  got := array(select s from unnest(coalesce(p_scopes, r.scopes)) s where s = any (r.scopes) and s = any (ryagram_private.connect_offered_scopes()));
  if cardinality(got) = 0 then raise exception 'Choose at least one thing the assistant may do.' using errcode = '22023'; end if;
  insert into public.connect_grants (owner_id, client_id, scopes) values (me, r.client_id, got)
    on conflict (owner_id, client_id) do update set scopes = excluded.scopes, revoked_at = null, created_at = now();
  code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.connect_codes (code_hash, owner_id, client_id, redirect_uri, code_challenge, scopes)
    values (encode(sha256(convert_to(code, 'UTF8')), 'hex'), me, r.client_id, r.redirect_uri, r.code_challenge, got);
  return jsonb_build_object('redirect_to', r.redirect_uri || sep || 'code=' || code || case when r.state is null then '' else '&state=' || ryagram_private.connect_pct(r.state) end);
end $$;

create function public.my_connected_ais()
returns table (client_id text, client_name text, scopes text[], connected_at timestamptz, last_used_at timestamptz, calls_30d int)
language sql stable security definer set search_path = '' as $$
  select g.client_id, c.name, g.scopes, g.created_at,
         (select max(t.last_used_at) from public.connect_tokens t where t.owner_id = g.owner_id and t.client_id = g.client_id),
         (select count(*)::int from public.connect_calls x where x.owner_id = g.owner_id and x.client_id = g.client_id and x.at > now() - interval '30 days')
  from public.connect_grants g join public.connect_clients c on c.client_id = g.client_id
  where g.owner_id = ryagram_private.connect_app_session() and g.revoked_at is null
  order by g.created_at desc
$$;

create function public.disconnect_ai(p_client_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_app_session();
begin
  update public.connect_grants set revoked_at = now() where owner_id = me and client_id = p_client_id and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = me and client_id = p_client_id and revoked_at is null;
end $$;

-- ------------------------------------------------------------------------------------------------------- admin
create function public.admin_set_connect_access(p_email text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  perform ryagram_private.connect_app_session();
  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select id into target from auth.users where lower(email) = lower(btrim(p_email));
  if target is null then raise exception 'No account with that email.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.app_admins where user_id = target) then
    raise exception 'Administrator accounts cannot be connected to an AI assistant.' using errcode = '42501'; end if;
  insert into public.connect_access (user_id, enabled) values (target, coalesce(p_enabled, false))
    on conflict (user_id) do update set enabled = excluded.enabled;
  if not coalesce(p_enabled, false) then
    update public.connect_tokens set revoked_at = now() where owner_id = target and revoked_at is null;
  end if;
end $$;

create function public.admin_connect_allowlist_set(p_redirect_uri text, p_kind text, p_label text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform ryagram_private.connect_app_session();
  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_kind not in ('exact', 'loopback') then raise exception 'kind must be exact or loopback.' using errcode = '22023'; end if;
  insert into public.connect_redirect_allowlist (redirect_uri, kind, label, enabled)
    values (p_redirect_uri, p_kind, coalesce(p_label, ''), coalesce(p_enabled, true))
    on conflict (redirect_uri) do update set kind = excluded.kind, label = excluded.label, enabled = excluded.enabled;
end $$;

-- ------------------------------------------------------------------------------------- tool functions (connect_runner)
-- Every function takes p_token_hash first and resolves the owner itself. None takes an owner id.

create function public.connect_scopes(p_token_hash text) returns text[]          -- null = not a live token / not allowed
language plpgsql stable security definer set search_path = '' as $$
declare t public.connect_tokens; g public.connect_grants;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into t from public.connect_tokens k where k.access_hash = p_token_hash and k.revoked_at is null and k.access_expires_at > now();
  if not found or not ryagram_private.connect_person_ok(t.owner_id) then return null; end if;
  select * into g from public.connect_grants x where x.owner_id = t.owner_id and x.client_id = t.client_id and x.revoked_at is null;
  if not found then return null; end if;
  return array(select s from unnest(g.scopes) s where s = any (t.scopes));
end $$;

create function public.connect_hit(p_token_hash text, p_bucket text, p_max int, p_window_s int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, null); cli text; w timestamptz; c int;
begin
  if p_bucket !~ '^[a-z0-9_:]{1,40}$' or p_window_s not between 1 and 86400 or p_max < 1 then raise exception 'bad limit' using errcode = '22023'; end if;
  select client_id into cli from public.connect_tokens where access_hash = p_token_hash;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.connect_buckets (who, bucket, window_start, n)
    values (me::text, p_bucket || case when p_bucket = 'calls' then ':' || cli else '' end, w, 1)
    on conflict (who, bucket, window_start) do update set n = public.connect_buckets.n + 1
    returning public.connect_buckets.n into c;
  return c <= p_max;
end $$;

create function public.connect_log(p_token_hash text, p_tool text, p_credits int, p_result text, p_code text, p_failed int) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.connect_tokens;
begin
  if p_result not in ('ok', 'refused', 'error') or p_tool !~ '^[a-z0-9_]{1,40}$' or p_code !~ '^[a-z0-9_]{1,40}$' then return; end if;
  select * into t from public.connect_tokens where access_hash = p_token_hash;
  if not found then return; end if;                    -- an unknown hash is not logged: anyone holding the runner credentials could flood the table
  insert into public.connect_calls (owner_id, client_id, tool, credits, result, code, failed_checks)
    values (t.owner_id, t.client_id, p_tool, greatest(coalesce(p_credits, 0), 0), p_result, p_code, greatest(coalesce(p_failed, 0), 0));
end $$;

create function public.connect_anon_hit(p_caller text, p_bucket text, p_max int, p_window_s int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w timestamptz; c int;
begin
  if p_caller is null or p_caller !~ '^[0-9a-f]{64}$' or p_bucket !~ '^[a-z0-9_]{1,30}$' or p_window_s not between 1 and 86400 or p_max < 1 then
    raise exception 'bad limit' using errcode = '22023'; end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.connect_buckets (who, bucket, window_start, n) values ('ip:' || p_caller, p_bucket, w, 1)
    on conflict (who, bucket, window_start) do update set n = public.connect_buckets.n + 1
    returning public.connect_buckets.n into c;
  return c <= p_max;
end $$;

create function public.connect_final_enabled() returns boolean
language sql stable security definer set search_path = '' as $$ select full_render_enabled from public.connect_flags where id $$;

create function public.connect_whoami(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); mail text; avail int := 0; held int := 0;
begin
  select email into mail from auth.users where id = me;
  if to_regclass('public.credit_balances') is not null then
    execute 'select coalesce(sum(available), 0)::int, coalesce(sum(held), 0)::int from public.credit_balances where owner_id = $1'
      into avail, held using me;
  end if;
  return jsonb_build_object('label', coalesce(mail, 'your account'), 'available', avail, 'held', held);
end $$;

create function public.connect_list_projects(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'created_at', p.created_at, 'updated_at', p.updated_at) order by p.updated_at desc)
                   from (select * from public.projects where owner_id = me and archived_at is null order by updated_at desc limit 100) p), '[]'::jsonb);
end $$;

create function public.connect_create_project(p_token_hash text, p_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'write'); pid uuid; v public.versions; t text := btrim(coalesce(p_title, ''));
begin
  if char_length(t) not between 1 and 120 then raise exception 'Give the project a title of 1 to 120 characters.' using errcode = '22023'; end if;
  select id into pid from public.projects where owner_id = me and archived_at is null and title = t order by created_at limit 1;
  if pid is not null then return jsonb_build_object('id', pid, 'title', t, 'created', false); end if;
  insert into public.projects (owner_id, title) values (me, t) returning id into pid;
  select * into v from public.create_version(pid);
  return jsonb_build_object('id', pid, 'title', t, 'version_id', v.id, 'number', v.number, 'created', true);
end $$;

create function public.connect_current_version(p_token_hash text, p_project uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return (select v.id from public.versions v join public.projects p on p.id = v.project_id
          where v.project_id = p_project and v.owner_id = me and p.owner_id = me and p.archived_at is null order by v.number desc limit 1);
end $$;

create function public.connect_get_version(p_token_hash text, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); v public.versions; p public.projects;
begin
  select * into v from public.versions where id = p_version and owner_id = me;
  if not found then raise exception 'Version not found.' using errcode = 'PT404'; end if;
  select * into p from public.projects where id = v.project_id and owner_id = me;
  return jsonb_build_object(
    'version', jsonb_build_object('id', v.id, 'project_id', v.project_id, 'number', v.number, 'state', v.state,
                                  'story_spec', v.story_spec, 'story_sha256', v.story_sha256),
    'project', jsonb_build_object('id', p.id, 'title', p.title),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'job_type', j.job_type, 'state', j.state, 'attempt', j.attempt,
                        'created_at', j.created_at, 'story_sha256', j.story_sha256, 'engine_commit', j.engine_commit,
                        'error_class', j.error_class, 'error_code', j.error_code, 'error_detail', j.error_detail,
                        'params', j.params, 'progress', j.progress) order by j.created_at desc)
                      from (select * from public.jobs where version_id = v.id and owner_id = me order by created_at desc limit 30) j), '[]'::jsonb));
end $$;

create function public.connect_list_versions(p_token_hash text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.number, 'state', v.state, 'created_at', v.created_at) order by v.number)
                   from public.versions v where v.project_id = p_project and v.owner_id = me), '[]'::jsonb);
end $$;

create function public.connect_save_story(p_token_hash text, p_version uuid, p_story jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'write'); v public.versions; sha text;
begin
  -- The app's lock rule lives in a trigger that only applies to the authenticated role; this definer function applies it itself.
  select * into v from public.versions where id = p_version and owner_id = me for update;
  if not found then raise exception 'Version not found.' using errcode = 'PT404'; end if;
  if v.state not in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
    raise exception 'This version is locked (%). Make a new version to change it.', v.state using errcode = '42501'; end if;
  if jsonb_typeof(p_story) <> 'object' or octet_length(p_story::text) > 262144 then
    raise exception 'The story must be a JSON object of at most 256 KB.' using errcode = '22023'; end if;
  update public.versions set story_spec = p_story where id = p_version returning story_sha256 into sha;
  return sha;
end $$;

create function public.connect_create_version(p_token_hash text, p_project uuid, p_from uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'write'); v public.versions;
begin
  select * into v from public.create_version(p_project, p_from);       -- the app's own function, as the owner
  return jsonb_build_object('id', v.id, 'number', v.number);
end $$;

create function public.connect_quote(p_token_hash text, p_version uuid, p_job_type text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); q record;
begin
  if p_job_type not in ('contact_sheet', 'preview', 'final_render') then raise exception 'Unknown job type.' using errcode = '22023'; end if;
  if not exists (select 1 from public.versions where id = p_version and owner_id = me) then raise exception 'Version not found.' using errcode = 'PT404'; end if;
  if to_regprocedure('public.credit_quote(uuid,public.job_type)') is null then      -- credits (2B) not installed: nothing is charged
    return jsonb_build_object('credits', 0, 'free', true, 'available', 0);
  end if;
  execute 'select credits, free_preview as free, available from public.credit_quote($1, $2::public.job_type)' into q using p_version, p_job_type;
  return jsonb_build_object('credits', q.credits, 'free', q.free, 'available', q.available);
end $$;

create function public.connect_submit_job(p_token_hash text, p_version uuid, p_job_type text, p_params jsonb,
                                          p_sheet uuid, p_preview uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; j public.jobs;
begin
  if p_job_type = 'final_render' then
    -- Never started from a connection until PIPE's approve queue exists. (The tool says so in words.)
    me := ryagram_private.connect_actor(p_token_hash, 'render_final');
    raise exception 'Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.' using errcode = '42501';
  end if;
  if p_job_type not in ('contact_sheet', 'preview') then raise exception 'Unknown job type.' using errcode = '22023'; end if;
  me := ryagram_private.connect_actor(p_token_hash, 'render_free');
  -- "Free" means free: a connection cannot spend credits in v1, so a job that would cost any is refused here, whatever the AI sends.
  -- (The tool says so in words first.) Credits are spent only by the person, in the Ryagram app.
  if coalesce((public.connect_quote(p_token_hash, p_version, p_job_type) ->> 'credits')::int, 0) > 0 then
    raise exception 'This would cost credits. Credits can only be spent from the Ryagram app for now; start it there.' using errcode = '42501';
  end if;
  select * into j from public.submit_job(p_version, p_job_type::public.job_type, coalesce(p_params, '{}'::jsonb));   -- the app's function, as the owner
  -- The check above is a look before the act: two calls at once can both be quoted as free when only one free preview is left, and the second
  -- is then charged. So look at what the job was ACTUALLY charged (the app's own trigger fills credits_quoted inside submit_job); if it is
  -- above zero, raise: this runs in the same transaction, so the job and its hold are rolled back with it. (to_jsonb because the column
  -- exists only once the credits ledger is installed.)
  if coalesce((to_jsonb(j) ->> 'credits_quoted')::int, 0) > 0 then
    raise exception 'This would cost credits. Credits can only be spent from the Ryagram app for now; start it there.' using errcode = '42501';
  end if;
  return jsonb_build_object('id', j.id, 'state', j.state);
end $$;

create function public.connect_job(p_token_hash text, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); j public.jobs;
begin
  select * into j from public.jobs where id = p_job and owner_id = me;
  if not found then return null; end if;
  return jsonb_build_object('id', j.id, 'version_id', j.version_id, 'job_type', j.job_type, 'state', j.state, 'attempt', j.attempt,
    'created_at', j.created_at, 'story_sha256', j.story_sha256, 'engine_commit', j.engine_commit, 'error_class', j.error_class,
    'error_code', j.error_code, 'error_detail', j.error_detail, 'progress', j.progress, 'note', j.progress_note,
    'queue_position', public.queue_position(j.id));
end $$;

create function public.connect_current_engine(p_token_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  if to_regprocedure('public.current_engine_commit()') is null then return null; end if;
  return public.current_engine_commit();
end $$;

-- ------------------------------------------------------------------------------------------------- retention
-- Run daily by the same schedule as the other purges. Expired requests and codes, spent tokens, and call rows past 30 days.
create function public.connect_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int;
begin
  delete from public.connect_requests where expires_at < now() - interval '1 day'; get diagnostics a = row_count;
  delete from public.connect_codes where expires_at < now() - interval '1 day'; get diagnostics b = row_count;
  delete from public.connect_tokens where refresh_expires_at < now() - interval '1 day'; get diagnostics c = row_count;      -- rotated rows stay until expiry so reuse is still detected
  delete from public.connect_calls where at < now() - interval '30 days'; get diagnostics d = row_count;
  delete from public.connect_buckets where window_start < now() - interval '2 days';
  -- clients that registered but nobody ever signed in to (DCR is open): gone after a week
  delete from public.connect_clients c where c.created_at < now() - interval '7 days'
    and not exists (select 1 from public.connect_grants g where g.client_id = c.client_id)
    and not exists (select 1 from public.connect_tokens t where t.client_id = c.client_id);
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d);
end $$;

-- --------------------------------------------------------------------------------------------------- grants
-- Nothing is callable by anyone until granted here. connect_runner gets the AS and tool functions; the app session gets
-- the consent, settings and admin functions; connect_purge is for the dashboard / service role only.
revoke all on function ryagram_private.connect_pct(text), ryagram_private.connect_uri_ok(text), ryagram_private.connect_offered_scopes(),
  ryagram_private.connect_person_ok(uuid), ryagram_private.connect_actor(text, text), ryagram_private.connect_app_session() from public, anon, authenticated, connect_runner;

revoke all on function
  public.connect_register_client(text, text[]), public.connect_begin_authorization(text, text, text, text, text, text, text),
  public.connect_exchange_code(text, text, text, text, text, text), public.connect_refresh(text, text, text, text), public.connect_revoke(text),
  public.connect_scopes(text), public.connect_hit(text, text, int, int), public.connect_anon_hit(text, text, int, int), public.connect_log(text, text, int, text, text, int),
  public.connect_final_enabled(), public.connect_whoami(text), public.connect_list_projects(text), public.connect_create_project(text, text),
  public.connect_current_version(text, uuid), public.connect_get_version(text, uuid), public.connect_list_versions(text, uuid),
  public.connect_save_story(text, uuid, jsonb), public.connect_create_version(text, uuid, uuid), public.connect_quote(text, uuid, text),
  public.connect_submit_job(text, uuid, text, jsonb, uuid, uuid), public.connect_job(text, uuid), public.connect_current_engine(text),
  public.connect_consent_check(uuid), public.connect_consent_decide(uuid, boolean, text[]), public.my_connected_ais(), public.disconnect_ai(text),
  public.admin_set_connect_access(text, boolean), public.admin_connect_allowlist_set(text, text, text, boolean), public.connect_purge()
  from public, anon, authenticated, connect_runner;

grant execute on function
  public.connect_register_client(text, text[]), public.connect_begin_authorization(text, text, text, text, text, text, text),
  public.connect_exchange_code(text, text, text, text, text, text), public.connect_refresh(text, text, text, text), public.connect_revoke(text),
  public.connect_scopes(text), public.connect_hit(text, text, int, int), public.connect_anon_hit(text, text, int, int), public.connect_log(text, text, int, text, text, int),
  public.connect_final_enabled(), public.connect_whoami(text), public.connect_list_projects(text), public.connect_create_project(text, text),
  public.connect_current_version(text, uuid), public.connect_get_version(text, uuid), public.connect_list_versions(text, uuid),
  public.connect_save_story(text, uuid, jsonb), public.connect_create_version(text, uuid, uuid), public.connect_quote(text, uuid, text),
  public.connect_submit_job(text, uuid, text, jsonb, uuid, uuid), public.connect_job(text, uuid), public.connect_current_engine(text)
  to connect_runner;

grant execute on function public.connect_consent_check(uuid), public.connect_consent_decide(uuid, boolean, text[]),
  public.my_connected_ais(), public.disconnect_ai(text), public.admin_set_connect_access(text, boolean),
  public.admin_connect_allowlist_set(text, text, text, boolean) to authenticated;
