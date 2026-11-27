-- THE EXACT UNDO of migrations/20261127001000_game_rooms.sql. NOT APPLIED, and NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- Every game room closes at once (the rooms, seated names, buckets and wrong tries are dropped; nothing in them is kept after a day anyway). A host page or phone page that
-- calls these functions then gets 'function not found': put the page back (GAMES' page undo) BEFORE or together with this file.
-- Ends with gate_apply.
begin;

drop function public.game_room_join(text, text, text, text);
drop function public.game_room_close(uuid);
drop function public.game_room_allow(uuid, text);
drop function public.game_room_kick(uuid, text);
drop function public.game_room_seats(uuid, int);
drop function public.game_room_lock(uuid, boolean);
drop function public.game_room_beat(uuid);
drop function public.game_room_open(text);
drop function ryagram_private.game_host_room(uuid, uuid);
drop function ryagram_private.game_roster(uuid);
drop function ryagram_private.game_caller();
drop function ryagram_private.game_take(text, double precision, double precision);
drop function ryagram_private.game_code_norm(text);
drop function ryagram_private.game_new_code();
drop function ryagram_private.game_room_fresh(timestamptz);
drop function ryagram_private.games_on(uuid);
drop table public.game_room_misses;
drop table public.game_room_limits;
drop table public.game_room_players;
drop table public.game_rooms;

select ryagram_private.gate_apply();                       -- same closing line as the migration

commit;
