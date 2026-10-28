-- THE RENDER MACHINE'S STATE FOR THE CONNECTED AI: the exact undo of migrations/20261027001100_connect_rendering_state.sql (NEXT-CONNECT 153). NOT a migration: nothing applies it by itself.
-- The connector's job tools then fall back to the plain 'unknown' wording; nothing else changes.
begin;
drop function if exists public.connect_rendering_state(text);
commit;
