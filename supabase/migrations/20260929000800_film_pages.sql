-- Public film pages (marketing strategy, "Made with Ryagram · View sources"). NOT APPLIED.
--
-- Opt-in per film, off by default: a page exists only after its owner publishes it, and
-- stops at once when they unpublish. Only a complete version's final film can be published.
--
-- What a page shows is a SUMMARY built by the film-page Edge Function from the film's receipt:
-- title, sources, licence, links, method notes, measures, window, engine commit. Never the
-- receipt itself (it holds machine paths and fingerprints), and never uploaded data: a film
-- made from the owner's own upload names only "the maker's own data".
--
-- Visitors never query the database: the film-page function reads public_film() with the
-- service role and hands back short-lived signed links to the video and poster.

begin;

create table public.film_pages (
  version_id uuid primary key references public.versions (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[A-Za-z0-9_-]{22}$'),
  title text not null check (char_length(title) between 1 and 120),
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 65536),
  published boolean not null default true,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index film_pages_owner on public.film_pages (owner_id);

-- The final film of a complete version, and its files (not deleted by retention).
create function ryagram_private.final_film(p_owner uuid, p_version uuid)
returns table (version_id uuid, project_title text, story jsonb, uploaded_data boolean,
               video_path text, thumb_path text, receipt_path text)
language plpgsql stable set search_path = '' as $$
declare
  v public.versions;
  job uuid;
begin
  select * into v from public.versions where id = p_version and owner_id = p_owner;
  if not found then
    raise exception 'Version not found.' using errcode = 'PT404';
  end if;
  if v.state <> 'complete' then
    raise exception 'Only a finished film can have a public page.' using errcode = '42501';
  end if;
  select j.id into job from public.jobs j
    where j.version_id = v.id and j.job_type = 'final_render' and j.state = 'complete'
    order by j.ended_at desc nulls last limit 1;
  return query
    select v.id, p.title, v.story_spec, v.dataset_id is not null,
           (select a.storage_path from public.artifacts a where a.job_id = job and a.kind = 'final_video' and a.deleted_at is null),
           (select a.storage_path from public.artifacts a where a.job_id = job and a.kind = 'thumbnail' and a.deleted_at is null),
           (select a.storage_path from public.artifacts a where a.job_id = job and a.kind = 'receipt' and a.deleted_at is null)
    from public.projects p where p.id = v.project_id;
end $$;

-- For the film-page function, before it reads the receipt.
create function public.film_publish_context(p_owner uuid, p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f record;
begin
  select * into f from ryagram_private.final_film(p_owner, p_version);
  if f.video_path is null or f.receipt_path is null then
    raise exception 'This film''s files are no longer stored, so it can''t be published.' using errcode = '42501';
  end if;
  return jsonb_build_object('project_title', f.project_title, 'story', f.story, 'uploaded_data', f.uploaded_data,
                            'receipt_path', f.receipt_path,
                            'slug', (select slug from public.film_pages where version_id = p_version));
end $$;

-- Publishes (or re-publishes, keeping the same link). Returns the slug.
create function public.film_publish(p_owner uuid, p_version uuid, p_title text, p_summary jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  f record;
  new_slug text := translate(rtrim(encode(uuid_send(gen_random_uuid()), 'base64'), '='), '+/', '-_');
  out_slug text;
begin
  select * into f from ryagram_private.final_film(p_owner, p_version);
  if f.video_path is null then
    raise exception 'This film''s files are no longer stored, so it can''t be published.' using errcode = '42501';
  end if;
  insert into public.film_pages as fp (version_id, owner_id, slug, title, summary)
    values (p_version, p_owner, new_slug, left(btrim(coalesce(nullif(btrim(p_title), ''), f.project_title)), 120), p_summary)
  on conflict (version_id) do update
    set title = excluded.title, summary = excluded.summary, published = true,
        published_at = case when fp.published then fp.published_at else now() end, updated_at = now()
  returning slug into out_slug;
  return out_slug;
end $$;

-- The owner stops sharing, from the app. The link then answers "not found".
create function public.film_unpublish(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.film_pages set published = false, updated_at = now()
    where version_id = p_version and owner_id = (select auth.uid());
  if not found then
    raise exception 'No public page for that film.' using errcode = 'PT404';
  end if;
end $$;

-- What a visitor's page needs, or null. A film whose files were removed shows as gone.
create function public.public_film(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  fp public.film_pages;
  f record;
begin
  if coalesce(p_slug, '') !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;
  select * into fp from public.film_pages where slug = p_slug and published;
  if not found then
    return null;
  end if;
  select * into f from ryagram_private.final_film(fp.owner_id, fp.version_id);
  return jsonb_build_object('title', fp.title, 'summary', fp.summary, 'published_at', fp.published_at,
                            'video_path', f.video_path, 'thumb_path', f.thumb_path);
exception when others then
  return null;                                     -- the version changed state or went away
end $$;

alter table public.film_pages enable row level security;
revoke all on public.film_pages from anon, authenticated, service_role;
grant select (version_id, slug, title, published, published_at) on public.film_pages to authenticated;
create policy "Owners see their film pages" on public.film_pages for select to authenticated
  using (owner_id = (select auth.uid()));

revoke execute on function ryagram_private.final_film(uuid, uuid) from public, anon, authenticated;
revoke execute on function
  public.film_publish_context(uuid, uuid), public.film_publish(uuid, uuid, text, jsonb),
  public.film_unpublish(uuid), public.public_film(text)
  from public, anon, authenticated;
grant execute on function
  public.film_publish_context(uuid, uuid), public.film_publish(uuid, uuid, text, jsonb), public.public_film(text)
  to service_role;
grant execute on function public.film_unpublish(uuid) to authenticated;

commit;
