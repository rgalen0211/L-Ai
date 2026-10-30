-- FOOTAGE PLANS (NEXT-CONNECT 168, slice P1b; design: proposals/CONNECT-FOOTAGE-PD-DESIGN.md). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes, and it is OFF even when applied.
-- The person's own AI may WRITE DOWN a plan to fetch ONE public-domain video from NASA or the U.S. National Archives: a SOURCE, that source's ITEM ID and a short reason. NEVER an address. The plan is DATA: it
-- starts nothing on the site, fetches nothing (the site never contacts anyone), touches no credit and holds no file. The person's own Ryagram desktop app reads its plans through the signed-in computer's node
-- route, builds every address itself from fixed templates (tools/footage_sources.py), reads the source's OWN rights record and shows it, and only after the person presses Approve downloads straight from the
-- publisher to their computer. The app tells the site the STATE and a small receipt (host, size, SHA-256, the date, the source's rights wording as shown); never a file name, a folder, a title or a path.
-- THE SWITCH: public.connect_flags gets footage_enabled, default FALSE. While it is false connect_request_footage refuses in words and writes nothing; listing and the node routes still answer (so a switched-off
-- site shows the person what they already have). Ryan turns it on, after the attorney's questions (design paper section 6); nothing in this file turns it on.
-- Needs 20261018000100_connect_ai.sql (tokens, scopes, connect_flags), 20261021000100_r9_render_node.sql (the signed-in computer's token), 20261027000400_live_editor.sql (ryagram_private.edit_text_ok) and
-- 20261027000500_download_plans.sql (the scope 'fetch_data', which this reuses: no new scope). Same shape as the download plans: the token hash is the only identity, EXECUTE only to connect_runner /
-- node_runner, a plan that is not the person's looks absent. Limits: at most 5 plans waiting at once and 20 a day per person (PT429); asking again for the item that is already waiting returns that plan.
-- Undo: supabase/rollbacks/20261030000200_footage_plans_rollback.sql.

begin;

alter table public.connect_flags add column footage_enabled boolean not null default false;

create function ryagram_private.footage_on() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select footage_enabled from public.connect_flags where id), false) $$;

create table public.footage_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('nasa', 'nara')),
  item_id text not null check ((source = 'nasa' and item_id ~ '^[A-Za-z0-9][A-Za-z0-9_.~-]{2,99}$') or (source = 'nara' and item_id ~ '^[0-9]{3,12}$')),
  why text not null check (char_length(why) between 1 and 300),
  state text not null default 'waiting' check (state in ('waiting', 'declined', 'downloading', 'done', 'refused', 'cancelled')),
  receipt jsonb check (receipt is null or (jsonb_typeof(receipt) = 'object' and octet_length(receipt::text) <= 4096)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index footage_plans_owner_idx on public.footage_plans (owner_id, created_at desc);

alter table public.footage_plans enable row level security;
-- The person may READ their own plans (signed in on the website). Nobody writes the table but the definer functions below.
create policy footage_plans_owner_read on public.footage_plans for select to authenticated using (owner_id = auth.uid());
revoke all on public.footage_plans from public, anon, authenticated, connect_runner, node_runner;
grant select on public.footage_plans to authenticated;

-- ---------------------------------------------------------------- the AI writes a plan (only while the switch is on)
create function public.connect_request_footage(p_token_hash text, p_source text, p_item_id text, p_why text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'fetch_data');
  waiting int; today int; same public.footage_plans; nid uuid;
begin
  if not ryagram_private.footage_on() then
    raise exception 'unavailable: fetching public-domain footage is not available yet' using errcode = 'PT400';
  end if;
  if p_source is null or p_source not in ('nasa', 'nara') then
    raise exception 'The source must be nasa or nara.' using errcode = '22023';
  end if;
  if p_item_id is null or not ((p_source = 'nasa' and p_item_id ~ '^[A-Za-z0-9][A-Za-z0-9_.~-]{2,99}$') or (p_source = 'nara' and p_item_id ~ '^[0-9]{3,12}$')) then
    raise exception 'That is not an item id of that source.' using errcode = '22023';
  end if;
  if p_why is null or not ryagram_private.edit_text_ok(p_why, 300) then
    raise exception 'The reason must be 1 to 300 characters of plain words (no places on a computer, no web addresses, no markup).' using errcode = '22023';
  end if;
  select * into same from public.footage_plans where owner_id = me and source = p_source and item_id = p_item_id and state in ('waiting', 'downloading') order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', same.id, 'state', same.state, 'already', true);          -- asking again for the item that is already waiting: the same plan
  end if;
  select count(*) into waiting from public.footage_plans where owner_id = me and state in ('waiting', 'downloading');
  if waiting >= 5 then
    raise exception 'There are already 5 footage requests waiting for the person. Ask them to deal with those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.footage_plans where owner_id = me and created_at > now() - interval '24 hours';
  if today >= 20 then
    raise exception 'That is 20 footage requests in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.footage_plans (owner_id, source, item_id, why) values (me, p_source, p_item_id, p_why) returning id into nid;
  return jsonb_build_object('id', nid, 'state', 'waiting', 'already', false);
end $$;

create function public.connect_list_footage(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'source', s.source, 'item_id', s.item_id, 'why', s.why, 'state', s.state, 'created_at', s.created_at,
                                                         'receipt', case when s.receipt is null then null
                                                                         else jsonb_build_object('bytes', s.receipt -> 'bytes', 'sha256', s.receipt -> 'sha256', 'retrieved', s.receipt -> 'retrieved',
                                                                                                 'rights_label_as_shown', s.receipt -> 'rights_label_as_shown') end)
                          order by s.created_at desc)
                     from (select * from public.footage_plans where owner_id = me order by created_at desc limit 20) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- the person's computer reads the plans and tells the state
