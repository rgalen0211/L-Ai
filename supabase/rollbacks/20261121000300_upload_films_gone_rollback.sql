-- UPLOAD FILMS GONE: the exact undo of migrations/20261121000300_upload_films_gone.sql (GEO's privacy review M3).
-- NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It drops the three functions the migration added (upload_films_due_for_deletion, mark_upload_films_removed and the rule
-- ryagram_private.upload_film_due); nothing else was changed by it, so nothing else is touched. A second run does nothing.
-- AFTER IT: films made from a deleted upload are no longer removed (as before M3). purge-uploads needs no change: its
-- films phase fails on its own (the missing function), is logged, and the spreadsheets are still removed every hour.

begin;

drop function if exists public.upload_films_due_for_deletion(int);
drop function if exists public.mark_upload_films_removed(uuid[]);
drop function if exists ryagram_private.upload_film_due(public.artifacts);

select ryagram_private.gate_apply();                       -- like every migration after the waiting list (CC1 11-21 G5)
commit;
