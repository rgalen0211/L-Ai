"""SIGN-UP: THE DAY'S SIZE COUNTS OPENED EMAILS (migrations/20261126000100_join_day_by_opened.sql) on a local Postgres. BUILDER 2026-11-26, building
CONNECT's 11-25 09:11 design (GAMES 11-25 09:04 MEDIUM-HIGH; CC1 09:05: branch only, after launch).

Run from the repo root with TEMP/TMP on D: (kill any pgserver it leaves by PID):
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_join_day_by_opened.py -v

  * FLOOD: one visitor typing made-up addresses (never opened) no longer fills the day: with a size of 3, ten asks from ten networks do not turn
    a real stranger away until the ASK ceiling (2 x the size = 6 by default) is reached; must-fail with the old block (every ask counts) back
  * OPENED: an address counts toward the day's size once its email is opened (auth.users.email_confirmed_at set, or the account made confirmed)
  * an address that already asked today still passes on a full day, even at a size of 0
  * the ask ceiling is ops_settings.join_asks_max (empty = 2 x the size), 0 and the size 0 still shut sign-up
  * the trigger never stops a sign-in, even when its own write fails; it fires only at the moment of opening; nobody can call its function
  * everything else in join_reserve is byte for byte 20261121000800's: the per-network and per-address limits keep their own words
  * only the two short edits change join_reserve (the rest is byte for byte 20261121000800's, so its mutants still reach their suite); the
    guard refuses a join_reserve whose size piece was changed by hand and changes nothing; the rollback puts the exact 20261121000800 text back
  MUST-FAIL: the old size block planted back; the trigger dropped.
"""
import hashlib
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
MIG = core.ROOT / "migrations" / "20261126000100_join_day_by_opened.sql"
RB = core.ROOT / "rollbacks" / "20261126000100_join_day_by_opened_rollback.sql"
OPEN000800 = core.ROOT / "migrations" / "20261121000800_join_open.sql"
FULL = {"ok": False, "reason": "full"}
OK = {"ok": True}


def body_000800():
    t = OPEN000800.read_text(encoding="utf-8").replace("\r\n", "\n")
    i = t.index("create or replace function public.join_reserve")
    a = t.index("$$", i) + 2
    return t[a:t.index("$$", a)]


