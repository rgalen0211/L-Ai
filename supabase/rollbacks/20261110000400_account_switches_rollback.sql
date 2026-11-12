-- THE PER-ACCOUNT SWITCH LIST: the exact undo of migrations/20261110000400_account_switches.sql (CONNECT, 2026-11-10). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- Switch the page helper back (featureOn must not call my_switches) first, or the page asks for a function that is gone and treats every 'account' switch as OFF (which is the safe side). What is lost: every
-- account's list and the history of changes. Every other account setting (upload_retention, local_compute) is untouched.
begin;
drop function if exists public.my_switches();
drop function if exists public.admin_account_switch_set(text, text, boolean, text);
drop function if exists public.admin_account_switch_list();
drop function if exists public.admin_account_switch_audit();
drop table if exists public.account_switch_audit;
alter table public.account_settings drop constraint if exists account_settings_switches_on_names;
alter table public.account_settings drop column if exists switches_on;
commit;
