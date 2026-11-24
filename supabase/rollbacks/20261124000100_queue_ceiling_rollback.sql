-- WHOLE-QUEUE CEILING: the exact undo of migrations/20261124000100_queue_ceiling.sql. NOT a migration: it lives outside migrations/
-- so nothing applies it by accident. It puts ryagram_private.queue_cap_check and order_cap_check back to the 20261123000200 text
-- (copied here unchanged), drops queue_ceiling_check and the ops_settings.queue_ceiling column (a value Ryan set is lost with it:
-- write it down first). If 20261123000200 was already undone, the two checks are not put back (they no longer exist).
begin;

do $do$
begin
  if to_regprocedure('ryagram_private.queue_cap_check(uuid)') is not null then
    execute $f$
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
end $$;
$f$;
    execute $f$
create or replace function ryagram_private.order_cap_check(p_owner uuid) returns void
language plpgsql set search_path = '' as $$
declare cap int := coalesce((select s.queue_cap_per_owner from public.ops_settings s where s.id), 2);
begin
  perform pg_advisory_xact_lock(hashtextextended('ryagram-queue-cap:' || p_owner::text, 0));
  if (select count(*) from public.render_orders o
       where o.owner_id = p_owner and o.state in ('running', 'awaiting_approval')) >= cap then
    raise exception 'You have % films waiting. You can start another when one is done.', cap using errcode = 'PTQUE';
  end if;
end $$;
$f$;
  end if;
end $do$;

drop function if exists ryagram_private.queue_ceiling_check();
alter table public.ops_settings drop column if exists queue_ceiling;

commit;
