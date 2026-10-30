-- The exact undo of migrations/20261030000100_invite_app_links.sql (NEXT-CONNECT 162). NOT a migration: nothing applies it by itself.
-- WHAT IT LOSES: every invite app link (used or not). Links already sent in emails stop working (the app-link function then says the link is no longer good). Invite codes, invite_sends and app_releases are not touched.
-- If the app-link function or send-invite with INVITE_APP_LINK=1 is deployed, switch them off (or redeploy the old commit) before or after: they fail closed once these functions are gone.
begin;
drop function if exists public.redeem_invite_app_link(text);
drop function if exists public.peek_invite_app_link(text);
drop function if exists public.admin_invite_app_link_make(text);
drop table if exists public.invite_app_links;
commit;
