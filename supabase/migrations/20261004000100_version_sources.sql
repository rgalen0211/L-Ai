-- The sources screen, first version: what a film is made from, shown with its source, coverage and
-- licence. NOT APPLIED. See Ryagram-logs/proposals/WEB-PROMPT-FIRST-SOURCING.md, sections 4 and 8.
--
--   catalog_sources  the internal list of datasets and their facts (publisher, coverage, short and full
--                    licence, whether the worker can run it today). Filled by
--                    supabase/catalog_sources_seed.sql (generated). No role can read it directly: the
--                    sources screen gets facts only through sync_version_sources(), so a card's facts
--                    never come from the browser.
--   version_sources  one row per source of a VERSION (a version is a frozen story, so its sources are
--                    frozen with it). Owners read their own; nobody writes except the function below.
--
-- sync_version_sources(version): on an editable version, makes the version's sources match the
-- datasets its story's render clips name (at most 5; each must be known and runnable); on a locked
-- version it only returns what is already recorded. Uploads and ticked suggestions (later) will add
-- rows of kind 'upload' / 'catalog' through their own functions; sync never removes an upload.

begin;

create table public.catalog_sources (
  id text primary key check (id ~ '^[a-z0-9_]{1,64}$'),
  title text not null check (char_length(title) between 1 and 300),
  publisher text not null default '' check (char_length(publisher) <= 300),
  source_url text not null default '' check (source_url = '' or source_url ~ '^https://'),
  coverage text not null default '' check (char_length(coverage) <= 300),
  licence_short text not null default '' check (char_length(licence_short) <= 200),
  licence_full text not null default '' check (char_length(licence_full) <= 2000),
  runnable boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.catalog_sources enable row level security;
revoke all on public.catalog_sources from anon, authenticated, service_role;

create table public.version_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version_id uuid not null references public.versions (id) on delete cascade,
  kind text not null check (kind in ('catalog', 'upload')),
  dataset_ref text not null check (char_length(dataset_ref) between 1 and 80),
  title text not null,
  publisher text not null default '',
  source_url text not null default '',
  coverage text not null default '',
  licence_short text not null default '',
  licence_full text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (version_id, dataset_ref)
);
create index version_sources_version on public.version_sources (version_id, position);
alter table public.version_sources enable row level security;
revoke all on public.version_sources from anon, authenticated, service_role;
grant select on public.version_sources to authenticated;
create policy "Owners read their sources" on public.version_sources for select to authenticated
  using (owner_id = (select auth.uid()));

create function public.sync_version_sources(p_version uuid)
returns setof public.version_sources
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := ryagram_private.require_signed_in();
  v public.versions;
  wanted text[];
  ref text;
  c public.catalog_sources;
  pos int := 0;
begin
  select * into v from public.versions where id = p_version and owner_id = me;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;

  if v.state in ('draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render') then
    -- The datasets the story's render clips name, in order of first appearance.
    select coalesce(array_agg(d order by first_pos), '{}') into wanted from (
      select d, min(ord) as first_pos from (
        select (clip->>'dataset') as d, ord
        from jsonb_array_elements(case when jsonb_typeof(v.story_spec #> '{sequence,clips}') = 'array'
                                       then v.story_spec #> '{sequence,clips}' else '[]'::jsonb end)
             with ordinality as t(clip, ord)
        where clip->>'kind' = 'render' and clip->>'dataset' is not null
      ) x group by d) y;

    if coalesce(array_length(wanted, 1), 0) > 5 then
      raise exception 'A film can use up to 5 sources.' using errcode = '22023';
    end if;
    foreach ref in array wanted loop
      select * into c from public.catalog_sources where id = ref;
      if not found then
        raise exception 'We don''t have data called "%".', left(ref, 60) using errcode = '22023';
      end if;
      if not c.runnable then
        raise exception 'We have "%", but can''t run it yet.', c.title using errcode = '22023';
      end if;
    end loop;

    delete from public.version_sources
      where version_id = v.id and kind = 'catalog' and dataset_ref <> all (wanted);
    foreach ref in array wanted loop
      pos := pos + 1;
      select * into c from public.catalog_sources where id = ref;
      insert into public.version_sources (owner_id, version_id, kind, dataset_ref, title, publisher, source_url,
                                          coverage, licence_short, licence_full, position)
        values (me, v.id, 'catalog', ref, c.title, c.publisher, c.source_url, c.coverage, c.licence_short,
                c.licence_full, pos)
        on conflict (version_id, dataset_ref) do update
          set title = excluded.title, publisher = excluded.publisher, source_url = excluded.source_url,
              coverage = excluded.coverage, licence_short = excluded.licence_short,
              licence_full = excluded.licence_full, position = excluded.position;
    end loop;
  end if;

  return query select * from public.version_sources s where s.version_id = v.id order by s.position, s.created_at;
end $$;

revoke execute on function public.sync_version_sources(uuid) from public, anon;
grant execute on function public.sync_version_sources(uuid) to authenticated;

commit;
