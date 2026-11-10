"""COUNTY REQUESTS (migrations/20261109000200_county_requests.sql) on a local Postgres, with the waiting-accounts gate (20261104000100) in place.

Same setup as test_geo_requests.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_county_requests.py -v

What this proves: a person's AI asks a county question through its token and only ever sees its own requests; the shape of a request is checked (one county for a profile, two to five different for a comparison, one kind, three rules, a year only with a rule);
the table is closed to every API role; the house worker claims, answers (an answer must carry the schema of its own shape) and fails requests through three functions only a worker can run; limits and keep times hold; a WAITING account is refused everywhere;
the rollback removes exactly these objects.
"""
import base64
import hashlib
import json
import sys
import threading
import time
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_waiting_accounts as tw  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, WAITER = (str(uuid.UUID(int=i)) for i in (501, 502, 503))
URI = "https://claude.ai/api/mcp/auth_callback"
VER = "v" * 43
GREENE, MONT = "39057", "39113"
PROFILE = {"schema": "ryagram.geo-county-profile/0", "county": {"fips": GREENE, "name": "Invented County"}, "kind": "limited_service", "figures": [], "say": ["invented line"]}
COMPARE = {"schema": "ryagram.geo-compare-counties/0", "counties": [], "rule": None, "year": None, "order": None, "order_words": "invented", "say": ["invented line"]}


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class County(core.Base):
    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'waiter@x')", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s), (%s)", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

    # -- helpers (the same OAuth dance as test_geo_requests.py)
    def runner(self):
        self.db.c.execute("reset role")
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role connect_runner")
        return self.db

    def app(self, who):
        self.db.as_(who)
        self.db.c.execute("select set_config('request.jwt.claims', '', false)")
        return self.db

    def connect(self, who):
        self.counter += 1
        client = self.runner().one("select connect_register_client('Claude', array[%s])", URI)
        req = self.runner().one("select connect_begin_authorization(%s,%s,'st',%s,'S256','read write',null)", client, URI, s256(VER))
        out = self.app(who).one("select connect_consent_decide(%s, true, %s)", req, ["read", "write"])
        code = out["redirect_to"].split("code=")[1].split("&")[0]
        access, refresh = f"acc{self.counter}-" + uuid.uuid4().hex, f"ref{self.counter}-" + uuid.uuid4().hex
        self.runner().one("select connect_exchange_code(%s,%s,%s,%s,%s,%s)", h(code), client, URI, VER, h(access), h(refresh))
        return h(access)

    def ask(self, token, shape="profile", counties=(GREENE,), kind="limited_service", rule=None, year=None):
        return self.runner().one("select connect_county_ask(%s, %s, %s, %s, %s, %s)", token, shape, list(counties), kind, rule, year)

    def get(self, token, rid):
        return self.runner().one("select connect_county_get(%s, %s)", token, rid)

    def fails(self, sql, *args, code=None):
        with self.assertRaises(psycopg.Error) as cm:
            self.runner().one(sql, *args)
        if code:
            self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def worker(self):
        return self.db.as_(core.WORKER)

    def claim(self):
        return self.worker().c.execute("select request_id, shape, counties, kind, rule, year from public.claim_next_county()").fetchall()

    def count(self):
        return self.owner("select count(*) from public.county_requests").fetchone()[0]

    # ------------------------------------------------------------------------------------------------ asking
    def test_a_profile_and_a_comparison_are_stored_as_asked_and_the_same_question_is_one_request(self):
        r = self.ask(self.a)
        self.assertEqual((r["state"], r["repeat"]), ("asked", False))
        row = self.owner("select owner_id, shape, counties, kind, rule, year, state from public.county_requests where id = %s", r["id"]).fetchone()
        self.assertEqual((str(row[0]), row[1], row[2], row[3], row[4], row[5], row[6]), (ALICE, "profile", [GREENE], "limited_service", None, None, "asked"))
        again = self.ask(self.a)
        self.assertEqual((again["id"], again["repeat"]), (r["id"], True))
        c = self.ask(self.a, "compare", (GREENE, MONT), rule="per_10k_low_first", year=2023)
        self.assertFalse(c["repeat"])
        self.assertNotEqual(self.ask(self.a, "compare", (MONT, GREENE), rule="per_10k_low_first", year=2023)["id"], c["id"], "the order asked is part of the question")
        self.assertNotEqual(self.ask(self.a, "compare", (GREENE, MONT))["id"], c["id"], "no rule is another question")
        self.assertNotEqual(self.ask(self.a, "compare", (GREENE, MONT), rule="per_10k_high_first", year=2023)["id"], c["id"], "another rule alone (same year) is another question")
        self.assertEqual(self.count(), 5)

    def test_a_request_that_is_not_one_of_the_closed_shapes_is_refused_in_words_and_stores_nothing(self):
        bad = [
            dict(shape="best"), dict(counties=("3905",)), dict(counties=("39057x",)), dict(counties=()), dict(counties=(GREENE, GREENE), shape="compare"),
            dict(counties=(GREENE, MONT)), dict(shape="compare", counties=(GREENE,)), dict(kind="food_drink"), dict(kind="grocery"), dict(rule="per_10k_low_first"), dict(year=2023),
            dict(shape="compare", counties=(GREENE, MONT), rule="best_first"), dict(shape="compare", counties=(GREENE, MONT), year=2023),
            dict(shape="compare", counties=(GREENE, MONT), rule="count_high_first", year=1990), dict(shape="compare", counties=(GREENE, MONT), rule="count_high_first", year=2025),
            dict(shape="compare", counties=tuple(f"3900{i}" for i in range(6))),
        ]
        for kw in bad:
            e = self.fails("select connect_county_ask(%s, %s, %s, %s, %s, %s)", self.a, kw.get("shape", "profile"), list(kw.get("counties", (GREENE,))), kw.get("kind", "limited_service"), kw.get("rule"), kw.get("year"), code="22023")
            self.assertTrue(e.diag.message_primary.endswith((".", ";")) and len(e.diag.message_primary) > 20, kw)
        self.assertEqual(self.count(), 0)

    def test_five_open_at_once_and_one_hundred_a_day(self):
        for i in range(5):
            self.ask(self.a, "compare", (GREENE, f"3910{i}"))
        self.fails("select connect_county_ask(%s, 'profile', %s, 'limited_service', null, null)", self.a, [MONT], code="PT429")
        self.owner("update public.county_requests set state = 'failed', fail_code = 'county_not_held', finished_at = now()")
        self.owner("insert into public.county_requests (owner_id, shape, counties, state, finished_at) select %s, 'profile', array[lpad(g::text, 5, '0')], 'failed', now() from generate_series(1, 95) g", ALICE)
        self.fails("select connect_county_ask(%s, 'profile', %s, 'limited_service', null, null)", self.a, [MONT], code="PT429")
        try:
            got = self.ask(self.b)
        except psycopg.Error as e:
            self.fail(f"another person was held up by Alice's limits (sqlstate {e.sqlstate})")
        self.assertTrue(got["id"])

    # ------------------------------------------------------------------------------------------------ two asks in flight at once (WORKER's finding, CC1 19:37): the limits must hold when an AI asks twice in parallel
    def other(self):
        c = psycopg.connect(self.db.c.info.dsn, autocommit=False)
        c.execute("set role connect_runner")
        return c

    def race(self, args1, args2):
        """Ask twice at the same moment on two connections. The first ask is held open (uncommitted) until the second is waiting behind it (or has finished: no lock), so the two really overlap.
        Returns (first, second, waited): each answer or database error, and whether the second ask had to wait behind the first (a per-person lock)."""
        sql = "select connect_county_ask(%s, %s, %s, 'limited_service', null, null)"
        # a token's last-used time is written by the first call of each minute, and that write would queue a second ask behind the first all by itself; a warm token (the usual case) leaves the per-person lock as the ONLY thing that can hold the second ask
        self.owner("update public.connect_tokens set last_used_at = now()")
        c1, c2, c3 = self.other(), self.other(), psycopg.connect(self.db.c.info.dsn, autocommit=True)
        out = {}
        waited = False

        def second():
            try:
                out["b"] = c2.execute(sql, args2).fetchone()[0]
            except psycopg.Error as e:
                out["b"] = e
        try:
            try:
                first = c1.execute(sql, args1).fetchone()[0]
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
        row = self.db.as_(None).c.execute("select count(*) filter (where state in ('asked','claimed')), count(*) from public.county_requests where owner_id = %s", (ALICE,)).fetchone()
        return row

    def test_two_asks_in_flight_at_four_open_leave_at_most_five_and_the_second_is_told_in_words(self):
        for i in range(4):
            self.ask(self.a, "compare", (GREENE, f"3910{i}"))
        first, second, waited = self.race((self.a, "profile", ["39001"]), (self.a, "profile", ["39003"]))
        self.assertTrue(waited, "the second ask waits behind the first (a lock per person)")
        self.assertIsInstance(first, dict, "the first ask is accepted")
        self.assertIsInstance(second, psycopg.Error, "the second ask is refused (limit 5), not accepted")
        self.assertEqual(second.sqlstate, "PT429")
        self.assertIn("5 county questions waiting", second.diag.message_primary)
        self.assertEqual(self.counts()[0], 5)

    def test_two_asks_in_flight_at_ninety_nine_in_a_day_leave_at_most_one_hundred(self):
        self.owner("insert into public.county_requests (owner_id, shape, counties, state, finished_at) select %s, 'profile', array[lpad(g::text, 5, '0')], 'failed', now() from generate_series(1, 99) g", ALICE)
        first, second, waited = self.race((self.a, "profile", ["39001"]), (self.a, "profile", ["39003"]))
        self.assertTrue(waited, "the second ask waits behind the first (a lock per person)")
        self.assertIsInstance(first, dict, "the first ask is accepted")
        self.assertIsInstance(second, psycopg.Error, "the second ask is refused (limit 100 a day)")
        self.assertEqual(second.sqlstate, "PT429")
        self.assertEqual(self.counts()[1], 100)

    def test_the_same_question_asked_twice_at_once_is_one_request(self):
        first, second, waited = self.race((self.a, "profile", ["39001"]), (self.a, "profile", ["39001"]))
        self.assertTrue(waited)
        self.assertIsInstance(first, dict)
        self.assertIsInstance(second, dict, "the repeat is answered, not refused")
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second.get("repeat"))
        self.assertEqual(self.counts()[1], 1)

    def test_two_people_asking_at_once_do_not_wait_for_each_other(self):
        first, second, waited = self.race((self.a, "profile", ["39001"]), (self.b, "profile", ["39001"]))
        self.assertFalse(waited, "another person's ask does not wait for Alice's")
        self.assertIsInstance(first, dict)
        self.assertIsInstance(second, dict, "Bob's ask is not held up by Alice's lock")
        self.assertNotEqual(first["id"], second["id"])

    # ------------------------------------------------------------------------------------------------ privacy
    def test_the_table_is_closed_to_every_api_role_and_a_request_looks_absent_to_anyone_else(self):
        r = self.ask(self.a)
        for who in ("anon", ALICE, "service"):
            for sql in ("select * from public.county_requests", "update public.county_requests set state = 'answered'", "delete from public.county_requests",
                        "insert into public.county_requests (owner_id, shape, counties) values (gen_random_uuid(), 'profile', array['39057'])"):
                with self.assertRaises(psycopg.Error, msg=f"{who}: {sql}"):
                    self.db.as_(who).c.execute(sql)
        for sql in ("select * from public.county_requests", "delete from public.county_requests"):
            with self.assertRaises(psycopg.Error):
                self.runner().c.execute(sql)
        self.assertIsNone(self.get(self.b, r["id"]), "Bob cannot see Alice's request")
        self.assertIsNone(self.get(self.a, str(uuid.uuid4())))
        got = self.get(self.a, r["id"])
        self.assertEqual((got["state"], got["shape"], got["counties"], got["kind"], got["rule"], got["year"]), ("asked", "profile", [GREENE], "limited_service", None, None))
        self.fails("select connect_county_get(%s, %s)", "0" * 64, r["id"])        # a token that is not live

    def test_nothing_older_than_seven_days_survives_an_ask_a_read_or_the_purge(self):
        old = "insert into public.county_requests (owner_id, shape, counties, asked_at) values (%s, 'profile', array['39057'], now() - interval '8 days')"
        for how in range(3):
            self.owner(old, ALICE)
            self.owner(old, BOB)
            if how == 0:
                self.ask(self.a, "profile", (MONT,))
            elif how == 1:
                self.get(self.a, str(uuid.uuid4()))
            else:
                self.assertEqual(self.db.as_("service").one("select public.county_purge()"), 2)
            self.assertEqual(self.owner("select count(*) from public.county_requests where asked_at < now() - interval '7 days'").fetchone()[0], 0, how)
        for who in ("anon", ALICE):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.county_purge()")

    # ------------------------------------------------------------------------------------------------ the house worker
    def test_the_worker_claims_answers_and_nobody_else_can(self):
        r = self.ask(self.a, "compare", (GREENE, MONT), rule="count_high_first", year=2022)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("select * from public.claim_next_county()")
        got = self.claim()
        self.assertEqual([(str(g[0]), g[1], g[2], g[3], g[4], g[5]) for g in got], [(r["id"], "compare", [GREENE, MONT], "limited_service", "count_high_first", 2022)])
        self.assertEqual(self.owner("select state, claimed_at is not null from public.county_requests").fetchone(), ("claimed", True))
        self.assertEqual(self.claim(), [], "a claimed request is not handed out twice")
        self.assertEqual(self.get(self.a, r["id"])["state"], "claimed")
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.finish_county(%s, %s::jsonb)", r["id"], json.dumps(COMPARE))
        for name, bad in (("a profile answer for a comparison", PROFILE), ("another schema", {**COMPARE, "schema": "something.else"}), ("no schema", {"say": []}), ("an array", [1]), ("too big", {**COMPARE, "pad": "x" * 70000})):
            with self.assertRaises(psycopg.Error, msg=name) as cm:
                self.worker().one("select public.finish_county(%s, %s::jsonb)", r["id"], json.dumps(bad))
            self.assertEqual(cm.exception.sqlstate, "22023", name)
        self.worker().one("select public.finish_county(%s, %s::jsonb)", r["id"], json.dumps(COMPARE))
        done = self.get(self.a, r["id"])
        self.assertEqual((done["state"], done["answer"]["schema"]), ("answered", "ryagram.geo-compare-counties/0"))
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.finish_county(%s, %s::jsonb)", r["id"], json.dumps(COMPARE))
        self.assertEqual(cm.exception.sqlstate, "PT404", "a request is answered once")

    def test_a_profile_answer_is_accepted_for_a_profile(self):
        r = self.ask(self.a)
        self.claim()
        self.worker().one("select public.finish_county(%s, %s::jsonb)", r["id"], json.dumps(PROFILE))
        self.assertEqual(self.get(self.a, r["id"])["answer"]["county"]["fips"], GREENE)

    def test_fail_county_records_a_known_code_and_a_failed_question_can_be_asked_again(self):
        r = self.ask(self.a)
        self.claim()
        with self.assertRaisesRegex(psycopg.Error, "Unknown failure code"):
            self.worker().one("select public.fail_county(%s, 'because', 'x')", r["id"])
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.fail_county(%s, 'engine_error', 'x')", r["id"])
        self.worker().one("select public.fail_county(%s, 'county_not_held', %s)", r["id"], "no figure is held for it" + "x" * 400)
        g = self.get(self.a, r["id"])
        self.assertEqual((g["state"], g["fail_code"], len(g["fail_detail"])), ("failed", "county_not_held", 300))
        self.assertNotEqual(self.ask(self.a)["id"], r["id"], "a failed question can be asked again")
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.fail_county(%s, 'engine_error', 'x')", r["id"])
        self.assertEqual(cm.exception.sqlstate, "PT404", "only a claimed request can be failed")

    def test_a_claim_nobody_finished_comes_back_after_ten_minutes_and_claims_off_means_none(self):
        self.ask(self.a)
        self.claim()
        self.assertEqual(self.claim(), [])
        self.owner("update public.county_requests set claimed_at = now() - interval '11 minutes'")
        self.assertEqual(len(self.claim()), 1)
        self.owner("update public.county_requests set state = 'asked'")
        self.owner("update public.control set claims_enabled = false")
        self.assertEqual(self.claim(), [])

    def test_the_same_question_after_ten_minutes_is_asked_again(self):
        r = self.ask(self.a)
        self.owner("update public.county_requests set asked_at = now() - interval '11 minutes'")
        self.assertNotEqual(self.ask(self.a)["id"], r["id"])

    # ------------------------------------------------------------------------------------------------ the waiting-list gate and the undo
    def test_a_waiting_account_cannot_ask_and_the_gate_covers_every_new_function(self):
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", ALICE)
        self.fails("select connect_county_ask(%s, 'profile', %s, 'limited_service', null, null)", self.a, [GREENE])
        self.owner("update public.account_status set status = 'active' where user_id = %s", ALICE)
        self.assertTrue(self.ask(self.a)["id"])
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "claim_next_county, finish_county and fail_county carry the waiting-list check")

    def test_the_rollback_removes_every_county_object_and_nothing_else(self):
        self.ask(self.a)
        self.owner((core.ROOT / "rollbacks" / "20261109000200_county_requests_rollback.sql").read_text(encoding="utf-8"))
        left = self.owner("""select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ryagram_private') and p.proname like '%county%'),
                                  (select count(*) from pg_class where relname = 'county_requests')""").fetchone()
        self.assertEqual(left, (0, 0))
        self.assertIsNotNone(self.owner("select to_regprocedure('public.connect_create_project(text,text)')").fetchone()[0])

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        """A later migration that ends with gate_apply() re-applies the check to every signed-in function, so a mutant that takes the line out of THIS migration would be healed by the next one and never fail:
        this test reads the file itself: its last statement before commit must be the gate."""
        sql = (core.ROOT / "migrations" / "20261109000200_county_requests.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])


if __name__ == "__main__":
    unittest.main()
