-- EXPIRED FILMS REALLY GONE: the exact undo of migrations/20261121000200_expired_films_really_gone.sql (GEO's privacy review M2).
-- NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It puts render_orders_tick back to its 20261017000600 body (byte for byte below) and drops mark_deliveries_removed.
-- Drift check, as the other rollbacks: a render_orders_tick that is neither the M2 one nor the original stops it in words and
-- changes nothing (the whole file is one transaction); already undone, it leaves the tick alone (and drops the mark function
-- if it is still there).
-- AFTER IT: the tick marks an expired film deleted at once again, as before M2 (a failed remove is no longer retried).
-- ops-tick needs no change: with no 'due_deliveries' in the tick's answer it never calls mark_deliveries_removed.

begin;

do $do$
declare def text;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.render_orders_tick()');
  if def is null then
    raise exception 'render_orders_tick is not on this database; nothing was changed. Send this sentence to WORKER.';
  end if;
  if position('due_deliveries' in def) = 0 then
    if position('update public.render_deliveries set deleted_at = now() where id = d.id' in def) = 0 then
      raise exception 'The live render_orders_tick is neither the M2 one nor the original; nothing was changed. Send this sentence to WORKER.';
    end if;
    raise notice 'render_orders_tick: nothing to undo (already the original).';
  end if;
end $do$;

create or replace function public.render_orders_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  d record;
  expired int := 0;
  paths jsonb := '[]'::jsonb;
  n_days int;
begin
  select approval_days into n_days from public.ops_settings where id;
  for s in select id from public.render_stages
           where stage = 'final_render' and state = 'awaiting_approval' and awaiting_since < now() - make_interval(days => n_days)
           for update skip locked loop
    perform ryagram_private.final_close(s.id, 'expired', 'approval_expired', null, null);
    expired := expired + 1;
  end loop;
  for d in select r.id, r.order_id, r.artifact_id from public.render_deliveries r
           where r.deleted_at is null and r.expires_at < now() for update skip locked loop
    update public.render_deliveries set deleted_at = now() where id = d.id;
    update public.artifacts set deleted_at = now() where id = d.artifact_id
      returning paths || to_jsonb(storage_path) into paths;
    update public.render_orders set state = 'expired', error_code = 'delivery_expired' where id = d.order_id;
  end loop;
  return jsonb_build_object('approvals_expired', expired, 'delete_objects', paths);
end $$;

drop function if exists public.mark_deliveries_removed(uuid[]);

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (CC1 11-21 G5)
commit;
