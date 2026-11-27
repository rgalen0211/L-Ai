"""GAME ROOMS, THE SERVER HALF (migrations/20261127001000_game_rooms.sql, NOT APPLIED) on a local Postgres with every migration. BUILDER 2026-11-27 (Ryan's 11:42 launch order).
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -B -m unittest supabase/tests/test_game_rooms.py -v

Must-fail style: each test names the fault it would catch.
  * a host is refused with the games switch off, as a WAITING account, and as a worker; opening gives a 12-letter code kept only as its sha256; one open room per host; 20 a day
  * a phone joins with the code (any case, spaces or dashes) and gets the channel and the host key; a wrong code is refused in words AND counted
  * limits per caller first, with real distinct caller keys (request.headers set the way PostgREST sets it, local to the statement): one caller may miss 10 and cannot
    shut joining for another; requests with no address share ONE 'unknown' bucket of 30; the door is a 300-a-minute backstop that a seated player with a seat token passes;
    one player id may try 5; one code may be tried 20 times; the caller key cuts IPv6 to its /64 and ignores a forged first x-forwarded-for entry
  * seat tokens: a first seat gets one (kept only as sha256); coming back (locked, full, or not) needs it; a wrong or missing token is a counted wrong code; a kick voids it;
    a return never renames the seat
  * seats (12 by default, the host may lower, never below the seated count), remove (and allow again), lock, another host cannot remove
  * a room with no beat for 15 minutes is closed when read, and every host call refuses it even before any join closed it; a beat keeps it open
  * the tidy-up in game_room_open deletes closed and long-idle rooms, never an open beating room
  * live step 83 says PASS after, STOP before and STOP on a planted grant; the rollback removes everything and the migration applies again
If 20261127000250 (the department switches, branch builder-dept-switches-1127) is not in this tree yet, it is read from git and applied to the template first.
"""
import json
import random
import re
import subprocess
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
THIRD = "66666666-6666-6666-6666-666666666666"
MIG = core.ROOT / "migrations" / "20261127001000_game_rooms.sql"
RB = core.ROOT / "rollbacks" / "20261127001000_game_rooms_rollback.sql"
STEP = core.ROOT / "live-steps" / "83_game_rooms_check.sql"
SWITCHES = "supabase/migrations/20261127000250_department_switches.sql"
SWITCHES_REF = "origin/builder-dept-switches-1127"
KEY = "hostkey-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
LETTERS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
WAITING_WORDS = "Your account is on the waiting list"
WRONG_WORDS = "No open room has that code. Check the letters on the host's screen."
# request.headers set LOCAL to the one statement, as PostgREST does per request; the materialized CTE runs first, so the function reads it
WITH_HEADERS = "with h as materialized (select set_config('request.headers', %s, true) as x) "


def headers(ip=None, xff=None):
    h = {}
    if ip is not None:
        h["cf-connecting-ip"] = ip
    if xff is not None:
        h["x-forwarded-for"] = xff
    return json.dumps(h)


def setUpModule():
    credits.setUpModule()
    with psycopg.connect(credits._server.get_uri(database="tmpl2b"), autocommit=True) as c:
        if c.execute("select to_regprocedure('ryagram_private.department_switch_on(uuid,text)')").fetchone()[0] is None:
            text = subprocess.run(["git", "-C", str(core.ROOT.parent), "show", SWITCHES_REF + ":" + SWITCHES],
                                  capture_output=True, check=True).stdout.decode("utf-8")
            c.execute(text)


def pid(n):
    return "phone%08d" % n


def wrong_code(rng):
    return "".join(rng.choice(LETTERS) for _ in range(12))


