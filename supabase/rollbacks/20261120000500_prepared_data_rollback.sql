-- AI-PREPARED DATA: the exact undo of migrations/20261120000500_prepared_data.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- It drops the six functions and the helper and purge functions, the staging table (every staged table goes with it: they are inert text waiting for a person, nothing else points at them except datasets.prepared_from, dropped below),
-- takes the two columns off public.datasets (the preparation log of any dataset already accepted from a staged table goes with prep_log: the dataset and its rows are untouched), and puts the offered scopes back to the five
-- that existed (read, write, render_free, edit, fetch_data). A connection that already holds submit_data keeps the word in its grant but no tool uses it. Already undone, it changes nothing (the whole file is one transaction).

begin;

drop function if exists public.connect_submit_prepared_data(text, text, text, jsonb, jsonb, jsonb, text);
drop function if exists public.connect_list_my_data(text);
drop function if exists public.my_prepared_data();
drop function if exists public.my_prepared_data_csv(uuid);
drop function if exists public.discard_prepared_data(uuid);
drop function if exists public.mark_prepared_accepted(uuid, uuid);
drop function if exists ryagram_private.prepared_purge();
drop function if exists ryagram_private.prepared_sources_ok(jsonb);
drop function if exists ryagram_private.prepared_log_ok(jsonb);
drop function if exists ryagram_private.prepared_measured_ok(jsonb);
drop table if exists public.prepared_data;
alter table public.datasets drop column if exists prep_log, drop column if exists prepared_from;

create or replace function ryagram_private.connect_offered_scopes() returns text[]
language sql stable set search_path = '' as $$ select array['read', 'write', 'render_free', 'edit', 'fetch_data']::text[] $$;

commit;
