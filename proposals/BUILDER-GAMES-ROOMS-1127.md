# BUILDER: game rooms on the server (2026-11-27)

For Ryan's 11:42 launch order. GAMES leads the page, BUILDER owns the server, RENDERER reviews.
Branch builder-games-rooms-1127, based on main f6312e3c. NOT APPLIED. NOT RUN YET: only py_compile has been run. The SQL run is queued for BUILDER's single Postgres slot.
Files:
- supabase/migrations/20261127001000_game_rooms.sql
- supabase/rollbacks/20261127001000_game_rooms_rollback.sql
- supabase/live-steps/83_game_rooms_check.sql
- supabase/tests/test_game_rooms.py

Builds on FACES-GAMES-ROOM-SAFETY-1127.md: Remove with a confirm, Lock, Seats, New room code, the room locking itself at the start, rate limits before any expensive work, and a ban by player id.

## What the server does

**1. The host opens a room: `game_room_open(host_key)`.**
- Who can call it: a signed-in person in the app. Games must show as working in their own top bar, which means their 'games' switch is on (20261127000250) or step 82b has opened Games for everyone. The account must be active, never waiting, and never a worker.
- An administrator sees no departments, so an administrator is off here too. Walk it on a test account.
- Ryagram makes a 12-character code from 31 letters and digits that cannot be misread (no I, L, O, 0 or 1). That is about 59 bits. It is shown as XXXX-XXXX-XXXX.
- Ryagram keeps only the code's sha256, never the code itself.
- Ryagram also keeps a secret channel name (244 random bits: two uuids, each with 6 fixed bits) and the host's public key.
- One open room per host: opening a new room closes the old one. That is "New room code".
- At most 20 rooms per host per day.

