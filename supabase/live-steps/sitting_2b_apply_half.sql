-- SITTING PASTE 2b (FALLBACK, only if paste 2 was refused as too long, BEFORE it ran): A11 to A19, byte for byte (GEO sitting_build.py; generated).
-- THIS CHANGES THE LIVE DATABASE. Run it ONCE. ANY error: STOP, do NOT run it again; run paste 3 and send GEO both.

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

select 'PASS: A11 to A19 applied; now paste 3' as result;
