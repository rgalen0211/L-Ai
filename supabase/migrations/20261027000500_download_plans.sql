-- DOWNLOAD PLANS (NEXT-CONNECT 152; design: proposals/CONNECT-LOCAL-DATA-DESIGN.md section 2). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- The person's own AI may WRITE DOWN a plan to download a public data file (an https address, a short reason, the NAME of a data folder). The plan is DATA: it starts nothing on the site, fetches nothing
-- (the site never contacts the address), touches no credit and holds no file. The person's own Ryagram desktop app reads its plans through the signed-in computer's node route, shows each one for the
-- person to APPROVE, and only then downloads straight from the publisher to a folder on the person's computer. The app tells the site the STATE and a small receipt (host, size, SHA-256, member count);
-- never a file name, a folder or a path.
-- It needs 20261018000100_connect_ai.sql (the connector's token and scopes), 20261021000100_r9_render_node.sql (the signed-in computer's token) and 20261027000400_live_editor.sql
-- (ryagram_private.edit_text_ok, the plain-words text rule, is reused). It adds the scope 'fetch_data' to the scopes the consent page offers; connections made before keep their grant and do not get it.
-- Same shape as every other connect_* / node_* function: the token hash is the only identity, no function takes an owner id, EXECUTE only to connect_runner / node_runner, a plan that is not the person's
-- looks absent. Limits: at most 5 plans waiting at once and 20 a day per person (the AI is told in words, code PT429).
-- Undo: supabase/rollbacks/20261027000500_download_plans_rollback.sql.

begin;

create table public.download_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  request jsonb not null check (jsonb_typeof(request) = 'object' and octet_length(request::text) <= 4096),
  host text not null check (host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),
  state text not null default 'waiting' check (state in ('waiting', 'declined', 'downloading', 'unpacking', 'done', 'refused', 'cancelled')),
  receipt jsonb check (receipt is null or (jsonb_typeof(receipt) = 'object' and octet_length(receipt::text) <= 4096)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index download_plans_owner_idx on public.download_plans (owner_id, created_at desc);

alter table public.download_plans enable row level security;
-- The person may READ their own plans (signed in on the website). Nobody writes the table but the definer functions below.
create policy download_plans_owner_read on public.download_plans for select to authenticated using (owner_id = auth.uid());
revoke all on public.download_plans from public, anon, authenticated, connect_runner, node_runner;
grant select on public.download_plans to authenticated;

-- ---------------------------------------------------------------- the AI writes a plan
create function public.connect_request_download(p_token_hash text, p_url text, p_why text, p_folder text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'fetch_data');
  host text; waiting int; today int; nid uuid;
begin
  if p_url is null or length(p_url) > 2000 or p_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(/[\x21-\x7e]*)?$' then
    raise exception 'The address must be an https:// website name with no user name, no port and no spaces.' using errcode = '22023';
  end if;
  host := lower(substring(p_url from '^https://([^/]+)'));
  if host ~ '^[0-9.]+$' then
    raise exception 'An address that is a number is not accepted: use the website name.' using errcode = '22023';
  end if;
  if p_why is null or not ryagram_private.edit_text_ok(p_why, 300) then
    raise exception 'The reason must be 1 to 300 characters of plain words (no places on a computer, no web addresses, no markup).' using errcode = '22023';
  end if;
  if p_folder is null or (p_folder <> '' and (p_folder !~ '^[A-Za-z0-9 ._-]{1,60}$' or p_folder in ('.', '..'))) then
    raise exception 'The folder is a NAME (letters, digits, space, dot, dash), never a path.' using errcode = '22023';
  end if;
  select count(*) into waiting from public.download_plans where owner_id = me and state in ('waiting', 'downloading', 'unpacking');
  if waiting >= 5 then
    raise exception 'There are already 5 download requests waiting for the person. Ask them to deal with those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.download_plans where owner_id = me and created_at > now() - interval '24 hours';
  if today >= 20 then
    raise exception 'That is 20 download requests in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.download_plans (owner_id, request, host)
  values (me, jsonb_build_object('schema', 'ryagram.download-plan/0', 'url', p_url, 'why', p_why, 'folder', p_folder), host)
  returning id into nid;
  return jsonb_build_object('id', nid, 'host', host, 'state', 'waiting');
end $$;

create function public.connect_list_downloads(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'host', s.host, 'url', s.request ->> 'url', 'why', s.request ->> 'why', 'folder', s.request ->> 'folder', 'state', s.state,
                                                         'created_at', s.created_at,
                                                         'receipt', case when s.receipt is null then null
                                                                         else jsonb_build_object('bytes', s.receipt -> 'bytes', 'sha256', s.receipt -> 'sha256', 'members', s.receipt -> 'members',
                                                                                                 'trust_label', s.receipt -> 'trust_label', 'retrieved', s.receipt -> 'retrieved') end)
                          order by s.created_at desc)
                     from (select * from public.download_plans where owner_id = me order by created_at desc limit 20) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- the person's computer reads the plans and tells the state
