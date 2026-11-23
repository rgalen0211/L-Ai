-- BLOCKED STORY VIEWS: the exact undo of migrations/20261123000300_blocked_story_views.sql. NOT a migration: it lives outside
-- migrations/ so nothing applies it by accident. Run it BEFORE 20261123000200_queue_cap_per_owner_rollback.sql if both are undone.
-- It puts ryagram_private.submit_job_for back exactly as 20261123000200 left it (the queue cap stays), puts 20261123000200's
-- order_submit wrapper back (the open-orders limit stays), and drops the blocked-view check, its helper and its table (the list itself stays in
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

create or replace function ryagram_private.order_submit(p_owner uuid, p_story jsonb, p_key text, p_want public.order_want,
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

drop function ryagram_private.blocked_view_check(jsonb);
drop function ryagram_private.blocked_view_in(jsonb);
drop table ryagram_private.blocked_story_views;

commit;
