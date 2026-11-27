-- OPEN PERFECT CITY FOR EVERYONE (BUILDER builder-dept-switches-1127). Ryan's yes, ONLY after walking it on a test account with its switch on. ONE statement.
-- It changes ONE row of public.departments: geo_intelligence to status 'working'. It answers in one row with what it changed.
-- UNDO: 82f_close_geo_intelligence_for_everyone.sql (back to Coming soon).
with u as (update public.departments set status = 'working' where id = 'geo_intelligence' returning id, status, needs_local_compute)
select case when exists (select 1 from u) then 'opened for everyone: ' || (select id || ' is ' || status || case when needs_local_compute then ' (testers only)' else '' end from u)
            else 'STOP: there is no department named geo_intelligence, nothing was changed' end as result;
