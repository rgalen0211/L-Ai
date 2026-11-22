-- UNDO of live-steps/36: back to the invited list only. Nothing is deleted. Tokens and grants made while it was open stay in the tables but every call re-checks the rule, so an account not on the list is refused again at once.
-- To end those connections too, run (as an administrator session) public.admin_connect_revoke_all(): every token and grant ends and each person reconnects.
update public.connect_flags set open_to_all = false where id;
select open_to_all as now_open from public.connect_flags where id;
