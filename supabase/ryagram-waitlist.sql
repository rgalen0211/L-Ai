-- Ryagram waitlist, Phase 1.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste all of this -> Run.
--
-- The website's public key can add rows and nothing else: it cannot read, change,
-- or delete the list. Read signups in Table Editor -> ryagram_waitlist.
--
-- Phase 2 (accounts) uses Supabase Auth in this same project. user_id and
-- invited_at are here so beta invites can be matched to signups without a
-- second list; the public key cannot set either of them.

create table if not exists public.ryagram_waitlist (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null
    check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  use_case text
    check (use_case is null or char_length(use_case) <= 2000),
  source text not null default 'uselai.com/ryagram'
    check (char_length(source) <= 100),
  user_id uuid references auth.users (id) on delete set null,
  invited_at timestamptz
);

-- One row per address, whatever the capitalisation.
create unique index if not exists ryagram_waitlist_email_key
  on public.ryagram_waitlist (lower(email));

alter table public.ryagram_waitlist enable row level security;

-- Nothing here relies on Supabase's default grants: the project has
-- "Automatically expose new tables" OFF, so every privilege is granted below,
-- including USAGE on the schema, without which the table is invisible.
grant usage on schema public to anon, authenticated;

-- Insert-only, and only the three columns the form sends.
revoke all on table public.ryagram_waitlist from anon, authenticated;
grant insert (email, use_case, source) on table public.ryagram_waitlist to anon, authenticated;

drop policy if exists "Visitors can join the waitlist" on public.ryagram_waitlist;
create policy "Visitors can join the waitlist"
  on public.ryagram_waitlist for insert
  to anon, authenticated
  with check (user_id is null and invited_at is null);
