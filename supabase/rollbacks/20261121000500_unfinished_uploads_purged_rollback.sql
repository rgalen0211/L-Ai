-- THE EXACT UNDO OF migrations/20261121000500_unfinished_uploads_purged.sql (GEO 2026-11-21; CC1 12:36 G1). NOT APPLIED, and NOT a migration: it lives outside
-- migrations/ so nothing applies it by itself. Every function body below is COPIED by script from the file named beside it.
-- ORDER: no order.
-- Nothing is restored: uploads the sweep already removed are gone. Grants are kept (create or replace keeps them; a dropped function takes its own).
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
         or (d.status = 'rejected' and d.last_activity_at < now() - interval '1 day'))
  order by d.last_activity_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

select ryagram_private.gate_apply();                       -- like every migration after the waiting list
commit;
