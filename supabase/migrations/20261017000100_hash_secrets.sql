-- Address hashes with a secret (CC1, 2026-10-16: "one-way" was not true while the hash had no secret: anyone holding the table could try all 2^32
-- IPv4 addresses for a day). Both the creator-beta caller key and the abuse reporter key are now an HMAC-SHA256 under a secret the rows never hold:
--   * creator_applications.caller_key: made in the creator-beta Edge Function with the secret CALLER_HASH_SECRET (falls back to the project's own
--     SUPABASE_SERVICE_ROLE_KEY; with neither the function refuses the application, it never falls back to an unsalted hash). No SQL change.
--   * abuse_reports.reporter_key: made here, in report_film_page, with a random secret generated once in ryagram_private.hash_secret (a closed
--     table: no role but the definer functions can read it). HMAC is written out in SQL (RFC 2104) on the built-in sha256(), so no extension is needed.
-- Old md5 keys already stored stop matching (they were only a rate-limit memory, an hour long).
-- The reporter's lowercased email is still the key when no address arrives: that is the email already stored with the report.

create table ryagram_private.hash_secret (
  only_row boolean primary key default true check (only_row),
  secret bytea not null check (octet_length(secret) >= 32)
);
revoke all on table ryagram_private.hash_secret from public, anon, authenticated, service_role;
insert into ryagram_private.hash_secret (secret) values (uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())) on conflict do nothing;

create function ryagram_private.hash_secret() returns bytea
language plpgsql stable security definer set search_path = '' as $$
declare s bytea;
begin
  select secret into s from ryagram_private.hash_secret;
  if s is null then
    raise exception 'The address-hash secret is missing.' using errcode = 'P0001';          -- never an unsalted or silently different key
  end if;
  return s;
end $$;
revoke all on function ryagram_private.hash_secret() from public, anon, authenticated, service_role;

