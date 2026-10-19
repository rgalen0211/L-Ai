-- LIVE: END EVERY CONNECTION (a bad day). Every token and every permission ends now; people must connect their assistants again.
-- Use together with 90_switch_off.sql. Run as the project owner in the SQL Editor.
update public.connect_tokens set revoked_at = now() where revoked_at is null;
update public.connect_grants set revoked_at = now() where revoked_at is null;

select (select count(*) from public.connect_tokens where revoked_at is null) as live_tokens_left,
       (select count(*) from public.connect_grants where revoked_at is null) as live_permissions_left;
