-- THE DESKTOP APP AS A SETUP EXE (BUILDER 2026-11-28, NOT APPLIED). Claude 23:30 installer order, Ryan's 23:49 yes (a direct download from our own site, unsigned for now).
-- public.app_releases.file_name allowed only .zip or .txt (20261026000500). The installer is one file, Ryagram-Setup-<version>.exe, so the app's release may now ALSO be an .exe:
--   * ONLY for kind 'app' (an add-on stays a .zip, the notices a .txt); the same safe characters and length as before; nothing else about a release changes
--   * the kind stays 'app', so request_app_download, the invite links (20261030000100), the app-download edge function and the site's card need NO new kind: switching the active
--     app row from the zip to the setup exe is two updates in one transaction (the zip off, then the exe on), and its undo is the same the other way (the zip row stays, inactive)
--   * who may download is unchanged: an invited tester, an administrator, or an account with compilations on (20261127000300, live)
-- The constraint is found by what it checks, not by its name; refused in words if there is not exactly one file-name check, or if it is not the one 20261026000500 wrote.
-- Apply AFTER 20261026000500_app_downloads.sql (live since 10-27). Undo: rollbacks/20261128000300_app_setup_exe_rollback.sql (refuses while the active app release is an .exe).
-- Check: live-steps/87_app_setup_exe_check.sql. Credits: none. No grant changes.
begin;

do $do$
declare n int; nm text; d text;
begin
  select count(*), min(c.conname), min(pg_get_constraintdef(c.oid)) into n, nm, d
    from pg_constraint c where c.conrelid = 'public.app_releases'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%file_name%';
  if n = 1 and d like '%exe%' then
    raise notice 'app_releases already allows a setup exe, left alone.';
    return;
  end if;
  if n <> 1 or d not like '%(zip|txt)$%' then
    raise exception 'app_releases is not the one this change expects (its file name check differs from the repository); nothing was changed. Send this sentence to BUILDER.';
  end if;
  execute format('alter table public.app_releases drop constraint %I', nm);
  alter table public.app_releases add constraint app_releases_file_name_check check (
    file_name ~ '^[A-Za-z0-9._-]{1,120}\.(zip|txt)$'
    or (kind = 'app' and file_name ~ '^[A-Za-z0-9._-]{1,120}\.exe$'));
end $do$;

select ryagram_private.gate_apply();
commit;
