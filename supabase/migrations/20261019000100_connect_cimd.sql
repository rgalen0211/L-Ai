-- Connect your own AI: client ID metadata documents ("Use Claude's published identity"). PROTOTYPE, PROOF PROJECT ONLY (CONNECT 2026-10-19).
-- Design: proposals/CONNECT-PUBLISHED-IDENTITY.md. Nothing here is on the live project; applying it there is a RYAN-QUEUE item.
--
-- Adds one table (an allowlist of exact client-ID addresses, Ryan's list) and ONE function the connector may call (connect_cimd_client), which
--   * checks the master switch,
--   * checks the address is on the allowlist and enabled (the Edge Function checks the same list first and fetches nothing else),
--   * checks every redirect address against the existing redirect allowlist (a document can never widen where codes may be sent),
--   * stores the client with a name taken from the allowlist label, NEVER from the document.
-- The rest of the sign-in (consent, code, token, refresh, revoke) only sees a client row and is unchanged.
begin;

create table public.connect_cimd_allowlist (
  client_id_url text primary key check (client_id_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[^#[:space:]]*$' and char_length(client_id_url) <= 300),
  label text not null check (char_length(label) between 1 and 80 and label !~ '[[:cntrl:]]'),
  enabled boolean not null default true);
alter table public.connect_cimd_allowlist enable row level security;
revoke all on public.connect_cimd_allowlist from public, anon, authenticated;

insert into public.connect_cimd_allowlist (client_id_url, label)
  values ('https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude (claude.ai)');

create function public.connect_cimd_client(p_client_id text, p_redirect_uris text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uri text; lbl text;
begin
  if not ryagram_private.connect_on() then raise exception 'unavailable: AI connections are switched off right now' using errcode = 'PT400'; end if;
  select a.label into lbl from public.connect_cimd_allowlist a where a.enabled and a.client_id_url = p_client_id;
  if not found then raise exception 'invalid_client' using errcode = 'PT400'; end if;
  if p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 5 then
    raise exception 'invalid_redirect_uri: one to five redirect URIs' using errcode = 'PT400'; end if;
  foreach uri in array p_redirect_uris loop
    if not ryagram_private.connect_uri_ok(uri) then
      raise exception 'invalid_redirect_uri: that address is not on Ryagram''s list of allowed sign-in return addresses' using errcode = 'PT400';
    end if;
  end loop;
  -- created_at is refreshed on every call so the daily purge of never-used clients cannot remove a client that is being used right now
  insert into public.connect_clients (client_id, name, redirect_uris) values (p_client_id, lbl, p_redirect_uris)
    on conflict (client_id) do update set redirect_uris = excluded.redirect_uris, name = excluded.name, created_at = now();
end $$;

revoke all on function public.connect_cimd_client(text, text[]) from public, anon, authenticated, connect_runner;
grant execute on function public.connect_cimd_client(text, text[]) to connect_runner;

commit;