create function public.node_download_plans(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'request', s.request, 'state', s.state) order by s.created_at desc)
                     from (select * from public.download_plans where owner_id = me and state in ('waiting', 'downloading', 'unpacking') order by created_at desc limit 5) s), '[]'::jsonb);
end $$;

create function public.node_download_update(p_access_hash text, p_id uuid, p_state text, p_receipt jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.node_actor(p_access_hash);
  cur text; k text; v jsonb;
begin
  select state into cur from public.download_plans where id = p_id and owner_id = me for update;
  if cur is null then
    return null;                                                    -- not this person's plan: it looks absent
  end if;
  if p_state is null or p_state not in ('declined', 'downloading', 'unpacking', 'done', 'refused', 'cancelled') then
    raise exception 'That is not a state a download can be in.' using errcode = '22023';
  end if;
  if cur = p_state then
    return cur;                                                     -- the app says the same thing twice: fine
  end if;
  if not ((cur = 'waiting' and p_state in ('declined', 'downloading'))
       or (cur = 'downloading' and p_state in ('unpacking', 'done', 'refused', 'cancelled'))
       or (cur = 'unpacking' and p_state in ('done', 'refused', 'cancelled'))) then
    raise exception 'That change is not allowed from "%".', cur using errcode = '22023';
  end if;
  if p_receipt is not null then
    if p_state <> 'done' then
      raise exception 'A receipt comes with a finished download only.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_receipt) <> 'object' or octet_length(p_receipt::text) > 4096
       or exists (select 1 from jsonb_object_keys(p_receipt) x where x not in ('schema', 'address_host', 'final_host', 'retrieved', 'bytes', 'sha256', 'kind', 'members', 'licence', 'trust_label', 'why', 'steps')) then
      raise exception 'The receipt has a field the site does not take.' using errcode = '22023';
    end if;
    if coalesce(p_receipt ->> 'schema' is distinct from 'ryagram.download-receipt/0'
       or jsonb_typeof(p_receipt -> 'address_host') is distinct from 'string' or (p_receipt ->> 'address_host') !~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
       or jsonb_typeof(p_receipt -> 'final_host') is distinct from 'string' or (p_receipt ->> 'final_host') !~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
       or (p_receipt ->> 'retrieved') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(p_receipt -> 'bytes') is distinct from 'number' or (p_receipt ->> 'bytes')::numeric < 0
       or (p_receipt ->> 'sha256') !~ '^[0-9a-f]{64}$'
       or (p_receipt ->> 'kind') not in ('text', 'zip', 'gzip', 'parquet')
       or jsonb_typeof(p_receipt -> 'members') is distinct from 'number' or (p_receipt ->> 'members')::numeric not between 0 and 10000
       or (p_receipt ->> 'trust_label') not in ('official', 'unchecked')
       or jsonb_typeof(p_receipt -> 'licence') is distinct from 'string' or not ryagram_private.edit_text_ok(p_receipt ->> 'licence', 300)
       or (p_receipt ? 'why' and (jsonb_typeof(p_receipt -> 'why') <> 'string' or not ryagram_private.edit_text_ok(p_receipt ->> 'why', 300)))
       or (p_receipt ? 'steps' and (jsonb_typeof(p_receipt -> 'steps') <> 'array' or jsonb_array_length(p_receipt -> 'steps') > 10
                                    or exists (select 1 from jsonb_array_elements(p_receipt -> 'steps') e where jsonb_typeof(e) <> 'string' or not ryagram_private.edit_text_ok(e #>> '{}', 100)))), true) then
      raise exception 'The receipt is not in the shape the site takes: host names, a date, sizes, a SHA-256 and plain words, never a file name or a path.' using errcode = '22023';
    end if;
  end if;
  update public.download_plans set state = p_state, receipt = coalesce(p_receipt, receipt), updated_at = now() where id = p_id and owner_id = me;
  return p_state;
end $$;

revoke all on function public.connect_request_download(text, text, text, text), public.connect_list_downloads(text), public.node_download_plans(text), public.node_download_update(text, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.connect_request_download(text, text, text, text), public.connect_list_downloads(text) to connect_runner;
grant execute on function public.node_download_plans(text), public.node_download_update(text, uuid, text, jsonb) to node_runner;

-- ---------------------------------------------------------------- the new scope, offered on the consent page
create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free', 'edit', 'fetch_data']::text[] $$;

commit;
