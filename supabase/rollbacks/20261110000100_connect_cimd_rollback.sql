-- CLIENT ID METADATA DOCUMENTS: the exact undo of migrations/20261110000100_connect_cimd.sql (CONNECT, 2026-11-10). NOT a migration: it lives outside migrations/ so nothing applies it by itself.
-- Turn the connector's CONNECT_CIMD setting off (delete the secret) and redeploy FIRST: with the metadata still saying 'use the published identity' and the function gone, every sign-in through it would fail.
-- Clients that were created through it stay as ordinary rows of connect_clients (a person's grants and tokens keep working); only the allowlist table and the one function go.
begin;
drop function if exists public.connect_cimd_client(text, text[]);
drop table if exists public.connect_cimd_allowlist;
commit;
