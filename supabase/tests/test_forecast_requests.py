"""FORECAST REQUESTS (migrations/20261104000500_forecast_requests.sql) on a local Postgres, with the waiting-accounts gate (20261104000100), the geo requests (000300) and the geo question shapes (000400) in place.

Same setup as test_geo_questions.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_forecast_requests.py -v

What this proves: a person's AI asks for a forecast through its token and only ever sees its own requests; the series is validated in the database too (6 to 120 pairs of a four-digit year and a number, the years going forward);
the forecast shares the 5-open and 100-a-day caps with the place questions; every claim function hands out only its own kind of request; finish_geo takes a forecast answer only for a forecast request (and refuses a forecast
answer for any other); the new worker function and the new ask function are gated like every other; and the rollback puts the three replaced functions back.
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
ALICE, BOB = (str(uuid.UUID(int=i)) for i in (501, 502))
URI = "https://claude.ai/api/mcp/auth_callback"
VER = "v" * 43
SERIES = [[2015, 100], [2016, 102], [2017, 104], [2018, 105], [2019, 108], [2020, 109], [2021, 112], [2022, 114]]
FORECAST = {"schema": "ryagram.forecast-answer/0", "series": {"label": "Estimated"}}
DRIVE = {"schema": "ryagram.drive-estimate/0", "minutes": 10}
ASKED = {"schema": "ryagram.geo-ask/0", "shape": "verdict-question"}


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def s256(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class Forecast(core.Base):
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

    def fc(self, token, series=SERIES, horizon=3, method=None, breaks=None, unit=None):
        return self.runner().one("select connect_forecast_ask(%s, %s::text::jsonb, %s, %s, %s::text::int[], %s)", token, json.dumps(series), horizon, method,
                                 None if breaks is None else "{" + ",".join(str(b) if b is not None else "NULL" for b in breaks) + "}", unit)

    def place(self, token, lat=39.7589, lon=-84.1916):
        return self.runner().one("select connect_geo_ask_shape(%s, 'verdict', %s, %s, null, null, 'chicken', null)", token, lat, lon)

    def get(self, token, rid):
        return self.runner().one("select connect_geo_get(%s, %s)", token, rid)

    def fails(self, series, code="22023", **kw):
        with self.assertRaises(psycopg.Error) as cm:
            self.fc(self.a, series, **kw)
        self.assertEqual(cm.exception.sqlstate, code, kw)
        return cm.exception

    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def worker(self):
        return self.db.as_(core.WORKER)

    # ------------------------------------------------------------------------------------------------ asking
    def test_a_forecast_is_stored_exactly_with_its_options_and_a_repeat_is_one_request(self):
        r = self.fc(self.a, SERIES, 3, "linear", [2020, 2018, 2020], " people ")
        self.assertEqual((r["state"], r["repeat"]), ("asked", False))
        row = self.owner("select shape, series, horizon, method, breaks, unit, lat, lon, minutes, category, town, categories, state, owner_id from public.geo_requests where id = %s", r["id"]).fetchone()
        self.assertEqual((row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], str(row[13])),
                         ("forecast", SERIES, 3, "linear", [2018, 2020], "people", None, None, None, None, None, [], "asked", ALICE))
        again = self.fc(self.a, SERIES, 3, "linear", [2018, 2020], "people")
        self.assertEqual((again["id"], again["repeat"]), (r["id"], True))
        for kw in (dict(horizon=2), dict(method="log"), dict(breaks=[2018]), dict(unit="percent")):
            self.assertNotEqual(self.fc(self.a, **{"series": SERIES, "horizon": 3, "method": "linear", "breaks": [2018, 2020], "unit": "people", **kw})["id"], r["id"], kw)
            self.owner("update public.geo_requests set state = 'answered', answer = %s::jsonb, finished_at = now()", json.dumps(FORECAST))
        got = self.get(self.a, r["id"])
        self.assertEqual((got["shape"], got["horizon"], got["method"], got["unit"], got["state"]), ("forecast", 3, "linear", "people", "answered"))
        self.assertNotIn("series", got, "the series is not handed back: the answer carries what was used")

    def test_bad_requests_are_refused_by_the_database_too_and_nothing_is_written(self):
        ok = [list(p) for p in SERIES]
        for label, series, kw in [
            ("five pairs", ok[:5], {}), ("121 pairs", [[1900 + i, i] for i in range(121)], {}), ("not an array", {"a": 1}, {}), ("a pair of three", ok[:7] + [[2023, 1, 2]], {}),
            ("a text year", ok[:7] + [["2022", 114]], {}), ("a text value", ok[:7] + [[2022, "114"]], {}), ("a null value", ok[:7] + [[2022, None]], {}), ("a three-digit year", [[999, 1]] + ok, {}),
            ("a fractional year", ok[:7] + [[2022.5, 1]], {}), ("the same year twice", ok[:7] + [[2021, 114]], {}), ("years going backwards", ok[:7] + [[2010, 114]], {}),
            ("a huge number", ok[:7] + [[2022, 1e16]], {}), ("horizon 0", ok, dict(horizon=0)), ("horizon 11", ok, dict(horizon=11)), ("no horizon", ok, dict(horizon=None)),
            ("an unknown method", ok, dict(method="prophet")), ("seasonal_naive", ok, dict(method="seasonal_naive")), ("six breaks", ok, dict(breaks=[2001, 2002, 2003, 2004, 2005, 2006])),
            ("a null break", ok, dict(breaks=[None, 2020])), ("a break before 1000", ok, dict(breaks=[999])), ("a unit with a newline", ok, dict(unit="people\nx")), ("a 31-character unit", ok, dict(unit="a" * 31)),
        ]:
            with self.assertRaises(psycopg.Error, msg=label) as cm:
                self.fc(self.a, series, **{"horizon": 3, **kw})
            self.assertEqual(cm.exception.sqlstate, "22023", label)
            for needle in ("2015", "114", "102"):
                self.assertNotIn(needle, (cm.exception.diag.message_primary or "") + (cm.exception.diag.message_detail or ""), label)
        with self.assertRaises(psycopg.Error):
            self.fc(self.a, None, 3)
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 0)

    def test_the_table_will_not_hold_a_forecast_row_with_the_wrong_fields_or_another_shape_with_forecast_fields(self):
        ins = "insert into public.geo_requests (owner_id, shape, series, horizon, method, lat, lon, minutes, category, town, categories) values (%s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, '{}')"
        s = json.dumps(SERIES)
        for bad in [("forecast", None, 3, None, None, None, None, None, None), ("forecast", s, None, None, None, None, None, None, None), ("forecast", s, 3, None, 1, 1, None, None, None),
                    ("forecast", s, 3, None, None, None, None, "chicken", None), ("forecast", s, 3, "nope", None, None, None, None, None), ("forecast", s, 11, None, None, None, None, None, None),
                    ("forecast", json.dumps(SERIES[:5]), 3, None, None, None, None, None, None), ("verdict", s, 3, None, 1, 1, None, "chicken", None), ("verdict", None, None, "linear", 1, 1, None, "chicken", None),
                    ("where_to_go", s, 3, None, None, None, None, "chicken", None)]:
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.owner(ins, ALICE, *bad)
        self.owner(ins, ALICE, "forecast", s, 3, "log", None, None, None, None, None)
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 1)

    def test_five_open_and_one_hundred_a_day_count_forecasts_and_place_questions_together(self):
        for i in range(3):
            self.fc(self.a, [[y, v + i] for y, v in SERIES])
        self.place(self.a, 31, -80)
        self.place(self.a, 32, -80)
        with self.assertRaises(psycopg.Error) as cm:
            self.fc(self.a, [[y, v + 9] for y, v in SERIES])
        self.assertEqual(cm.exception.sqlstate, "PT429")
        with self.assertRaises(psycopg.Error) as cm:
            self.place(self.a, 40, -80)
        self.assertEqual(cm.exception.sqlstate, "PT429")
        self.owner("update public.geo_requests set state = 'answered', answer = %s::jsonb, finished_at = now()", json.dumps(FORECAST))
        self.owner("insert into public.geo_requests (owner_id, lat, lon, minutes, state, finished_at) select %s, 10 + g * 0.01, 10, 5, 'answered', now() from generate_series(1, 95) g", ALICE)
        with self.assertRaises(psycopg.Error) as cm:
            self.fc(self.a, [[y, v + 7] for y, v in SERIES])
        self.assertEqual(cm.exception.sqlstate, "PT429")
        self.assertTrue(self.fc(self.b)["id"], "another person is not held up by Alice's limits")

    def test_another_person_cannot_read_a_forecast_and_no_api_role_can_call_the_ask_directly(self):
        r = self.fc(self.a)
        self.assertIsNone(self.get(self.b, r["id"]))
        for who in ("anon", ALICE, "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select connect_forecast_ask(%s, '[]'::jsonb, 3, null, null, null)", self.a)
        with self.assertRaises(psycopg.Error):
            self.runner().one("select connect_forecast_ask(%s, '[]'::jsonb, 3, null, null, null)", "0" * 64)            # a token that is not live

    def test_nothing_older_than_seven_days_survives_a_forecast_ask(self):
        self.owner("insert into public.geo_requests (owner_id, shape, series, horizon, asked_at) values (%s, 'forecast', %s::jsonb, 3, now() - interval '8 days')", ALICE, json.dumps(SERIES))
        self.fc(self.b)
        self.assertEqual(self.owner("select count(*) from public.geo_requests where asked_at < now() - interval '7 days'").fetchone()[0], 0)

    # ------------------------------------------------------------------------------------------------ the house worker
    def test_each_claim_function_hands_out_only_its_own_kind(self):
        f = self.fc(self.a, SERIES, 4, "log", [2018], "people")
        old = self.runner().one("select connect_geo_ask(%s, 39.7589, -84.1916, 10, array['chicken'])", self.a)
        v = self.place(self.a)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).c.execute("select * from public.claim_next_forecast()")
        self.assertEqual([str(r[0]) for r in self.worker().c.execute("select request_id from public.claim_next_geo()").fetchall()], [old["id"]])
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo()").fetchall(), [], "the place claim never hands out a forecast")
        self.assertEqual([str(r[0]) for r in self.worker().c.execute("select request_id from public.claim_next_geo_question()").fetchall()], [v["id"]])
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall(), [], "the question claim never hands out a forecast")
        cur = self.worker().c.execute("select request_id, series, horizon, method, breaks, unit from public.claim_next_forecast()")
        self.assertEqual([d.name for d in cur.description], ["request_id", "series", "horizon", "method", "breaks", "unit"])
        got = cur.fetchall()
        self.assertEqual([(str(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in got], [(f["id"], SERIES, 4, "log", [2018], "people")])
        self.assertEqual(self.owner("select state, claimed_at is not null from public.geo_requests where id = %s", f["id"]).fetchone(), ("claimed", True))
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_forecast()").fetchall(), [], "a claimed request is not handed out twice")

    def test_a_claim_nobody_finished_comes_back_and_claims_off_means_no_claims(self):
        self.fc(self.a)
        self.worker().c.execute("select * from public.claim_next_forecast()").fetchall()
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_forecast()").fetchall(), [])
        self.owner("update public.geo_requests set claimed_at = now() - interval '11 minutes'")
        self.assertEqual(len(self.worker().c.execute("select * from public.claim_next_forecast()").fetchall()), 1)
        self.owner("update public.geo_requests set claimed_at = now() - interval '11 minutes'")
        self.owner("update public.control set claims_enabled = false")
        self.assertEqual(self.worker().c.execute("select * from public.claim_next_forecast()").fetchall(), [])

    def test_finish_geo_takes_a_forecast_answer_only_for_a_forecast_request_and_a_forecast_request_takes_nothing_else(self):
        f = self.fc(self.a)
        v = self.place(self.a)
        o = self.runner().one("select connect_geo_ask(%s, 39.76, -84.19, 10, '{}')", self.a)
        self.worker().c.execute("select * from public.claim_next_forecast()").fetchall()
        self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall()
        self.worker().c.execute("select * from public.claim_next_geo()").fetchall()
        for rid, doc in [(f["id"], DRIVE), (f["id"], ASKED), (v["id"], FORECAST), (o["id"], FORECAST)]:
            with self.assertRaisesRegex(psycopg.Error, "not for this kind", msg=str(doc)):
                self.worker().one("select public.finish_geo(%s, %s::jsonb)", rid, json.dumps(doc))
        with self.assertRaisesRegex(psycopg.Error, "not a drive estimate"):
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", f["id"], '{"schema": "something.else"}')
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select public.finish_geo(%s, %s::jsonb)", f["id"], json.dumps(FORECAST))
        self.assertEqual(self.get(self.a, f["id"])["state"], "claimed", "every refused finish left the request claimed")
        self.worker().one("select public.finish_geo(%s, %s::jsonb)", f["id"], json.dumps(FORECAST))
        self.worker().one("select public.finish_geo(%s, %s::jsonb)", v["id"], json.dumps(ASKED))
        self.worker().one("select public.finish_geo(%s, %s::jsonb)", o["id"], json.dumps(DRIVE))
        self.assertEqual((self.get(self.a, f["id"])["state"], self.get(self.a, f["id"])["answer"]["series"]["label"]), ("answered", "Estimated"))
        with self.assertRaises(psycopg.Error) as cm:
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", f["id"], json.dumps(FORECAST))
        self.assertEqual(cm.exception.sqlstate, "PT404")

    def test_fail_geo_works_for_a_forecast_and_the_ai_can_read_why(self):
        f = self.fc(self.a)
        self.worker().c.execute("select * from public.claim_next_forecast()").fetchall()
        self.worker().one("select public.fail_geo(%s, 'geo_request_rejected', 'only 5 years of history; a forecast needs at least 6')", f["id"])
        g = self.get(self.a, f["id"])
        self.assertEqual((g["state"], g["fail_code"], g["fail_detail"]), ("failed", "geo_request_rejected", "only 5 years of history; a forecast needs at least 6"))
        self.assertNotEqual(self.fc(self.a)["id"], f["id"], "a failed request can be asked again")

    # ------------------------------------------------------------------------------------------------ the waiting-list gate
    def test_a_waiting_account_cannot_ask_and_the_gate_covers_every_new_and_replaced_function(self):
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", ALICE)
        with self.assertRaises(psycopg.Error):
            self.fc(self.a)
        self.owner("update public.account_status set status = 'active' where user_id = %s", ALICE)
        self.assertTrue(self.fc(self.a)["id"])
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "claim_next_forecast, claim_next_geo_question and finish_geo carry the waiting-list check")

    def test_the_rollback_puts_the_replaced_functions_back_and_removes_every_forecast_object(self):
        f = self.fc(self.a)
        v = self.place(self.a)
        self.owner((core.ROOT / "rollbacks" / "20261104000500_forecast_requests_rollback.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.owner("select count(*) from public.geo_requests").fetchone()[0], 1, "only the place question's row is left")
        self.assertIsNone(self.get(self.a, f["id"]))
        names = {r[0] for r in self.owner("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '%forecast%' or p.proname like '%geo%')").fetchall()}
        self.assertEqual(names, {"connect_geo_ask", "connect_geo_ask_shape", "connect_geo_get", "claim_next_geo", "claim_next_geo_question", "finish_geo", "fail_geo", "geo_purge"})
        cols = {r[0] for r in self.owner("select column_name from information_schema.columns where table_name = 'geo_requests'").fetchall()}
        self.assertFalse(cols & {"series", "horizon", "method", "breaks", "unit"})
        self.assertEqual(self.get(self.a, v["id"])["shape"], "verdict")
        self.assertEqual(tw.ungated(self.db.as_(None).c), [], "the restored functions got the waiting-list check back")
        with self.assertRaises(psycopg.Error):
            self.owner("insert into public.geo_requests (owner_id, shape, lat, lon, minutes) values (%s, 'forecast', 1, 1, 1)", ALICE)
        self.worker().c.execute("select * from public.claim_next_geo_question()").fetchall()
        with self.assertRaisesRegex(psycopg.Error, "not for this kind"):
            self.worker().one("select public.finish_geo(%s, %s::jsonb)", v["id"], json.dumps(DRIVE))


if __name__ == "__main__":
    unittest.main()
