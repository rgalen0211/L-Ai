-- UNDO of live-steps/36: back to the invited list only. Nothing is deleted. Tokens and grants made while it was open stay in the tables but every call re-checks the rule, so an account not on the list is refused again at once.
-- To end those connections too (EVERY token and grant ends, the invited testers' too: everybody reconnects), run these two statements in the SQL Editor. public.admin_connect_revoke_all() does the same but needs an administrator's APP session (it checks auth.uid()), which the SQL Editor does not have:
--   update public.connect_tokens set revoked_at = now() where revoked_at is null;
--   update public.connect_grants set revoked_at = now() where revoked_at is null;
update public.connect_flags set open_to_all = false where id;
select open_to_all as now_open from public.connect_flags where id;
