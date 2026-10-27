-- film_publish gets a backstop (Ryan, 2026-10-13): a film made from the owner's own upload is refused unless p_confirmed is true. The default is FALSE, so an old
-- four-argument caller is safe by construction. NOT APPLIED; needs 20260929000800_film_pages.sql.
begin;

drop function public.film_publish(uuid, uuid, text, jsonb);

-- Publishes (or re-publishes, keeping the same link). Returns the slug. p_confirmed: the owner explicitly confirmed publishing a film made from their own upload.
create function public.film_publish(p_owner uuid, p_version uuid, p_title text, p_summary jsonb, p_confirmed boolean default false) returns text
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
  -- A film made from the owner's own upload (every "Don't keep my data" project included) is never published unless the caller says the owner confirmed it.
  -- The Edge Function checks this first; this is the backstop for any other caller (a script, a second function), which publishes nothing silently.
  if f.uploaded_data and not coalesce(p_confirmed, false) then
    raise exception 'This film was made from data you uploaded. Publishing it needs the owner''s explicit confirmation.' using errcode = 'PT409';
  end if;
  insert into public.film_pages as fp (version_id, owner_id, slug, title, summary)
    values (p_version, p_owner, new_slug, left(btrim(coalesce(nullif(btrim(p_title), ''), f.project_title)), 120), p_summary)
  on conflict (version_id) do update
    set title = excluded.title, summary = excluded.summary, published = true,
        published_at = case when fp.published then fp.published_at else now() end, updated_at = now()
  returning slug into out_slug;
  return out_slug;
end $$;

revoke execute on function public.film_publish(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.film_publish(uuid, uuid, text, jsonb, boolean) to service_role;

commit;
