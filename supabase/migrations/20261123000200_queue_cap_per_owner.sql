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
