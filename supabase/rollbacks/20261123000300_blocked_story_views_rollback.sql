-- BLOCKED STORY VIEWS: the exact undo of migrations/20261123000300_blocked_story_views.sql. NOT a migration: it lives outside
-- migrations/ so nothing applies it by accident. Run it BEFORE 20261123000200_queue_cap_per_owner_rollback.sql if both are undone.
-- It puts ryagram_private.submit_job_for back exactly as 20261123000200 left it (the queue cap stays), puts pipe1's order_submit
-- back under its own name (drops the wrapper), and drops the blocked-view check, its helper and its table (the list itself stays in
-- tools/data/engine-catalog-block-list-1123.json).
begin;

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
begin
  if p_stage_id is null and p_job_type in ('contact_sheet', 'preview') then                     -- a person's own new sheet or preview
    perform ryagram_private.queue_cap_check(p_owner);                                            -- QUEUE CAP (20261123000200)
  end if;
  return ryagram_private.submit_job_for_base(p_owner, p_version_id, p_job_type, p_params, p_sheet_job_id, p_preview_job_id,
                                             p_state, p_stage_id);
end $$;

drop function ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source);
alter function ryagram_private.order_submit_base(uuid, jsonb, text, public.order_want, text, public.order_source)
  rename to order_submit;

drop function ryagram_private.blocked_view_check(jsonb);
drop function ryagram_private.blocked_view_in(jsonb);
drop table ryagram_private.blocked_story_views;

commit;
