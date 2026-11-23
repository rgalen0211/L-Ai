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
-- between a read and the insert cannot slip through. The order path: pipe1's ryagram_private.order_submit is renamed, body
-- untouched, to order_submit_base, and a small wrapper checks a NEW order's story first.
-- The list is a table, so a pair ENGINE clears later is one delete (and its line comes off the JSON; the test keeps them equal).
-- Undo: rollbacks/20261123000300_blocked_story_views_rollback.sql (puts back 20261123000200's submit_job_for wrapper and pipe1's
-- order_submit, drops the table).
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
    raise exception 'This film is not available yet. Please pick another view.' using errcode = 'PTVEW';
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

-- The order path: pipe1's function, untouched, renamed; the wrapper refuses a NEW order whose story uses a blocked pair (a repeat
-- of an existing order key goes straight through, as before).
alter function ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source)
  rename to order_submit_base;

create function ryagram_private.order_submit(p_owner uuid, p_story jsonb, p_key text, p_want public.order_want,
                                             p_title text, p_source public.order_source)
returns public.render_orders
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is not null
     and not exists (select 1 from public.render_orders o where o.owner_id = p_owner and o.idempotency_key = p_key) then
    perform ryagram_private.blocked_view_check(p_story);                                         -- a NEW order only (BLOCKED VIEWS)
  end if;
  return ryagram_private.order_submit_base(p_owner, p_story, p_key, p_want, p_title, p_source);
end $$;

revoke execute on function
  ryagram_private.blocked_view_in(jsonb),
  ryagram_private.blocked_view_check(jsonb),
  ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source)
  from public, anon, authenticated, service_role;

select ryagram_private.gate_apply();                       -- every migration after the waiting-accounts file ends with it (tests/waiting-gate.test.mjs)

commit;
