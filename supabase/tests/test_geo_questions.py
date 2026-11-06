"""GEO QUESTION SHAPES (migrations/20261104000400_geo_questions.sql) on a local Postgres, with the waiting-accounts gate (20261104000100) and the geo requests (20261104000300) in place.

Same setup as test_geo_requests.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_questions.py -v

What this proves: compare / verdict / where-to-go questions are asked through the token, stored with only their own fields (points ROUNDED), deduplicated, counted in the same 5-open and 100-a-day caps as the old shape;
the old claim function hands out ONLY the old shape and the new claim function ONLY the new ones, so WORKER's tested step is unchanged; finish_geo accepts each kind of answer only for its own kind of request; the
new worker function and the new ask function are gated like every other; and the rollback puts the old three functions back.
"""
import base64
import hashlib
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_waiting_accounts as tw  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB = (str(uuid.UUID(int=i)) for i in (401, 402))
URI = "https://claude.ai/api/mcp/auth_callback"
VER = "v" * 43
DRIVE = {"schema": "ryagram.drive-estimate/0", "minutes": 10, "label_for_everything": "Estimated", "sites": [{"residents": {"label": "Estimated", "value": 1000, "note": "n", "source": "s"}}]}
ASKED = {"schema": "ryagram.geo-ask/0", "shape": "verdict-question", "assumptions": "x", "answers": [], "statements": [], "refused": None}


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class GeoQuestions(core.Base):
    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x')", (ALICE, BOB))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

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

    def shape(self, token, shape, a=(39.7589, -84.1916), b=None, category=None, town=None):
        return self.runner().one("select connect_geo_ask_shape(%s, %s, %s, %s, %s, %s, %s, %s)", token, shape, a[0] if a else None, a[1] if a else None, b[0] if b else None, b[1] if b else None, category, town)

    def old(self, token, lat=39.7589, lon=-84.1916, minutes=10, cats=("chicken",)):
        return self.runner().one("select connect_geo_ask(%s, %s, %s, %s, %s)", token, lat, lon, minutes, list(cats))

    def get(self, token, rid):
        return self.runner().one("select connect_geo_get(%s, %s)", token, rid)

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

    # ------------------------------------------------------------------------------------------------ asking
    def test_each_shape_is_stored_with_only_its_own_fields_and_the_points_rounded(self):
        c = self.shape(self.a, "compare_sites", (39.758912345, -84.191598765), (39.781234567, -84.201234567))
        v = self.shape(self.a, "verdict", (39.75, -84.185), None, "chicken")
        w = self.shape(self.a, "where_to_go", None, None, "chicken", "Kettering")
        rows = self.owner("select shape, lat, lon, lat_b, lon_b, category, town, minutes, categories, state, owner_id from public.geo_requests order by asked_at").fetchall()
        self.assertEqual([(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], str(r[10])) for r in rows], [
            ("compare_sites", 39.7589, -84.1916, 39.7812, -84.2012, None, None, None, [], "asked", ALICE),
            ("verdict", 39.75, -84.185, None, None, "chicken", None, None, [], "asked", ALICE),
            ("where_to_go", None, None, None, None, "chicken", "Kettering", None, [], "asked", ALICE)])
        self.assertEqual([x["repeat"] for x in (c, v, w)], [False, False, False])
        got = self.get(self.a, c["id"])
        self.assertEqual((got["shape"], got["lat_b"], got["lon_b"], got["category"], got["town"], got["minutes"]), ("compare_sites", 39.7812, -84.2012, None, None, None))

    def test_a_repeat_is_one_request_whatever_the_shape_and_other_shapes_never_match_it(self):
        v = self.shape(self.a, "verdict", (39.758912, -84.19159), None, "chicken")
        again = self.shape(self.a, "verdict", (39.75891, -84.19160), None, "chicken")
        self.assertEqual((again["id"], again["repeat"]), (v["id"], True))
        w1 = self.shape(self.a, "where_to_go", None, None, "chicken", "Dayton")
        self.assertEqual(self.shape(self.a, "where_to_go", None, None, "chicken", "Dayton")["id"], w1["id"])
        self.assertNotEqual(self.shape(self.a, "where_to_go", None, None, "chicken", "Kettering")["id"], w1["id"], "a different town is a different question")
        self.assertNotEqual(self.shape(self.a, "where_to_go", None, None, "chicken")["id"], w1["id"], "no town is a different question")
        self.assertNotEqual(self.shape(self.a, "verdict", (39.75891, -84.1916), None, "pizza")["id"], v["id"], "a different category is a different question")
        self.owner("update public.geo_requests set state = 'answered', answer = %s::jsonb, finished_at = now()", json.dumps(ASKED))       # five were open: let the house computer catch up
        old = self.old(self.a, 39.7589, -84.1916, 10, ())
        self.assertNotEqual(old["id"], v["id"], "the old shape never matches a verdict at the same point")

    def test_bad_questions_are_refused_and_say_nothing_about_the_point(self):
        p = (39.7589123, -84.1916456)
        bad = [("nope", p, None, "chicken", None), ("compare_sites", p, None, None, None), ("compare_sites", p, (91, 0), None, None), ("compare_sites", (None, None), (1, 1), None, None),
               ("verdict", p, None, None, None), ("verdict", p, None, "Chicken", None), ("verdict", (91, 0), None, "chicken", None), ("verdict", (0, 181), None, "chicken", None),
               ("where_to_go", None, None, None, None), ("where_to_go", None, None, "x", None), ("where_to_go", None, None, "chicken", "Dayton/../etc"), ("where_to_go", None, None, "chicken", "Dayton 45402"),
               ("where_to_go", None, None, "chicken", "A" * 41)]
        for shape, a, b, cat, town in bad:
            e = self.fails("select connect_geo_ask_shape(%s, %s, %s, %s, %s, %s, %s, %s)", self.a, shape, a[0] if a else None, a[1] if a else None, b[0] if b else None, b[1] if b else None, cat, town, code="22023")
            text = e.diag.message_primary + " " + (e.diag.message_detail or "") + " " + (e.diag.message_hint or "")
            for needle in ("39.7589", "84.1916", "Dayton"):
                self.assertNotIn(needle, text, (shape, cat, town))
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 0)

    def test_the_table_will_not_hold_a_row_with_the_wrong_fields_for_its_shape(self):
        ins = "insert into public.geo_requests (owner_id, shape, lat, lon, lat_b, lon_b, minutes, category, town, categories) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, '{}')"
        for bad in [("verdict", 1, 1, None, None, None, None, None), ("verdict", 1, 1, None, None, 5, "chicken", None), ("compare_sites", 1, 1, None, None, None, None, None),
                    ("compare_sites", 1, 1, 2, 2, None, "chicken", None), ("where_to_go", 1, 1, None, None, None, "chicken", None), ("where_to_go", None, None, None, None, None, None, None),
                    ("where_to_go", None, None, None, None, None, "chicken", "Day/ton"), ("within_minutes", 1, 1, None, None, None, None, None), ("within_minutes", 1, 1, 2, 2, 5, None, None)]:
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.owner(ins, ALICE, *bad)
        self.owner(ins, ALICE, "where_to_go", None, None, None, None, None, "chicken", None)         # a good one goes in
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 1)

    def test_five_open_at_once_and_one_hundred_a_day_count_every_shape_together(self):
        self.old(self.a, 30, -80, 10, ())
        self.shape(self.a, "verdict", (31, -80), None, "chicken")
        self.shape(self.a, "compare_sites", (32, -80), (33, -80))
        self.shape(self.a, "where_to_go", None, None, "chicken")
        self.shape(self.a, "where_to_go", None, None, "pizza")
        self.fails("select connect_geo_ask_shape(%s, 'verdict', 40, -80, null, null, 'chicken', null)", self.a, code="PT429")
        self.fails("select connect_geo_ask(%s, 40, -80, 10, '{}')", self.a, code="PT429")
        self.owner("update public.geo_requests set state = 'answered', answer = %s::jsonb, finished_at = now()", json.dumps(ASKED))
        self.owner("insert into public.geo_requests (owner_id, lat, lon, minutes, state, finished_at) select %s, 10 + g * 0.01, 10, 5, 'answered', now() from generate_series(1, 95) g", ALICE)
        self.fails("select connect_geo_ask_shape(%s, 'where_to_go', null, null, null, null, 'burger', null)", self.a, code="PT429")
        self.assertTrue(self.shape(self.b, "where_to_go", None, None, "burger")["id"], "another person is not held up by Alice's limits")

    # ------------------------------------------------------------------------------------------------ privacy
    def test_another_person_cannot_read_a_new_shape_and_no_api_role_can_call_the_ask_directly(self):
        v = self.shape(self.a, "verdict", (39.75, -84.185), None, "chicken")
        self.assertIsNone(self.get(self.b, v["id"]))
        for who in ("anon", ALICE, "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select connect_geo_ask_shape(%s, 'verdict', 1, 1, null, null, 'chicken', null)", self.a)
        self.fails("select connect_geo_ask_shape(%s, 'verdict', 1, 1, null, null, 'chicken', null)", "0" * 64)            # a token that is not live

    def test_nothing_older_than_seven_days_survives_a_shape_ask(self):
        self.owner("insert into public.geo_requests (owner_id, shape, category, asked_at) values (%s, 'where_to_go', 'chicken', now() - interval '8 days')", ALICE)
        self.shape(self.b, "where_to_go", None, None, "pizza")
        self.assertEqual(self.owner("select count(*) from public.geo_requests where asked_at < now() - interval '7 days'").fetchone()[0], 0)

    def test_a_read_also_drops_what_is_older_than_seven_days(self):
        v = self.shape(self.a, "verdict", (39.75, -84.185), None, "chicken")
        self.owner("insert into public.geo_requests (owner_id, shape, category, asked_at) values (%s, 'where_to_go', 'chicken', now() - interval '8 days')", BOB)
        self.assertEqual(self.get(self.a, v["id"])["state"], "asked")
        self.assertEqual(self.owner("select count(*) from public.geo_requests where asked_at < now() - interval '7 days'").fetchone()[0], 0)

    # ------------------------------------------------------------------------------------------------ the house worker
    def test_each_claim_function_hands_out_only_its_own_kind(self):
        o = self.old(self.a)
        c = self.shape(self.a, "compare_sites", (39.75, -84.185), (39.78, -84.2))
        v = self.shape(self.a, "verdict", (39.76, -84.19), None, "chicken")
        w = self.shape(self.a, "where_to_go", None, None, "chicken", "Dayton")
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("select * from public.claim_next_geo_question()")
        got = self.worker().c.execute("select request_id, shape, lat, lon, lat_b, lon_b, category, town from public.claim_next_geo_question()").fetchall()
        self.assertEqual([(str(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7]) for r in got], [(c["id"], "compare_sites", 39.75, -84.185, 39.78, -84.2, None, None)],
                         "the new claim skips the older old-shape request and hands out the oldest NEW one")
        old = self.worker().c.execute("select request_id, lat, lon, minutes, categories from public.claim_next_geo()").fetchall()
        self.assertEqual([(str(r[0]), r[1], r[2], r[3], r[4]) for r in old], [(o["id"], 39.7589, -84.1916, 10, ["chicken"])], "the old claim still hands out exactly the old five fields")
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo()").fetchall(), [], "and nothing else, however many new questions wait")
        cols = [d.name for d in self.worker().c.execute("select * from public.claim_next_geo()").description]
        self.assertEqual(cols, ["request_id", "lat", "lon", "minutes", "categories"])
        got = self.worker().c.execute("select request_id, shape, category, town from public.claim_next_geo_question()").fetchall()
        self.assertEqual([(str(r[0]), r[1], r[2], r[3]) for r in got], [(v["id"], "verdict", "chicken", None)])
        got = self.worker().c.execute("select request_id, shape, lat, category, town from public.claim_next_geo_question()").fetchall()
        self.assertEqual([(str(r[0]), r[1], r[2], r[3], r[4]) for r in got], [(w["id"], "where_to_go", None, "chicken", "Dayton")])
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall(), [], "a claimed request is not handed out twice")

    def test_finish_geo_takes_each_answer_only_for_its_own_kind(self):
        o = self.old(self.a)
        v = self.shape(self.a, "verdict", (39.76, -84.19), None, "chicken")
        self.worker().c.execute("select * from public.claim_next_geo()").fetchall()
        self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall()
        with self.assertRaisesRegex(psycopg.Error, "not for this kind"):
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", o["id"], json.dumps(ASKED))
        with self.assertRaisesRegex(psycopg.Error, "not for this kind"):
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", v["id"], json.dumps(DRIVE))
        for junk in ('{"schema": "something.else"}', '{}', '[1]', '"x"'):
            with self.assertRaisesRegex(psycopg.Error, "not a drive estimate"):
                self.worker().one("select public.finish_geo(%s, %s::jsonb)", v["id"], junk)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.finish_geo(%s, %s::jsonb)", v["id"], json.dumps(ASKED))
        self.assertEqual(self.get(self.a, v["id"])["state"], "claimed", "every refused finish left the request claimed")
        self.worker().one("select public.finish_geo(%s, %s::jsonb)", o["id"], json.dumps(DRIVE))
        self.worker().one("select public.finish_geo(%s, %s::jsonb)", v["id"], json.dumps(ASKED))
        done = self.get(self.a, v["id"])
        self.assertEqual((done["state"], done["answer"]["shape"]), ("answered", "verdict-question"))
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", v["id"], json.dumps(ASKED))
        self.assertEqual(cm.exception.sqlstate, "PT404")
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", str(uuid.uuid4()), json.dumps(ASKED))
        self.assertEqual(cm.exception.sqlstate, "PT404")

    def test_fail_geo_works_for_a_new_shape_and_a_claim_nobody_finished_comes_back(self):
        w = self.shape(self.a, "where_to_go", None, None, "chicken")
        self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall()
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall(), [])
        self.owner("update public.geo_requests set claimed_at = now() - interval '11 minutes'")
        self.assertEqual(len(self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall()), 1)
        self.worker().one("select public.fail_geo(%s, 'unknown_category', 'no data for chicken')", w["id"])
        g = self.get(self.a, w["id"])
        self.assertEqual((g["state"], g["fail_code"]), ("failed", "unknown_category"))
        self.assertNotEqual(self.shape(self.a, "where_to_go", None, None, "chicken")["id"], w["id"], "a failed question can be asked again")

    def test_claims_off_means_no_new_claims_either(self):
        self.shape(self.a, "verdict", (39.76, -84.19), None, "chicken")
        self.owner("update public.control set claims_enabled = false")
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall(), [])

    # ------------------------------------------------------------------------------------------------ the waiting-list gate
    def test_a_waiting_account_cannot_ask_and_the_gate_covers_every_new_and_replaced_function(self):
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", ALICE)
        self.fails("select connect_geo_ask_shape(%s, 'verdict', 40, -80, null, null, 'chicken', null)", self.a)
        self.fails("select connect_geo_get(%s, %s)", self.a, str(uuid.uuid4()))
        self.owner("update public.account_status set status = 'active' where user_id = %s", ALICE)
        self.assertTrue(self.shape(self.a, "verdict", (40, -80), None, "chicken")["id"])
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "claim_next_geo, claim_next_geo_question, finish_geo and fail_geo carry the waiting-list check")

    def test_the_rollback_puts_the_three_old_functions_back_and_keeps_the_old_shapes_rows(self):
        o = self.old(self.a)
        self.shape(self.a, "verdict", (39.76, -84.19), None, "chicken")
        self.owner((core.ROOT / "rollbacks" / "20261104000400_geo_questions_rollback.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 1, "only the old shape's row is left")
        names = {r[0] for r in self.owner("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%geo%'").fetchall()}
        self.assertEqual(names, {"connect_geo_ask", "connect_geo_get", "claim_next_geo", "finish_geo", "fail_geo", "geo_purge"})
        cols = {r[0] for r in self.owner("select column_name from information_schema.columns where table_name = 'geo_requests'").fetchall()}
        self.assertFalse(cols & {"shape", "lat_b", "lon_b", "category", "town"})
        self.assertEqual(self.get(self.a, o["id"])["minutes"], 10)
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "the restored functions got the waiting-list check back")
        with self.assertRaisesRegex(psycopg.Error, "not a drive estimate"):
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", o["id"], json.dumps(ASKED))


    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        """MASKED-MUTANT RE-AIM (CC1 05:04): a later migration that ends with gate_apply() re-applies the waiting-list check to every signed-in function, so a mutant that takes the line out of THIS migration was healed by the next one
        and never failed. This test reads the file itself: its last statement before commit must be the gate, whatever is applied after it."""
        sql = (core.ROOT / "migrations" / "20261104000400_geo_questions.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])

if __name__ == "__main__":
    unittest.main()