class JoinByOpened(core.Base):
    def setUp(self):
        super().setUp()
        self.d().execute("update public.ops_settings set join_open = true, waiting_accounts = false")

    def d(self):
        return self.db.as_(None).c

    def size(self, n, asks=None):
        self.d().execute("update public.ops_settings set join_daily_max = %s, join_asks_max = %s", (n, asks))

    def join(self, mail, ip):
        return self.db.as_("service").one("select public.join_reserve(%s, %s)", mail, ip)

    def opened(self, mail):
        self.d().execute("insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), %s, now())", (mail,))

    def body(self):
        return self.d().execute("select prosrc from pg_proc where oid = to_regprocedure('public.join_reserve(text, text)')").fetchone()[0]

    # ---------------------------------------------------------------- scenarios (each also runs on a planted fault)
    def scenario_a_flood_of_unopened_addresses_does_not_fill_the_day(self):
        self.size(3)                                                         # ask ceiling: empty = 2 x 3 = 6
        for i in range(5):
            self.assertEqual(self.join(f"fake{i}@nowhere.example", f"net{i}"), OK, f"made-up address {i}")
        self.assertEqual(self.join("real@example.com", "home"), OK, "a real stranger still gets in: nobody has opened an email, the day is not full")

    def scenario_opened_addresses_fill_the_day(self):
        self.size(2)
        for m, ip in (("a@example.com", "ip1"), ("b@example.com", "ip2")):
            self.assertEqual(self.join(m, ip), OK)
            self.opened(m)
        self.assertEqual(self.join("c@example.com", "ip3"), FULL, "two people opened their email: a size of 2 is full")

    # ---------------------------------------------------------------- tests
    def test_a_flood_of_unopened_addresses_does_not_fill_the_day(self):
        self.scenario_a_flood_of_unopened_addresses_does_not_fill_the_day()

    def test_the_ask_ceiling_still_caps_made_up_addresses_and_protects_the_email_budget(self):
        self.size(3)                                                         # 2 x 3 = 6 asks
        for i in range(6):
            self.assertEqual(self.join(f"fake{i}@nowhere.example", f"net{i}"), OK)
        self.assertEqual(self.join("x@nowhere.example", "net9"), FULL, "the 7th different address asked for: the ask ceiling (6)")
        self.assertEqual(self.join("fake0@nowhere.example", "net10"), OK, "an address that already asked today still passes")
        self.size(3, 10)
        self.assertEqual(self.join("x@nowhere.example", "net11"), OK, "join_asks_max raises the ceiling")
        self.size(3, 0)
        self.assertEqual(self.join("y@nowhere.example", "net12"), FULL, "an ask ceiling of 0 shuts NEW addresses")

    def test_opened_addresses_fill_the_day(self):
        self.scenario_opened_addresses_fill_the_day()

    def test_an_address_that_holds_a_place_still_passes_on_a_full_day(self):
        self.scenario_opened_addresses_fill_the_day()
        self.assertEqual(self.join("a@example.com", "ip7"), OK, "a asked today and opened: it holds its place, it is not a new one")
        self.size(0)
        self.assertEqual(self.join("b@example.com", "ip8"), OK, "a held place passes even at 0 (0 turns away NEW people, as before)")
        self.assertEqual(self.join("new@example.com", "ip9"), FULL, "a size of 0 still shuts sign-up for NEW people")

    def test_the_trigger_records_the_moment_of_opening_only(self):
        self.size(10)
        self.assertEqual(self.join("late@example.com", "ip1"), OK)
        uid = self.d().execute("insert into auth.users (id, email) values (gen_random_uuid(), 'late@example.com') returning id").fetchone()[0]
        self.assertIsNone(self.d().execute("select confirmed_at from public.join_attempts").fetchone()[0], "not opened yet")
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (uid,))
        first = self.d().execute("select confirmed_at from public.join_attempts").fetchone()[0]
        self.assertIsNotNone(first, "opened: recorded")
        self.d().execute("update auth.users set email_confirmed_at = now() + interval '1 minute' where id = %s", (uid,))
        self.assertEqual(self.d().execute("select confirmed_at from public.join_attempts").fetchone()[0], first, "a later change is not a new opening")
        self.assertEqual(self.join("OTHER@Example.com ", "ip2"), OK)
        self.opened("other@example.com")
        self.assertEqual(self.d().execute("select count(*) from public.join_attempts where confirmed_at is not null").fetchone()[0], 2,
                         "the address is matched as join_reserve hashes it (lower case, trimmed)")

    def test_the_trigger_never_stops_a_sign_in(self):
        self.d().execute("alter table public.join_attempts rename column confirmed_at to confirmed_at_gone")   # its own write now fails
        self.d().execute("insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'safe@example.com', now())")
        self.assertEqual(self.d().execute("select count(*) from auth.users where email = 'safe@example.com'").fetchone()[0], 1, "the sign-in row is made")

    def test_the_other_limits_keep_their_own_words(self):
        self.size(100)
        for _ in range(3):
            self.assertEqual(self.join("same@example.com", "ipS"), OK)
        self.assertEqual(self.join("same@example.com", "ipT"), {"ok": False, "reason": "throttled"}, "3 a day for one address")
        for i in range(2):
            self.assertEqual(self.join(f"n{i}@example.com", "ipS"), OK)
        self.assertEqual(self.join("n9@example.com", "ipS"), {"ok": False, "reason": "throttled"}, "5 an hour from one network")
        self.assertEqual(self.join("bad", "ipZ"), {"ok": False, "reason": "email"})
        self.d().execute("update public.ops_settings set join_open = false")
        self.assertEqual(self.join("off@example.com", "ipO"), {"ok": False, "reason": "off"})

    def test_only_the_two_edits_changed(self):
        old, new = body_000800(), self.body().replace("\r", "")
        p1_old = "from public.join_attempts where at > now() - interval '1 day')"
        p1_new = "from public.join_attempts where at > now() - interval '1 day' and confirmed_at is not null)"
        anchor = "  if (select count(*) from public.join_attempts where ip_hash = left("
        self.assertEqual(new.count(p1_new), 1)
        start = new.index("  -- the ceiling on ASKS")
        asks = new[start:new.index(anchor)]
        self.assertEqual(new.replace(asks, "", 1).replace(p1_new, p1_old, 1), old, "everything else is 20261121000800's text, byte for byte")
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.d().execute("select has_function_privilege(%s, 'ryagram_private.join_attempt_confirmed()', 'execute')", (role,)).fetchone()[0], role)
        self.assertTrue(self.d().execute("select has_function_privilege('service_role', 'public.join_reserve(text, text)', 'execute')").fetchone()[0])
        self.assertFalse(self.d().execute("select has_function_privilege('authenticated', 'public.join_reserve(text, text)', 'execute')").fetchone()[0])

    def test_a_hand_changed_join_reserve_is_refused_and_nothing_changes(self):
        self.d().execute(RB.read_text(encoding="utf-8"))
        drifted = self.d().execute("select replace(pg_get_functiondef(to_regprocedure('public.join_reserve(text, text)')), %s, %s)",
                                   ("where at > now() - interval '1 day')", "where at > now() - interval '2 days')")).fetchone()[0]
        self.d().execute(drifted)
        before = self.body()
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertIn("is not the one this change expects", str(cm.exception))
        self.db.c.execute("rollback")
        self.assertEqual(self.body(), before, "nothing was changed")
        self.assertEqual(self.d().execute("select count(*) from information_schema.columns where table_name = 'join_attempts' and column_name = 'confirmed_at'").fetchone()[0], 0)

    def test_rollback_is_exact_and_forward_again(self):
        self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertEqual(hashlib.md5(self.body().replace("\r", "").encode()).hexdigest(), hashlib.md5(body_000800().encode()).hexdigest(), "join_reserve is 20261121000800's text again")
        for t, c in (("join_attempts", "confirmed_at"), ("ops_settings", "join_asks_max")):
            self.assertEqual(self.d().execute("select count(*) from information_schema.columns where table_name = %s and column_name = %s", (t, c)).fetchone()[0], 0, c)
        self.assertIsNone(self.d().execute("select to_regprocedure('ryagram_private.join_attempt_confirmed()')").fetchone()[0])
        self.assertEqual(self.d().execute("select count(*) from pg_trigger where tgname = 'join_attempt_confirmed_trg'").fetchone()[0], 0)
        self.d().execute(MIG.read_text(encoding="utf-8"))
        self.scenario_opened_addresses_fill_the_day()

    # ---------------------------------------------------------------- MUST-FAIL
    def must_fail(self, plant, scenario):
        self.d().execute(plant)
        with self.assertRaises(AssertionError):
            scenario()

    def test_must_fail_with_every_ask_counted_again(self):
        old_block_body = body_000800()
        self.must_fail(f"create or replace function public.join_reserve(p_email text, p_ip_hash text) returns jsonb language plpgsql security definer set search_path = '' as $p${old_block_body}$p$",
                       self.scenario_a_flood_of_unopened_addresses_does_not_fill_the_day)

    def test_must_fail_without_the_trigger(self):
        self.must_fail("drop trigger join_attempt_confirmed_trg on auth.users", self.scenario_opened_addresses_fill_the_day)


if __name__ == "__main__":
    unittest.main()
