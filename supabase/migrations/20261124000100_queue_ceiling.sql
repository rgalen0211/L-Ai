-- WHOLE-QUEUE CEILING (BUILDER 11-24; CONNECT 11-24 09:31 item B, Ryan's Tuesday order: Wednesday is FULLY PUBLIC, no first-wave cap).
-- The render PC makes one film at a time. 20261123000200 limits each PERSON to queue_cap_per_owner waiting films (default 2), but
-- nothing limits the WHOLE line: N strangers can put 2N sheets and previews ahead of one machine, and every wait sentence grows
-- with N. This adds ONE optional number, ops_settings.queue_ceiling. EMPTY (null, the default) = OFF: nothing changes at all
-- unless Ryan sets it (one dashboard line). When it is set and that many house jobs (contact sheets, previews and full films) are
-- already QUEUED, a person's own NEW contact sheet or preview, and a NEW order, are refused with plain words and the same errcode
-- as the per-person cap (PTQUE: the connector already tells an AI 'queue_full' and not to retry):
--   'The render queue is full right now. Please try again in a while.'
-- WHAT IS NEVER REFUSED: an order that is already open moving to its next stage inside the worker's report call (the p_stage_id
-- guard of 20261123000200 is unchanged), a repeat of an existing order key, Ryan's approval of a full film, a retry put back in line,
-- and a job for a tester's own PC (run_on 'owner_local' is not counted). A claimed or running job does not count.
-- HOW: the two check functions of 20261123000200 (ryagram_private.queue_cap_check and order_cap_check, BUILDER's own, called by the
-- two wrappers there) are replaced with the same body plus the ceiling, AFTER the per-person check (its sentence is the more useful
-- one). No pipe1 function and no wrapper is touched. The ceiling count takes one global lock after the per-owner lock (always in
-- that order, so no two submits can deadlock), and only when the ceiling is set, so the OFF state costs nothing.
-- A guard refuses to run if either check is not the 20261123000200 text this file expects (someone changed it by hand).
-- THE NUMBER: e.g. what the PC makes in a few hours (ENGINE-QUEUE-WAIT-NUMBERS-1124: a sheet 3 to 5 min, a preview 4 to 6 min).
-- Undo: rollbacks/20261124000100_queue_ceiling_rollback.sql (puts both checks back exactly and drops the column).
begin;

do $$
begin
  if md5(replace((select prosrc from pg_proc where oid = to_regprocedure('ryagram_private.queue_cap_check(uuid)')), chr(13), '')) is distinct from '0d9f24854a620becac8e70f7bdb7627a'
     or md5(replace((select prosrc from pg_proc where oid = to_regprocedure('ryagram_private.order_cap_check(uuid)')), chr(13), '')) is distinct from '518b349c83b54d19d2648d10dea64782' then
    raise exception 'ryagram_private.queue_cap_check or order_cap_check is not the one this change expects (20261123000200). Nothing was changed.';
  end if;
end $$;

alter table public.ops_settings add column queue_ceiling int
  check (queue_ceiling is null or queue_ceiling between 1 and 100000);

create or replace function ryagram_private.queue_ceiling_check() returns void
language plpgsql set search_path = '' as $$
declare ceiling int := (select s.queue_ceiling from public.ops_settings s where s.id);
begin
  if ceiling is null then
    return;                                                                                        -- OFF (the default)
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ryagram-queue-ceiling', 0));                     -- after the per-owner lock, always
  if (select count(*) from public.jobs j
       where j.state = 'queued' and j.run_on = 'house'
         and j.job_type in ('contact_sheet', 'preview', 'final_render')) >= ceiling then
    raise exception 'The render queue is full right now. Please try again in a while.' using errcode = 'PTQUE';
  end if;
end $$;

create or replace function ryagram_private.queue_cap_check(p_owner uuid) returns void
language plpgsql set search_path = '' as $$
declare cap int := coalesce((select s.queue_cap_per_owner from public.ops_settings s where s.id), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-queue-cap:' || p_owner::text, 0));
  if (select count(*) from public.jobs j
       where j.owner_id = p_owner and j.state = 'queued' and j.run_on = 'house'
         and j.job_type in ('contact_sheet', 'preview', 'final_render')) >= cap then
    raise exception 'You have % films waiting. You can start another when one is done.', cap using errcode = 'PTQUE';
  end if;
  perform ryagram_private.queue_ceiling_check();                                                   -- WHOLE-QUEUE CEILING (20261124000100)
end $$;

create or replace function ryagram_private.order_cap_check(p_owner uuid) returns void
language plpgsql set search_path = '' as $$
declare cap int := coalesce((select s.queue_cap_per_owner from public.ops_settings s where s.id), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-queue-cap:' || p_owner::text, 0));
  if (select count(*) from public.render_orders o
       where o.owner_id = p_owner and o.state in ('running', 'awaiting_approval')) >= cap then
    raise exception 'You have % films waiting. You can start another when one is done.', cap using errcode = 'PTQUE';
  end if;
  perform ryagram_private.queue_ceiling_check();                                                   -- a NEW order queues its free sheet at once
end $$;

revoke execute on function ryagram_private.queue_ceiling_check() from public, anon, authenticated, service_role;

select ryagram_private.gate_apply();                       -- every migration after the waiting-accounts file ends with it (tests/waiting-gate.test.mjs)

commit;