**2. A phone joins: `game_room_join(code, player_id, name, seat_token)`.** (`seat_token` is optional: leave it out on a first join.)
- Phones are not signed in, so only the public key (anon) can call it.
- It always answers `{ok, problem, words}`. It never raises an error, so a wrong try is never rolled back and is always counted.
- The cheap checks run first, before the room is looked up:
  1. **Shape.** Bad letters, a bad player id or a bad name are refused in words. These are not counted as guesses.
  2. **One lock.** Every count below is taken under one transaction lock, so a burst of joins cannot all read the same count and slip past a limit together. Joins queue for a moment; each one is short.
  3. **One caller** (its address, HMAC'd with the house secret and kept one hour; an IPv6 address is cut to its /64, because one home or phone gets a whole /64; IPv4 is kept whole): 10 wrong codes a minute. This is checked first, so one caller's misses never hold anyone else.
  4. **No readable address.** All such requests share ONE 'unknown' bucket: 30 wrong codes a minute. A missing address is never a skipped check.
  5. **The guessing door, a backstop.** 300 wrong codes in any 60 seconds, from all callers together, close joining for everyone else. The right code is refused too while the door is closed, so a guess learns nothing. Refusals at the door are not counted, so it reopens a minute after the 300th miss.
  6. **One player id:** 5 tries, then one more every 12 seconds.
  7. **One code:** 20 tries, then one more every 3 seconds.
- **A seated player coming back with the right seat token** is held only by their own caller limit (3). The unknown bucket, the door and the code's bucket never stop them.
- Then the room checks run, in this order:
  1. Open, and beaten in the last 15 minutes.
  2. The player id was not removed.
  3. **A player id that is already seated** comes back (even into a locked or full room) only with the matching seat token. Player ids are seen on the shared channel, so the id alone proves nothing. A missing or wrong token is counted as a miss and gets the same words as a wrong code. A return never renames the seat.
  4. A new player: the name is not already taken in this room, the room is not locked, and a seat is free.
- On success the phone gets the channel name and the host's key. On a FIRST seat it also gets `seat_token`: 244 random bits, kept by Ryagram only as its sha256 and given out this once. A kick voids it. Allow again forgets the seat, so the old token is worth nothing after that.

**3. The host's controls.** Each refuses another host with "Only the host of this room can do that."
- `game_room_lock(room, on/off)`
- `game_room_seats(room, 2..12)`: 12 by default, never below the number already seated.
- `game_room_kick(room, player_id)`: frees the seat, voids its seat token and refuses that player id from then on.
- `game_room_allow(room, player_id)`: the undo for "Allow Ana again".
- `game_room_close(room)`
- `game_room_beat(room)`: tells Ryagram the host is still there, and returns the seated list. It shows no site-wide count of wrong tries.

**4. Idle rooms.** A room with no beat (or other host action) for 15 minutes is closed the next time anyone reads it. No cron job is needed. To a phone, an idle room answers like a wrong code. Every host call refuses an idle room too.
- The tidy-up (inside `game_room_open`) deletes rooms closed more than a day ago and rooms with no beat for a day. It never deletes an open room that is still beating, however long ago it opened.

**5. Tables.** All four have row security on, no policy and no grant to anon, signed-in people or the service role. Only the functions above can reach them.
- `public.game_rooms`
- `public.game_room_players`: first names, deleted a day after the room closes.
- `public.game_room_limits`: the token buckets, kept one hour.
- `public.game_room_misses`: the wrong tries, kept one hour.

No address or email is stored. Credits are not involved.

## What it cannot do, said plainly

- **A ban stops one player id, not one person.** Phones have no accounts. A new key, a cleared tab or a private window makes a new player id for free. What really works against a stranger who keeps coming back is Lock and New room code. The host's help line should say: "If someone keeps coming back, lock the room or start a new room code."
- **The guessing door can still be used against new joins.** It is now a backstop at 300 wrong codes a minute, and each caller is held at 10 first, so shutting it takes 30 or more addresses (or /64s) at once. Seated players with their tokens still get back in. The unknown bucket (30 a minute) can be filled by one stranger whose requests carry no address; that only stops other address-less new joins.
  - The trade-off: with 59-bit codes, 1,000 open rooms and 300 guesses a minute, a hit is still only about 1 in 5 million per year (1,000 rooms in 31^12 codes, 158 million guesses a year).
  - **FOR RYAN'S YES:** the numbers 10, 30 and 300.
- **The caller key depends on the address header.** Ryagram reads `cf-connecting-ip`, else the LAST `x-forwarded-for` hop. The FIRST hop is written by the client and could be forged, so it is never used. But on Supabase's PostgREST path, the last hop may be a proxy shared by every phone. If so, every phone gets the same key, the per-caller limit is useless, and the door carries the load. This cannot be checked from SQL: see the live checklist.
- **A kick takes the seat, not the channel.** The channel name is a shared secret: a removed phone still knows it until a New room code. The host's signed messages (FACES 1.4) stop it from playing. New room code is what shuts it out.
- **A leave does not free a seat on the server.** A phone that just closes its tab keeps its seat until the host removes it. Removing it is one tap.

## How the page must use it (GAMES)

**Host page**
1. Call `game_room_open(the host's public key)` and show the code it returns. Stop deriving the code from the key with the slow PBKDF2 codeOf.
   - Phones now get the host key from Ryagram over HTTPS. That closes RENDERER's 10:19 HIGH (the table attack on the 6-letter code).
2. Subscribe to the returned `channel`. Never use `ryagram-game-<CODE>` again.
3. Call `game_room_beat` every 60 seconds, and whenever a join message comes from a player id the host does not know yet. Seat only player ids that are in the returned `players` list. Ignore every other player id before any signature check.
4. Wire the buttons: Remove calls kick, Allow again calls allow, Lock calls lock, and the game start calls lock(true). Seats calls seats. New room code calls open again. Leaving the page calls close.

**Phone page**
1. Call `game_room_join` FIRST. Subscribe only after `ok:true`, to the `channel` it returns.
2. Pin `host_key` from the answer.
3. Show the `words` for any refusal. The `problem` codes are: code_letters, player, name, door, slow_down, wrong_code, removed, locked, full, name_taken.
4. Keep the client's `persistSession: false` (it is already set), so the phone stays anon. The join is granted to anon only.
5. Code input: accept lower case, spaces and dashes, 12 characters.
6. **The seat token.** A first `ok:true` answer carries `seat_token`. Keep it in page memory only, next to the player id: never in localStorage, a cookie, a URL, the channel, or any log or error report. Send it as `p_seat_token` on every rejoin (a dropped connection, a host's Lock). A reload loses it, so after a reload the page starts as a new player with a new player id. Never log it.

**Channel: the name is the secret.** Today the channel name must come only from Ryagram, after a successful join, and must never appear in a URL, a QR code, a log or the page source.
- Better, later: make it a private Realtime channel with a realtime.messages policy keyed on the topic of an open room.
- Not in this change, because the test database has no Realtime schema. **FOR RYAN'S YES** as a follow-up.

## Ryan's steps

1. Step 82 (the department switches) must already say PASS.
2. Run step 83: it should say STOP.
3. Paste the migration.
4. Run step 83 again: it must say PASS.
5. Push GAMES' page.
6. **Live checklist, after deploy:** two phones on different networks (for example one on home wifi and one on mobile data) must get DIFFERENT caller keys. Check it by having one phone type a wrong code 10 times: it must then get "Too many tries", while the other phone still joins with the right code. If both are held, every phone shares one key, the per-caller limit does nothing, and the shared limits carry the load: tell BUILDER before Games goes wide.

Undo: put the page back first, then paste the rollback.
