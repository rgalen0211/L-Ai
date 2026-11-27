-- GAME ROOMS, THE SERVER HALF (BUILDER 2026-11-27; Ryan's 11:42 launch order: Games goes live today once its holds close. GAMES owns the page, BUILDER the server, RENDERER reviews).
-- NOT APPLIED: Ryan applies it (live step 83). Undo: supabase/rollbacks/20261127001000_game_rooms_rollback.sql. Design: proposals/BUILDER-GAMES-ROOMS-1127.md.
-- THE GAP: a room today is a PUBLIC Realtime broadcast channel named from a 6-letter code. Anyone who guesses or reads the code joins, the host key is bound only by a slow hash
--   of the code (RENDERER 10:19 HIGH: beaten by a table made ahead of time), and nothing on a server limits guessing, seats, or how long a forgotten room stays open.
-- WHAT THIS ADDS
--   (1) public.game_room_open(host_key): the HOST (signed in, in the app, games working in their own top bar, account active, never a worker) registers a room. Ryagram makes a
--       12-letter code from 31 letters and digits that cannot be misread (no I, L, O, 0, 1; about 59 bits), keeps ONLY its sha256, a secret channel name (244 random bits)
--       and the host's public key. One open room per host (opening a new one closes the old: that is New room code); at most 20 rooms a day per host.
--   (2) public.game_room_join(code, player_id, name, seat_token): a PHONE (not signed in, the public key) joins. It ANSWERS in words and never raises, so every wrong
--       try is counted: cheap checks first (shape, then under ONE lock: the caller, the unknown bucket, the guessing door, the player id, the code tried), then the room.
--       On success it gives the channel name and the host's key (the phone pins the host key from Ryagram, not from the code) and, on a FIRST seat, a seat_token
--       (244 random bits, kept only as its sha256). Refusals: wrong code, door closed, slow down, removed, locked, full, name.
--       LIMITS, per caller first: one caller (its address, HMAC'd; IPv6 cut to its /64) may miss 10 times a minute. Requests with no readable address share ONE
--       'unknown' bucket: 30 misses a minute. THE GUESSING DOOR is a backstop: 300 wrong codes in any 60 seconds across ALL callers close joining for everyone else
--       until the oldest is a minute old. A seated player coming back with the right seat token is held only by their own caller limit, never by the door or the
--       unknown bucket. A player id may try 5 times a minute; a code may be tried 20 times a minute.
--       COMING BACK: a seated player id returns (even into a locked or full room) only with its seat token; a missing or wrong token is a miss with the wrong-code
--       words; a kick voids the token; a returning seat keeps its name.
--   (3) THE HOST'S CONTROLS: game_room_lock (nobody new joins; seated players may come back with their seat token), game_room_seats (2 to 12, default 12, never below the seated count),
--       game_room_kick (the seat is freed, its seat token voided, and that player id is refused from then on), game_room_allow (undo a removal), game_room_close, and game_room_beat (the host is
--       still here; answers the seated list so the host trusts only player ids Ryagram seated). A room with no beat for 15 minutes is CLOSED ON READ: no cron.
--   (4) TABLES, RLS ON, NO POLICY, NO GRANTS (nobody reads or writes them except through the functions): public.game_rooms, public.game_room_players,
--       public.game_room_limits (token buckets), public.game_room_misses (wrong tries, kept an hour). Closed rooms and their names go after a day.
--   (5) CREDITS: none. No address, no email, no IP is stored: the caller key is an HMAC of the address with the house secret (or 'unknown'), kept an hour.
-- Apply AFTER: 20261127000250_department_switches.sql (so the games switch opens it), 20261027000100_departments.sql (departments_for), 20261017000100_hash_secrets.sql,
--   20261104000100_waiting_accounts.sql (the gate; this file ends with gate_apply()).
begin;

-- ---------------------------------------------------------------------------------------------------- tables (RLS on, no policy, no grants)
create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  code_sha256 bytea not null check (octet_length(code_sha256) = 32),     -- the code itself is never stored
  channel text not null check (channel ~ '^ryagram-game-[0-9a-f]{64}$'),
  host_key text not null check (char_length(host_key) between 16 and 1000),
  seats int not null default 12 check (seats between 2 and 12),
  locked boolean not null default false,
  opened_at timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_reason text check (closed_reason in ('host', 'idle', 'new_code'))
);
create unique index game_rooms_open_code on public.game_rooms (code_sha256) where closed_at is null;
create unique index game_rooms_one_open_per_host on public.game_rooms (host_id) where closed_at is null;
create index game_rooms_host_opened on public.game_rooms (host_id, opened_at);
create unique index game_rooms_channel on public.game_rooms (channel);

create table public.game_room_players (
  room_id uuid not null references public.game_rooms (id) on delete cascade,
  player_id text not null check (player_id ~ '^[A-Za-z0-9]{8,32}$'),
  name text not null check (char_length(name) between 1 and 16),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,                                               -- set by the host: the seat is free and this player id is refused
  token_sha256 bytea check (token_sha256 is null or octet_length(token_sha256) = 32),  -- the seat token's sha256 (the token itself is never stored); null once kicked
  primary key (room_id, player_id)
);

create table public.game_room_limits (
  key text primary key check (char_length(key) <= 100),
  tokens double precision not null,
  at timestamptz not null default now()
);

create table public.game_room_misses (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  caller text not null                                                  -- HMAC of the address (an hour), or 'unknown' when no address could be read
);
create index game_room_misses_at on public.game_room_misses (at);
create index game_room_misses_caller_at on public.game_room_misses (caller, at);

alter table public.game_rooms enable row level security;
alter table public.game_room_players enable row level security;
alter table public.game_room_limits enable row level security;
alter table public.game_room_misses enable row level security;
revoke all on public.game_rooms, public.game_room_players, public.game_room_limits, public.game_room_misses from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- private helpers
-- Games follow the top bar exactly (as compilations_on, CC1 09:35): working in departments_for (the 'games' switch from 20261127000250, or live step 82b for everyone;
-- invited accounts only, so an administrator is off: walk it on a TEST account), never a worker, never a WAITING account.
create function ryagram_private.games_on(p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_person is not null
     and not exists (select 1 from public.workers w where w.user_id = p_person)
     and ryagram_private.account_active(p_person)
     and exists (select 1 from ryagram_private.departments_for(p_person) x where x.id = 'games' and x.status = 'working')
$$;

-- the idle rule in one place: a room with no beat for 15 minutes is closed
create function ryagram_private.game_room_fresh(p_last_beat timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_last_beat >= now() - interval '15 minutes'
$$;

-- 12 characters from 31 that cannot be misread, from the server's strong random source (gen_random_uuid); the uuid's fixed version and variant bytes (6 and 8) are skipped,
-- and only bytes below 248 (8 x 31) are used, so no character is more likely than another.
create function ryagram_private.game_new_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare a constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea; i int; v int; c text := '';
begin
  while char_length(c) < 12 loop
    b := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      v := get_byte(b, i);
      if i not in (6, 8) and v < 248 and char_length(c) < 12 then
        c := c || substr(a, v % 31 + 1, 1);
      end if;
    end loop;
  end loop;
  return c;
end $$;

-- what a typed code becomes before it is hashed: capitals, no spaces or dashes
create function ryagram_private.game_code_norm(p_code text) returns text
language sql immutable security definer set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'))
$$;

-- a token bucket: true when a token was taken. Rows go after an hour unused.
create function ryagram_private.game_take(p_key text, p_capacity double precision, p_per_second double precision) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t double precision; a timestamptz;
begin
  insert into public.game_room_limits (key, tokens, at) values (p_key, p_capacity, now()) on conflict (key) do nothing;
  select l.tokens, l.at into t, a from public.game_room_limits l where l.key = p_key for update;
  t := least(p_capacity, t + greatest(0, extract(epoch from now() - a)) * p_per_second);
  if t < 1 then
    update public.game_room_limits set tokens = t, at = now() where key = p_key;
    return false;
  end if;
  update public.game_room_limits set tokens = t - 1, at = now() where key = p_key;
  return true;
end $$;

-- the caller's address as a key: cf-connecting-ip, else the LAST hop of x-forwarded-for (the house rule, 20261017000100), HMAC'd with the house secret.
-- IPv6 is cut to its /64 (one home or phone gets a whole /64, so a whole address would give one person endless keys); IPv4 is kept whole.
-- Null when no address can be read (no header, or not an address): join then scores the miss in the ONE shared 'unknown' bucket. The FIRST x-forwarded-for entry is
-- written by the client and is never used. Whether the LAST hop is really the phone on Supabase's PostgREST path is checked on live (design doc, live checklist).
create function ryagram_private.game_caller() returns text
language plpgsql stable security definer set search_path = '' as $$
declare hdr json; ip text; a inet;
begin
  begin
    hdr := current_setting('request.headers', true)::json;
    ip := nullif(trim(coalesce(hdr->>'cf-connecting-ip',
                               (string_to_array(coalesce(hdr->>'x-forwarded-for', ''), ','))[array_length(string_to_array(coalesce(hdr->>'x-forwarded-for', ''), ','), 1)])), '');
    if ip is null then
      return null;
    end if;
    a := ip::inet;
    ip := case when family(a) = 6 then host(network(set_masklen(a, 64))) || '/64' else host(a) end;
    return encode(ryagram_private.hmac_sha256(ryagram_private.hash_secret(), convert_to('game|' || ip, 'UTF8')), 'hex');
  exception when others then
    return null;
  end;
end $$;

-- the seated list the host checks player ids against
create function ryagram_private.game_roster(p_room uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'room_id', r.id, 'seats', r.seats, 'locked', r.locked,
    'players', coalesce((select jsonb_agg(jsonb_build_object('player_id', p.player_id, 'name', p.name, 'joined_at', p.joined_at) order by p.joined_at, p.player_id)
                           from public.game_room_players p where p.room_id = r.id and p.removed_at is null), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(jsonb_build_object('player_id', p.player_id, 'name', p.name) order by p.removed_at, p.player_id)
                           from public.game_room_players p where p.room_id = r.id and p.removed_at is not null), '[]'::jsonb))
  from public.game_rooms r where r.id = p_room
$$;

-- the host's own open room, locked for this call, or a refusal in words
create function ryagram_private.game_host_room(p_room uuid, p_me uuid) returns public.game_rooms
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms;
begin
  if not ryagram_private.games_on(p_me) then
    raise exception 'Games are not open for this account yet.' using errcode = '42501';
  end if;
  select * into r from public.game_rooms where id = p_room for update;
  if not found then
    raise exception 'That game room was not found.' using errcode = 'PT404';
  end if;
  if r.host_id <> p_me then
    raise exception 'Only the host of this room can do that.' using errcode = '42501';
  end if;
  if r.closed_at is not null or not ryagram_private.game_room_fresh(r.last_beat_at) then
    raise exception 'This room is closed. Open a new room.' using errcode = '55000', hint = 'closed';
  end if;
  return r;
end $$;

revoke execute on function ryagram_private.games_on(uuid), ryagram_private.game_room_fresh(timestamptz), ryagram_private.game_new_code(), ryagram_private.game_code_norm(text),
  ryagram_private.game_take(text, double precision, double precision), ryagram_private.game_caller(), ryagram_private.game_roster(uuid), ryagram_private.game_host_room(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------- the host (signed in, in the app)
create function public.game_room_open(p_host_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); c text; rid uuid; ch text;
begin
  perform ryagram_private.require_active();
  if exists (select 1 from public.workers w where w.user_id = me) then
    raise exception 'A worker account cannot host a game.' using errcode = '42501';
  end if;
  if not ryagram_private.games_on(me) then
    raise exception 'Games are not open for this account yet.' using errcode = '42501';
  end if;
  if p_host_key is null or char_length(p_host_key) not between 16 and 1000 or p_host_key ~ '[[:cntrl:][:space:]]' then
    raise exception 'That host key is not valid. Reload the page and try again.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('game_room_open:' || me::text, 0));
  if (select count(*) from public.game_rooms r where r.host_id = me and r.opened_at > now() - interval '1 day') >= 20 then
    raise exception 'You opened 20 game rooms today. Keep using the one that is open, or try again tomorrow.' using errcode = 'PT429';
  end if;
  -- tidy (bounded: rooms are capped per host per day, misses by the door): closed rooms and their names a day after closing, rooms nobody beat for a day (idle,
  -- so already closed in effect), old buckets and misses after an hour. An open room that is still beating is NEVER deleted, however long ago it opened.
  delete from public.game_rooms r where (r.closed_at is not null and r.closed_at < now() - interval '1 day')
                                     or (r.closed_at is null and r.last_beat_at < now() - interval '1 day');
  delete from public.game_room_limits l where l.at < now() - interval '1 hour';
  delete from public.game_room_misses m where m.at < now() - interval '1 hour';
  -- one open room per host: a new room closes the old one (this is New room code)
  update public.game_rooms set closed_at = now(), closed_reason = 'new_code' where host_id = me and closed_at is null;
  c := ryagram_private.game_new_code();
  -- the secret channel name: two uuids, 244 random bits (6 of each uuid's 128 bits are its fixed version and variant)
  ch := 'ryagram-game-' || encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
  insert into public.game_rooms (host_id, code_sha256, channel, host_key) values (me, sha256(convert_to(c, 'UTF8')), ch, p_host_key) returning id into rid;
  return jsonb_build_object('room_id', rid, 'code', substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4), 'channel', ch, 'seats', 12, 'locked', false,
                            'beat_seconds', 60, 'idle_minutes', 15);
end $$;

create function public.game_room_beat(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); r public.game_rooms;
begin
  perform ryagram_private.require_active();
  r := ryagram_private.game_host_room(p_room, me);
  update public.game_rooms set last_beat_at = now() where id = r.id;
  return ryagram_private.game_roster(r.id);
end $$;

create function public.game_room_lock(p_room uuid, p_locked boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); r public.game_rooms;
begin
  perform ryagram_private.require_active();
  r := ryagram_private.game_host_room(p_room, me);
  if p_locked is null then
    raise exception 'Say whether to lock the room or open it.' using errcode = '22023';
  end if;
  update public.game_rooms set locked = p_locked, last_beat_at = now() where id = r.id;
  return ryagram_private.game_roster(r.id);
end $$;

create function public.game_room_seats(p_room uuid, p_seats int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); r public.game_rooms; n int;
begin
  perform ryagram_private.require_active();
  r := ryagram_private.game_host_room(p_room, me);
  if p_seats is null or p_seats not between 2 and 12 then
    raise exception 'A room has 2 to 12 seats.' using errcode = '22023';
  end if;
  select count(*) into n from public.game_room_players p where p.room_id = r.id and p.removed_at is null;
  if p_seats < n then
    raise exception '% players are already in. Remove someone first, or keep % seats.', n, n using errcode = '22023';
  end if;
  update public.game_rooms set seats = p_seats, last_beat_at = now() where id = r.id;
  return ryagram_private.game_roster(r.id);
end $$;

create function public.game_room_kick(p_room uuid, p_player_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); r public.game_rooms;
begin
  perform ryagram_private.require_active();
  r := ryagram_private.game_host_room(p_room, me);
  update public.game_room_players set removed_at = now(), token_sha256 = null where room_id = r.id and player_id = p_player_id and removed_at is null;
  if not found then
    raise exception 'That player is not in this room.' using errcode = 'PT404';
  end if;
  update public.game_rooms set last_beat_at = now() where id = r.id;
  return ryagram_private.game_roster(r.id);
end $$;

-- Allow again: the removal is forgotten and the player may join (and take a seat) again
create function public.game_room_allow(p_room uuid, p_player_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); r public.game_rooms;
begin
  perform ryagram_private.require_active();
  r := ryagram_private.game_host_room(p_room, me);
  delete from public.game_room_players where room_id = r.id and player_id = p_player_id and removed_at is not null;
  if not found then
    raise exception 'That player was not removed from this room.' using errcode = 'PT404';
  end if;
  update public.game_rooms set last_beat_at = now() where id = r.id;
  return ryagram_private.game_roster(r.id);
end $$;

create function public.game_room_close(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := ryagram_private.require_app_session(); r public.game_rooms;
begin
  perform ryagram_private.require_active();
  r := ryagram_private.game_host_room(p_room, me);
  update public.game_rooms set closed_at = now(), closed_reason = 'host' where id = r.id;
end $$;

-- ---------------------------------------------------------------------------------------------------- the phone (not signed in: the public key only)
-- Answers {ok: true, channel, host_key, seats, seated, name, rejoined, seat_token (first seat only)} or {ok: false, problem, words}. Never raises for a refusal, so the
-- wrong try it counts is kept. problem is one of: code_letters, player, name, door, slow_down, wrong_code, removed, locked, full, name_taken.
create function public.game_room_join(p_code text, p_player_id text, p_name text, p_seat_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c text := ryagram_private.game_code_norm(p_code); nm text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
        who text := ryagram_private.game_caller(); bucket text; h bytea; th bytea; r public.game_rooms; p public.game_room_players; n int; live boolean := false;
        back boolean := false; tok text;
begin
  -- 1. shape: costs nothing and is never counted as a guess
  if c !~ '^[2-9A-HJKMNP-Z]{12}$' then
    return jsonb_build_object('ok', false, 'problem', 'code_letters', 'words', 'A room code is 12 letters and numbers from the host''s screen. It never uses I, L, O, 0 or 1.');
  end if;
  if p_player_id is null or p_player_id !~ '^[A-Za-z0-9]{8,32}$' then
    return jsonb_build_object('ok', false, 'problem', 'player', 'words', 'This page could not join. Reload it and try again.');
  end if;
  if nm = '' then
    return jsonb_build_object('ok', false, 'problem', 'name', 'words', 'Type a name to join.');
  end if;
  if char_length(nm) > 16 then
    return jsonb_build_object('ok', false, 'problem', 'name', 'words', 'Use 16 letters or fewer.');
  end if;
  if nm ~ '[[:cntrl:]\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]' then
    return jsonb_build_object('ok', false, 'problem', 'name', 'words', 'That name has hidden characters. Type it again.');
  end if;
  if nm ~* '(@|://|www\.)' then
    return jsonb_build_object('ok', false, 'problem', 'name', 'words', 'Leave out web addresses and email addresses.');
  end if;
  if p_seat_token is not null and char_length(p_seat_token) > 200 then
    return jsonb_build_object('ok', false, 'problem', 'player', 'words', 'This page could not join. Reload it and try again.');
  end if;
  h := sha256(convert_to(c, 'UTF8'));
  th := sha256(convert_to(coalesce(p_seat_token, ''), 'UTF8'));
  bucket := coalesce(who, 'unknown');
  -- 2. ONE lock for every count below, so a burst of joins cannot all read the same count and pass a limit together (joins queue for a moment; each is short)
  perform pg_advisory_xact_lock(hashtextextended('game_room_join', 0));
  -- 3. a seated player coming back with the right seat token to an open room with this code (knowing both, a guess learns nothing new)
  back := p_seat_token is not null and exists (
    select 1 from public.game_rooms r2 join public.game_room_players q on q.room_id = r2.id
     where r2.code_sha256 = h and r2.closed_at is null and ryagram_private.game_room_fresh(r2.last_beat_at)
       and q.player_id = p_player_id and q.removed_at is null and q.token_sha256 = th);
  -- 4. one caller (address known): 10 misses a minute. This holds a returning player too: it is their own limit.
  if who is not null and (select count(*) from public.game_room_misses m where m.caller = who and m.at > now() - interval '60 seconds') >= 10 then
    return jsonb_build_object('ok', false, 'problem', 'slow_down', 'words', 'Too many tries. Wait a minute and try again.');
  end if;
  -- 5. no readable address: ONE shared 'unknown' bucket, 30 misses a minute (never skipped; a returning seat is not held by it)
  if who is null and not back and (select count(*) from public.game_room_misses m where m.caller = 'unknown' and m.at > now() - interval '60 seconds') >= 30 then
    return jsonb_build_object('ok', false, 'problem', 'slow_down', 'words', 'Too many tries. Wait a minute and try again.');
  end if;
  -- 6. the guessing door, a backstop: 300 wrong codes in 60 seconds from everyone together (refusals here are not counted, so it reopens a minute after the 300th)
  if not back and (select count(*) from public.game_room_misses m where m.at > now() - interval '60 seconds') >= 300 then
    return jsonb_build_object('ok', false, 'problem', 'door', 'words', 'Too many wrong room codes were tried just now. Wait a minute and try again.');
  end if;
  -- 7. one player id: 5 tries, one more every 12 seconds; 8. one code: 20 tries, one more every 3 seconds (a returning seat skips the code's bucket)
  if not ryagram_private.game_take('pid:' || p_player_id, 5, 1.0 / 12) or (not back and not ryagram_private.game_take('code:' || encode(h, 'hex'), 20, 1.0 / 3)) then
    return jsonb_build_object('ok', false, 'problem', 'slow_down', 'words', 'Too many tries. Wait a minute and try again.');
  end if;
  -- 9. the room: open and beaten in the last 15 minutes (an idle room is closed here, on read)
  select * into r from public.game_rooms where code_sha256 = h and closed_at is null for update;
  if found then
    if ryagram_private.game_room_fresh(r.last_beat_at) then
      live := true;
    else
      update public.game_rooms set closed_at = now(), closed_reason = 'idle' where id = r.id;
    end if;
  end if;
  if not live then
    insert into public.game_room_misses (caller) values (bucket);
    return jsonb_build_object('ok', false, 'problem', 'wrong_code', 'words', 'No open room has that code. Check the letters on the host''s screen.');
  end if;
  -- 10. the host's word on this player id (a kick also voided its seat token)
  select * into p from public.game_room_players where room_id = r.id and player_id = p_player_id;
  if p.removed_at is not null then
    return jsonb_build_object('ok', false, 'problem', 'removed', 'words', 'The host removed you from this game.');
  end if;
  if p.player_id is not null then
    -- 11. already seated: may come back, even into a locked or full room, ONLY with its seat token (player ids are seen on the shared channel). A missing or wrong
    --     token is a miss and gets the wrong-code words. The seat keeps its name: a return never renames it.
    if p_seat_token is null or p.token_sha256 is null or p.token_sha256 <> th then
      insert into public.game_room_misses (caller) values (bucket);
      return jsonb_build_object('ok', false, 'problem', 'wrong_code', 'words', 'No open room has that code. Check the letters on the host''s screen.');
    end if;
    nm := p.name;
  else
    if exists (select 1 from public.game_room_players q where q.room_id = r.id and q.removed_at is null and lower(q.name) = lower(nm)) then
      return jsonb_build_object('ok', false, 'problem', 'name_taken', 'words', 'Someone in this room already uses that name. Pick another.');
    end if;
    if r.locked then
      return jsonb_build_object('ok', false, 'problem', 'locked', 'words', 'The room is locked. Ask the host to unlock it.');
    end if;
    select count(*) into n from public.game_room_players q where q.room_id = r.id and q.removed_at is null;
    if n >= r.seats then
      return jsonb_build_object('ok', false, 'problem', 'full', 'words',
                                format('Room is full. All %s seats are taken. Ask the host to remove someone, or wait for the next game.', r.seats));
    end if;
    -- 12. a first seat: a fresh seat token (two uuids, 244 random bits), kept only as its sha256 and given to the phone this once
    tok := encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex');
    insert into public.game_room_players (room_id, player_id, name, token_sha256) values (r.id, p_player_id, nm, sha256(convert_to(tok, 'UTF8')));
  end if;
  return jsonb_build_object('ok', true, 'channel', r.channel, 'host_key', r.host_key, 'seats', r.seats, 'name', nm, 'rejoined', p.player_id is not null,
                            'seated', (select count(*) from public.game_room_players q where q.room_id = r.id and q.removed_at is null))
         || case when tok is null then '{}'::jsonb else jsonb_build_object('seat_token', tok) end;
end $$;

revoke execute on function public.game_room_open(text), public.game_room_beat(uuid), public.game_room_lock(uuid, boolean), public.game_room_seats(uuid, int),
  public.game_room_kick(uuid, text), public.game_room_allow(uuid, text), public.game_room_close(uuid) from public, anon, service_role;
grant execute on function public.game_room_open(text), public.game_room_beat(uuid), public.game_room_lock(uuid, boolean), public.game_room_seats(uuid, int),
  public.game_room_kick(uuid, text), public.game_room_allow(uuid, text), public.game_room_close(uuid) to authenticated;
revoke execute on function public.game_room_join(text, text, text, text) from public, authenticated, service_role;
grant execute on function public.game_room_join(text, text, text, text) to anon;             -- the phone page makes its client with persistSession false, so it is always anon

select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)

commit;
