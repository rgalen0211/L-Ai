-- LIVE: who may connect an AI assistant. Invite-only. Edit the list of email addresses below, then run as the project owner in the SQL Editor.
-- Administrator accounts and render-worker logins are refused by the connector itself even if they are listed here.
-- An invitation does nothing until the person also presses Allow on the consent page for a specific assistant.
with wanted(email) as (values
  ('person-one@example.com'),
  ('person-two@example.com')
)
insert into public.connect_access (user_id, enabled)
select u.id, true from auth.users u join wanted w on lower(u.email) = lower(w.email)
where not exists (select 1 from public.app_admins a where a.user_id = u.id) and not exists (select 1 from public.workers k where k.user_id = u.id)
on conflict (user_id) do update set enabled = true;

-- Check (every column aliased): who is invited now, and who in the list above was NOT found or was refused.
select u.email as invited_email, a.enabled as invited, a.created_at as since
  from public.connect_access a join auth.users u on u.id = a.user_id order by u.email;