create function ryagram_private.hmac_sha256(p_key bytea, p_msg bytea) returns bytea
language plpgsql immutable set search_path = '' as $$
declare k bytea := p_key; ipad bytea := ''::bytea; opad bytea := ''::bytea; i int;
begin
  if octet_length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - octet_length(k)), 'hex');
  for i in 0..63 loop
    ipad := ipad || set_byte(decode('00', 'hex'), 0, get_byte(k, i) # 54);                 -- 0x36
    opad := opad || set_byte(decode('00', 'hex'), 0, get_byte(k, i) # 92);                 -- 0x5c
  end loop;
  return sha256(opad || sha256(ipad || p_msg));
end $$;
revoke all on function ryagram_private.hmac_sha256(bytea, bytea) from public, anon, authenticated, service_role;

create or replace function public.report_film_page(p_slug text, p_reason text, p_email text, p_details text default '', p_website text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare fp public.film_pages; hold boolean; held_today int; id bigint; s public.ops_settings; rk text; ip text; hdr json; prior int; keep boolean;
begin
  if coalesce(p_website, '') <> '' then
    return;                                                                       -- honeypot
  end if;
  -- LOW-2 (CC1): one report at a time, so the per-reporter, hourly and hide-cap counts below cannot be raced past by concurrent reports.
  perform pg_advisory_xact_lock(hashtext('report_film_page'));
  select * into s from public.ops_settings;
  select * into fp from public.film_pages where slug = p_slug;
  if not found then
    return;                                                                       -- same silence for a slug that does not exist
  end if;
  -- The reporter is the caller's address when the request carries one (rotating daily, hashed), else the typed email. A new email
  -- per report therefore does not reset the limits, and a GLOBAL cap stops a flood from any number of addresses.
  -- Header choice: cf-connecting-ip is set by Cloudflare in front of the API and overwrites anything the client sent. Without it, the
  -- LAST hop of x-forwarded-for (the one our own proxy appended), never the first, which the client writes. Verify once on the real
  -- project which of the two arrives (supabase/README.md, "Hands-off operations", go-live step 10).
  begin
    hdr := current_setting('request.headers', true)::json;
    ip := nullif(trim(coalesce(hdr->>'cf-connecting-ip',
                               (string_to_array(coalesce(hdr->>'x-forwarded-for', ''), ','))[array_length(string_to_array(coalesce(hdr->>'x-forwarded-for', ''), ','), 1)])), '');
  exception when others then
    ip := null;
  end;
  rk := coalesce(encode(ryagram_private.hmac_sha256(ryagram_private.hash_secret(), convert_to('report|' || ip || '|' || to_char(now() at time zone 'EST5EDT', 'YYYY-MM-DD'), 'UTF8')), 'hex'),
                 lower(trim(p_email)));
  -- CHILD SAFETY (Ryan, 2026-10-12): such a report is ALWAYS RECORDED (no caller or global cap can refuse it), Ryan is alerted AT ONCE (an URGENT
  -- alert that bypasses the daily mail allowance), and the page is hidden pending his review, but at most ops_settings.child_safety_holds_per_hour
  -- (10) pages an hour site-wide. Above that the report is still recorded and still alerts, as queued, with the words "NOT hidden".
  -- Every other reason: per caller 5 an hour, 30 an hour in all (a refusal), a few auto-hides a day per caller, 10 auto-hides an hour in all.
  if p_reason <> 'child_safety'
     and ((select count(*) from public.abuse_reports where reporter_key = rk and created_at > now() - interval '1 hour') >= 5
          or (select count(*) from public.abuse_reports where created_at > now() - interval '1 hour') >= 30) then
    raise exception 'Too many reports. Please try again later.' using errcode = 'P0001';
  end if;
  -- A page Ryan has restored is never auto-held again (he decided; the report only queues), and a removed page is already held.
  hold := p_reason in ('child_safety', 'private_information', 'harassment', 'copyright') and fp.held_at is null
          and fp.restored_at is null and fp.removed_at is null and fp.owner_id is distinct from auth.uid();
  if hold and p_reason = 'child_safety' then
    hold := (select count(*) from public.abuse_reports where reason = 'child_safety' and auto_held and created_at > now() - interval '1 hour')
            < s.child_safety_holds_per_hour;
  elsif hold then
    -- LOW-1 (CC1): child-safety holds have their own cap (above) and never use up the ordinary per-reporter or hourly allowance.
    select count(*) into held_today from public.abuse_reports where reporter_key = rk and auto_held and reason <> 'child_safety' and created_at > now() - interval '1 day';
    hold := held_today < s.abuse_hide_per_reporter_day                            -- griefing guard: a few auto-hides a day per reporter
            and (select count(*) from public.abuse_reports where auto_held and reason <> 'child_safety' and created_at > now() - interval '1 hour') < 10;   -- and 10 an hour in all
  end if;
  -- Ryan (2026-10-14): FULL details for this reporter's first 5 reports in an hour; after that each report is still recorded, as a SHORT record
  -- (time, reporter, target, reason: no free text). A child-safety report is never refused for it (the caps above do not apply to it).
  select count(*) into prior from public.abuse_reports where reporter_key = rk and created_at > now() - interval '1 hour';
  keep := prior < s.report_detail_per_reporter_hour;
  insert into public.abuse_reports (slug, reason, details, details_omitted, reporter_email, reporter_key, version_id, auto_held)
    values (p_slug, p_reason, case when keep then coalesce(p_details, '') else '' end, not keep, trim(p_email), rk, fp.version_id, hold) returning abuse_reports.id into id;
  if hold then
    update public.film_pages set held_at = now(), published = false where slug = p_slug;
  end if;
  if p_reason = 'child_safety' then
    perform ryagram_private.ops_raise('urgent:child_safety:' || id,
      'URGENT: child-safety report #' || id || ' on a public film page. ' ||
      case when hold then 'The page is HIDDEN pending your review.'
           when fp.held_at is not null then 'The page was already hidden.'
           when fp.removed_at is not null or fp.restored_at is not null then 'The page was already reviewed by you and is NOT hidden.'
           else 'The hourly cap on automatic hiding (' || s.child_safety_holds_per_hour || ') is reached: the page is NOT hidden. Review it now.' end);
  else
    perform ryagram_private.ops_raise('abuse:' || id, 'Abuse report #' || id || ' (' || p_reason || ')' || case when hold then ' - page held' else '' end);
  end if;
end $$;
