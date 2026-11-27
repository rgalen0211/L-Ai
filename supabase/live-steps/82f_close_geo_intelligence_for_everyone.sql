-- THE UNDO OF 82c: PERFECT CITY back to Coming soon for everyone (BUILDER builder-dept-switches-1127). ONE statement. Accounts whose switch is on still see it working.
with u as (update public.departments set status = 'soon' where id = 'geo_intelligence' returning id, status)
select case when exists (select 1 from u) then 'closed for everyone: ' || (select id || ' is ' || status from u)
            else 'STOP: there is no department named geo_intelligence, nothing was changed' end as result;
