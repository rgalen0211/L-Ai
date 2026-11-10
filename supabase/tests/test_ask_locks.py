"""ASK LOCKS (migrations/20261109000300_ask_locks.sql) on a local Postgres, with every migration in place.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_ask_locks.py -v

What this proves (WORKER's finding 2026-11-09, CC1's order): the three place-question ask functions (connect_geo_ask, connect_geo_ask_shape, connect_forecast_ask) share ONE pair of limits (5 open, 100 a day) in
public.geo_requests. Two asks in flight together used to both pass them. Now they take turns: the second ask waits for the first, then counts it. Every race here runs on TWO REAL CONNECTIONS, with the first ask held
open (not yet committed) until the second is seen waiting on the person's lock, so the overlap is real and not a guess. And: another person is never held; the same question asked twice at once is one request; the three
functions really do share the one lock (a race ACROSS two of them is held too); grants and settings survive; the migration is safe to run twice; the rollback takes the lock out and puts it back.
"""
import json
import sys
import threading
import time
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_geo_requests as G  # noqa: E402

setUpModule = core.setUpModule
ROOT = core.ROOT
ALICE, BOB = G.ALICE, G.BOB
SERIES = [[2015, 100], [2016, 102], [2017, 104], [2018, 105], [2019, 108], [2020, 109], [2021, 112], [2022, 114]]
GEO = "select connect_geo_ask(%s, %s, %s, %s, %s)"
SHAPE = "select connect_geo_ask_shape(%s, 'verdict', %s, %s, null, null, 'chicken', null)"
FORECAST = "select connect_forecast_ask(%s, %s::text::jsonb, 3, null, null, null)"
FUNCS = ("connect_geo_ask", "connect_geo_ask_shape", "connect_forecast_ask")


def geo(token, lat, lon=-84.1916):
    return (GEO, (token, lat, lon, 10, ["chicken"]))


def shape(token, lat, lon=-84.1916):
    return (SHAPE, (token, lat, lon))


def forecast(token, k=0):
    return (FORECAST, (token, json.dumps([[y, v + k] for y, v in SERIES])))


