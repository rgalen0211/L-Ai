-- LAUNCH ONLY, WITH RYAN: Connect-an-AI opens to every signed-up account (Ryan 2026-11-21 11:30). Run ONLY after the checklist in proposals/CONNECT-OPEN-CONNECT-1121.md section 4 is all done (the words flipped together, WORKER's and the launch checks).
-- One row, one flag. Undo at any minute: live-steps/37_connect_open_OFF.sql (and public.admin_connect_revoke_all() if the connections made while open should end).
update public.connect_flags set open_to_all = true where id;
select open_to_all as now_open from public.connect_flags where id;
