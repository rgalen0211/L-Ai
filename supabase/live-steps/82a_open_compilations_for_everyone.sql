-- OPEN COMPILATIONS FOR EVERYONE (BUILDER builder-dept-switches-1127). Ryan's yes, ONLY after walking it on a test account with its switch on. ONE statement.
-- It changes ONE row of public.departments: compilations to status 'working' (and no longer only for testers; with 20261127000300 applied, any account can then sign in its own computer for compilations). It answers in one row with what it changed.
-- It REFUSES (changes nothing) until 20261127000300 (compilations for everyone) is applied: before it, a non-tester could see the department but not sign in a computer (CC1 08:46).
-- UNDO: 82d_close_compilations_for_everyone.sql (back to Coming soon).
with u as (update public.departments set status = 'working', needs_local_compute = false
            where id = 'compilations' and to_regprocedure('ryagram_private.compilations_on(uuid)') is not null returning id, status, needs_local_compute)
select case when exists (select 1 from u) then 'opened for everyone: ' || (select id || ' is ' || status || case when needs_local_compute then ' (testers only)' else '' end from u)
            when to_regprocedure('ryagram_private.compilations_on(uuid)') is null then 'STOP: apply 20261127000300 (compilations for everyone) first, nothing was changed'
            else 'STOP: there is no department named compilations, nothing was changed' end as result;
