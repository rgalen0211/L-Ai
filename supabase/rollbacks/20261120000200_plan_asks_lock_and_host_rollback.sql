-- DOWNLOAD AND FOOTAGE PLAN ASKS: the exact undo of migrations/20261120000200_plan_asks_lock_and_host.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by itself. UNRUN against a database.
-- It puts public.connect_request_download back as 20261027000500_download_plans.sql defined it and public.connect_request_footage back as 20261030000200_footage_plans.sql defined it (no per-person lock, no host rule beyond "not only digits and dots").
-- No plan row is touched. A function that is not on this database is skipped.
begin;

do $do$
begin
  if to_regprocedure('public.connect_request_download(text, text, text, text)') is null then
    raise notice 'connect_request_download is not on this database: skipped.';
    return;
  end if;
  execute $fn$
create or replace function public.connect_request_download(p_token_hash text, p_url text, p_why text, p_folder text) returns jsonb
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
$fn$;
end $do$;

do $do$
begin
  if to_regprocedure('public.connect_request_footage(text, text, text, text)') is null then
    raise notice 'connect_request_footage is not on this database: skipped.';
    return;
  end if;
  execute $fn$
create or replace function public.connect_request_footage(p_token_hash text, p_source text, p_item_id text, p_why text) returns jsonb
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
$fn$;
end $do$;

commit;
