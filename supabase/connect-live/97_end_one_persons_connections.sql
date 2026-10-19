-- WRITE. End ONE person's AI connections now (every assistant they connected); they connect again from their assistant when they next want to.
-- Edit the email address in the one place marked below, then run in the SQL Editor as the project owner. Nothing else is touched.
-- To also stop them connecting again until you say so, run the commented last statement.
with who as (select id from auth.users where lower(email) = lower('PERSON@EXAMPLE.COM')),    -- <== put the person's email here
t as (update public.connect_tokens set revoked_at = now() where revoked_at is null and owner_id in (select id from who) returning 1),
g as (update public.connect_grants set revoked_at = now() where revoked_at is null and owner_id in (select id from who) returning 1)
select (select count(*) from who) as people_found, (select count(*) from t) as tokens_ended, (select count(*) from g) as permissions_ended;

-- update public.connect_access set enabled = false where user_id = (select id from auth.users where lower(email) = lower('PERSON@EXAMPLE.COM'));
