-- "Invite someone" (CC1 13:33, Ryan's ask): Ryan invites a friend straight from #/admin/ops before the public creator form is live: name -> a single-use code,
-- shown ONCE, that carries the welcome credits (granted by invite_sent when the person signs up, exactly as for a creator application).
-- The email address is NOT sent to the database: the panel only needs it to open Ryan's mail program with the code (a mailto: link), so nothing about the
-- address is stored until the person redeems (the redemption row then holds it, as for every invite).
--   * label 'invite: <name>' (the code row holds the name), 30 days valid, one use;
--   * retention: such a code is deleted 12 months after its last redemption, or 12 months after it expired if never used (retention_purge below; the Privacy
--     draft says so).
-- Apply AFTER 20261016000200_creator_flow.sql and 20261016000300_retention_purge.sql.

create function public.admin_invite_person(p_name text, p_credits int default null) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.creator_flow_settings; c int; n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); code text;
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can invite people.' using errcode = '42501';
  end if;
  if char_length(n) < 1 or char_length(n) > 100 then raise exception 'Give the person''s name (up to 100 characters).' using errcode = 'P0001'; end if;
  select * into s from public.creator_flow_settings;
  c := coalesce(p_credits, s.invite_credits);
  if c < 0 or c > 1000 then raise exception 'Welcome credits must be 0 to 1,000.' using errcode = 'P0001'; end if;
  code := public.invite_issue('invite: ' || n, 1, 30);
  update public.invite_codes set grant_credits = c where code_hash = ryagram_private.invite_hash(code);
  return code;
end $$;
revoke execute on function public.admin_invite_person(text, int) from public, anon;
grant execute on function public.admin_invite_person(text, int) to authenticated;

create or replace function public.retention_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'EST5EDT')::date; apps int := 0; codes int := 0; people int := 0; helps int := 0; reps int := 0; ids bigint[];
begin
  perform pg_advisory_xact_lock(hashtext('retention_purge'));
  if (select last_run_on from public.retention_runs) = today then
    return jsonb_build_object('skipped', true);
  end if;
  select coalesce(array_agg(id), '{}') into ids from public.creator_applications where decided_at is not null and decided_at < now() - interval '12 months';
  if cardinality(ids) > 0 then
    delete from public.invite_codes where exists (select 1 from unnest(ids) i where invite_codes.label like 'creator #' || i || ' %');   -- redemptions go with them (on delete cascade)
    get diagnostics codes = row_count;
    delete from public.creator_applications where id = any (ids);
    get diagnostics apps = row_count;
    delete from public.ops_alerts where key in (select 'creator:' || i from unnest(ids) i);
  end if;
  -- Invites Ryan made for a person directly (label 'invite: <name>', admin_invite_person): the code row holds the name and its redemption holds the email.
  -- Removed 12 months after the code was last redeemed, or, if nobody used it, 12 months after it expired. Never earlier: a valid, unused invite stays.
  delete from public.invite_codes c where c.label like 'invite: %'
    and coalesce((select max(r.created_at) from public.invite_redemptions r where r.code_hash = c.code_hash), c.expires_at) < now() - interval '12 months';
  get diagnostics people = row_count;
  delete from public.support_requests where answered_at is not null and answered_at < now() - interval '3 years';
  get diagnostics helps = row_count;
  delete from public.abuse_reports where reason <> 'child_safety' and reviewed_at is not null and reviewed_at < now() - interval '3 years';
  get diagnostics reps = row_count;
  update public.retention_runs set last_run_on = today;
  return jsonb_build_object('skipped', false, 'applications', apps, 'invite_codes', codes, 'person_invites', people, 'help_requests', helps, 'reports', reps);
end $$;

revoke execute on function public.retention_purge() from public, anon, authenticated;
grant execute on function public.retention_purge() to service_role;
