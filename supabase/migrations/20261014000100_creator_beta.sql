-- Creator beta applications (Ryan, 2026-10-14). YouTubers, podcasters, newsletter writers, journalists, teachers and researchers apply on
-- /ryagram/#creators; Ryan approves or declines each one on #/admin/ops. Apply AFTER 20261010000100_ops_readiness.sql (it uses its alert ledger
-- and is_app_admin). Review only; nothing here is applied by the web session.
--
-- Who can touch what:
--   * the table is closed to every role (RLS on, no policy, every grant revoked, service_role included), like support_requests;
--   * creator_beta_apply is for the service role ONLY: the creator-beta Edge Function is the one writer (it checks the origin and
--     the honeypot first). Visitors, signed-in people and the public key cannot call it, and cannot read a single row;
--   * admin_creator_beta / admin_decide_creator are for Ryan (is_app_admin() is the gate).
-- Approving changes only the row's status: it sends nothing and grants no credits. Ryan replies from his inbox and grants the free
-- beta credits by hand, so nothing can cost money by itself.

create table public.creator_applications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 3 and 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  kind text not null check (kind in ('youtuber', 'podcaster', 'newsletter', 'journalist', 'teacher', 'researcher', 'other')),
  makes text not null check (char_length(makes) between 3 and 200),                           -- what they make
  link text not null check (char_length(link) between 10 and 300 and link ~ '^https://[^[:space:]]+$'),   -- channel / site
  question text not null check (char_length(question) between 10 and 1000),                   -- the question they would answer with data
  source text not null default 'creator_beta' check (source = 'creator_beta'),
  status text not null default 'new' check (status in ('new', 'approved', 'declined')),
  decided_at timestamptz,
  caller_key text check (caller_key is null or char_length(caller_key) = 64)   -- sha-256 of (caller address + day), made by the function; for the per-caller limit only. The address itself is never stored.
);
-- One application per address, whatever the capitalisation.
create unique index creator_applications_email_key on public.creator_applications (lower(email));
create index creator_applications_caller_idx on public.creator_applications (caller_key, created_at) where caller_key is not null;
alter table public.creator_applications enable row level security;
revoke all on table public.creator_applications from anon, authenticated, service_role;

-- Returns the application number. A non-empty p_website is the honeypot: reported as success, stored nowhere. An address that already
-- applied gets the same answer (so the form cannot be used to find out who applied) and changes nothing.
-- Limits (only STORED applications count): 3 an hour per caller (p_caller = the function's hash of the caller's address and the day; empty when the
-- request carried no address, in which case only the site-wide cap applies, never one shared bucket for everybody) and 40 an hour in all. The per-caller
-- limit is checked first, so one spammer is refused long before the site-wide cap is anywhere near, and cannot lock real applicants out.
create function public.creator_beta_apply(p_name text, p_email text, p_kind text, p_makes text, p_link text, p_question text, p_website text default '', p_caller text default '')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare r public.creator_applications; n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
        e text := trim(coalesce(p_email, '')); m text := regexp_replace(trim(coalesce(p_makes, '')), '\s+', ' ', 'g');
        l text := trim(coalesce(p_link, '')); q text := trim(coalesce(p_question, ''));
        ck text := case when coalesce(p_caller, '') ~ '^[0-9a-f]{64}$' then p_caller else null end;
begin
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;
  if char_length(n) < 2 or char_length(n) > 100 then raise exception 'Enter your name.' using errcode = 'PT422'; end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(e) > 200 then raise exception 'Enter an email address we can reply to.' using errcode = 'PT422'; end if;
  if p_kind is null or p_kind not in ('youtuber', 'podcaster', 'newsletter', 'journalist', 'teacher', 'researcher', 'other') then
    raise exception 'Choose what describes you best.' using errcode = 'PT422';
  end if;
  if char_length(m) < 3 or char_length(m) > 200 then raise exception 'Tell us what you make (a few words).' using errcode = 'PT422'; end if;
  if l !~ '^https://[^[:space:]]+$' or char_length(l) < 10 or char_length(l) > 300 then raise exception 'Add a link to your channel or site (it starts with https://).' using errcode = 'PT422'; end if;
  if char_length(q) < 10 or char_length(q) > 1000 then raise exception 'Tell us the question you would answer with data (10 to 1,000 characters).' using errcode = 'PT422'; end if;

  select * into r from public.creator_applications where lower(email) = lower(e);
  if found then
    return r.id;
  end if;
  if ck is not null and (select count(*) from public.creator_applications where caller_key = ck and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'You have sent a few applications already. Please try again in an hour.' using errcode = 'PT429';
  end if;
  if (select count(*) from public.creator_applications where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many applications right now. Please try again later.' using errcode = 'PT429';
  end if;
  insert into public.creator_applications (name, email, kind, makes, link, question, caller_key) values (n, e, p_kind, m, l, q, ck) returning * into r;
  perform ryagram_private.ops_raise('creator:' || r.id, 'New creator beta application #' || r.id || ' (' || r.kind || ')');
  return r.id;
end $$;

-- Ryan's list: the waiting ones (oldest first, 30 at most) and the counts.
create function public.admin_creator_beta() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can see creator applications.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'waiting', (select count(*) from public.creator_applications where status = 'new'),
    'approved', (select count(*) from public.creator_applications where status = 'approved'),
    'declined', (select count(*) from public.creator_applications where status = 'declined'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'name', name, 'email', email, 'kind', kind,
                                                          'makes', makes, 'link', link, 'question', question) order by id)
                         from (select * from public.creator_applications where status = 'new' order by id limit 30) a), '[]'::jsonb));
end $$;

-- Approve or decline a waiting application (it clears that application's alert). Nothing is sent and no credits move.
create function public.admin_decide_creator(p_id bigint, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ryagram_private.is_app_admin() then
    raise exception 'Only an admin can decide creator applications.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'declined') then
    raise exception 'Choose approve or decline.' using errcode = 'P0001';
  end if;
  update public.creator_applications set status = p_decision, decided_at = now() where id = p_id and status = 'new';
  perform ryagram_private.ops_clear('creator:' || p_id);
end $$;

revoke execute on function public.creator_beta_apply(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.creator_beta_apply(text, text, text, text, text, text, text, text) to service_role;
revoke execute on function public.admin_creator_beta(), public.admin_decide_creator(bigint, text) from public, anon;
grant execute on function public.admin_creator_beta(), public.admin_decide_creator(bigint, text) to authenticated;   -- is_app_admin() is the gate
