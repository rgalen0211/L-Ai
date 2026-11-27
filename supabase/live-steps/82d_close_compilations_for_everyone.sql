-- THE UNDO OF 82a: COMPILATIONS back to Coming soon for everyone (BUILDER builder-dept-switches-1127). ONE statement. Accounts whose switch is on still see it working.
with u as (update public.departments set status = 'soon', needs_local_compute = true where id = 'compilations' returning id, status)
select case when exists (select 1 from u) then 'closed for everyone: ' || (select id || ' is ' || status from u)
            else 'STOP: there is no department named compilations, nothing was changed' end as result;
