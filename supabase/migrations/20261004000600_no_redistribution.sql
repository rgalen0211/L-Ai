-- "No redistribution": licence-restricted data is never offered for download. NOT APPLIED.
-- Needs 20261004000100_version_sources.sql and 20261004000200_uploads_schema.sql (this replaces sync_version_sources
-- again, with the flag carried onto a film's source rows). Rerun the regenerated catalog_sources_seed.sql after it.
--
--   catalog_sources.no_redistribution   true when the data's licence does not let Ryagram pass the DATA ITSELF on (for
--                                       example NHGIS/IPUMS tables). A film made from it is fine: the film is a
--                                       transformation, drawn and credited. What is refused is handing the underlying
--                                       numbers to anyone: a "download this data" link, an export, a data file in a bundle.
--   version_sources.no_redistribution   the same fact on a film's source card, so the screen can say so.
--   dataset_download_allowed(ref)       the ONE question any download or export feature must ask first. FAIL CLOSED:
--                                       false for a flagged dataset, for an id the catalog does not know, for null, and
--                                       for an uploaded dataset (u_...: that is the person's own file, handled by its
--                                       own owner-only path, never through the catalog).
--
-- The flag is derived by tools/gen-catalog.py from the engine's own licence text and an explicit list, never typed by hand
-- in the database.

begin;

alter table public.catalog_sources add column no_redistribution boolean not null default false;
alter table public.version_sources add column no_redistribution boolean not null default false;

create or replace function public.sync_version_sources(p_version uuid)
returns setof public.version_sources
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  wanted text[];
  ref text;
  c public.catalog_sources;
  d public.datasets;
  pos int := 0;
begin
  select * into v from public.versions where id = p_version and owner_id = me;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;

  if v.state in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
    select coalesce(array_agg(d2 order by first_pos), '{}') into wanted from (
      select d2, min(ord) as first_pos from (
        select (clip->>'dataset') as d2, ord
        from jsonb_array_elements(case when jsonb_typeof(v.story_spec #> '{sequence,clips}') = 'array'
                                       then v.story_spec #> '{sequence,clips}' else '[]'::jsonb end)
             with ordinality as t(clip, ord)
        where clip->>'kind' = 'render' and clip->>'dataset' is not null
      ) x group by d2) y;

    if coalesce(array_length(wanted, 1), 0) > 5 then
      raise exception 'A film can use up to 5 sources.' using errcode = '22023';
    end if;
    foreach ref in array wanted loop
      if ref ~ '^u_[0-9a-f]{24}$' then
        select * into d from public.datasets
          where owner_id = me and source = 'upload' and status = 'approved' and deleted_at is null and delete_requested_at is null
            and substr(replace(id::text, '-', ''), 1, 24) = substr(ref, 3);
        if not found then
          raise exception 'That uploaded data isn''t ready, or isn''t yours.' using errcode = '22023';
        end if;
      else
        select * into c from public.catalog_sources where id = ref;
        if not found then
          raise exception 'We don''t have data called "%".', left(ref, 60) using errcode = '22023';
        end if;
        if not c.runnable then
          raise exception 'We have "%", but can''t run it yet.', c.title using errcode = '22023';
        end if;
      end if;
    end loop;

    delete from public.version_sources
      where version_id = v.id and kind = 'catalog' and dataset_ref <> all (wanted);
    foreach ref in array wanted loop
      pos := pos + 1;
      if ref ~ '^u_[0-9a-f]{24}$' then
        update public.version_sources set position = pos where version_id = v.id and dataset_ref = ref;
      else
        select * into c from public.catalog_sources where id = ref;
        insert into public.version_sources (owner_id, version_id, kind, dataset_ref, title, publisher, source_url,
                                            coverage, licence_short, licence_full, no_redistribution, position)
          values (me, v.id, 'catalog', ref, c.title, c.publisher, c.source_url, c.coverage, c.licence_short,
                  c.licence_full, c.no_redistribution, pos)
          on conflict (version_id, dataset_ref) do update
            set title = excluded.title, publisher = excluded.publisher, source_url = excluded.source_url,
                coverage = excluded.coverage, licence_short = excluded.licence_short,
                licence_full = excluded.licence_full, no_redistribution = excluded.no_redistribution,
                position = excluded.position;
      end if;
    end loop;
  end if;

  return query select * from public.version_sources s where s.version_id = v.id order by s.position, s.created_at;
end $$;

create function public.dataset_download_allowed(p_ref text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select not c.no_redistribution from public.catalog_sources c where c.id = p_ref), false)
$$;

revoke execute on function public.dataset_download_allowed(text) from public, anon;
grant execute on function public.dataset_download_allowed(text) to authenticated, service_role;

commit;
