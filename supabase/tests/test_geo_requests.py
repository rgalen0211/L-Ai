"""GEO REQUESTS (migrations/20261104000300_geo_requests.sql) on a local Postgres, with the waiting-accounts gate (20261104000100) in place.

Same setup as test_2a_core.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_requests.py -v

What this proves: a person's AI asks a place question through its token and only ever sees its own requests; the point is stored ROUNDED and kept 7 days; the table is closed to every API role; the house worker
claims, answers and fails requests through three functions only a worker can run; a WAITING account is refused everywhere; nothing about the point is in an error message.
"""
import base64
import hashlib
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_waiting_accounts as tw  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB, WAITER = (str(uuid.UUID(int=i)) for i in (301, 302, 303))
URI = "https://claude.ai/api/mcp/auth_callback"
VER = "v" * 43
ANSWER = {"schema": "ryagram.drive-estimate/0", "minutes": 10, "label_for_everything": "Estimated", "sites": [{"residents": {"label": "Estimated", "value": 1000, "note": "n", "source": "s"}}]}


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class Geo(core.Base):
    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'waiter@x')", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s), (%s)", (ALICE, BOB, WAITER))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

    # -- helpers (the same OAuth dance as test_connect.py)
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

    def ask(self, token, lat=39.7589, lon=-84.1916, minutes=10, cats=("chicken",)):
        return self.runner().one("select connect_geo_ask(%s, %s, %s, %s, %s)", token, lat, lon, minutes, list(cats))

    def get(self, token, rid):
        return self.runner().one("select connect_geo_get(%s, %s)", token, rid)

    def fails(self, who, sql, *args, code=None):
        with self.assertRaises(psycopg.Error) as cm:
            who().one(sql, *args)
        if code:
            self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def worker(self):
        return self.db.as_(core.WORKER)

    # ------------------------------------------------------------------------------------------------ asking
    def test_an_ask_is_stored_rounded_and_counted_once_when_repeated(self):
        r = self.ask(self.a, 39.758912345, -84.191598765, 10, ("chicken", "bank", "chicken"))
        self.assertEqual((r["state"], r["repeat"]), ("asked", False))
        row = self.owner("select lat, lon, minutes, categories, state, owner_id from public.geo_requests where id = %s", r["id"]).fetchone()
        self.assertEqual((row[0], row[1], row[2], row[3], row[4], str(row[5])), (39.7589, -84.1916, 10, ["bank", "chicken"], "asked", ALICE))
        again = self.ask(self.a, 39.75891, -84.19159, 10, ("bank", "chicken"))
        self.assertEqual((again["id"], again["repeat"]), (r["id"], True), "the same question (after rounding) is one request")
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 1)

    def test_bad_questions_are_refused_and_say_nothing_about_the_point(self):
        bad = [dict(lat=91), dict(lat=-91), dict(lon=181), dict(minutes=0), dict(minutes=61), dict(cats=("a", "bb", "cc", "dd", "ee")), dict(cats=("Chicken",)), dict(cats=("x",)), dict(cats=("a b",))]
        for kw in bad:
            e = self.fails(lambda: self.runner(), "select connect_geo_ask(%s, %s, %s, %s, %s)", self.a, kw.get("lat", 39.7589123), kw.get("lon", -84.1916456), kw.get("minutes", 10),
                           list(kw.get("cats", ("chicken",))), code="22023")
            text = e.diag.message_primary + " " + (e.diag.message_detail or "") + " " + (e.diag.message_hint or "")
            for needle in ("39.7589", "84.1916", "39.76", "-84"):
                self.assertNotIn(needle, text, kw)
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 0)

    def test_five_open_at_once_and_one_hundred_a_day(self):
        for i in range(5):
            self.ask(self.a, 30 + i, -80, 10, ())
        self.fails(lambda: self.runner(), "select connect_geo_ask(%s, 40, -80, 10, '{}')", self.a, code="PT429")
        self.owner("update public.geo_requests set state = 'answered', answer = %s::jsonb, finished_at = now()", '{"schema": "ryagram.drive-estimate/0"}')
        self.owner("insert into public.geo_requests (owner_id, lat, lon, minutes, state, finished_at) select %s, 10 + g * 0.01, 10, 5, 'answered', now() from generate_series(1, 95) g", ALICE)
        self.fails(lambda: self.runner(), "select connect_geo_ask(%s, 41, -80, 10, '{}')", self.a, code="PT429")
        self.assertTrue(self.ask(self.b, 41, -80, 10, ())["id"], "another person is not held up by Alice's limits")

    # ------------------------------------------------------------------------------------------------ privacy
    def test_the_table_is_closed_to_every_api_role_and_a_request_looks_absent_to_anyone_else(self):
        r = self.ask(self.a)
        for who in ("anon", ALICE, "service"):
            for sql in ("select * from public.geo_requests", "update public.geo_requests set state = 'answered'", "delete from public.geo_requests",
                        "insert into public.geo_requests (owner_id, lat, lon, minutes) values (gen_random_uuid(), 1, 1, 1)"):
                with self.assertRaises(psycopg.Error, msg=f"{who}: {sql}"):
                    self.db.as_(who).c.execute(sql)
        for sql in ("select * from public.geo_requests", "delete from public.geo_requests"):
            with self.assertRaises(psycopg.Error):
                self.runner().c.execute(sql)
        self.assertIsNone(self.get(self.b, r["id"]), "Bob cannot see Alice's request")
        self.assertIsNone(self.get(self.a, str(uuid.uuid4())))
        got = self.get(self.a, r["id"])
        self.assertEqual((got["state"], got["minutes"], got["categories"]), ("asked", 10, ["chicken"]))
        self.fails(lambda: self.runner(), "select connect_geo_get(%s, %s)", "0" * 64, r["id"])        # a token that is not live

    def test_nothing_older_than_seven_days_survives_an_ask_a_read_or_the_purge(self):
        old = "insert into public.geo_requests (owner_id, lat, lon, minutes, asked_at) values (%s, 1, 1, 5, now() - interval '8 days')"
        for how in range(3):
            self.owner(old, ALICE)
            self.owner(old, BOB)
            if how == 0:
                self.ask(self.a, 5, 5, 5, ())
            elif how == 1:
                self.get(self.a, str(uuid.uuid4()))
            else:
                self.assertEqual(self.db.as_("service").one("select public.geo_purge()"), 2)
            self.assertEqual(self.owner("select count(*) from public.geo_requests where asked_at < now() - interval '7 days'").fetchone()[0], 0, how)
        for who in ("anon", ALICE):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.geo_purge()")

    # ------------------------------------------------------------------------------------------------ the house worker
    def test_the_worker_claims_answers_and_fails_and_nobody_else_can(self):
        r = self.ask(self.a)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("select * from public.claim_next_geo()")
        got = self.worker().c.execute("select request_id, lat, lon, minutes, categories from public.claim_next_geo()").fetchall()
        self.assertEqual([(str(g[0]), g[1], g[2], g[3], g[4]) for g in got], [(r["id"], 39.7589, -84.1916, 10, ["chicken"])])
        self.assertEqual(self.owner("select state, claimed_at is not null from public.geo_requests").fetchone(), ("claimed", True), "a claim marks the request claimed")
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo()").fetchall(), [], "a claimed request is not handed out twice")
        self.assertEqual(self.get(self.a, r["id"])["state"], "claimed")
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.finish_geo(%s, %s::jsonb)", r["id"], '{"schema": "ryagram.drive-estimate/0"}')
        with self.assertRaisesRegex(psycopg.Error, "not a drive estimate"):                 # refused as an unknown schema, not only as the wrong kind of answer
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", r["id"], '{"schema": "something.else"}')
        self.worker().one("select public.finish_geo(%s, %s::jsonb)", r["id"], __import__("json").dumps(ANSWER))
        done = self.get(self.a, r["id"])
        self.assertEqual((done["state"], done["answer"]["minutes"]), ("answered", 10))
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", r["id"], __import__("json").dumps(ANSWER))
        self.assertEqual(cm.exception.sqlstate, "PT404")

    def test_fail_geo_records_a_known_code_and_the_ai_can_read_it(self):
        r = self.ask(self.a)
        self.worker().c.execute("select * from public.claim_next_geo()").fetchall()
        with self.assertRaisesRegex(psycopg.Error, "Unknown failure code"):
            self.worker().one("select public.fail_geo(%s, 'because', 'x')", r["id"])
        self.worker().one("select public.fail_geo(%s, 'answer_rejected', 'the place is outside the area the data covers')", r["id"])
        g = self.get(self.a, r["id"])
        self.assertEqual((g["state"], g["fail_code"], g["fail_detail"]), ("failed", "answer_rejected", "the place is outside the area the data covers"))
        again = self.ask(self.a)
        self.assertNotEqual(again["id"], r["id"], "a failed question can be asked again")

    def test_a_claim_nobody_finished_comes_back_after_ten_minutes(self):
        r = self.ask(self.a)
        self.worker().c.execute("select * from public.claim_next_geo()").fetchall()
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo()").fetchall(), [])
        self.owner("update public.geo_requests set claimed_at = now() - interval '11 minutes'")
        self.assertEqual(len(self.worker().c.execute("select * from public.claim_next_geo()").fetchall()), 1)

    def test_claims_off_means_no_geo_claims_either(self):
        self.ask(self.a)
        self.owner("update public.control set claims_enabled = false")
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo()").fetchall(), [])

    # ------------------------------------------------------------------------------------------------ the waiting-list gate
    def test_a_waiting_account_cannot_ask_and_the_gate_covers_every_new_function(self):
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", ALICE)
        self.fails(lambda: self.runner(), "select connect_geo_ask(%s, 40, -80, 10, '{}')", self.a)
        self.owner("update public.account_status set status = 'active' where user_id = %s", ALICE)
        self.assertTrue(self.ask(self.a, 40, -80, 10, ())["id"])
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "claim_next_geo, finish_geo and fail_geo carry the waiting-list check")

    def test_the_rollback_removes_every_geo_object_and_nothing_else(self):
        self.ask(self.a)
        for name in ("20261104000400_geo_questions_rollback.sql", "20261104000300_geo_requests_rollback.sql"):       # newest first
            self.owner((core.ROOT / "rollbacks" / name).read_text(encoding="utf-8"))
        left = self.owner("""select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','ryagram_private')
                                       and (p.proname like '%geo%')),
                                  (select count(*) from pg_class where relname = 'geo_requests')""").fetchone()
        self.assertEqual(left, (0, 0))
        self.assertIsNotNone(self.owner("select to_regprocedure('public.connect_create_project(text,text)')").fetchone()[0])


    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        """MASKED-MUTANT RE-AIM (CC1 05:04): a later migration that ends with gate_apply() re-applies the waiting-list check to every signed-in function, so a mutant that takes the line out of THIS migration was healed by the next one
        and never failed. This test reads the file itself: its last statement before commit must be the gate, whatever is applied after it."""
        sql = (core.ROOT / "migrations" / "20261104000300_geo_requests.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])

if __name__ == "__main__":
    unittest.main()
