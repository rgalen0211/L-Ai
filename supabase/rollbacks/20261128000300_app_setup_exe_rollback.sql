-- UNDO of 20261128000300_app_setup_exe.sql (BUILDER 2026-11-28): app_releases.file_name goes back to .zip or .txt only, as 20261026000500 wrote it.
-- REFUSES while the ACTIVE app release is an .exe: switch the app back to its zip first (Ryan's row in the release sheet). A past exe release that people downloaded cannot be deleted
-- (its download rows point at it), so when such rows remain the old rule comes back NOT VALID: every new or changed row must be a .zip or .txt again, the old exe rows stay as history.
-- With no exe row at all the rule comes back exactly as before (validated). After it, step 87 says STOP.
begin;

do $do$
begin
  if exists (select 1 from public.app_releases where active and file_name ~ '\.exe$') then
    raise exception 'The active app release is still a setup exe: switch the app back to its zip first; nothing was changed.';
  end if;
  alter table public.app_releases drop constraint app_releases_file_name_check;
  if exists (select 1 from public.app_releases where file_name ~ '\.exe$') then
    alter table public.app_releases add constraint app_releases_file_name_check check (file_name ~ '^[A-Za-z0-9._-]{1,120}\.(zip|txt)$') not valid;
    raise notice 'Past setup exe releases stay as history; the zip-or-txt rule is back for every new row (NOT VALID).';
  else
    alter table public.app_releases add constraint app_releases_file_name_check check (file_name ~ '^[A-Za-z0-9._-]{1,120}\.(zip|txt)$');
  end if;
end $do$;

select ryagram_private.gate_apply();
commit;
