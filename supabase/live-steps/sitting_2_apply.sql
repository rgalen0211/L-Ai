-- SITTING PASTE 2 of 3: migrations A1 to A19, byte for byte, in the paper's order (GEO sitting_build.py, Wed 11-25; generated).
-- THIS CHANGES THE LIVE DATABASE. Run it ONCE, only after paste 1 said PASS. Copy ALL, paste into the SQL Editor, Run.
-- The Editor may warn about a destructive operation: that is expected, click 'Run this query'.
-- PASS = the last result reads 'PASS: A1 to A19 applied'. ANY error: STOP, do NOT run this again; run paste 3 and send GEO both.
-- Each migration keeps its own begin ... commit: on an error, the ones before it stay applied and nothing after it runs.

-- ===== A1: migrations/20261120000100_connect_purge_edit.sql =====
-- THE DAILY CONNECTOR PURGE ALSO RUNS THE LIVE EDITOR'S PURGE (CONNECT audit, 2026-11-20). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, and it CHANGES ONE LIVE FUNCTION (public.connect_purge). UNRUN against a database: written and read, not executed.
-- Why: 20261027000400_live_editor.sql promises that the track summary the desktop app mirrors for the person's AI (clip names and times) "is dropped 24 hours after the editor was last open" and that the edit log "keeps 7 days".
-- Both promises live in ryagram_private.edit_purge(), which that migration revokes from every API role and says "a later ops step calls it". Nothing ever did: no migration, no cron step and no Edge Function names it
-- (grep the repository for edit_purge: only its own definition, its tests and the after-check), so a mirrored track summary stays in public.edit_drafts and every op stays in public.edit_ops for ever.
-- The one purge that IS scheduled is public.connect_purge() (a daily pg_cron job, supabase/connect-live/05b_purge_last_run.sql checks it runs). This file makes that function ALSO call edit_purge(), when the live editor is installed.
-- Everything else in connect_purge is as 20261018000100_connect_ai.sql left it (same deletes, same four counts, same keys); ONE key is added to the answer, 'edit' (what edit_purge answered: summaries_dropped, ops_deleted; null where the live editor is not installed).
-- Same name, same arguments, same owner and grants (create or replace keeps them: nobody but the database owner and the dashboard can run it). Summaries are therefore dropped between 24 and 48 hours after the editor was last open (the job runs once a day).
-- Needs 20261018000100_connect_ai.sql. Uses 20261027000400_live_editor.sql when it is applied (the call is skipped without it, so the file is safe in either order).
-- Undo: supabase/rollbacks/20261120000100_connect_purge_edit_rollback.sql. After-check: supabase/live-steps/30_connect_purge_edit_after_check.sql.
-- APPLY NOTE FOR RYAN (CC1's deep review of 11-20, LOW 3, so this file does not surprise anyone): applying it switches edit_purge on FOR THE FIRST TIME, and edit_purge DELETES DATA on the live database: within a day, any
-- compilation draft whose web editor was last opened more than 24 hours ago loses its mirrored track list and its "AI can see it" setting, EVEN IF the desktop app posted a new list an hour earlier (edit_purge compares the editor-open
-- time, coalesce(editor_seen_at, updated_at), not the app's last post); the draft's revision does not change, so a client sees nothing and waiting edits stay pending until the app posts again. That is what the 24-hour promise in
-- 20261027000400 says, but nobody has ever run it. THE FIRST RUN ALSO DELETES every public.edit_ops row older than 7 days: the whole edit-log backlog since the live editor began (edit_purge in 20261027000400_live_editor.sql), in one go. Those rows also hold the AI's re-apply guard (a change the person undid is not applied again: status undone or rejected, ended_by person, live_editor line 237), so that guard and the person's undo history vanish after 7 days; that is the promise the live-editor migration makes, nobody ran it before. Before applying: decide whether to also (a) bump the revision and reject waiting edits when a draft is cleared, and (b) count the app's last post as activity; neither is done here
-- (unrun SQL is kept to the least change). Also: the network-only host list in the plan-asks migration (20261120000200) is a name rule only; a public name that resolves to a private address (127.0.0.1.nip.io) passes it, and names such as
-- home.arpa, localdomain, corp and intranet are not listed: the desktop app's own address check at download time is the real guard, this is the first one.

begin;

create or replace function public.connect_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int; e jsonb := null;
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
  -- the live editor's own retention (20261027000400): mirrored track summaries 24 hours after the editor was last open, the edit log after 7 days
  if to_regprocedure('ryagram_private.edit_purge()') is not null then
    begin
      execute 'select ryagram_private.edit_purge()' into e;
    exception when others then
      e := jsonb_build_object('error', sqlstate);          -- a failing editor purge must NEVER stop the daily connector purge above it (RENDERER's review of 11-20): the answer says it failed, the other deletes stand
    end;
  end if;
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (connect_purge is for the database owner and the dashboard only, so the gate leaves it as it is)

commit;

-- ===== A2: migrations/20261120000200_plan_asks_lock_and_host.sql =====
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

-- ===== A3: migrations/20261120000500_prepared_data.sql =====
-- AI-PREPARED DATA: THE AI HANDS RYAGRAM A TABLE IT RESEARCHED (CONNECT, 2026-11-20; Q634, Ryan's ChatGPT walk: "median age by US state 2010-2023"; design: proposals/CONNECT-FIND-DATA-DESIGN.md section 8 and
-- proposals/CONNECT-AI-DATA-HANDOFF-1120.md). NOT APPLIED: a migration for CC1's review; applying it is a live step Ryan takes.
-- WHAT IT DOES. The person's own AI may send a small table (place, year, value, ... as CSV text, at most 200 KB) with the sources it used (https addresses), the licence, the units and a short change log. It lands in a CLOSED
-- staging table, public.prepared_data, as inert text: it is NOT a dataset, it holds no file, and NO connector function can accept, confirm, attach or use it. The signed-in PERSON sees it in the app ("Prepared by your AI"),
-- previews it, and presses Accept; THEIR browser then runs today's exact upload path (create_upload -> upload -> finish_upload -> the worker's sandbox reads it -> confirm_dataset_mapping -> attach_upload_to_version), so every
-- upload rule, cap and the trust label ("Unverified, user-supplied": an upload is always unverified) is reused unchanged. After the upload the app calls mark_prepared_accepted(staged id, dataset id), which records WHO prepared it
-- and what the AI declared on the dataset (datasets.prepared_from, datasets.prep_log) and deletes the staged text.
-- WHAT IT ADDS. (1) the scope 'submit_data' on the consent page (connections made before keep their grant and do not get it); (2) two columns on public.datasets (prepared_from, prep_log); (3) the table public.prepared_data;
-- (4) connector functions (token hash only, EXECUTE only to connect_runner): connect_submit_prepared_data (scope submit_data) and connect_list_my_data (scope read: the person's uploaded datasets, by the story name u_<24 hex>);
-- (5) app functions (signed-in session only; the gate refuses a waiting-list account): my_prepared_data(), my_prepared_data_csv(uuid), discard_prepared_data(uuid), mark_prepared_accepted(uuid, uuid);
-- (6) a discarded table keeps its (empty) row for a day so the 10-a-day count cannot be lowered by discarding; ryagram_private.prepared_purge(): deletes staged items 7 days after they arrived (and accepted or discarded ones a day later). NOTHING CALLS IT YET: until the daily connector purge (connect_purge) calls it, an expired item is simply
-- invisible and refused (every read and write checks expires_at), and the purge is one line to add. Limits: at most 5 waiting and 10 a day per person (the AI is told in words, code PT429); the table is at most 200 KB and 5000 rows.
-- WHAT IT DOES NOT DO. It changes no grant on an existing object, no existing function, and nothing about how a story names a dataset (that is the connector's TypeScript: set_story learns that u_<hex> names the person's own approved uploads).
-- Needs 20261004000200_uploads_schema.sql (datasets, create_upload ...), 20261018000100_connect_ai.sql (connect_actor and the scopes), 20261027000400_live_editor.sql (ryagram_private.edit_text_ok) and the waiting-list gate (gate_apply).
-- UNRUN against a database: written and read, not executed. Undo: supabase/rollbacks/20261120000500_prepared_data_rollback.sql. After-check: supabase/live-steps/34_prepared_data_after_check.sql.

begin;

-- ---------------------------------------------------------------- what a dataset records about how it was prepared
alter table public.datasets
  add column prepared_from uuid,
  add column prep_log jsonb check (prep_log is null or (jsonb_typeof(prep_log) = 'object' and pg_column_size(prep_log) <= 16384));

-- ---------------------------------------------------------------- the staging table: inert text, closed to every API role
create table public.prepared_data (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  csv_text text not null check (octet_length(csv_text) <= 204800),
  sources jsonb not null check (jsonb_typeof(sources) = 'object' and octet_length(sources::text) <= 8192),
  change_log jsonb not null check (jsonb_typeof(change_log) = 'array' and jsonb_array_length(change_log) <= 12 and octet_length(change_log::text) <= 4096),
  measured jsonb not null check (jsonb_typeof(measured) = 'object' and octet_length(measured::text) <= 8192),
  ai_name text check (ai_name is null or char_length(ai_name) <= 60),
  state text not null default 'waiting' check (state in ('waiting', 'accepted', 'discarded')),
  dataset_id uuid references public.datasets (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  decided_at timestamptz
);
create index prepared_data_owner_idx on public.prepared_data (owner_id, created_at desc);
alter table public.prepared_data enable row level security;
revoke all on public.prepared_data from public, anon, authenticated, service_role, connect_runner;      -- read and written only through the definer functions below

-- ---------------------------------------------------------------- what the AI may send, checked here (the connector checks and measures first; this is the second lock)
create function ryagram_private.prepared_sources_ok(s jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare u jsonb; k text;
begin
  if s is null or jsonb_typeof(s) <> 'object' then return 'The sources must be an object.'; end if;
  if exists (select 1 from jsonb_object_keys(s) x where x not in ('urls', 'publisher', 'licence', 'units', 'notes', 'retrieved')) then return 'The sources have a field Ryagram does not know.'; end if;
  if jsonb_typeof(s -> 'urls') is distinct from 'array' or jsonb_array_length(s -> 'urls') not between 1 and 5 then return 'Give 1 to 5 source addresses (https).'; end if;
  for u in select * from jsonb_array_elements(s -> 'urls') loop
    if jsonb_typeof(u) <> 'string' or length(u #>> '{}') > 500
       or (u #>> '{}') !~ '^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]*(/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$' then
      return 'Each source address must be an https:// website name with no user name, no port and no spaces.';
    end if;
  end loop;
  for k in select unnest(array['publisher', 'licence', 'units', 'notes', 'retrieved']) loop
    if s ? k then
      if jsonb_typeof(s -> k) <> 'string' or not ryagram_private.edit_text_ok(s ->> k, 300) then
        return format('"%s" must be 1 to 300 characters of plain words (no places on a computer, no web addresses, no markup).', k);
      end if;
    end if;
  end loop;
  if not (s ? 'licence') or not (s ? 'units') then return 'Say what the licence is and what the units are.'; end if;
  return null;
end $$;

create function ryagram_private.prepared_log_ok(l jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb;
begin
  if l is null or jsonb_typeof(l) <> 'array' or jsonb_array_length(l) > 12 then return false; end if;
  for e in select * from jsonb_array_elements(l) loop
    if jsonb_typeof(e) <> 'string' or not ryagram_private.edit_text_ok(e #>> '{}', 200) then return false; end if;
  end loop;
  return true;
end $$;

create function ryagram_private.prepared_measured_ok(m jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if m is null or jsonb_typeof(m) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(m) x where x not in ('rows', 'columns', 'header', 'places', 'first_period', 'last_period', 'periods_found', 'periods_missing', 'value_column', 'period_column', 'place_column', 'shape', 'non_numeric_values')) then return false; end if;
  if coalesce(jsonb_typeof(m -> 'rows'), '') <> 'number' or coalesce(jsonb_typeof(m -> 'columns'), '') <> 'number' then return false; end if;
  if (m ->> 'rows')::numeric not between 1 and 5000 or (m ->> 'columns')::numeric not between 2 and 40 then return false; end if;
  return true;
end $$;
revoke execute on function ryagram_private.prepared_sources_ok(jsonb), ryagram_private.prepared_log_ok(jsonb), ryagram_private.prepared_measured_ok(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the AI hands over a table (the connector measures it first and passes what it measured)
create function public.connect_submit_prepared_data(p_token_hash text, p_label text, p_csv text, p_sources jsonb, p_change_log jsonb, p_measured jsonb, p_ai_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.connect_actor(p_token_hash, 'submit_data');
  problem text; waiting int; today int; nid uuid; exp timestamptz;
begin
  if p_label is null or not ryagram_private.edit_text_ok(p_label, 120) then
    raise exception 'The label must be 1 to 120 characters of plain words (no places on a computer, no web addresses, no markup).' using errcode = '22023';
  end if;
  if p_csv is null or octet_length(p_csv) < 8 or octet_length(p_csv) > 204800 then
    raise exception 'The table must be CSV text of 200 KB or less. For a bigger table, give the person the cleaned file to upload by hand.' using errcode = '22023';
  end if;
  if p_csv ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then
    raise exception 'The table has control characters in it. Send plain CSV text.' using errcode = '22023';
  end if;
  problem := ryagram_private.prepared_sources_ok(p_sources);
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;
  if not ryagram_private.prepared_log_ok(coalesce(p_change_log, '[]'::jsonb)) then
    raise exception 'The change log is at most 12 steps, each 1 to 200 characters of plain words.' using errcode = '22023';
  end if;
  if not ryagram_private.prepared_measured_ok(p_measured) then
    raise exception 'The measured counts are not in the shape Ryagram expects.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prepared:' || me::text, 0));
  select count(*) into waiting from public.prepared_data where owner_id = me and state = 'waiting' and expires_at > now();
  if waiting >= 5 then
    raise exception 'There are already 5 tables waiting for the person to accept. Ask them to deal with those first.' using errcode = 'PT429';
  end if;
  select count(*) into today from public.prepared_data where owner_id = me and created_at > now() - interval '24 hours';
  if today >= 10 then
    raise exception 'That is 10 prepared tables in a day. Try again tomorrow.' using errcode = 'PT429';
  end if;
  insert into public.prepared_data (owner_id, label, csv_text, sources, change_log, measured, ai_name)
    values (me, p_label, p_csv, p_sources, coalesce(p_change_log, '[]'::jsonb), p_measured, left(nullif(p_ai_name, ''), 60)) returning id, expires_at into nid, exp;
  return jsonb_build_object('prepared_id', nid, 'state', 'waiting', 'expires_at', exp, 'where', 'Your data');
end $$;

-- ---------------------------------------------------------------- what the AI may read about the person's own uploaded data (names, never rows)
create function public.connect_list_my_data(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');
begin
  return jsonb_build_object(
    'datasets', coalesce((select jsonb_agg(jsonb_build_object(
        'name', 'u_' || substr(replace(d.id::text, '-', ''), 1, 24), 'label', d.filename_label, 'status', d.status::text, 'geography', d.geography,
        'cadence', d.mapping ->> 'cadence', 'trust_label', 'unverified_user', 'prepared_by_ai', d.prepared_from is not null) order by d.created_at desc)
      from public.datasets d where d.owner_id = me and d.source = 'upload' and d.deleted_at is null and d.delete_requested_at is null and (to_jsonb(d) ->> 'trashed_at') is null), '[]'::jsonb),
    'waiting_for_you', (select count(*) from public.prepared_data p where p.owner_id = me and p.state = 'waiting' and p.expires_at > now()));
end $$;

-- ---------------------------------------------------------------- the PERSON's side (a signed-in session; the gate refuses a waiting-list account)
create function public.my_prepared_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'label', p.label, 'sources', p.sources, 'change_log', p.change_log, 'measured', p.measured, 'ai_name', p.ai_name,
      'preview_lines', to_jsonb((regexp_split_to_array(p.csv_text, E'\r?\n'))[1:21]), 'created_at', p.created_at, 'expires_at', p.expires_at,
      'trust_label', 'unverified_user') order by p.created_at desc)
    from public.prepared_data p where p.owner_id = me and p.state = 'waiting' and p.expires_at > now()), '[]'::jsonb);
end $$;

create function public.my_prepared_data_csv(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); t text;
begin
  select p.csv_text into t from public.prepared_data p where p.id = p_id and p.owner_id = me and p.state = 'waiting' and p.expires_at > now();
  if not found then raise exception 'That table is not waiting for you any more.' using errcode = '22023'; end if;
  return t;
end $$;

create function public.discard_prepared_data(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); n int;
begin
  -- the staged text goes at once, the row stays a day so that discarding does not lower the day's count (the purge removes it)
  update public.prepared_data set state = 'discarded', csv_text = '', decided_at = now() where id = p_id and owner_id = me and state = 'waiting';
  get diagnostics n = row_count;
  return jsonb_build_object('discarded', n > 0);
end $$;

-- after the browser has uploaded the table as a dataset of its own: record who prepared it and what was declared, and drop the staged text
create function public.mark_prepared_accepted(p_id uuid, p_dataset uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_signed_in(); p public.prepared_data; d public.datasets;
begin
  select * into p from public.prepared_data where id = p_id and owner_id = me and state = 'waiting' and expires_at > now() for update;
  if not found then raise exception 'That table is not waiting for you any more.' using errcode = '22023'; end if;
  select * into d from public.datasets where id = p_dataset and owner_id = me and source = 'upload' and deleted_at is null and delete_requested_at is null for update;
  if not found or d.prepared_from is not null or d.created_at < now() - interval '2 hours' or lower(btrim(coalesce(d.filename_label, ''))) <> lower(btrim(p.label)) then
    raise exception 'That upload is not one you just made from this table.' using errcode = '22023';
  end if;
  update public.datasets set prepared_from = p.id,
    prep_log = jsonb_build_object('declared_by', coalesce(p.ai_name, 'your AI'), 'declared_at', p.created_at, 'change_log', p.change_log, 'sources', p.sources, 'measured', p.measured, 'staged_id', p.id)
    where id = d.id;
  update public.prepared_data set state = 'accepted', dataset_id = d.id, csv_text = '', decided_at = now() where id = p.id;
  return jsonb_build_object('accepted', true, 'dataset_id', d.id);
end $$;

-- ---------------------------------------------------------------- retention: staged items go 7 days after they arrived (accepted or discarded ones a day after); NOTHING CALLS THIS YET (see the header)
create function ryagram_private.prepared_purge() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.prepared_data where expires_at < now() or (state <> 'waiting' and decided_at < now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function ryagram_private.prepared_purge() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- grants: the connector's two functions to the connector login only; the app's four to a signed-in session only
revoke execute on function public.connect_submit_prepared_data(text, text, text, jsonb, jsonb, jsonb, text), public.connect_list_my_data(text) from public, anon, authenticated;
grant execute on function public.connect_submit_prepared_data(text, text, text, jsonb, jsonb, jsonb, text), public.connect_list_my_data(text) to connect_runner;
revoke execute on function public.my_prepared_data(), public.my_prepared_data_csv(uuid), public.discard_prepared_data(uuid), public.mark_prepared_accepted(uuid, uuid) from public, anon;
grant execute on function public.my_prepared_data(), public.my_prepared_data_csv(uuid), public.discard_prepared_data(uuid), public.mark_prepared_accepted(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the new scope, offered on the consent page (connections made before keep their grant and do not get it)
create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free', 'edit', 'fetch_data', 'submit_data']::text[] $$;

select ryagram_private.gate_apply();                       -- a waiting-list account is refused by the four app functions like everywhere else (the connector's two are for the connector login only, so the gate leaves them as they are)

commit;

-- ===== A4: migrations/20261120000600_prepared_purge_daily.sql =====
-- THE DAILY CONNECTOR PURGE ALSO RUNS THE PREPARED-DATA PURGE (CONNECT, 2026-11-21; GEO's 12:00 review, MEDIUM 1). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. UNRUN against a database (the Postgres lane waits for disk; see the header of the test).
-- Why: 20261120000500_prepared_data.sql defines ryagram_private.prepared_purge() (delete a waiting table 7 days after it arrived, an accepted or discarded one a day after it was decided) and says nothing calls it yet. Nothing did, so an expired waiting
-- table kept its full CSV text in public.prepared_data for ever (only hidden), and accepted and discarded rows stayed. The Privacy page will say a handed-over table is gone after 7 days, so this makes it true.
-- What it changes: ONE live function, public.connect_purge() (the daily pg_cron job; the same name, arguments, owner and grants, because create or replace keeps them). It is 20261120000100_connect_purge_edit.sql's function (same deletes, same four counts, the
-- editor purge call) PLUS one guarded call to prepared_purge() (skipped when that function does not exist, and a failing prepared purge can never stop the purge above it), and ONE new key in the answer, 'prepared' (the number of rows removed).
-- Order: after 20261120000100 and 20261120000500; it is a superset of the first, so it is safe even if only one of them is applied (each call is skipped without its function). Undo: supabase/rollbacks/20261120000600_prepared_purge_daily_rollback.sql. After-check: supabase/live-steps/38_prepared_purge_after_check.sql.
-- Why a new file and not an edit of 20261120000500: that file is the lane proven 11 of 11 on a real Postgres and stays byte for byte as it was.

begin;

create or replace function public.connect_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int; e jsonb := null; f jsonb := null;
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
  -- the live editor's own retention (20261027000400): mirrored track summaries 24 hours after the editor was last open, the edit log after 7 days
  if to_regprocedure('ryagram_private.edit_purge()') is not null then
    begin
      execute 'select ryagram_private.edit_purge()' into e;
    exception when others then
      e := jsonb_build_object('error', sqlstate);          -- a failing editor purge must NEVER stop the daily connector purge above it (RENDERER's review of 11-20): the answer says it failed, the other deletes stand
    end;
  end if;
  -- AI-prepared tables (20261120000500): a waiting table goes 7 days after it arrived, an accepted or discarded one a day after it was decided (its text was already emptied at once). Without this call an expired table keeps its full text in the database for ever, only hidden (GEO 11-21).
  if to_regprocedure('ryagram_private.prepared_purge()') is not null then
    begin
      execute 'select to_jsonb(ryagram_private.prepared_purge())' into f;
    exception when others then
      f := jsonb_build_object('error', sqlstate);          -- a failing prepared purge must NEVER stop the daily connector purge above it, and its answer says it failed
    end;
  end if;
  return jsonb_build_object('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e, 'prepared', f);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (connect_purge is for the database owner and the dashboard only, so the gate leaves it as it is)

commit;

-- ===== A5: migrations/20261121000100_account_delete_paid.sql =====
-- ACCOUNT DELETION FOR A CUSTOMER WHO PAID, AND EMAILS LEFT BEHIND (GEO, 2026-11-21; CC1 10:4x; proposals/GEO-SECURITY-PRIVACY-REVIEW-1121.md
-- M1 and M5). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. It adds TWO new functions (service role only) and changes no existing one.
-- Why M1: delete-account recorded only a REQUEST for anyone with credit history (the ledger is a financial record) and removed nothing,
-- so a paying customer's uploads and films stayed until a hand step that has no procedure. Now the function removes both buckets' files
-- first (as for everyone), then account_erase_paid_content leaves only tombstones: an upload becomes 'Deleted data' with no name, file
-- label, report or mapping (exactly mark_uploads_removed's tombstone), and a film row is marked deleted. Both only where the file is
-- really gone from Storage, so a failed removal is retried by asking again. The ledger, the account and its login are NOT touched: the
-- request row stays, and Ryan closes the account by hand.
-- Why M5: support_requests.email and invite_redemptions.email outlived the account (support_requests set owner_id to null on delete;
-- an unanswered request was kept with no end). account_redact_contact replaces the address in both, for the person's own rows
-- (by owner, or by the address itself in any case where the row has no owner; a creator application by its address), BEFORE the login goes. The support message itself is kept (its retention is
-- support's: answered requests 3 years); the row no longer names the person.
-- Nothing here reaches the Stripe customer record (it keeps the email at Stripe); the Privacy page says so (GEO review L4).
begin;

create function public.account_erase_paid_content(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uploads int;
  films int;
begin
  if p_owner is null then
    raise exception 'No account named.' using errcode = '22023';
  end if;
  uploads := public.mark_uploads_removed(array(select d.id from public.datasets d where d.owner_id = p_owner and d.deleted_at is null));
  update public.artifacts a set deleted_at = now()
    where a.owner_id = p_owner and a.deleted_at is null
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = a.storage_path);
  get diagnostics films = row_count;
  return jsonb_build_object('uploads_erased', uploads, 'films_marked_deleted', films,
    'uploads_left', (select count(*) from public.datasets d where d.owner_id = p_owner and d.deleted_at is null and d.storage_path is not null),
    'films_left', (select count(*) from public.artifacts a where a.owner_id = p_owner and a.deleted_at is null));
end $$;

create function public.account_redact_contact(p_owner uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(trim(coalesce(p_email, '')));
  support int;
  invites int;
  applications int;
  labels int;
  creator_labels int;
begin
  if p_owner is null then
    raise exception 'No account named.' using errcode = '22023';
  end if;
  update public.support_requests s set email = 'redacted@deleted.invalid'
    where s.email <> 'redacted@deleted.invalid'
      and (s.owner_id = p_owner or (s.owner_id is null and addr <> '' and lower(s.email) = addr));   -- never another person's row (CC1 10:57)
  get diagnostics support = row_count;
  -- the code a person was invited with names them ('invite: <name>'): its label goes first, while the redemption still points at it
  -- (CC1 11:15 LOW d); retention_purge still removes it 12 months on (its label still starts 'invite: ')
  update public.invite_codes k set label = 'invite: (deleted)'
    where k.label like 'invite: %' and k.label <> 'invite: (deleted)'
      and exists (select 1 from public.invite_redemptions r where r.code_hash = k.code_hash
                    and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr)));
  get diagnostics labels = row_count;
  -- a creator's invite is labelled 'creator #<application id> <name>' (creator_flow.sql): its name goes too, found by the application, before that is redacted
  update public.invite_codes k set label = 'creator #' || c.id || ' (deleted)'
    from public.creator_applications c
    where addr <> '' and lower(c.email) = addr and k.label like 'creator #' || c.id || ' %' and k.label <> 'creator #' || c.id || ' (deleted)';
  get diagnostics creator_labels = row_count;
  labels := labels + creator_labels;
  update public.invite_redemptions r set email = 'redacted'
    where r.email <> 'redacted'
      and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr));
  get diagnostics invites = row_count;                    -- right after its own update (CC1 11:15 LOW a)
  -- a creator application names no account: matched by the address alone (CC1 10:57 LOW 5). lower(email) is UNIQUE
  -- (creator_applications_email_key), so each row gets ITS OWN address: one fixed address would collide on the second applicant (CC1 11:15 HIGH)
  update public.creator_applications c set email = 'redacted+' || c.id || '@deleted.invalid', name = 'Deleted'
    where addr <> '' and lower(c.email) = addr;
  get diagnostics applications = row_count;
  return jsonb_build_object('support_requests_redacted', support, 'invite_redemptions_redacted', invites, 'invite_labels_redacted', labels,
                            'creator_applications_redacted', applications);
end $$;

revoke execute on function public.account_erase_paid_content(uuid), public.account_redact_contact(uuid, text)
  from public, anon, authenticated;
grant execute on function public.account_erase_paid_content(uuid), public.account_redact_contact(uuid, text) to service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (both functions are service role only)
commit;

-- ===== A6: migrations/20261121000200_expired_films_really_gone.sql =====
-- An expired paid film is marked GONE only once its file is really gone (WORKER 2026-11-21, GEO's privacy review M2;
-- r2 after CC1's 11:27 review and GEO's second review).
--
-- Before: render_orders_tick() set render_deliveries.deleted_at and artifacts.deleted_at for every expired delivery, and
-- only THEN handed the file paths to ops-tick to remove. If that Storage remove failed (one error, a timeout), the rows
-- already said 'deleted', no later tick looked at them again, and the customer's film stayed in Storage for good while
-- everything said it was gone.
--
-- Now, two marks with two meanings:
--   * artifacts.deleted_at = the customer may no longer READ the film. Set by the tick AT EXPIRY, as before (the owner's
--     Storage read policy and the artifacts RLS check it), so the film is unreadable at once even while a remove fails.
--   * render_deliveries.deleted_at = the film is REALLY GONE from Storage. Set only by mark_deliveries_removed, and only
--     when storage.objects no longer holds the file (the mark_uploads_removed rule).
-- The tick LISTS the expired deliveries not yet really gone (paths + ids) and ends the order 'expired'; ops-tick removes
-- the files, then calls mark_deliveries_removed(ids). A failed remove leaves the delivery due, so the next tick (every
-- minute) lists it and tries again.
-- One thing this does not change (as on main): a download link signed BEFORE expiry keeps working until its own end
-- (up to an hour); a new one cannot be made (ryagram_private.delivery_object refuses past expires_at).
--
-- Nothing applied is edited: this file replaces the function body and adds one function. Service role only.

begin;

create or replace function public.render_orders_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  d record;
  expired int := 0;
  paths jsonb := '[]'::jsonb;
  ids jsonb := '[]'::jsonb;
  n_days int;
begin
  select approval_days into n_days from public.ops_settings where id;
  for s in select id from public.render_stages
           where stage = 'final_render' and state = 'awaiting_approval' and awaiting_since < now() - make_interval(days => n_days)
           for update skip locked loop
    perform ryagram_private.final_close(s.id, 'expired', 'approval_expired', null, null);
    expired := expired + 1;
  end loop;
  -- expired deliveries not yet really gone: unreadable now (artifacts.deleted_at), listed until the file is removed.
  -- random order (CC1's LOW): a batch of files whose remove keeps failing can never starve the newer ones.
  for d in select r.id, r.order_id, r.artifact_id, a.storage_path from public.render_deliveries r
           left join public.artifacts a on a.id = r.artifact_id
           where r.deleted_at is null and r.expires_at < now()
           order by random() limit 500
           for update of r skip locked loop
    update public.artifacts set deleted_at = now() where id = d.artifact_id and deleted_at is null;
    update public.render_orders set state = 'expired', error_code = 'delivery_expired'
      where id = d.order_id and state <> 'expired';
    if d.storage_path is not null then
      paths := paths || to_jsonb(d.storage_path);
    end if;
    ids := ids || to_jsonb(d.id);
  end loop;
  return jsonb_build_object('approvals_expired', expired, 'delete_objects', paths, 'due_deliveries', ids);
end $$;

create function public.mark_deliveries_removed(p_delivery_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    select r.id, r.artifact_id from public.render_deliveries r
    left join public.artifacts a on a.id = r.artifact_id
    where r.id = any (p_delivery_ids) and r.deleted_at is null and r.expires_at < now()
      and (a.storage_path is null
           or not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = a.storage_path))),
  arts as (
    update public.artifacts set deleted_at = now()
      where id in (select artifact_id from gone where artifact_id is not null) and deleted_at is null
      returning id)
  update public.render_deliveries set deleted_at = now()
    where id in (select id from gone) and deleted_at is null;      -- overlapping calls never count one twice (CC1's LOW)
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.mark_deliveries_removed(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_deliveries_removed(uuid[]) to service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
-- Check after running: supabase/live-steps/39_expired_films_gone_after_check.sql (every ok true).
commit;

-- ===== A7: migrations/20261121000300_upload_films_gone.sql =====
-- Films made FROM a customer's upload go when the upload goes (WORKER 2026-11-21, GEO's privacy review M3;
-- r2 after CC1's 11:27 review and GEO's second review).
--
-- Before: the hourly purge-uploads sweep removed the uploaded spreadsheet, but every contact sheet, preview, thumbnail and
-- receipt made from it stayed in Storage for good, so a customer deleted their data and a preview showing their values
-- frame by frame stayed in their films.
--
-- THE RULE (reversible; Ryan to confirm, as GEO asked 'decide the rule'):
--   * the person DELETED their data (Delete, then Recently deleted ran out or 'Delete forever'): every file of every
--     finished job that read it goes, the final film too: the film shows their data and they asked for it to be gone;
--   * 'Don't keep' or an unreadable file: every file goes EXCEPT those of a final render whose delivery is still live
--     (the film, its thumbnail and its receipt stay until the delivery's own 30 days end and M2 removes the film; then
--     the rest go here). 'Don't keep' means 'don't keep my spreadsheet', not 'delete the film I paid for'. A final that
--     was rendered but NEVER delivered (the approval ran out, or it was declined) is treated as a draft: it goes (GEO).
--   * only FINISHED jobs (complete, failed, cancelled, editorial_action_required): a job still uploading cannot have a
--     file marked before it lands (CC1's MEDIUM).
--   * only the upload owner's own files (a.owner_id = d.owner_id; the version trigger already ties them, a cheap guard).
--
-- The sweep LISTS what is due (upload_films_due_for_deletion), removes the files from Storage, then
-- mark_upload_films_removed marks an artifact (and a delivery that names it) deleted ONLY when storage.objects no longer
-- holds the file, the mark_uploads_removed rule, so a failed remove is retried on the next hourly run.
-- Nothing applied is edited. Service role only.

begin;

create function ryagram_private.upload_film_due(a public.artifacts) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
    join public.datasets d on d.id = j.dataset_id
    where j.id = a.job_id and a.deleted_at is null and a.owner_id = d.owner_id
      and d.source = 'upload' and d.deleted_at is not null
      and j.state in ('complete', 'failed', 'cancelled', 'editorial_action_required')
      and (d.delete_requested_at is not null or d.trashed_at is not null                 -- the person deleted it: everything
           or j.job_type <> 'final_render'                                               -- the drafts
           or not exists (select 1 from public.render_deliveries r                       -- a final with no live delivery
                          join public.artifacts f on f.id = r.artifact_id
                          where f.job_id = j.id and r.deleted_at is null)))
$$;

create function public.upload_films_due_for_deletion(p_limit int default 500)
returns table (artifact_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.storage_path from public.artifacts a
  where a.deleted_at is null and ryagram_private.upload_film_due(a)
  order by random()                                       -- a batch whose remove keeps failing never starves the rest
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

create function public.mark_upload_films_removed(p_artifact_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    select a.id from public.artifacts a
    where a.id = any (p_artifact_ids) and a.deleted_at is null and ryagram_private.upload_film_due(a)
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-artifacts' and o.name = a.storage_path)),
  dl as (
    update public.render_deliveries set deleted_at = now()
      where artifact_id in (select id from gone) and deleted_at is null
      returning id)
  update public.artifacts set deleted_at = now() where id in (select id from gone) and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function ryagram_private.upload_film_due(public.artifacts) from public, anon, authenticated, service_role;
revoke execute on function public.upload_films_due_for_deletion(int), public.mark_upload_films_removed(uuid[])
  from public, anon, authenticated;
grant execute on function public.upload_films_due_for_deletion(int), public.mark_upload_films_removed(uuid[]) to service_role;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
-- Check after running: supabase/live-steps/40_upload_films_gone_after_check.sql (every ok true).
commit;

-- ===== A8: migrations/20261121000400_retention_outbox_support.sql =====
-- RETENTION OF THE MAIL WE SENT AND OF UNANSWERED HELP REQUESTS (GEO, 2026-11-21; CC1 11:0x; proposals/GEO-SECURITY-PRIVACY-REVIEW-1121.md
-- M4 and the second half of M5). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it, AFTER 20261121000100_account_delete_paid.sql. It
-- CHANGES TWO FUNCTIONS: public.retention_purge (copied from 20261017000900_funnel_events.sql, its newest version, with only new lines
-- added) and public.account_redact_contact (from 20261121000100, the same way). Grants and owners are kept (create or replace).
-- The numbers, for the Privacy page:
--   * mail we sent a person (invites and approvals, kind 'invite': address, first name, code, app link): removed 12 months after it was sent;
--   * Ryan's own alerts, digests and acks: removed after 12 months;
--   * urgent (child-safety) mail: NOT purged here (kept as long as the law requires; LEGAL-QUESTIONS T5);
--   * a help request nobody answered: removed 12 months after it was sent (answered ones stay 3 years, as before);
--   * on 'delete my account': every outbox row addressed to the person is erased (urgent mail excepted), and their address inside any
--     other message is replaced by '[deleted address]'.
begin;
create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; apps int := 0; codes int := 0; people int := 0; helps int := 0; reps int := 0; funnel int := 0; ids bigint[];
        unanswered int := 0; out_invites int := 0; out_ops int := 0;        -- GEO 11-21 (review M4, M5)
begin
  perform pg_advisory_xact_lock(hashtext('retention_purge'));
  if (select last_run_on from public.retention_runs) = today then
    return jsonb_build_object('skipped', true);
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.creator_applications where decided_at is not null and decided_at < now() - interval '12 months';
  if cardinality(ids) > 0 then
    delete from public.invite_codes where exists (select 1 from unnest(ids) i where invite_codes.label like 'creator #' || i || ' %');   -- redemptions go with them (on delete cascade)
    get diagnostics codes = row_count;
    delete from public.creator_applications where id = any (ids);
    get diagnostics apps = row_count;
    delete from public.ops_alerts where key in (select 'creator:' || i from unnest(ids) i);
  end if;
  -- Invites Ryan made for a person directly (label 'invite: <name>', admin_invite_person): the code row holds the name and its redemption holds the email.
  -- Removed 12 months after the code was last redeemed, or, if nobody used it, 12 months after it expired. Never earlier: a valid, unused invite stays.
  delete from public.invite_codes c where c.label like 'invite: %'
    and coalesce((select max(r.created_at) from public.invite_redemptions r where r.code_hash = c.code_hash), c.expires_at) < now() - interval '12 months';
  get diagnostics people = row_count;
  delete from public.support_requests where answered_at is not null and answered_at < now() - interval '3 years';
  get diagnostics helps = row_count;
  delete from public.abuse_reports where reason <> 'child_safety' and reviewed_at is not null and reviewed_at < now() - interval '3 years';
  get diagnostics reps = row_count;
  -- Funnel events: 13 months after they happened (the account's source row stays while the account does).
  delete from public.funnel_events where at < now() - interval '13 months';
  get diagnostics funnel = row_count;
  -- GEO 11-21 (review M5): a help request nobody answered is removed 12 months after it was sent (answered ones: 3 years, above).
  delete from public.support_requests where answered_at is null and created_at < now() - interval '12 months';
  get diagnostics unanswered = row_count;
  -- GEO 11-21 (review M4): the mail we sent. Invites and approvals ('invite': a person's address, first name, code, app link) go
  -- 12 months after sending, as invite_email.sql's comment promised for the address; Ryan's own alerts, digests and acks go after
  -- 12 months too. Urgent (child-safety) mail is NOT purged here: it is kept as long as the law requires (LEGAL-QUESTIONS T5).
  delete from public.ops_outbox where kind = 'invite' and created_at < now() - interval '12 months';
  get diagnostics out_invites = row_count;
  delete from public.ops_outbox where kind in ('alert', 'digest', 'ack') and created_at < now() - interval '12 months';
  get diagnostics out_ops = row_count;
  update public.retention_runs set last_run_on = today;
  return jsonb_build_object('skipped', false, 'applications', apps, 'invite_codes', codes, 'person_invites', people, 'help_requests', helps, 'reports', reps, 'funnel_events', funnel,
                            'help_requests_unanswered', unanswered, 'outbox_invites', out_invites, 'outbox_ops_mail', out_ops);
end $$;

create or replace function public.account_redact_contact(p_owner uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(trim(coalesce(p_email, '')));
  support int;
  invites int;
  out_gone int := 0;
  out_redacted int := 0;
  pat text;
  applications int;
  labels int;
  creator_labels int;
begin
  if p_owner is null then
    raise exception 'No account named.' using errcode = '22023';
  end if;
  update public.support_requests s set email = 'redacted@deleted.invalid'
    where s.email <> 'redacted@deleted.invalid'
      and (s.owner_id = p_owner or (s.owner_id is null and addr <> '' and lower(s.email) = addr));   -- never another person's row (CC1 10:57)
  get diagnostics support = row_count;
  -- the code a person was invited with names them ('invite: <name>'): its label goes first, while the redemption still points at it
  -- (CC1 11:15 LOW d); retention_purge still removes it 12 months on (its label still starts 'invite: ')
  update public.invite_codes k set label = 'invite: (deleted)'
    where k.label like 'invite: %' and k.label <> 'invite: (deleted)'
      and exists (select 1 from public.invite_redemptions r where r.code_hash = k.code_hash
                    and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr)));
  get diagnostics labels = row_count;
  -- a creator's invite is labelled 'creator #<application id> <name>' (creator_flow.sql): its name goes too, found by the application, before that is redacted
  update public.invite_codes k set label = 'creator #' || c.id || ' (deleted)'
    from public.creator_applications c
    where addr <> '' and lower(c.email) = addr and k.label like 'creator #' || c.id || ' %' and k.label <> 'creator #' || c.id || ' (deleted)';
  get diagnostics creator_labels = row_count;
  labels := labels + creator_labels;
  update public.invite_redemptions r set email = 'redacted'
    where r.email <> 'redacted'
      and (r.user_id = p_owner or (r.user_id is null and addr <> '' and lower(r.email) = addr));
  get diagnostics invites = row_count;                    -- right after its own update (CC1 11:15 LOW a)
  -- a creator application names no account: matched by the address alone (CC1 10:57 LOW 5). lower(email) is UNIQUE
  -- (creator_applications_email_key), so each row gets ITS OWN address: one fixed address would collide on the second applicant (CC1 11:15 HIGH)
  update public.creator_applications c set email = 'redacted+' || c.id || '@deleted.invalid', name = 'Deleted'
    where addr <> '' and lower(c.email) = addr;
  get diagnostics applications = row_count;
  -- GEO 11-21 (review M4): mail we sent TO the person is erased (invites, approvals); urgent (child-safety) mail is kept.
  if addr <> '' then
    delete from public.ops_outbox o where o.kind <> 'urgent' and lower(o.to_addr) = addr;
    get diagnostics out_gone = row_count;
    -- and their address inside any other message (an alert or a digest to Ryan) is replaced: the WHOLE address only, in any case
    -- (CC1 11:15 MEDIUM): every non-letter, non-digit is escaped, and no address character may touch it on either side,
    -- so bryan@example.com or ryan@example.company stay; a sentence's full stop after it is not part of it.
    pat := '(?<![a-z0-9._%+@-])' || regexp_replace(addr, '([^a-z0-9])', '\\\1', 'g') || '(?![a-z0-9_%+@-]|\.[a-z0-9])';
    update public.ops_outbox o set body = regexp_replace(o.body, pat, '[deleted address]', 'gi')
      where o.kind <> 'urgent' and o.body ~* pat;
    get diagnostics out_redacted = row_count;
  end if;
  return jsonb_build_object('support_requests_redacted', support, 'invite_redemptions_redacted', invites, 'invite_labels_redacted', labels,
                            'creator_applications_redacted', applications,
                            'outbox_rows_erased', out_gone, 'outbox_rows_redacted', out_redacted);
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (both functions are service role only)
commit;

-- ===== A9: migrations/20261121000500_unfinished_uploads_purged.sql =====
-- AN UPLOAD THAT WAS NEVER FINISHED IS PURGED AFTER A DAY (GEO, 2026-11-21; CC1 11:3x; proposals/GEO-SECURITY-PRIVACY-REVIEW-1121.md L6).
-- NOT APPLIED: a PROPOSAL for CC1; Ryan applies it. Before: create_upload made the row and its open slot, the browser stored the
-- file, and if the tab closed before finish_upload the row kept uploaded_at null for good; no rule of uploads_due_for_deletion
-- matched it, so the file (the customer's data) stayed in Storage forever. Now the hourly purge-uploads sweep lists it a day
-- after the slot was made, removes the file, and mark_uploads_removed marks the row only once the file is really gone (that
-- also closes the slot: upload_slot_ok needs deleted_at is null, so a late file cannot land). No other change: the function
-- is copied from 20261027000200 with one condition added; grants are kept (create or replace). Service role only.
begin;
create or replace function public.uploads_due_for_deletion(p_limit int default 200)
returns table (dataset_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.storage_path from public.datasets d
  where d.source = 'upload' and d.storage_path is not null and d.deleted_at is null
    and (d.delete_requested_at is not null
         or d.trashed_at < now() - interval '7 days'
         or (d.retention = 'dont_keep'
             and (d.last_activity_at < now() - interval '7 days'
                  or exists (select 1 from public.jobs j where j.dataset_id = d.id and j.job_type = 'final_render' and j.state = 'complete')))
         or (d.status = 'rejected' and d.last_activity_at < now() - interval '1 day')
         -- GEO 11-21 (review L6): a slot whose upload was never finished (the tab closed before finish_upload) goes a day after
         -- it was made; created_at, not last_activity_at, so nothing can keep it alive
         or (d.uploaded_at is null and d.created_at < now() - interval '1 day'))
  order by d.last_activity_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

-- ===== A10: migrations/20261121000550_delete_revokes_ai.sql =====
-- A PAYING CUSTOMER'S DELETE REQUEST ENDS THEIR AI CONNECTIONS (GEO, 2026-11-21; CC1 12:1x number 000550; split from 000600 after
-- GAMES 12:12 so it does not depend on Q634's prepared data). NOT APPLIED: a PROPOSAL for CC1; Ryan applies it.
-- account_request_deletion (its only version, 20260929000900, copied; lines added) is called by delete-account ONLY for an
-- account with credit history, right after the erase step; the login then stays blocked until Ryan closes the account by hand.
-- Now it also revokes that person's AI connection grants and tokens. ORDER: 20261121000600_prepared_tombstone.sql (if applied)
-- redefines this function again, copied from THIS body plus its own lines, so applying in version order (000550, then 000600)
-- ends with both; a test checks 000600 still carries every line of this one. Grants kept (create or replace). Service role only.
begin;
create or replace function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
  -- GEO 11-21 (CC1 12:1x; GAMES 12:12): a paying customer's login stays (blocked) until Ryan's hand close, so nothing
  -- cascades yet. The auth ban stops a sign-in, but connect_actor reads only the connector's own tokens and grants:
  -- without this their AI could keep acting on the account. A revoked grant also refuses a refresh and a code exchange.
  update public.connect_grants set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = p_owner and revoked_at is null;
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

-- ===== A11: migrations/20261121000600_prepared_tombstone.sql =====
-- A DELETED UPLOAD KEEPS NONE OF THE AI'S DECLARATIONS; A PAYING CUSTOMER'S DELETE ALSO CLEARS THEIR AI'S WAITING TABLES
-- (GEO, 2026-11-21; CC1 12:0x; GEO's second review of train 3, MEDIUM 2 and LOW 3). NOT APPLIED: a PROPOSAL for CC1;
-- Ryan applies it AFTER 20261120000500_prepared_data.sql (it needs the prepared columns and table) and AFTER
-- 20261121000550_delete_revokes_ai.sql (CC1 12:1x: version order; that file ends the person's AI connections on its own).
--   * mark_uploads_removed (its only version, 20261004000300, copied; one line added): the 'Deleted data' row also drops
--     prep_log (sources, publisher, notes, change log, who declared it) and prepared_from. Before, every deleted AI-prepared
--     upload kept them.
--   * account_request_deletion, COPIED FROM 000550's body (which already revokes the person's AI connections) with lines
--     added: that person's WAITING prepared tables lose their text and every AI declaration (label, sources, change log,
--     measured, AI name) and are marked discarded. delete-account calls it only for an account with credit history, right
--     after the erase step; the login then stays blocked until Ryan closes the account by hand. ORDER MATTERS: this body must
--     carry every line of 000550's, or applying 000600 after it would undo the revoke; test_prepared_data checks that.
-- Grants and owners are kept (create or replace). Service role only, as before.
begin;
create or replace function public.mark_uploads_removed(p_dataset_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with gone as (
    select d.id from public.datasets d
    where d.id = any (p_dataset_ids) and d.storage_path is not null and d.deleted_at is null
      and not exists (select 1 from storage.objects o where o.bucket_id = 'ryagram-uploads' and o.name = d.storage_path))
  update public.datasets set deleted_at = now(), status = 'rejected', storage_path = null, name = 'Deleted data',
         filename_label = null, ingest_report = null, mapping = null,
         prep_log = null, prepared_from = null      -- GEO 11-21: what an AI declared about a deleted upload goes with it (train 3 review MEDIUM 2)
    where id in (select id from gone);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.account_request_deletion(p_owner uuid, p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_deletion_requests (owner_id, email, reason) values (p_owner, left(p_email, 320), left(p_reason, 500))
    on conflict (owner_id) do nothing;
  -- GEO 11-21 (CC1 12:1x; GAMES 12:12): a paying customer's login stays (blocked) until Ryan's hand close, so nothing
  -- cascades yet. The auth ban stops a sign-in, but connect_actor reads only the connector's own tokens and grants:
  -- without this their AI could keep acting on the account. A revoked grant also refuses a refresh and a code exchange.
  update public.connect_grants set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  update public.connect_tokens set revoked_at = now() where owner_id = p_owner and revoked_at is null;
  -- GEO 11-21 (train 3 review LOW 3): their waiting AI-prepared tables lose their text and the AI's declarations now
  -- (the rows go with the login at Ryan's hand close).
  update public.prepared_data set csv_text = '', state = 'discarded', decided_at = now(),
         label = 'Deleted', sources = '{}'::jsonb, change_log = '[]'::jsonb, measured = '{}'::jsonb, ai_name = null   -- none of the AI's declarations (GAMES 12:12 LOW)
    where owner_id = p_owner and state = 'waiting';
end $$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;

-- ===== A12: migrations/20261121000700_connect_ai_open_to_all.sql =====
-- CONNECT-AN-AI OPENS TO EVERYONE WHO HAS SIGNED UP, AT LAUNCH (CONNECT 2026-11-21; Ryan's typed decision 11:30: "Connect-an-AI open to all signed-up users"; flipped only with him).
-- NOT APPLIED. Applying this file changes NOTHING a person can see: it adds one flag that is OFF, and a connect_person_ok that still answers exactly as before while the flag is off.
--
-- TODAY (20261018000100_connect_ai.sql): "invited" = an enabled row in public.connect_access, and never an administrator, and never a worker. connect_person_ok is the ONE rule behind the consent page, every connector call,
-- the departments list (department_person_ok) and the site's "may this account connect" check (connect_consent_check, which the site reads as invited), so opening it here opens all of them together.
--
-- WHAT THIS ADDS
--   (1) public.connect_flags.open_to_all, default false (the same one-row table as the master switch connections_enabled).
--   (2) ryagram_private.connect_open(): reads it (security definer, like connect_on(); closed to every API role).
--   (3) connect_person_ok, replaced: allowed when the account is enabled in connect_access, OR the flag is on AND the account has no DISABLED row there (an administrator's explicit block still wins while open);
--       an administrator and a worker are never allowed, open or not. With the flag off it is exactly the old rule.
--   (4) admin_connect_set_open(boolean): an administrator's own session flips it (mirror of admin_connect_set_enabled). The live steps also flip it from the SQL Editor (live-steps/36 and 37).
-- WHAT IT DOES NOT TOUCH: tokens, grants, scopes, rate limits, the consent page's own words (an administrator keeps the line "Administrator accounts cannot be connected to an AI assistant.").
-- THE EMERGENCY STOP is unchanged: admin_connect_revoke_all() (from an administrator's app session; from the SQL Editor use the two statements in live-steps/37_connect_open_OFF.sql or connect-live/98_end_all_connections.sql) ends every token and grant; admin_connect_set_enabled(false) refuses everything. Undo of this file: rollbacks/20261121000700_connect_ai_open_to_all_rollback.sql.
-- Needs: 20261018000100_connect_ai.sql. Tested: tests/connect-open-all.test.mjs (reads this file), supabase/tests/test_connect_open.py (a local Postgres; NOT RUN yet, see its header).

begin;

alter table public.connect_flags add column open_to_all boolean not null default false;

create function ryagram_private.connect_open() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select open_to_all from public.connect_flags where id), false) $$;

create or replace function ryagram_private.connect_person_ok(p_owner uuid) returns boolean
language sql stable set search_path = '' as $$
  select p_owner is not null
     and (exists (select 1 from public.connect_access a where a.user_id = p_owner and a.enabled)
          or (ryagram_private.connect_open() and not exists (select 1 from public.connect_access a where a.user_id = p_owner)))
     and not exists (select 1 from public.app_admins ad where ad.user_id = p_owner)
     and not exists (select 1 from public.workers w where w.user_id = p_owner)
$$;

create function public.admin_connect_set_open(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform ryagram_private.connect_app_session();
  if not ryagram_private.is_app_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update public.connect_flags set open_to_all = coalesce(p_on, false) where id;
end $$;

revoke all on function ryagram_private.connect_open() from public, anon, authenticated, connect_runner;
revoke all on function public.admin_connect_set_open(boolean) from public, anon, authenticated, connect_runner;
grant execute on function public.admin_connect_set_open(boolean) to authenticated;

select ryagram_private.gate_apply();                       -- a waiting-list account is refused by the app functions like everywhere else (the new one is for an administrator's session)

commit;

-- ===== A13: migrations/20261121000800_join_open.sql =====
-- SIGN-UP OPEN AT LAUNCH (CONNECT, 2026-11-21; CC1's 12:4x order, WEB's proposals/WEB-SIGNUP-FLIP-1121.md option 2): a stranger can make an account through the join function and be let in at once, with no invite and no one's approval.
-- NOT APPLIED: Ryan applies it. Apply AFTER 20261104000100, 20261104000200 and 20261106000100 (it replaces the 20261106000100 version of join_reserve). Rollback: supabase/rollbacks/20261121000800_join_open_rollback.sql. Check: supabase/live-steps/46_join_open_check.sql.
--
-- WHY: today join_reserve answers 'off' unless the waiting switch (ops_settings.waiting_accounts) is ON, and while it is ON every new account is recorded WAITING. So there was no setting where a stranger joins AND is let in.
-- WHAT THIS ADDS: one flag, ops_settings.join_open, OFF by default. join_reserve answers 'off' only when the waiting switch is off AND join_open is off. Nothing else changes: the same address check, the same limits (5 an hour and 10 a day per caller,
-- 3 a day per email), the same lock, the same answers. The overall cap (200 different addresses in any 24 hours: people, not tries) is now ops_settings.join_daily_max (default 200, CC1's ruling 11-23: Ryan can size opening day) and answers its OWN reason 'full', which the join function words without blaming the person. The account is recorded by the trigger that already exists: with the waiting switch OFF it is ACTIVE, with the switch ON (the brake, live-step 20) it is WAITING.
-- So after launch: join_open ON + waiting switch OFF = a stranger joins and is in; the brake (live-step 20) = new sign-ups wait instead; live-step 21 puts it back. join_open OFF + switch OFF = join closed, as today.
-- The migration turns NOTHING on: join_open is false after it. Ryan flips it with live-step 47 (and back with 48). Only the dashboard (the table owner) can write the flag: ops_settings is closed to every API role.
-- join_reserve keeps its name, arguments, owner and grants (service role only; create or replace keeps them).
--
-- ALSO IN THIS FILE (CC1's 13:5x order; Ryan's 11:30 'Age 18+'): the 18+ confirmation is RECORDED WITH THE ACCOUNT. The join function now refuses without adult_confirmed: true and passes it on as the new account's user metadata;
-- the trigger below copies it into public.account_adult_confirmation (user, time, source) in the same moment the account row is made, so a later change of the metadata cannot change the record. Closed to every API role (the
-- dashboard reads it); no policy, so the account gate has nothing to cover. If the recording ever failed, the account is still made (a warning is logged): a sign-up never fails because of this record.
-- Accounts made through join (source 'join') and through an invite code (redeem-invite, source 'invite') carry it; accounts made before this have no row. The source comes from the server-set metadata adult_source.

begin;

create table public.account_adult_confirmation (
  user_id uuid primary key references auth.users (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  source text not null check (source in ('join', 'invite'))
);
alter table public.account_adult_confirmation enable row level security;
revoke all on public.account_adult_confirmation from public, anon, authenticated, service_role;

create function ryagram_private.account_adult_new() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.raw_user_meta_data ->> 'adult_confirmed' = 'true' then
      insert into public.account_adult_confirmation (user_id, source) values (new.id, case when new.raw_user_meta_data ->> 'adult_source' = 'invite' then 'invite' else 'join' end) on conflict (user_id) do nothing;
    end if;
  exception when others then
    raise warning 'account_adult_confirmation not recorded: %', sqlstate;        -- never stops a sign-up (the whole check is inside: even a missing column cannot)
  end;
  return new;
end $$;
revoke execute on function ryagram_private.account_adult_new() from public, anon, authenticated, service_role;
create trigger account_adult_new_trg after insert on auth.users for each row execute function ryagram_private.account_adult_new();

alter table public.ops_settings add column join_daily_max integer not null default 200 check (join_daily_max >= 0);        -- CC1 11-23: the size of sign-up for any 24 hours; 200 unless Ryan sets another number (0 shuts sign-up for everyone); only the dashboard can write it
alter table public.ops_settings add column join_open boolean not null default false;        -- Ryan's flag: a stranger who joins is let in (with the waiting switch off); false = join is closed unless the waiting list is on

create or replace function public.join_reserve(p_email text, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare mail text := lower(btrim(coalesce(p_email, ''))); eh text;
begin
  if not ryagram_private.waiting_on() and not coalesce((select o.join_open from public.ops_settings o limit 1), false) then       -- 'off' only when BOTH the waiting list and open sign-up are off
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if mail !~ '^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$' or char_length(mail) > 320 then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;
  eh := encode(sha256(convert_to('ryagram-join:' || mail, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- count-then-write takes turns, so callers at the same moment cannot pass the limit together
  delete from public.join_attempts where at < now() - interval '2 days';
  if (select count(distinct email_hash) from public.join_attempts where at > now() - interval '1 day') >= coalesce((select o.join_daily_max from public.ops_settings o limit 1), 200)
     and not exists (select 1 from public.join_attempts a where a.email_hash = eh and a.at > now() - interval '1 day') then       -- the size of sign-up for any 24 hours (Ryan's setting, 200 unless he changes it), counted in DIFFERENT ADDRESSES (people), not tries (GAMES 09:21), and an address that ALREADY holds a place in the window is never turned away by it (GEO 09:51: the person whose email went missing presses Send again): nobody is blamed
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  if (select count(*) from public.join_attempts where ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and at > now() - interval '1 hour') >= 5
     or (select count(*) from public.join_attempts where ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and at > now() - interval '1 day') >= 10
     or (select count(*) from public.join_attempts where email_hash = eh and at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  insert into public.join_attempts (ip_hash, email_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64), eh);
  return jsonb_build_object('ok', true);
end $$;

-- 11-23 (CC1's audit of the email path): when the join function cannot send the email (SMTP down, Auth's hourly email allowance used up) it tells the person so and calls join_release, which gives back the ONE try
-- join_reserve just counted for this caller and address (the newest, within the last 10 minutes). Otherwise three honest retries on a launch morning would lock a stranger out for the day. Service role only, like join_reserve.
create or replace function public.join_release(p_email text, p_ip_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare eh text := encode(sha256(convert_to('ryagram-join:' || lower(btrim(coalesce(p_email, ''))), 'UTF8')), 'hex');
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- takes turns with join_reserve
  delete from public.join_attempts where ctid = (select a.ctid from public.join_attempts a
    where a.ip_hash = left(coalesce(p_ip_hash, 'unknown'), 64) and a.email_hash = eh and a.at > now() - interval '10 minutes' order by a.at desc limit 1);
end $$;
revoke execute on function public.join_release(text, text) from public, anon, authenticated;
grant execute on function public.join_release(text, text) to service_role;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

-- ===== A14: migrations/20261123000100_free_preview_machine_faults.sql =====
-- A STRANGER NEVER LOSES A FREE PREVIEW TO THE MACHINE'S FAULT (CONNECT, 2026-11-23; CC1's ruling 08:11 on WORKER's audit: a limit and an unsupported setup are the render machine's fault, not the person's).
-- NOT APPLIED: Ryan applies it, AFTER phase-2b/credits_ledger.sql (the ledger that owns the free previews). Rollback: supabase/rollbacks/20261123000100_free_preview_machine_faults_rollback.sql. Check: supabase/live-steps/51_free_preview_machine_faults_check.sql.
--
-- WHY: every person gets 6 free previews a project (15 in any 24 hours). ryagram_private.free_previews_used counts them and skips a failed preview only when its error CLASS is 'infrastructure'. The database sets the class from
-- the error CODE (error_class_for), and two codes the machine itself raises land in other classes: engine_unsupported (the worker's own setup: no limits for the job type, no ffmpeg, or, since WORKER's 11-23 change,
-- a catalog dataset or view missing from its list) is 'invalid_input', and limit_exceeded (memory or disk on the machine) is 'limit'. So a stranger who did nothing wrong lost a free preview, and for a person at the allowance
-- (6 used) the next one cost a credit.
-- WHAT THIS CHANGES: one extra condition in free_previews_used: a FAILED preview whose error_code is engine_unsupported is not counted at all, and one whose error_code is limit_exceeded is not counted against the 6 free previews of a
-- PROJECT, like an infrastructure failure. A limit_exceeded preview STILL counts in the 15 free previews in any 24 hours (GAMES' review 11-23: with one render machine, a story that reliably runs it out of memory could otherwise be
-- queued all day across many projects, free, while everyone behind it waits; engine_unsupported fails in seconds at the worker's setup check, so it needs no cap). Everything else counts as before
-- (a story the engine refused, a timeout, a failed check, a finished preview, one cancelled AFTER a machine picked it up).
-- AND (BUILDER's MEDIUM 3, CC1 09:21): a preview cancelled BEFORE a machine picked it up (state cancelled, claimed_at null) is not counted in either count: it never used the machine, and a stranger who changes their mind while waiting
-- in the queue must not lose one of the 6.
-- WHAT IT DOES NOT CHANGE: the error class of any code (so the worker's contract.py / tests/worker_contract.py stay as they are, and the page's words for a limit and for an unsupported setup stay as they are:
-- assets/app-jobs.js keys them on the code and the class), the price quote's shape, grants, or any table. The same body is in phase-2b/credits_ledger.sql, so an apply of the ledger from scratch is right too.
-- ORDER: if the ledger is not applied yet there is no free_previews_used to change: this file then does nothing (a notice says so) and the ledger file, which already carries the rule, is what to apply.

begin;

do $mig$
begin
  if to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)') is null then
    raise notice 'free_previews_used does not exist: the credits ledger (phase-2b/credits_ledger.sql) is not applied. That file carries this rule, so there is nothing to change here.';
    return;
  end if;
  execute $f$
    create or replace function ryagram_private.free_previews_used(p_owner uuid, p_project uuid, p_since timestamptz)
    returns int
    language sql stable set search_path = '' as $body$
      select count(*)::int from public.jobs
      where owner_id = p_owner and job_type = 'preview' and free_preview
        and (p_project is null or project_id = p_project)
        and (p_since is null or created_at >= p_since)
        and not (state = 'failed' and (error_class = 'infrastructure' or error_code = 'engine_unsupported' or (error_code = 'limit_exceeded' and p_since is null)))
        and not (state = 'cancelled' and claimed_at is null)
    $body$
  $f$;
end $mig$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

-- ===== A15: migrations/20261123000200_queue_cap_per_owner.sql =====
-- QUEUE CAP PER OWNER (BUILDER 11-23; CC1 rulings 09:21, 09:54, 10:00 on BUILDER's 08:52 queue audit, HIGH 1). Tuesday head.
-- The render PC makes one film at a time and claims the oldest job first. Contact sheets are free and nothing capped how many
-- a person could queue, so one stranger with 10 projects could put about 45 minutes of work ahead of everyone. Now a person's
-- own NEW contact sheet or preview is refused while they already have ops_settings.queue_cap_per_owner jobs QUEUED (default 2),
-- with plain words and its own errcode (PTQUE). A claimed or running job does not count, nor a full film waiting for approval,
-- nor a job for a tester's own PC (run_on 'owner_local').
--
-- WHERE (CC1 10:00, 'the cap applies ONLY to a person's own new sheet or preview (p_stage is null)'): every job is made by
-- ryagram_private.submit_job_for. A person's own submit (public.submit_job: the app's buttons and the connector's
-- connect_submit_job, which calls it) passes NO stage; an order's stage (stage_submit, which runs inside the worker's report call
-- when an order advances) always passes its stage id. So submit_job_for is wrapped, and the cap runs only when p_stage_id is null
-- and the job is a contact sheet or preview. Order STAGES are never capped (a refusal there would be caught by jobs_advance_order
-- and end the stranger's order as failed/advance_error: the must-fail in tests/test_queue_cap_blocked_views.py).
-- ORDERS (CC1 11:37, option (a), GAMES' 11:37 MEDIUM): public.submit_render_order is granted to every signed-in person and each new
-- key queues a free contact-sheet stage, so it could go around the cap; it is not revoked because Ryagram's worker_orders lane (in
-- tools/worker_update.py PG_LANES, Ryan's Tuesday B3) and pipe1's own tests call it as a signed-in owner. Instead pipe1's
-- ryagram_private.order_submit is RENAMED, body untouched, to order_submit_base, and its wrapper refuses a NEW order while the
-- owner already has the same number (queue_cap_per_owner) of orders still open (running or awaiting approval), same words, same
-- errcode, same per-owner lock. A repeat of an existing order key goes straight through (an idempotent retry is never refused).
--
-- HOW: pipe1's ryagram_private.submit_job_for (20261017000600_pipe1_orders.sql) is RENAMED, body untouched, to submit_job_for_base,
-- and a small wrapper with the same name and signature checks first and calls it. public.submit_job is not touched at all (its
-- grants, the waiting-account gate in it, and the connector fault runner's grant plants all stay on the same function), and no pipe1
-- text is copied, so tests/test_pipe1_orders.py's fault runner still plants into the code that runs.
-- The count-then-insert takes a per-owner lock, so two tabs at the same moment cannot both pass.
-- THE NUMBER: ops_settings.queue_cap_per_owner (default 2, 1 to 50); one dashboard line if the first wave needs another value.
-- Undo: rollbacks/20261123000200_queue_cap_per_owner_rollback.sql. 20261123000300_blocked_story_views.sql replaces the wrapper
-- and carries this check.
begin;

alter table public.ops_settings add column queue_cap_per_owner int not null default 2
  check (queue_cap_per_owner between 1 and 50);

create function ryagram_private.queue_cap_check(p_owner uuid) returns void
language plpgsql set search_path = '' as $$
declare cap int := coalesce((select s.queue_cap_per_owner from public.ops_settings s where s.id), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-queue-cap:' || p_owner::text, 0));
  if (select count(*) from public.jobs j
       where j.owner_id = p_owner and j.state = 'queued' and j.run_on = 'house'
         and j.job_type in ('contact_sheet', 'preview', 'final_render')) >= cap then
    raise exception 'You have % films waiting. You can start another when one is done.', cap using errcode = 'PTQUE';
  end if;
end $$;

alter function ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)
  rename to submit_job_for_base;

create function ryagram_private.submit_job_for(
  p_owner uuid,
  p_version_id uuid,
  p_job_type public.job_type,
  p_params jsonb default '{}'::jsonb,
  p_sheet_job_id uuid default null,
  p_preview_job_id uuid default null,
  p_state public.job_state default 'queued',
  p_stage_id uuid default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  if p_stage_id is null and p_job_type in ('contact_sheet', 'preview') then                     -- a person's own new sheet or preview
    perform ryagram_private.queue_cap_check(p_owner);                                            -- QUEUE CAP (20261123000200)
  end if;
  return ryagram_private.submit_job_for_base(p_owner, p_version_id, p_job_type, p_params, p_sheet_job_id, p_preview_job_id,
                                             p_state, p_stage_id);
end $$;

-- The open-orders limit: the same number, the same words, the same lock as the job cap.
create function ryagram_private.order_cap_check(p_owner uuid) returns void
language plpgsql set search_path = '' as $$
declare cap int := coalesce((select s.queue_cap_per_owner from public.ops_settings s where s.id), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-queue-cap:' || p_owner::text, 0));
  if (select count(*) from public.render_orders o
       where o.owner_id = p_owner and o.state in ('running', 'awaiting_approval')) >= cap then
    raise exception 'You have % films waiting. You can start another when one is done.', cap using errcode = 'PTQUE';
  end if;
end $$;

alter function ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source)
  rename to order_submit_base;

create function ryagram_private.order_submit(p_owner uuid, p_story jsonb, p_key text, p_want public.order_want,
                                             p_title text, p_source public.order_source)
returns public.render_orders
language plpgsql security definer set search_path = '' as $$
begin
  -- the base function's own per-key lock, taken FIRST (re-entrant in this transaction), so two calls with the same new key cannot
  -- both read 'no order yet' and the second be refused instead of getting the first one's order
  perform pg_advisory_xact_lock(hashtext('render_order:' || p_owner::text || ':' || p_key));
  if p_owner is not null
     and not exists (select 1 from public.render_orders o where o.owner_id = p_owner and o.idempotency_key = p_key) then
    perform ryagram_private.order_cap_check(p_owner);                                            -- a NEW order only (OPEN-ORDERS LIMIT)
  end if;
  return ryagram_private.order_submit_base(p_owner, p_story, p_key, p_want, p_title, p_source);
end $$;

-- New private functions: nobody but the definer's own functions (a new function is executable by PUBLIC by default).
revoke execute on function
  ryagram_private.queue_cap_check(uuid),
  ryagram_private.order_cap_check(uuid),
  ryagram_private.submit_job_for(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid),
  ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source)
  from public, anon, authenticated, service_role;

select ryagram_private.gate_apply();                       -- every migration after the waiting-accounts file ends with it (tests/waiting-gate.test.mjs)

commit;

-- ===== A16: migrations/20261123000300_blocked_story_views.sql =====
-- BLOCKED STORY VIEWS (BUILDER 11-23; CC1 rulings 09:24, 09:32, 09:42, 10:00; GAMES' 09:23 plan (a), the SERVER BACKSTOP). Tuesday
-- head. Apply AFTER 20261123000200_queue_cap_per_owner.sql: this file replaces that file's ryagram_private.submit_job_for wrapper
-- and CARRIES its queue-cap check.
-- ENGINE ran every film the catalog builder makes and listed the (dataset, view) pairs that fail the engine's own checks or time
-- out, plus every view that falls back to a blocked one: proposals/ENGINE-CATALOG-BLOCK-LIST-1123-v2.json (FINAL, ENGINE 09:55,
-- sha256 c5a11028..., 16 datasets, 58 pairs), committed ONCE in L-Ai as tools/data/engine-catalog-block-list-1123.json (WEB's
-- gen-catalog reads the same file; tests/test_queue_cap_blocked_views.py keeps this seed equal to it, pair for pair). A stranger who
-- picks one gets a first contact sheet that ends 'checks failed'. The app's builder, a typed or pasted story, a new version of an
-- old story and the AI connector all reach public.submit_job -> ryagram_private.submit_job_for with no stage, and orders start at
-- order_submit, so the refusal is THERE: a person's own contact sheet or preview (or a new order) whose story has a clip on a
-- blocked pair is refused with plain words and errcode PTVEW. Full films are not checked (they need a finished sheet and preview
-- of the same story, which this refuses first). An order's STAGE is never refused here (it runs inside the worker's report call).
-- HOW: submit_job_for is 20261123000200's wrapper over pipe1's untouched submit_job_for_base. The check reads the story the base
-- just stored in the new job (exactly what would run), and a refusal rolls the whole call back, so a story changed in another tab
-- between a read and the insert cannot slip through. The order path: 20261123000200's order_submit wrapper (over pipe1's
-- untouched order_submit_base) also checks a NEW order's story, and keeps its open-orders limit.
-- The list is a table, so a pair ENGINE clears later is one delete (and its line comes off the JSON; the test keeps them equal).
-- Undo: rollbacks/20261123000300_blocked_story_views_rollback.sql (puts back 20261123000200's submit_job_for and order_submit
-- wrappers, drops the table).
begin;

create table ryagram_private.blocked_story_views (
  dataset text not null check (dataset ~ '^[a-z0-9_]{1,80}$'),
  view text not null check (view ~ '^[a-z_]{1,40}$'),
  reason text not null default 'engine checks fail or fall back to a failing view (ENGINE-CATALOG-BLOCK-LIST-1123-v2)',
  added_at timestamptz not null default now(),
  primary key (dataset, view)
);
revoke all on ryagram_private.blocked_story_views from public, anon, authenticated, service_role;

-- Seed: every pair in tools/data/engine-catalog-block-list-1123.json, in its order.
insert into ryagram_private.blocked_story_views (dataset, view) values
  ('bps_county_permits', 'map'),
  ('bps_county_permits', 'bars'),
  ('bps_county_permits', 'paired'),
  ('bps_county_permits', 'panel'),
  ('bps_county_permits', 'shares'),
  ('bea_sainc1_state_income_index', 'bars'),
  ('bea_sainc1_state_income_index', 'paired'),
  ('bea_sainc1_state_income_index', 'panel'),
  ('bls_state_unemployment', 'bars'),
  ('bls_state_unemployment', 'paired'),
  ('bls_state_unemployment', 'panel'),
  ('bls_state_unemployment', 'shares'),
  ('cbp_county_grocery', 'map'),
  ('cbp_county_grocery', 'bars'),
  ('cbp_county_grocery', 'paired'),
  ('cbp_county_grocery', 'panel'),
  ('cbp_county_grocery', 'shares'),
  ('cbp_accommodation_food_share_state', 'bars'),
  ('cbp_accommodation_food_share_state', 'paired'),
  ('cbp_accommodation_food_share_state', 'panel'),
  ('cbp_admin_support_share_state', 'bars'),
  ('cbp_admin_support_share_state', 'paired'),
  ('cbp_admin_support_share_state', 'panel'),
  ('cbp_arts_share_state', 'map'),
  ('cbp_arts_share_state', 'bars'),
  ('cbp_arts_share_state', 'paired'),
  ('cbp_arts_share_state', 'panel'),
  ('cbp_arts_share_state', 'shares'),
  ('cbp_construction_share_state', 'bars'),
  ('cbp_construction_share_state', 'paired'),
  ('cbp_construction_share_state', 'panel'),
  ('cbp_finance_share_state', 'map'),
  ('cbp_finance_share_state', 'bars'),
  ('cbp_finance_share_state', 'paired'),
  ('cbp_finance_share_state', 'panel'),
  ('cbp_finance_share_state', 'shares'),
  ('cbp_management_share_state', 'bars'),
  ('cbp_management_share_state', 'paired'),
  ('cbp_management_share_state', 'panel'),
  ('cbp_mining_share_state', 'map'),
  ('cbp_mining_share_state', 'paired'),
  ('cbp_mining_share_state', 'panel'),
  ('cbp_mining_share_state', 'shares'),
  ('cbp_other_services_share_state', 'bars'),
  ('cbp_other_services_share_state', 'paired'),
  ('cbp_other_services_share_state', 'panel'),
  ('cbp_professional_share_state', 'bars'),
  ('cbp_professional_share_state', 'paired'),
  ('cbp_professional_share_state', 'panel'),
  ('cbp_retail_share_state', 'bars'),
  ('cbp_retail_share_state', 'paired'),
  ('cbp_retail_share_state', 'panel'),
  ('cbp_utilities_share_state', 'bars'),
  ('cbp_utilities_share_state', 'paired'),
  ('cbp_utilities_share_state', 'panel'),
  ('cbp_wholesale_share_state', 'bars'),
  ('cbp_wholesale_share_state', 'paired'),
  ('cbp_wholesale_share_state', 'panel');

-- The first blocked pair a story uses ('dataset view'), or null. Any clip with a dataset and a view counts; an odd or empty story is
-- not an error here (submit_job_for's own checks refuse a story that is not a schema-1 sequence).
create function ryagram_private.blocked_view_in(p_story jsonb) returns text
language sql stable set search_path = '' as $$
  select (c ->> 'dataset') || ' ' || (c ->> 'view')
    from jsonb_array_elements(case when jsonb_typeof(p_story -> 'sequence' -> 'clips') = 'array'
                                   then p_story -> 'sequence' -> 'clips' else '[]'::jsonb end) c
    join ryagram_private.blocked_story_views b on b.dataset = c ->> 'dataset' and b.view = c ->> 'view'
   limit 1
$$;

create function ryagram_private.blocked_view_check(p_story jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if ryagram_private.blocked_view_in(p_story) is not null then
    raise exception 'This film is not available yet. Please pick another view. A line view always works.' using errcode = 'PTVEW';
  end if;
end $$;

-- ryagram_private.submit_job_for: 20261123000200's wrapper, plus the blocked-view check (marked). Same revokes (create or replace
-- keeps them).
create or replace function ryagram_private.submit_job_for(
  p_owner uuid,
  p_version_id uuid,
  p_job_type public.job_type,
  p_params jsonb default '{}'::jsonb,
  p_sheet_job_id uuid default null,
  p_preview_job_id uuid default null,
  p_state public.job_state default 'queued',
  p_stage_id uuid default null)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  own boolean := p_stage_id is null and p_job_type in ('contact_sheet', 'preview');            -- a person's own new sheet or preview
begin
  if own then
    perform ryagram_private.queue_cap_check(p_owner);                                            -- QUEUE CAP (20261123000200)
  end if;
  j := ryagram_private.submit_job_for_base(p_owner, p_version_id, p_job_type, p_params, p_sheet_job_id, p_preview_job_id,
                                           p_state, p_stage_id);
  if own then
    perform ryagram_private.blocked_view_check(j.story);                                         -- BLOCKED VIEWS (20261123000300): rolls the insert back
  end if;
  return j;
end $$;

-- The order path: 20261123000200's order_submit wrapper (pipe1's body stays in order_submit_base), plus the blocked-view check for a
-- NEW order (a repeat of an existing order key goes straight through, as before). Same revokes (create or replace keeps them).
create or replace function ryagram_private.order_submit(p_owner uuid, p_story jsonb, p_key text, p_want public.order_want,
                                                        p_title text, p_source public.order_source)
returns public.render_orders
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('render_order:' || p_owner::text || ':' || p_key));    -- the base's per-key lock, first (20261123000200)
  if p_owner is not null
     and not exists (select 1 from public.render_orders o where o.owner_id = p_owner and o.idempotency_key = p_key) then
    perform ryagram_private.blocked_view_check(p_story);                                         -- a NEW order only (BLOCKED VIEWS)
    perform ryagram_private.order_cap_check(p_owner);                                            -- a NEW order only (OPEN-ORDERS LIMIT, 20261123000200)
  end if;
  return ryagram_private.order_submit_base(p_owner, p_story, p_key, p_want, p_title, p_source);
end $$;

revoke execute on function
  ryagram_private.blocked_view_in(jsonb),
  ryagram_private.blocked_view_check(jsonb)
  from public, anon, authenticated, service_role;

select ryagram_private.gate_apply();                       -- every migration after the waiting-accounts file ends with it (tests/waiting-gate.test.mjs)

commit;

-- ===== A17: migrations/20261123000400_retention_join_attempts.sql =====
-- THE JOIN AND INVITE-GUESS RECORDS ARE REALLY PURGED (CONNECT, 2026-11-23; CC1 09:48 audit: Privacy :34 says the scrambled address and email of a join attempt go after 2 days, but public.join_attempts was cleaned only inside join_reserve,
-- so with sign-up OFF (or on a quiet day) the rows stayed). NOT APPLIED: Ryan applies it, AFTER 20261121000400_retention_outbox_support.sql and 20261121000800_join_open.sql (join_attempts exists since 20261104000200).
-- Rollback: supabase/rollbacks/20261123000400_retention_join_attempts_rollback.sql. It CHANGES ONE FUNCTION: public.retention_purge (a copy of 20261121000400's, its newest version, with only new lines added: two deletes and two numbers in
-- the answer). Grants and owner are kept (create or replace). The purge still does real work once a day (retention_runs) and answers {skipped: true} on its other calls.
--   * join_attempts older than 2 days are deleted (the Privacy promise);
--   * invite_attempts older than 1 day are deleted (failed invite-code guesses, a scrambled address; their own functions clean them only when called).
begin;
create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; apps int := 0; codes int := 0; people int := 0; helps int := 0; reps int := 0; funnel int := 0; ids bigint[];
        unanswered int := 0; out_invites int := 0; out_ops int := 0;        -- GEO 11-21 (review M4, M5)
        join_tries int := 0; invite_tries int := 0;                              -- CONNECT 11-23 (CC1 09:48: Privacy says join records go after 2 days)
begin
  perform pg_advisory_xact_lock(hashtext('retention_purge'));
  if (select last_run_on from public.retention_runs) = today then
    return jsonb_build_object('skipped', true);
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.creator_applications where decided_at is not null and decided_at < now() - interval '12 months';
  if cardinality(ids) > 0 then
    delete from public.invite_codes where exists (select 1 from unnest(ids) i where invite_codes.label like 'creator #' || i || ' %');   -- redemptions go with them (on delete cascade)
    get diagnostics codes = row_count;
    delete from public.creator_applications where id = any (ids);
    get diagnostics apps = row_count;
    delete from public.ops_alerts where key in (select 'creator:' || i from unnest(ids) i);
  end if;
  -- Invites Ryan made for a person directly (label 'invite: <name>', admin_invite_person): the code row holds the name and its redemption holds the email.
  -- Removed 12 months after the code was last redeemed, or, if nobody used it, 12 months after it expired. Never earlier: a valid, unused invite stays.
  delete from public.invite_codes c where c.label like 'invite: %'
    and coalesce((select max(r.created_at) from public.invite_redemptions r where r.code_hash = c.code_hash), c.expires_at) < now() - interval '12 months';
  get diagnostics people = row_count;
  delete from public.support_requests where answered_at is not null and answered_at < now() - interval '3 years';
  get diagnostics helps = row_count;
  delete from public.abuse_reports where reason <> 'child_safety' and reviewed_at is not null and reviewed_at < now() - interval '3 years';
  get diagnostics reps = row_count;
  -- Funnel events: 13 months after they happened (the account's source row stays while the account does).
  delete from public.funnel_events where at < now() - interval '13 months';
  get diagnostics funnel = row_count;
  -- GEO 11-21 (review M5): a help request nobody answered is removed 12 months after it was sent (answered ones: 3 years, above).
  delete from public.support_requests where answered_at is null and created_at < now() - interval '12 months';
  get diagnostics unanswered = row_count;
  -- GEO 11-21 (review M4): the mail we sent. Invites and approvals ('invite': a person's address, first name, code, app link) go
  -- 12 months after sending, as invite_email.sql's comment promised for the address; Ryan's own alerts, digests and acks go after
  -- 12 months too. Urgent (child-safety) mail is NOT purged here: it is kept as long as the law requires (LEGAL-QUESTIONS T5).
  delete from public.ops_outbox where kind = 'invite' and created_at < now() - interval '12 months';
  get diagnostics out_invites = row_count;
  delete from public.ops_outbox where kind in ('alert', 'digest', 'ack') and created_at < now() - interval '12 months';
  get diagnostics out_ops = row_count;
  -- CONNECT 11-23: the scrambled address and email of a join attempt (public.join_attempts) go after 2 days, as the Privacy page says. join_reserve also cleans them, but only when a join is tried:
  -- with sign-up closed nobody calls it, so they stayed. Failed invite-code guesses (public.invite_attempts, a scrambled address) go after a day, the same way (their own functions clean them only when called).
  delete from public.join_attempts where at < now() - interval '2 days';
  get diagnostics join_tries = row_count;
  delete from public.invite_attempts where at < now() - interval '1 day';
  get diagnostics invite_tries = row_count;
  update public.retention_runs set last_run_on = today;
  return jsonb_build_object('skipped', false, 'applications', apps, 'invite_codes', codes, 'person_invites', people, 'help_requests', helps, 'reports', reps, 'funnel_events', funnel,
                            'help_requests_unanswered', unanswered, 'outbox_invites', out_invites, 'outbox_ops_mail', out_ops,
                            'join_attempts', join_tries, 'invite_attempts', invite_tries);
end $$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

-- ===== A18: migrations/20261123000500_connect_whoami_desktop_app.sql =====
-- THE CONNECTOR TELLS THE AI WHETHER THE ACCOUNT MAY HAVE THE DESKTOP APP (CONNECT, 2026-11-23; CC1's ruling 12:03: a stranger's AI must never be sent to a desktop app only invited testers can get).
-- NOT APPLIED: Ryan applies it, AFTER 20261018000100_connect_ai.sql and 20261026000500_app_downloads.sql. Rollback: supabase/rollbacks/20261123000500_connect_whoami_desktop_app_rollback.sql. Check: supabase/live-steps/61_connect_whoami_desktop_app_check.sql.
-- ONE FUNCTION CHANGES: public.connect_whoami (a copy of 20261018000100's with one added answer, 'desktop_app'). The same rule as request_app_download: true for an invited tester (account_settings.local_compute) or an administrator, never for a worker.
-- Grants and owner are kept (create or replace). The connector's compilation and download tools and the compilation question of suggest_next_step REFUSE for an account whose answer is false, saving nothing; an answer that is absent (this file not applied yet) is treated as allowed, so nothing changes until it is.
begin;
create or replace function public.connect_whoami(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read'); mail text; avail int := 0; held int := 0; desk boolean;
begin
  select email into mail from auth.users where id = me;
  if to_regclass('public.credit_balances') is not null then
    execute 'select coalesce(sum(available), 0)::int, coalesce(sum(held), 0)::int from public.credit_balances where owner_id = $1'
      into avail, held using me;
  end if;
  -- desktop_app: may this account have the Ryagram desktop app? EXACTLY request_app_download's rule (20261026000500): not a worker, and an invited tester (account_settings.local_compute) or an administrator.
  desk := not exists (select 1 from public.workers w where w.user_id = me)
          and (coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or exists (select 1 from public.app_admins a where a.user_id = me));
  return jsonb_build_object('label', coalesce(mail, 'your account'), 'available', avail, 'held', held, 'desktop_app', desk);
end $$;

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

-- ===== A19: migrations/20261123000600_welcome_credits.sql =====
-- WELCOME CREDITS (CONNECT, 2026-11-23; Ryan's 15:46 answer to Q679 B: "8 welcome credits, one per verified email").
-- NOT APPLIED: Ryan applies it, AFTER the credits ledger (phase-2b/credits_ledger.sql, live: Q673 check 1), 20261104000100_waiting_accounts.sql and 20261121000800_join_open.sql. Rollback: supabase/rollbacks/20261123000600_welcome_credits_rollback.sql. Check: supabase/live-steps/63_welcome_credits_check.sql.
--
-- WHAT IT DOES: when a person's email is VERIFIED (auth.users.email_confirmed_at goes from empty to set, or a row is made already confirmed), they get ops_settings.welcome_credits credits (8 unless Ryan changes it; 0 = off) in the credit ledger, ONCE for each email
-- address EVER. An unopened sign-up email gets nothing (nothing is verified); an account verified before this file is applied is not touched (the trigger sees only a change from empty to set).
-- ONCE PER ADDRESS: ryagram_private.welcome_credit_grants keeps only a SCRAMBLED copy of the address (sha256 of 'ryagram-welcome:' + the lower-cased, trimmed address), no user id and no foreign key, so deleting the account does not forget it: a deleted and remade account does not get them again.
-- THE GRANT goes ONLY through public.grant_credits (the ledger's own function: a positive grant into the 'granted' pool; for a WAITING account the existing guard holds it and pays it at activation).
-- NOT GIVEN TO: an invite-code account (an invite_redemptions row for the address, or adult_source 'invite' in its metadata: it keeps its own credits and is not given 8 more), an administrator, a worker.
-- IT NEVER STOPS A SIGN-UP OR A LINK CLICK: the whole body is inside a block that turns any error into a warning (a missing ledger, a failed grant); the once-per-address record rolls back with a failed grant, so nothing is half done.
-- The migration touches no existing function and no existing row. Only the dashboard (the table owner) can change the setting.
begin;

alter table public.ops_settings add column welcome_credits integer not null default 8 check (welcome_credits between 0 and 100);        -- Ryan's lever: credits given at verification; 0 = off

create table ryagram_private.welcome_credit_grants (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz not null default now()
);
revoke all on ryagram_private.welcome_credit_grants from public, anon, authenticated, service_role;

create function ryagram_private.welcome_credits_on_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mail text; eh text; n int;
begin
  begin
    if new.email_confirmed_at is null or btrim(coalesce(new.email, '')) = '' then return new; end if;
    if tg_op = 'UPDATE' and old.email_confirmed_at is not null then return new; end if;                  -- only the moment of verification
    n := coalesce((select o.welcome_credits from public.ops_settings o limit 1), 0);
    if n <= 0 then return new; end if;
    mail := lower(btrim(new.email));
    if exists (select 1 from public.workers w where w.user_id = new.id) or exists (select 1 from public.app_admins a where a.user_id = new.id) then return new; end if;
    if coalesce(new.raw_user_meta_data ->> 'adult_source', '') = 'invite' or exists (select 1 from public.invite_redemptions r where r.email = mail) then return new; end if;     -- an invite-code account keeps its own credits
    eh := encode(sha256(convert_to('ryagram-welcome:' || mail, 'UTF8')), 'hex');
    insert into ryagram_private.welcome_credit_grants (email_hash) values (eh) on conflict (email_hash) do nothing;
    if not found then return new; end if;                                                               -- this address has had its welcome credits already, whichever account it was
    perform public.grant_credits(new.id, 'grant', n, 'Welcome credits (email verified)', 'welcome');
  exception when others then
    raise warning 'welcome credits not granted: %', sqlstate;                                           -- never a failed sign-up or link click
  end;
  return new;
end $$;
revoke execute on function ryagram_private.welcome_credits_on_verified() from public, anon, authenticated, service_role;

create trigger welcome_credits_trg after insert or update of email_confirmed_at on auth.users for each row execute function ryagram_private.welcome_credits_on_verified();

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;

select 'PASS: A1 to A19 applied; now paste 3' as result;
