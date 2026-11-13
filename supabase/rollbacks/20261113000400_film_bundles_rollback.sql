-- Ryagram: film bundles: the exact undo of migrations/20261113000400_film_bundles.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It is for the time BEFORE any bundle was built: if a film_bundle job exists it stops in words and changes nothing (a job of that type could not be read or priced without this file's functions). The enum values from
-- 20261113000300 stay (a value cannot be removed; nothing uses it). It removes the request function and the guard trigger, puts the three artifact helpers back to the 2A core's own text, KEEPS both types in the
-- control row's disabled list (they stay switched OFF) and the bucket's mime list is left as it is (a harmless extra type), removes the free price row and the two ledger branches when the ledger is on this database.
-- Files already stored under film_bundle artifacts are not touched here (there are none before a first build).

begin;

do $do$
begin
  if exists (select 1 from public.jobs where job_type = 'film_bundle') then
    raise exception 'A film bundle job exists on this database; this undo is for before the first one. Nothing was changed. Send this sentence to CONNECT.';
  end if;
end $do$;

drop function if exists public.request_film_bundle(uuid, text);
drop trigger if exists jobs_film_bundle_by_request on public.jobs;
drop function if exists ryagram_private.film_bundle_by_request();

create or replace function ryagram_private.artifact_file(k public.artifact_kind, out filename text, out mime text, out max_bytes bigint)
language sql immutable set search_path = '' as $$
  select t.filename, t.mime, t.max_bytes from (values
    ('contact_sheet'::public.artifact_kind, 'sheet.png', 'image/png', 20000000::bigint),
    ('preview', 'preview.mp4', 'video/mp4', 60000000),
    ('final_video', 'film.mp4', 'video/mp4', 500000000),
    ('thumbnail', 'thumb.jpg', 'image/jpeg', 5000000),
    ('receipt', 'receipt.sequence.json', 'application/json', 5000000),
    ('receipt_text', 'receipt.txt', 'text/plain', 5000000),
    ('metering', 'metering.json', 'application/json', 5000000)
  ) as t(kind, filename, mime, max_bytes)
  where t.kind = k
$$;

create or replace function ryagram_private.kind_allowed(t public.job_type, k public.artifact_kind) returns boolean
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then k in ('contact_sheet', 'receipt', 'receipt_text', 'metering')
    when 'preview' then k in ('preview', 'thumbnail', 'receipt', 'receipt_text', 'metering')
    when 'final_render' then k in ('final_video', 'thumbnail', 'receipt', 'receipt_text', 'metering')
  end
$$;

create or replace function ryagram_private.required_kinds(t public.job_type) returns public.artifact_kind[]
language sql immutable set search_path = '' as $$
  select case t
    when 'contact_sheet' then array['contact_sheet']::public.artifact_kind[]
    when 'preview' then array['preview']::public.artifact_kind[]
    when 'final_render' then array['final_video', 'thumbnail', 'receipt']::public.artifact_kind[]
  end
$$;

-- The two enum values stay (a value cannot be removed) and the types stay SWITCHED OFF: after this undo nothing can run them (no request function, no price, no helper rows), so they must never be claimable.
update public.control set disabled_job_types = array(select distinct t from unnest(disabled_job_types || array['film_bundle', 'scene_bundle']::public.job_type[]) t) where id;

do $do$
declare
  def text; neu text;
  a1 constant text := E'  else\n    new.price_code := ryagram_private.film_price_code(new.story);';
  b1 constant text := E'  elsif new.job_type::text = ''film_bundle'' then\n    new.price_code := ''film_bundle'';                     -- film bundles are free (20261113000400)\n' || a1;
  a2 constant text := E'  else code := ryagram_private.film_price_code(v.story_spec);';
  b2 constant text := E'  elsif p_job_type::text = ''film_bundle'' then code := ''film_bundle'';\n' || a2;
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('ryagram_private.jobs_quote()');
  if def is not null then
    def := replace(def, chr(13), '');
    if position(b1 in def) > 0 then execute replace(def, b1, a1); end if;
  end if;
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.credit_quote(uuid,public.job_type)');
  if def is not null then
    def := replace(def, chr(13), '');
    if position(b2 in def) > 0 then execute replace(def, b2, a2); end if;
  end if;
  if to_regclass('public.credit_prices') is not null then delete from public.credit_prices where code = 'film_bundle'; end if;
end $do$;

do $do$
declare
  def text;
  a3 constant text := E'    order by created_at, id\n    for update skip locked\n    limit 1;';
  b3 constant text := E'    order by case when job_type = ''film_bundle'' and not exists (select 1 from public.jobs o where o.state = ''queued'' and o.run_on = ''house'' and o.job_type <> ''film_bundle'' and o.job_type <> all (ctl.disabled_job_types)\n                                                                  and o.created_at < now() - interval ''2 minutes'') then 0 else 1 end, created_at, id\n    for update skip locked\n    limit 1;';
begin
  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.claim_next_job()');
  if def is not null then
    def := replace(def, chr(13), '');
    if position(b3 in def) > 0 then execute replace(def, b3, a3); end if;
  end if;
end $do$;

commit;
