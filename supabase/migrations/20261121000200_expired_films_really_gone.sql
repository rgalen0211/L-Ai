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
