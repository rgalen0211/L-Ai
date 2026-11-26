-- LIVE STEP 75b: THE UNDO OF LIVE STEP 75 (CONNECT 2026-11-26): NEW verified emails get 8 welcome credits again. Undo the PAGES first (the pages say 16), then run this. People who already got 16 keep it (credits already given are never taken back).
-- PART 1 (read-only): the setting now. PART 2 (the one write): REFUSES unless the setting is exactly 16 (a 0 means off on purpose: left alone). PART 3 (read-only): read-back, must say 8.

-- PART 1 (read-only)
select (select o.welcome_credits from public.ops_settings o limit 1) as welcome_credits_now;

-- PART 2 (the write)
do $do$
declare n int;
begin
  n := (select o.welcome_credits from public.ops_settings o limit 1);
  if n = 8 then raise exception 'Not run: the setting is already 8.'; end if;
  if n is distinct from 16 then raise exception 'Not run: the setting is % (not 16), so it was not changed by live step 75. Look before changing it.', n; end if;
  update public.ops_settings set welcome_credits = 8;
  if (select o.welcome_credits from public.ops_settings o limit 1) is distinct from 8 then raise exception 'Not run: the setting did not change.'; end if;
end $do$;

-- PART 3 (read-only)
select (select o.welcome_credits from public.ops_settings o limit 1) as welcome_credits_now;