class Locks(core.Base):
    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'waiter@x')", (ALICE, BOB, G.WAITER))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s), (%s)", (ALICE, BOB, G.WAITER))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (G.URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

    runner = G.Geo.runner
    app = G.Geo.app
    connect = G.Geo.connect
    owner = G.Geo.owner

    # ------------------------------------------------------------------------------------------------ the two-connection race
    def other(self):
        c = psycopg.connect(self.db.c.info.dsn, autocommit=False)
        c.execute("set role connect_runner")
        return c

    def race(self, first_ask, second_ask):
        """Two asks at the same moment on two connections. The first is held open (uncommitted) until the second is waiting behind it on an advisory lock (or has finished: it did not wait).
        Returns (first, second, waited): each the answer or the database error, and whether the second had to wait."""
        # a token's last-used time is written by the first call of each minute, and that write would queue a second ask behind the first by itself; a warm token (the usual case) leaves the lock as the ONLY thing that can hold it
        self.owner("update public.connect_tokens set last_used_at = now()")
        c1, c2, c3 = self.other(), self.other(), psycopg.connect(self.db.c.info.dsn, autocommit=True)
        out = {}
        waited = False

        def second():
            try:
                out["b"] = c2.execute(*second_ask).fetchone()[0]
            except psycopg.Error as e:
                out["b"] = e
        try:
            try:
                first = c1.execute(*first_ask).fetchone()[0]
            except psycopg.Error as e:
                first = e
            t = threading.Thread(target=second)
            t.start()
            end = time.time() + 5
            while t.is_alive() and time.time() < end:
                if c3.execute("select count(*) from pg_locks where locktype = 'advisory' and not granted").fetchone()[0]:
                    waited = True
                    break
                time.sleep(0.05)
            if isinstance(first, psycopg.Error):
                c1.rollback()
            else:
                c1.commit()
            t.join(10)
            self.assertFalse(t.is_alive(), "the second ask never finished")
            if isinstance(out["b"], psycopg.Error):
                c2.rollback()
            else:
                c2.commit()
        finally:
            for c in (c1, c2, c3):
                c.close()
        return first, out["b"], waited

    def counts(self):
        return self.owner("select count(*) filter (where state in ('asked','claimed')), count(*) from public.geo_requests where owner_id = %s", ALICE).fetchone()

    def seed_open(self, n):
        for i in range(n):
            self.runner().one(GEO, self.a, 30 + i, -80, 10, ["chicken"])

    def seed_day(self, n):
        self.owner("insert into public.geo_requests (owner_id, lat, lon, minutes, state, finished_at) select %s, 20, -100 + g * 0.01, 10, 'failed', now() from generate_series(1, %s) g", ALICE, n)

    def assert_second_refused(self, first, second, waited, words):
        self.assertTrue(waited, "the second ask waits behind the first (a lock per person)")
        self.assertIsInstance(first, dict, "the first ask is accepted")
        self.assertIsInstance(second, psycopg.Error, "the second ask is refused, not accepted")
        self.assertEqual(second.sqlstate, "PT429")
        self.assertIn(words, second.diag.message_primary)

    # ------------------------------------------------------------------------------------------------ the races
    def test_two_place_asks_at_four_open_leave_at_most_five_and_the_second_is_told_in_words(self):
        self.seed_open(4)
        first, second, waited = self.race(geo(self.a, 41), geo(self.a, 42))
        self.assert_second_refused(first, second, waited, "5 place questions waiting")
        self.assertEqual(self.counts()[0], 5)

    def test_two_place_asks_at_ninety_nine_in_a_day_leave_at_most_one_hundred(self):
        self.seed_day(99)
        first, second, waited = self.race(geo(self.a, 41), geo(self.a, 42))
        self.assert_second_refused(first, second, waited, "100 place questions in a day")
        self.assertEqual(self.counts()[1], 100)

    def test_the_same_question_asked_twice_at_once_is_one_request(self):
        self.seed_open(1)
        first, second, waited = self.race(geo(self.a, 41), geo(self.a, 41))
        self.assertTrue(waited)
        self.assertIsInstance(first, dict)
        self.assertIsInstance(second, dict, "the repeat is answered, not refused")
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second.get("repeat"))
        self.assertEqual(self.counts()[1], 2)

    def test_two_people_asking_at_once_do_not_wait_for_each_other(self):
        first, second, waited = self.race(geo(self.a, 41), geo(self.b, 41))
        self.assertFalse(waited, "another person's ask does not wait for Alice's")
        self.assertIsInstance(first, dict)
        self.assertIsInstance(second, dict, "Bob's ask is not held up by Alice's lock")
        self.assertNotEqual(first["id"], second["id"])

    def test_the_three_functions_share_one_lock_a_shape_ask_racing_a_place_ask_is_held(self):
        self.seed_open(4)
        first, second, waited = self.race(geo(self.a, 41), shape(self.a, 42))
        self.assert_second_refused(first, second, waited, "5 place questions waiting")
        self.assertEqual(self.counts()[0], 5)

    def test_a_forecast_ask_racing_a_place_ask_is_held_and_so_is_a_forecast_racing_a_shape_ask(self):
        self.seed_open(4)
        first, second, waited = self.race(geo(self.a, 41), forecast(self.a))
        self.assert_second_refused(first, second, waited, "waiting for an answer")
        self.assertEqual(self.counts()[0], 5)
        self.owner("update public.geo_requests set state = 'failed', fail_code = 'engine_error', finished_at = now() where owner_id = %s", ALICE)
        self.seed_open(4)
        first, second, waited = self.race(shape(self.a, 43), forecast(self.a, 1))
        self.assert_second_refused(first, second, waited, "waiting for an answer")

    # ------------------------------------------------------------------------------------------------ what the change leaves alone
    def functions(self):
        return {r[0]: r for r in self.owner(
            "select p.proname, pg_get_functiondef(p.oid), p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'), "
            "has_function_privilege('connect_runner', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(%s)", list(FUNCS)).fetchall()}

    def test_every_ask_function_takes_the_lock_first_and_keeps_its_grants_and_settings(self):
        got = self.functions()
        self.assertEqual(sorted(got), sorted(FUNCS))
        for name, (_, d, secdef, config, anon, auth, runner) in got.items():
            self.assertEqual(d.count("pg_advisory_xact_lock(hashtextextended('geo:' || me::text, 0))"), 1, name)
            begin = d.index("\nbegin\n")
            self.assertTrue(d[begin:].startswith("\nbegin\n  perform pg_advisory_xact_lock("), f"{name}: the lock is the first statement")
            self.assertTrue(secdef, f"{name} is still security definer")
            self.assertEqual(config, ["search_path=\"\""], f"{name} keeps its search_path")
            self.assertEqual((anon, auth, runner), (False, False, True), f"{name} keeps its grants (the connector's runner only)")

    def apply(self, sql, what):
        try:
            self.owner(sql)
        except psycopg.Error as e:
            self.db.c.execute("rollback")
            self.fail(f"{what} failed: {e.diag.message_primary}")

    def test_the_migration_is_safe_to_run_twice_and_the_rollback_takes_the_lock_out_and_back(self):
        before = self.functions()
        mig = (ROOT / "migrations" / "20261109000300_ask_locks.sql").read_text(encoding="utf-8")
        rb = (ROOT / "rollbacks" / "20261109000300_ask_locks_rollback.sql").read_text(encoding="utf-8")
        self.apply(mig, "running the migration a second time")
        self.assertEqual({k: v[1] for k, v in self.functions().items()}, {k: v[1] for k, v in before.items()}, "a second run changes nothing")
        self.apply(rb, "the rollback")
        for name, v in self.functions().items():
            self.assertNotIn("pg_advisory_xact_lock", v[1], f"{name}: the rollback takes the lock out")
            self.assertEqual(v[2:], before[name][2:], f"{name}: grants and settings are kept")
        self.apply(rb, "the rollback run a second time")                           # and the rollback is safe to run twice
        self.apply(mig, "putting the lock back")
        self.assertEqual({k: v[1] for k, v in self.functions().items()}, {k: v[1] for k, v in before.items()}, "putting it back gives exactly the text it had")

    def test_a_function_that_is_not_as_expected_stops_the_migration_in_words_and_changes_nothing(self):
        mig = (ROOT / "migrations" / "20261109000300_ask_locks.sql").read_text(encoding="utf-8")
        rb = (ROOT / "rollbacks" / "20261109000300_ask_locks_rollback.sql").read_text(encoding="utf-8")
        self.apply(rb, "the rollback")
        before = {k: v[1] for k, v in self.functions().items()}
        d = before["connect_geo_ask_shape"]
        odd = d.replace("delete from public.geo_requests where asked_at < now() - interval '7 days';", "delete from public.geo_requests where asked_at < now() - interval '8 days';")
        self.assertNotEqual(odd, d)
        self.owner(odd)
        edited = {k: v[1] for k, v in self.functions().items()}
        with self.assertRaises(psycopg.Error) as cm:
            self.owner(mig)
        self.assertIn("not as expected", cm.exception.diag.message_primary)
        self.assertIn("connect_geo_ask_shape", cm.exception.diag.message_primary)
        self.db.c.execute("rollback")                                            # the failed migration left its explicit transaction open: end it
        after = {k: v[1] for k, v in self.functions().items()}
        self.assertEqual(after, edited, "the migration changed nothing, not even the functions it could have handled")

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        sql = (ROOT / "migrations" / "20261109000300_ask_locks.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])


if __name__ == "__main__":
    unittest.main()
