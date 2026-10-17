-- Engine profiles (ENGINE session, 2026-10-17). NOT APPLIED.
--
-- A profile is a person's own LOOK and FLOW defaults: theme, canvas, palette, pacing. It is plain
-- data, validated by the Edge Function with the engine's rules (supabase/functions/_shared/
-- profile.ts) and never executed. It has no field for data, scale, sources or checks, so a profile
-- cannot change what a film claims.
--
-- Access: a person reads and deletes only their own rows (RLS). They cannot insert or update
-- directly: every write goes through set_engine_profile(), which is the database's backstop and
-- refuses any key the profile schema does not have, at any depth, and any object where a plain
-- value belongs. The Edge Function already validated the values; this keeps a direct API call
-- from storing a field the engine has no business reading.
--
-- KEEP IN SYNC: profile_tree below is the key tree of ryagram/profile/schema.py (the Ryagram
-- repo). tests/engine-profile.test.mjs compares it with the generated profile_data.ts.

begin;

create table public.engine_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$'),
  title text check (char_length(title) <= 80),
  based_on text check (based_on ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) <= 16384),
  spec_sha256 text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);
create unique index engine_profiles_one_default on public.engine_profiles (owner_id) where is_default;

alter table public.engine_profiles enable row level security;
revoke all on public.engine_profiles from anon, authenticated, service_role;
grant select, delete on public.engine_profiles to authenticated;
create policy "Owners read profiles" on public.engine_profiles for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners delete profiles" on public.engine_profiles for delete to authenticated
  using (owner_id = (select auth.uid()));

create function ryagram_private.profile_tree() returns jsonb
language sql immutable set search_path = '' as $$
  select '{
    "profile_version": null, "name": null, "title": null, "based_on": null, "notes": null,
    "look": {
      "theme": null, "canvas": null, "fps": null, "page_background": null, "text_muted": null,
      "ramp": {"low": null, "high": null, "mode": null, "steps": null, "continuous": null},
      "hatch_line_color": null,
      "dots": {"color": null, "baseline_color": null, "radius": null},
      "state": {"fill": null, "no_data_fill": null, "outline_width": null},
      "bars": {"swap_seconds": null, "label_width": null, "value_width": null}
    },
    "pacing": {
      "hold_seconds": null,
      "transition": {"kind": null, "seconds": null},
      "title_card": {"fade": null, "align": null}
    },
    "reserved": {
      "fonts": {"bold": null, "regular": null},
      "motion": {"position_easing": null},
      "brand": {"channel": null, "credit_line": null}
    }
  }'::jsonb
$$;

-- Every key at every depth is in the tree, and a null (plain-value) node holds no object.
create function ryagram_private.profile_keys_ok(v jsonb, tree jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(tree) = 'null' then
    return jsonb_typeof(v) <> 'object';
  end if;
  if jsonb_typeof(v) <> 'object' then
    return false;
  end if;
  for k in select jsonb_object_keys(v) loop
    if not (tree ? k) then return false; end if;
    if not ryagram_private.profile_keys_ok(v -> k, tree -> k) then return false; end if;
  end loop;
  return true;
end $$;

create function public.set_engine_profile(p_spec jsonb, p_make_default boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  nm text := p_spec ->> 'name';
  existing uuid;
  n int;
  out_id uuid;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if jsonb_typeof(p_spec) is distinct from 'object' then
    raise exception 'a profile is a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_spec) > 16384 then
    raise exception 'the profile is larger than 16 KB' using errcode = '22023';
  end if;
  if (p_spec -> 'profile_version') is distinct from '1'::jsonb then
    raise exception 'profile_version must be 1' using errcode = '22023';
  end if;
  if nm is null or nm !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$' then
    raise exception 'the profile needs a name: letters, digits and hyphens, up to 64' using errcode = '22023';
  end if;
  if not ryagram_private.profile_keys_ok(p_spec, ryagram_private.profile_tree()) then
    raise exception 'the profile has a field the engine profile does not allow' using errcode = '22023';
  end if;

  select id into existing from public.engine_profiles where owner_id = me and name = nm;
  if existing is null then
    select count(*) into n from public.engine_profiles where owner_id = me;
    if n >= 20 then
      raise exception 'at most 20 profiles per person' using errcode = '54000';
    end if;
  end if;
  if p_make_default then
    update public.engine_profiles set is_default = false where owner_id = me and is_default;
  end if;

  insert into public.engine_profiles (owner_id, name, title, based_on, spec, spec_sha256, is_default)
  values (me, nm, p_spec ->> 'title', p_spec ->> 'based_on', p_spec,
          encode(sha256(convert_to(p_spec::text, 'utf8')), 'hex'),
          coalesce(p_make_default, false))
  on conflict (owner_id, name) do update
    set title = excluded.title, based_on = excluded.based_on, spec = excluded.spec,
        spec_sha256 = excluded.spec_sha256, updated_at = now(),
        is_default = case when p_make_default then true else public.engine_profiles.is_default end
  returning id into out_id;
  return out_id;
end $$;

revoke all on function public.set_engine_profile(jsonb, boolean) from public, anon;
grant execute on function public.set_engine_profile(jsonb, boolean) to authenticated;
revoke all on function ryagram_private.profile_tree() from public, anon, authenticated;
revoke all on function ryagram_private.profile_keys_ok(jsonb, jsonb) from public, anon, authenticated;

commit;
