-- DOWNLOAD AND FOOTAGE PLANS: ONE ASK AT A TIME PER PERSON, AND A HOST THAT IS A REAL NAME (CONNECT audit, 2026-11-20). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES TWO LIVE FUNCTIONS. UNRUN against a database: written and read, not executed.
-- (1) THE RACE. public.connect_request_download (20261027000500_download_plans.sql) and public.connect_request_footage (20261030000200_footage_plans.sql) count the person's waiting plans and today's plans and THEN insert, with nothing between.
--     Two asks in flight together (an AI making parallel tool calls) each count the same 4 waiting plans and each insert, so 6 are waiting (the limit is 5) and the 20-a-day count has the same gap. 20261109000300_ask_locks.sql and the film card asks
--     closed exactly this gap for the place questions and the film cards (one advisory lock per person, taken before the counts); the two plan asks were not given it. This file gives them the same: pg_advisory_xact_lock on 'download:' + the person's id
--     and 'footage:' + the person's id (a second ask waits until the first has committed, then counts it; another person's ask is never held). The lock is taken after the arguments are checked, so a refused call never waits.
-- (2) THE HOST. The address check refused a host made only of digits and dots ("127.0.0.1") but let through the other spellings of a number that a computer's resolver reads as an address: "0x7f.0.0.1", "0177.0.0.1", "1.0x7f" (the last label is not a name).
--     A real public website name always ends in a label that starts with a letter (a top-level name is never a number), so a host whose last label does not start with a letter is now refused, and so is a name that only works inside a computer or network
--     (localhost, local, internal, lan as the last label). The desktop app still shows the host to the person and checks again before it fetches anything; this only stops the site from writing such a plan down. The TypeScript twin (downloadUrlProblem in
--     connect-core/tools.ts) carries the same two rules.
-- Everything else in both functions is as the migrations named left it (same arguments, same limits, same sentences, same owners and grants: create or replace keeps them). Needs 20261027000500_download_plans.sql and 20261030000200_footage_plans.sql;
-- a function that is not on this database is skipped, so the file is safe in either order.
-- Undo: supabase/rollbacks/20261120000200_plan_asks_lock_and_host_rollback.sql. After-check: supabase/live-steps/31_plan_asks_lock_and_host_after_check.sql.

-- HOST RULE CAVEAT (CC1's deep review 11-20, LOW 2): the network-only host list below is a NAME rule only. A public name that resolves to a private address (127.0.0.1.nip.io) passes it, and names such as home.arpa, localdomain, corp and intranet are not listed. The desktop app's own address check at download time is the real guard; this is the first one. Do not rely on it alone.

begin;

-- connect_request_download: the per-person lock and the host rule
do $do$
declare cur text;
begin
  select md5(replace(f.prosrc, chr(13), '')) into cur from pg_proc f where f.oid = to_regprocedure('public.connect_request_download(text, text, text, text)');
  if cur is null then raise notice 'connect_request_download is not on this database: skipped.'; return; end if;
  if cur = '776cf579d8ef38b1941a1439ce49e814' then raise notice 'connect_request_download: nothing to do (already in the wanted state).'; return; end if;
  if cur <> '2116d6cfde60b64701bbbb56a53ca143' then
    raise exception 'The live function connect_request_download is not the one this change expects (its text differs from the repository''s 20261027000500_download_plans.sql); nothing was changed. Send this sentence to CONNECT.';
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
  -- a public website name ends in a label that starts with a letter; a number written another way (0x7f.0.0.1, 0177.0.0.1) and a name that only works on a computer or network are not accepted either
  if host !~ '\.[a-z][a-z0-9-]*$' or host ~ '\.(localhost|local|internal|lan)$' then
    raise exception 'Use a public website name (like www.example.org), not a number and not a name that only works inside a computer or network.' using errcode = '22023';
  end if;
  if p_why is null or not ryagram_private.edit_text_ok(p_why, 300) then
    raise exception 'The reason must be 1 to 300 characters of plain words (no places on a computer, no web addresses, no markup).' using errcode = '22023';
  end if;
  if p_folder is null or (p_folder <> '' and (p_folder !~ '^[A-Za-z0-9 ._-]{1,60}$' or p_folder in ('.', '..'))) then
    raise exception 'The folder is a NAME (letters, digits, space, dot, dash), never a path.' using errcode = '22023';
  end if;
  -- One ask at a time per person: two asks in flight together would both count the same waiting plans and both insert (the same lock as the place questions and the film cards; 2026-11-20 audit).
  perform pg_advisory_xact_lock(hashtextextended('download:' || me::text, 0));
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

-- connect_request_footage: the per-person lock and the host rule
do $do$
declare cur text;
begin
  select md5(replace(f.prosrc, chr(13), '')) into cur from pg_proc f where f.oid = to_regprocedure('public.connect_request_footage(text, text, text, text)');
  if cur is null then raise notice 'connect_request_footage is not on this database: skipped.'; return; end if;
  if cur = '881966a329796faacbc2eac5e40f72df' then raise notice 'connect_request_footage: nothing to do (already in the wanted state).'; return; end if;
  if cur <> '100b43a667e9058952c345d1b8c8ac3e' then
    raise exception 'The live function connect_request_footage is not the one this change expects (its text differs from the repository''s 20261030000200_footage_plans.sql); nothing was changed. Send this sentence to CONNECT.';
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
  -- One ask at a time per person: two asks in flight together would both count the same waiting plans (and both insert the same item twice). The same lock as the place questions and the film cards (2026-11-20 audit).
  perform pg_advisory_xact_lock(hashtextextended('footage:' || me::text, 0));
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

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (both functions are the connector login's only, so the gate leaves them as they are)

commit;