create function public.node_footage_plans(p_access_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.node_actor(p_access_hash);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'source', s.source, 'item_id', s.item_id, 'why', s.why, 'state', s.state) order by s.created_at desc)
                     from (select * from public.footage_plans where owner_id = me and state in ('waiting', 'downloading') order by created_at desc limit 5) s), '[]'::jsonb);
end $$;

create function public.node_footage_update(p_access_hash text, p_id uuid, p_state text, p_receipt jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.node_actor(p_access_hash);
  cur text; src text; iid text;
begin
  select state, source, item_id into cur, src, iid from public.footage_plans where id = p_id and owner_id = me for update;
  if cur is null then
    return null;                                                    -- not this person's plan: it looks absent
  end if;
  if p_state is null or p_state not in ('declined', 'downloading', 'done', 'refused', 'cancelled') then
    raise exception 'That is not a state a footage request can be in.' using errcode = '22023';
  end if;
  if cur = p_state then
    return cur;                                                     -- the app says the same thing twice: fine
  end if;
  if not ((cur = 'waiting' and p_state in ('declined', 'downloading')) or (cur = 'downloading' and p_state in ('done', 'refused', 'cancelled'))) then
    raise exception 'That change is not allowed from "%".', cur using errcode = '22023';
  end if;
  if p_receipt is not null then
    if p_state <> 'done' then
      raise exception 'A receipt comes with a finished download only.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_receipt) <> 'object' or octet_length(p_receipt::text) > 4096
       or exists (select 1 from jsonb_object_keys(p_receipt) x where x not in ('source', 'item_id', 'rights_label_as_shown', 'retrieved', 'host', 'bytes', 'sha256')) then
      raise exception 'The receipt has a field the site does not take.' using errcode = '22023';
    end if;
    if coalesce(p_receipt ->> 'source' is distinct from src
       or p_receipt ->> 'item_id' is distinct from iid
       or jsonb_typeof(p_receipt -> 'rights_label_as_shown') is distinct from 'string' or char_length(p_receipt ->> 'rights_label_as_shown') not between 1 and 1500
       or (p_receipt ->> 'rights_label_as_shown') ~ '[<>[:cntrl:]]' or (p_receipt ->> 'rights_label_as_shown') ~* 'https?://'
       or (p_receipt ->> 'retrieved') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(p_receipt -> 'host') is distinct from 'string' or (p_receipt ->> 'host') !~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
       or jsonb_typeof(p_receipt -> 'bytes') is distinct from 'number' or (p_receipt ->> 'bytes')::numeric not between 10000 and 2147483648
       or (p_receipt ->> 'sha256') !~ '^[0-9a-f]{64}$', true) then
      raise exception 'The receipt is not in the shape the site takes: the source and item, the rights wording as shown, a date, a host name, a size and a SHA-256, never a file name, a title or a path.' using errcode = '22023';
    end if;
  end if;
  update public.footage_plans set state = p_state, receipt = coalesce(p_receipt, receipt), updated_at = now() where id = p_id and owner_id = me;
  return p_state;
end $$;

revoke all on function public.connect_request_footage(text, text, text, text), public.connect_list_footage(text), public.node_footage_plans(text), public.node_footage_update(text, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function ryagram_private.footage_on() from public, anon, authenticated, connect_runner, node_runner;
grant execute on function public.connect_request_footage(text, text, text, text), public.connect_list_footage(text) to connect_runner;
grant execute on function public.node_footage_plans(text), public.node_footage_update(text, uuid, text, jsonb) to node_runner;

commit;