class GameRooms(unittest.TestCase):
    tearDown = credits.Ledger.tearDown
    admin = credits.Ledger.admin

    def setUp(self):
        credits.Ledger.setUp(self)
        self.rng = random.Random(1127)
        self.d().execute("insert into auth.users (id, email) values (%s, 'third@x')", (THIRD,))
        self.d().execute("insert into public.connect_access (user_id, enabled) values (%s, true), (%s, true)", (OTHER, THIRD))
        self.switches(OTHER, "games")
        self.switches(THIRD, "games")

    # -- helpers
    def d(self):
        return self.db.as_(None).c

    def switches(self, who, *names):
        self.d().execute("insert into public.account_settings (owner_id, switches_on) values (%s, %s) on conflict (owner_id) do update set switches_on = excluded.switches_on",
                         (who, list(names)))

    def host(self, who, sql, *args):
        return self.db.as_(who).one(sql, *args)

    def refused(self, who, words, sql, *args):
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(who).one(sql, *args)
        self.assertIn(words, str(cm.exception), sql)

    def open(self, who=OTHER):
        return self.host(who, "select public.game_room_open(%s)", KEY)

    def join(self, code, player, name="Ana", token=None, ip=None, xff=None):
        """ip/xff None: the request carries no address (the shared 'unknown' bucket)."""
        return self.db.as_("anon").one(WITH_HEADERS + "select public.game_room_join(%s, %s, %s, %s) from h", headers(ip, xff), code, player, name, token)

    def caller(self, ip=None, xff=None):
        return self.d().execute(WITH_HEADERS + "select ryagram_private.game_caller() from h", (headers(ip, xff),)).fetchone()[0]

    def misses(self):
        return self.admin("select count(*) from public.game_room_misses")

    def refill(self, player):
        self.d().execute("update public.game_room_limits set tokens = 5 where key = 'pid:' || %s", (player,))

    def step(self):
        return self.d().execute(STEP.read_text(encoding="utf-8")).fetchall()

    # -- the host
    def test_switch_off_is_refused_and_switching_off_mid_game_stops_the_host(self):
        self.switches(OTHER)
        self.refused(OTHER, "Games are not open for this account yet.", "select public.game_room_open(%s)", KEY)
        self.switches(OTHER, "games")
        room = self.open()
        self.switches(OTHER)
        self.refused(OTHER, "Games are not open for this account yet.", "select public.game_room_beat(%s)", room["room_id"])

    def test_a_waiting_account_is_refused(self):
        self.d().execute("update public.ops_settings set waiting_accounts = true")
        self.d().execute("insert into public.account_status (user_id, status, source) values (%s, 'waiting', 'signup') on conflict (user_id) do update set status = 'waiting'", (OTHER,))
        self.refused(OTHER, WAITING_WORDS, "select public.game_room_open(%s)", KEY)
        self.assertEqual(self.admin("select count(*) from public.game_rooms"), 0)

    def test_a_worker_is_refused_even_with_the_switch(self):
        self.switches(WORKER, "games")
        self.refused(WORKER, "The worker account can only run jobs.", "select public.game_room_open(%s)", KEY)   # refused before the room code runs, by the house guard

    def test_open_gives_a_long_code_kept_only_as_its_hash_one_room_per_host_and_twenty_a_day(self):
        room = self.open()
        self.assertRegex(room["code"], r"^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$")
        self.assertRegex(room["channel"], r"^ryagram-game-[0-9a-f]{64}$")
        code = room["code"].replace("-", "")
        self.assertTrue(self.admin("select code_sha256 = sha256(convert_to(%s, 'UTF8')) from public.game_rooms where id = %s", code, room["room_id"]))
        self.assertNotIn(code, self.admin("select r::text from public.game_rooms r where id = %s", room["room_id"]), "the code itself is never stored")
        self.assertEqual(self.admin("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'game_rooms' and column_name = 'code'"), 0)
        # typed in lower case with spaces: the same room, and the phone gets the channel and the host key from Ryagram
        got = self.join(" " + room["code"].lower().replace("-", " ") + " ", pid(1))
        self.assertEqual((got["ok"], got["channel"], got["host_key"], got["seated"]), (True, room["channel"], KEY, 1))
        # a new room (New room code) closes the old one: its code is now wrong
        second = self.open()
        self.assertNotEqual(second["code"], room["code"])
        self.assertEqual(self.admin("select closed_reason from public.game_rooms where id = %s", room["room_id"]), "new_code")
        self.assertEqual(self.join(room["code"], pid(2))["problem"], "wrong_code")
        self.assertEqual(self.admin("select count(*) from public.game_rooms where host_id = %s and closed_at is null", OTHER), 1)
        for _ in range(18):
            self.open()
        self.refused(OTHER, "You opened 20 game rooms today.", "select public.game_room_open(%s)", KEY)
        self.assertEqual(self.open(THIRD)["seats"], 12, "another host is not held by OTHER's count")

    def test_a_short_or_spaced_host_key_is_refused(self):
        self.refused(OTHER, "That host key is not valid.", "select public.game_room_open(%s)", "short")
        self.refused(OTHER, "That host key is not valid.", "select public.game_room_open(%s)", KEY + " x")

    # -- the phone
    def test_who_can_call_what(self):
        room = self.open()
        with self.assertRaises(psycopg.Error):
            self.host(OTHER, "select public.game_room_join(%s, %s, %s)", room["code"], pid(1), "Ana")      # a signed-in page is never the phone
        for sql in ("select public.game_room_open('" + KEY + "')", "select public.game_room_beat('%s')" % room["room_id"],
                    "select public.game_room_kick('%s', 'phone00000001')" % room["room_id"], "select public.game_room_lock('%s', true)" % room["room_id"]):
            with self.assertRaises(psycopg.Error):
                self.db.as_("anon").one(sql)
        for who in ("anon", OTHER):
            for t in ("game_rooms", "game_room_players", "game_room_limits", "game_room_misses"):
                with self.assertRaises(psycopg.Error):
                    self.db.as_(who).one("select count(*) from public." + t)
        open_helpers = self.admin("""select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'ryagram_private'
                                     and (p.proname like 'game%%' or p.proname = 'games_on')
                                     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))""")
        self.assertEqual(open_helpers, 0)

    def test_a_wrong_code_is_refused_in_words_and_counted_and_bad_letters_are_not_a_guess(self):
        self.open()
        got = self.join(wrong_code(self.rng), pid(1))
        self.assertEqual((got["ok"], got["problem"]), (False, "wrong_code"))
        self.assertIn("No open room has that code", got["words"])
        self.assertEqual(self.misses(), 1, "every wrong code is counted")
        got = self.join("ABCDEFGHIJKL", pid(2))
        self.assertEqual((got["problem"], self.misses()), ("code_letters", 1), "I, L, O, 0 and 1 are never in a code: said in words, not counted")
        self.assertEqual(self.join("ABC", pid(2))["problem"], "code_letters")
        self.assertEqual(self.join(wrong_code(self.rng), "x")["problem"], "player")
        for name, words in (("", "Type a name to join."), ("A" * 17, "Use 16 letters or fewer."), ("An\u200ba", "hidden characters"), ("a" + chr(64) + "b.com", "web addresses")):
            got = self.join(wrong_code(self.rng), pid(3), name)
            self.assertEqual(got["problem"], "name")
            self.assertIn(words, got["words"])
        self.assertEqual(self.misses(), 1, "shape refusals are never counted")

    def test_the_guessing_door_is_a_300_a_minute_backstop_that_a_seated_token_passes(self):
        room = self.open()
        seat = self.join(room["code"], pid(1), "Ana", ip="198.51.100.1")
        bare = self.join(room["code"], pid(2), "Bo")                                    # seated with no address: its caller is 'unknown'
        for k in range(30):                                                             # 30 callers, 10 misses each: no caller hits its own limit early
            for j in range(10):
                got = self.join(wrong_code(self.rng), pid(1000 + 10 * k + j), ip="203.0.113.%d" % (k + 1))
                self.assertEqual(got["problem"], "wrong_code", (k, j))
        self.assertEqual(self.misses(), 300)
        got = self.join(room["code"], pid(3), "Cy", ip="192.0.2.77")
        self.assertEqual((got["ok"], got["problem"]), (False, "door"), "a fresh caller with the RIGHT code is refused while the door is shut: a guess learns nothing")
        self.assertEqual(self.join(room["code"], pid(4), "Di")["problem"], "door", "no address and no seat: the door holds it too")
        got = self.join(room["code"], pid(1), "Ana", token=seat["seat_token"], ip="198.51.100.1")
        self.assertEqual((got["ok"], got["rejoined"]), (True, True), "a seated player with its seat token is never stopped by the door")
        got = self.join(room["code"], pid(2), "Bo", token=bare["seat_token"])
        self.assertEqual((got["ok"], got["rejoined"]), (True, True), "nor with no address")
        got = self.join(room["code"], pid(1), "Ana", token=seat["seat_token"], ip="203.0.113.1")
        self.assertEqual(got["problem"], "slow_down", "but its own caller limit still holds it (this caller missed 10)")
        self.assertEqual(self.misses(), 300, "refusals at the door are not counted, so it reopens a minute after the 300th")
        self.d().execute("update public.game_room_misses set at = at - interval '61 seconds'")
        self.assertTrue(self.join(room["code"], pid(3), "Cy", ip="192.0.2.77")["ok"])

    def test_one_caller_may_miss_ten_times_and_cannot_shut_joining_for_another(self):
        room = self.open()
        for i in range(10):
            self.assertEqual(self.join(wrong_code(self.rng), pid(200 + i), ip="203.0.113.9")["problem"], "wrong_code")
        self.assertEqual(self.join(room["code"], pid(1), ip="203.0.113.9")["problem"], "slow_down", "caller A is held, even with the right code")
        got = self.join(room["code"], pid(1), ip="198.51.100.7")
        self.assertEqual((got["ok"], got["seated"]), (True, 1), "caller B with a valid code still joins: A cannot close the door for B")
        self.assertTrue(self.join(room["code"], pid(2), "Bo")["ok"], "nor for the unknown bucket")
        self.assertEqual(self.admin("select count(distinct caller) from public.game_room_misses"), 1)
        self.assertEqual(self.admin("select count(*) from public.game_room_misses where caller like '%%203.0.113%%' or caller = 'unknown'"), 0,
                         "no address is stored: the key is an HMAC")

    def test_the_caller_key_is_an_hmac_of_the_address_ipv6_cut_to_its_64_and_never_the_forged_first_hop(self):
        a = self.caller(ip="203.0.113.9")
        self.assertRegex(a, r"^[0-9a-f]{64}$")
        self.assertNotEqual(a, self.caller(ip="203.0.113.10"), "IPv4 is kept whole")
        self.assertEqual(self.caller(xff="198.51.100.66, 203.0.113.9"), a, "x-forwarded-for: the LAST hop")
        self.assertEqual(self.caller(xff="192.0.2.1, 203.0.113.9"), a, "a forged first entry changes nothing")
        self.assertEqual(self.caller(ip="203.0.113.9", xff="192.0.2.1"), a, "cf-connecting-ip comes first")
        v6 = self.caller(ip="2001:db8:1:2::5")
        self.assertEqual(self.caller(ip="2001:db8:1:2:ffff:1:2:3"), v6, "one /64 is one caller")
        self.assertNotEqual(self.caller(ip="2001:db8:1:3::5"), v6, "another /64 is another caller")
        self.assertIsNone(self.caller(), "no address: null, and join scores it in the 'unknown' bucket")
        self.assertIsNone(self.caller(ip="not-an-address"))

    def test_requests_with_no_address_share_one_unknown_bucket_of_thirty(self):
        room = self.open()
        seat = self.join(room["code"], pid(1), "Ana")
        for i in range(30):
            self.assertEqual(self.join(wrong_code(self.rng), pid(300 + i))["problem"], "wrong_code", i)
        self.assertEqual(self.admin("select count(*) from public.game_room_misses where caller = 'unknown'"), 30, "a missing address is never a skipped check")
        self.assertEqual(self.join(room["code"], pid(2), "Bo")["problem"], "slow_down", "the 31st from the unknown bucket is held, even with the right code")
        self.assertEqual(self.misses(), 30)
        self.assertTrue(self.join(room["code"], pid(2), "Bo", ip="198.51.100.7")["ok"], "a caller with an address is not held by the unknown bucket")
        got = self.join(room["code"], pid(1), "Ana", token=seat["seat_token"])
        self.assertEqual((got["ok"], got["rejoined"]), (True, True), "a seated player with its token is never held by the unknown bucket")
        self.d().execute("update public.game_room_misses set at = at - interval '61 seconds'")
        self.assertTrue(self.join(room["code"], pid(3), "Cy")["ok"])

    def test_one_code_may_be_tried_twenty_times_a_minute(self):
        self.open()
        w = wrong_code(self.rng)
        for i in range(20):                                                             # 4 callers x 5, each its own player id: only the code's bucket is spent
            self.assertEqual(self.join(w, pid(400 + i), ip="203.0.113.%d" % (i // 5 + 1))["problem"], "wrong_code", i)
        self.assertEqual(self.join(w, pid(499), ip="192.0.2.50")["problem"], "slow_down", "the 21st try of one code, from a fresh caller and player id")
        self.assertEqual(self.misses(), 20, "held before the room is looked up, so not counted")
        self.d().execute("update public.game_room_limits set at = at - interval '4 seconds' where key = 'code:' || encode(sha256(convert_to(%s, 'UTF8')), 'hex')", (w,))
        self.assertEqual(self.join(w, pid(498), ip="192.0.2.51")["problem"], "wrong_code", "one more every 3 seconds")

    def test_one_player_id_may_try_five_times(self):
        room = self.open()
        for _ in range(5):
            self.assertEqual(self.join(wrong_code(self.rng), pid(7))["problem"], "wrong_code")
        self.assertEqual(self.join(room["code"], pid(7))["problem"], "slow_down", "checked before the room is looked up")
        self.d().execute("update public.game_room_limits set at = at - interval '13 seconds' where key = 'pid:' || %s", (pid(7),))
        self.assertTrue(self.join(room["code"], pid(7))["ok"])

    def test_names_and_rejoin(self):
        room = self.open()
        first = self.join(room["code"], pid(1), "Ana")
        self.assertTrue(first["ok"])
        got = self.join(room["code"], pid(2), "ANA")
        self.assertEqual(got["problem"], "name_taken")
        got = self.join(room["code"], pid(1), "Ana B", token=first["seat_token"])
        self.assertEqual((got["ok"], got["rejoined"], got["seated"], got["name"]), (True, True, 1, "Ana"), "a return never renames the seat")
        self.assertNotIn("seat_token", got, "the token is given once, on the first seat")

    def test_a_seat_comes_back_only_with_its_token_and_a_kick_voids_it(self):
        room = self.open()
        first = self.join(room["code"], pid(1), "Ana")
        tok = first["seat_token"]
        self.assertRegex(tok, r"^[0-9a-f]{64}$")
        self.assertTrue(self.admin("select token_sha256 = sha256(convert_to(%s, 'UTF8')) from public.game_room_players where player_id = %s", tok, pid(1)))
        self.assertNotIn(tok, self.admin("select string_agg(p::text, ' ') from public.game_room_players p"), "the token itself is never stored")
        self.assertNotEqual(self.join(room["code"], pid(2), "Bo")["seat_token"], tok)
        self.host(OTHER, "select public.game_room_lock(%s, true)", room["room_id"])
        self.assertEqual(self.join(room["code"], pid(3), "Cy")["problem"], "locked")
        before = self.misses()
        for token in (None, "0" * 64, tok[:-1] + ("1" if tok[-1] == "0" else "0")):
            got = self.join(room["code"], pid(1), "Mallory", token=token)
            self.assertEqual((got["ok"], got["problem"], got["words"]), (False, "wrong_code", WRONG_WORDS), token)
        self.assertEqual(self.misses(), before + 3, "a missing or wrong seat token is a counted miss with the wrong-code words")
        self.refill(pid(1))
        got = self.join(room["code"], pid(1), "Mallory", token=tok)
        self.assertEqual((got["ok"], got["rejoined"], got["name"]), (True, True, "Ana"), "the right token comes back into a locked room, name kept")
        self.assertEqual(self.admin("select name from public.game_room_players where player_id = %s", pid(1)), "Ana")
        self.host(OTHER, "select public.game_room_lock(%s, false)", room["room_id"])
        self.assertEqual(self.join(room["code"], pid(1), "Eve")["problem"], "wrong_code", "an open room too: a seated player id without its token is refused")
        self.host(OTHER, "select public.game_room_kick(%s, %s)", room["room_id"], pid(1))
        self.assertIsNone(self.admin("select token_sha256 from public.game_room_players where player_id = %s", pid(1)), "a kick voids the token")
        self.refill(pid(1))
        self.assertEqual(self.join(room["code"], pid(1), "Ana", token=tok)["problem"], "removed")
        self.host(OTHER, "select public.game_room_lock(%s, true)", room["room_id"])
        self.host(OTHER, "select public.game_room_allow(%s, %s)", room["room_id"], pid(1))
        self.assertEqual(self.join(room["code"], pid(1), "Ana", token=tok)["problem"], "locked", "after Allow again the old token is no seat: a locked room keeps it out")

    # -- the host's controls
    def test_twelve_seats_by_default_and_the_host_may_lower_them(self):
        room = self.open()
        tokens = {}
        for i in range(12):
            got = self.join(room["code"], pid(i), "P%d" % i)
            self.assertTrue(got["ok"], i)
            tokens[i] = got["seat_token"]
        got = self.join(room["code"], pid(99), "Late")
        self.assertEqual(got["problem"], "full")
        self.assertIn("All 12 seats are taken", got["words"])
        self.assertEqual(self.join(room["code"], pid(3), "P3")["problem"], "wrong_code", "a known player id without its token does not pass Full")
        self.assertTrue(self.join(room["code"], pid(3), "P3", token=tokens[3])["ok"], "a seated player with its token comes back into a full room")
        self.refused(OTHER, "12 players are already in.", "select public.game_room_seats(%s, 3)", room["room_id"])
        small = self.open()
        self.refused(OTHER, "A room has 2 to 12 seats.", "select public.game_room_seats(%s, 13)", small["room_id"])
        self.assertEqual(self.host(OTHER, "select public.game_room_seats(%s, 3)", small["room_id"])["seats"], 3)
        for i in range(3):
            self.assertTrue(self.join(small["code"], pid(50 + i), "Q%d" % i)["ok"])
        self.assertEqual(self.join(small["code"], pid(60), "Late")["problem"], "full")

    def test_remove_refuses_that_player_frees_the_seat_and_allow_undoes_it(self):
        room = self.open()
        self.join(room["code"], pid(1), "Ana")
        self.join(room["code"], pid(2), "Bo")
        roster = self.host(OTHER, "select public.game_room_kick(%s, %s)", room["room_id"], pid(1))
        self.assertEqual([p["player_id"] for p in roster["players"]], [pid(2)])
        self.assertEqual([p["player_id"] for p in roster["removed"]], [pid(1)])
        got = self.join(room["code"], pid(1), "Ana")
        self.assertEqual((got["ok"], got["problem"], got["words"]), (False, "removed", "The host removed you from this game."))
        self.host(OTHER, "select public.game_room_seats(%s, 2)", room["room_id"])
        self.assertTrue(self.join(room["code"], pid(3), "Cy")["ok"], "the removed player's seat is free")
        self.refused(OTHER, "That player is not in this room.", "select public.game_room_kick(%s, %s)", room["room_id"], pid(9))
        self.host(OTHER, "select public.game_room_seats(%s, 3)", room["room_id"])
        self.host(OTHER, "select public.game_room_allow(%s, %s)", room["room_id"], pid(1))
        self.assertTrue(self.join(room["code"], pid(1), "Ana")["ok"], "allowed again")

    def test_another_host_cannot_remove_lock_or_beat(self):
        room = self.open()
        self.join(room["code"], pid(1), "Ana")
        self.open(THIRD)
        for sql in ("select public.game_room_kick(%s, 'phone00000001')", "select public.game_room_lock(%s, true)", "select public.game_room_beat(%s)",
                    "select public.game_room_seats(%s, 2)", "select public.game_room_close(%s)"):
            self.refused(THIRD, "Only the host of this room can do that.", sql, room["room_id"])
        self.assertEqual(self.admin("select count(*) from public.game_room_players where removed_at is null"), 1)

    def test_lock_keeps_newcomers_out_and_lets_seated_players_back(self):
        room = self.open()
        tok = self.join(room["code"], pid(1), "Ana")["seat_token"]
        roster = self.host(OTHER, "select public.game_room_lock(%s, true)", room["room_id"])
        self.assertTrue(roster["locked"])
        self.assertNotIn("wrong_tries_last_minute", roster, "the host's answers show no site-wide wrong-try count")
        got = self.join(room["code"], pid(2), "Bo")
        self.assertEqual((got["problem"], got["words"]), ("locked", "The room is locked. Ask the host to unlock it."))
        self.assertEqual(self.join(room["code"], pid(1), "Ana")["problem"], "wrong_code", "a player id seen on the channel does not pass Lock")
        self.assertTrue(self.join(room["code"], pid(1), "Ana", token=tok)["rejoined"])
        self.host(OTHER, "select public.game_room_lock(%s, false)", room["room_id"])
        self.assertTrue(self.join(room["code"], pid(2), "Bo")["ok"])

    def test_no_beat_for_fifteen_minutes_closes_the_room_on_read(self):
        room = self.open()
        self.join(room["code"], pid(1), "Ana")
        self.d().execute("update public.game_rooms set last_beat_at = now() - interval '14 minutes'")
        roster = self.host(OTHER, "select public.game_room_beat(%s)", room["room_id"])
        self.assertEqual([p["name"] for p in roster["players"]], ["Ana"])
        self.assertTrue(self.admin("select last_beat_at > now() - interval '1 minute' from public.game_rooms where id = %s", room["room_id"]), "a beat keeps it open")
        self.d().execute("update public.game_rooms set last_beat_at = now() - interval '16 minutes'")
        self.assertEqual(self.join(room["code"], pid(2), "Bo")["problem"], "wrong_code", "an idle room answers like a wrong code")
        self.assertEqual(self.admin("select closed_reason from public.game_rooms where id = %s", room["room_id"]), "idle", "closed on read, no cron")
        self.refused(OTHER, "This room is closed. Open a new room.", "select public.game_room_beat(%s)", room["room_id"])
        self.assertTrue(self.join(self.open()["code"], pid(2), "Bo")["ok"], "a new room works")

    def test_every_host_call_refuses_an_idle_room_before_any_join_closed_it(self):
        room = self.open()
        self.d().execute("update public.game_rooms set last_beat_at = now() - interval '16 minutes'")
        for sql in ("select public.game_room_beat(%s)", "select public.game_room_lock(%s, true)", "select public.game_room_seats(%s, 2)",
                    "select public.game_room_kick(%s, 'phone00000001')", "select public.game_room_allow(%s, 'phone00000001')", "select public.game_room_close(%s)"):
            self.refused(OTHER, "This room is closed. Open a new room.", sql, room["room_id"])
        self.assertIsNone(self.admin("select closed_at from public.game_rooms where id = %s", room["room_id"]), "no join ran: the freshness check itself refused")
        self.assertEqual(self.admin("select (last_beat_at < now() - interval '15 minutes') from public.game_rooms where id = %s", room["room_id"]), True,
                         "and a refused beat did not revive it")

    def test_the_tidy_up_spares_an_open_beating_room(self):
        old = self.open()
        live = self.open()                                                              # closes old (new_code)
        self.d().execute("update public.game_rooms set closed_at = now() - interval '2 days' where id = %s", (old["room_id"],))
        self.d().execute("update public.game_rooms set opened_at = now() - interval '3 days' where id = %s", (live["room_id"],))   # long open, still beating
        idle = self.open(THIRD)
        self.d().execute("update public.game_rooms set opened_at = now() - interval '2 days', last_beat_at = now() - interval '2 days' where id = %s", (idle["room_id"],))
        self.open(THIRD)                                                                # the tidy-up runs here
        left = {r[0] for r in self.d().execute("select id::text from public.game_rooms").fetchall()}
        self.assertIn(live["room_id"], left, "an open room that is still beating is never deleted, however old")
        self.assertNotIn(old["room_id"], left, "closed a day ago: gone")
        self.assertNotIn(idle["room_id"], left, "no beat for a day: gone")
        self.assertTrue(self.join(live["code"], pid(1), "Ana")["ok"])

    def test_close_by_the_host(self):
        room = self.open()
        self.host(OTHER, "select public.game_room_close(%s)", room["room_id"])
        self.assertEqual(self.join(room["code"], pid(1))["problem"], "wrong_code")

    # -- the live step and the undo
    def test_step_83_pass_after_stop_on_a_planted_grant_and_the_rollback_restores(self):
        rows = self.step()
        self.assertTrue(rows[0][1].startswith("PASS") and all(r[2] for r in rows), rows)
        self.d().execute("grant select on public.game_rooms to anon")
        rows = self.step()
        self.assertTrue(rows[0][1].startswith("STOP") and rows[1][2] is False, rows)
        self.d().execute("revoke select on public.game_rooms from anon")
        self.d().execute("grant execute on function ryagram_private.game_take(text, double precision, double precision) to authenticated")
        self.assertFalse(dict((r[0], r[2]) for r in self.step())[6], "a game helper anyone can run is seen")
        self.d().execute("revoke execute on function ryagram_private.game_take(text, double precision, double precision) from authenticated")
        self.assertTrue(self.step()[0][2])
        room = self.open()
        self.join(room["code"], pid(1), "Ana")
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.step()
        self.assertEqual([r[2] for r in rows], [False] * 9 + [True], rows)
        self.assertIsNone(self.admin("select to_regclass('public.game_rooms')"))
        self.assertEqual(self.admin("select count(*) from pg_proc where proname like 'game\\_room%%' or proname in ('games_on', 'game_take', 'game_caller', 'game_new_code', 'game_code_norm', 'game_roster', 'game_host_room')"), 0)
        self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertTrue(self.step()[0][1].startswith("PASS"), "forward again")
        self.assertTrue(self.join(self.open()["code"], pid(1), "Ana")["ok"])

    def test_the_step_file_is_one_statement_with_no_semicolon_in_a_string_and_no_address(self):
        t = STEP.read_text(encoding="utf-8")
        code = "\n".join(line for line in t.splitlines() if not line.lstrip().startswith("--"))
        self.assertEqual(code.strip().count(";"), 1)
        self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", code))
        self.assertNotIn(chr(64), t)
        self.assertTrue(MIG.read_text(encoding="utf-8").rstrip().endswith("commit;"))
        self.assertIn("select ryagram_private.gate_apply();", MIG.read_text(encoding="utf-8"))
        self.assertIn("select ryagram_private.gate_apply();", RB.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
