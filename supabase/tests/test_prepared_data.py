"""AI-prepared data (migrations/20261120000500_prepared_data.sql, NOT APPLIED) on a local Postgres. CONNECT, 2026-11-20 (Q634).

Same setup as test_download_plans.py (their helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv, TEMP/TMP on D: and RYAGRAM_LAI_REPO set:
    pgvenv/Scripts/python -m unittest supabase/tests/test_prepared_data.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the new scope 'submit_data' is offered; a token without it cannot hand a table over (it can still LIST the person's data with 'read'); a revoked grant ends the AI's access
  * a hand-over is INERT TEXT in a closed table: no API role (anon, signed-in, service, the connector login) can read or write it directly; it is not a dataset; the connector has no function that accepts, confirms or attaches it
  * what may be sent: a label and sources in plain words, 1 to 5 https addresses, a licence and units, at most 12 change-log steps, no control characters, at most 200 KB; anything else is refused in words and nothing is stored
  * at most 5 tables wait at once and 10 a day per person (PT429); another person's tables are never listed, read or discarded
  * the PERSON (a signed-in session) previews, takes the CSV, discards, and accepts: accepting records who prepared it and what was declared on THEIR dataset (prep_log), deletes the staged text, and works once, for their own fresh upload only
  * the label is never a parameter: both reads say unverified_user
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401

SCOPES = ("read", "write", "render_free", "edit", "fetch_data", "submit_data")
SOURCES = {"urls": ["https://data.census.gov/table?q=B01002"], "publisher": "U.S. Census Bureau", "licence": "Public domain (U.S. government work)", "units": "median age in years"}
CSV = "place,year,value\n" + "\n".join(f"{s},{y},{35 + (y % 7) / 3:.1f}" for s in ("Alabama", "Alaska") for y in (2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023)) + "\n"
MEASURED = {"rows": 26, "columns": 3, "places": 2, "first_period": 2010, "last_period": 2023, "periods_found": 13, "periods_missing": [2020], "shape": "long", "non_numeric_values": 0}   # every key the connector measures (CC1 review HIGH: the database refused two of them)
LOG = ["kept table B01002 estimate 001", "one row per state and year"]


class PreparedData(core.Base):
    def setUp(self):
        core.Base.setUp(self)
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')", (ALICE, BOB, tc.ADMIN, tc.NOBODY))
        c.execute("insert into public.app_admins (user_id) values (%s)", (tc.ADMIN,))
        c.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), ('loopback', 'loopback', 'loopback')", (tc.URI,))
        self.counter = 0

    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect
    fails = tc.Connect.fails

    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def alice(self, scopes=SCOPES):
        _, a, _ = self.connect(ALICE, scopes=scopes)
        return a

    def hand(self, access, label="Median age by US state", csv=CSV, sources=None, log=None, measured=None, ai="Claude"):
        return self.runner().one("select connect_submit_prepared_data(%s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s)", h(access), label, csv,
                                 json.dumps(SOURCES if sources is None else sources), json.dumps(LOG if log is None else log), json.dumps(MEASURED if measured is None else measured), ai)

    def refused(self, access, code="22023", **kw):
        with self.assertRaises(psycopg.Error) as cm:
            self.hand(access, **kw)
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        return str(cm.exception)

    def staged(self):
        return self.admin("select count(*) from public.prepared_data")

    def upload_of(self, owner, label="Median age by US state"):
        """What the browser's own upload path leaves behind (create_upload, finish_upload, the worker's read): an approved upload dataset of this person."""
        ds = self.admin("insert into public.datasets (owner_id, name) values (%s, 'upload.csv') returning id", owner)
        self.admin("update public.datasets set source = 'upload', status = 'approved', filename_label = %s, geography = 'us_states', mapping = %s::jsonb where id = %s", label, json.dumps({"cadence": "annual"}), ds)
        return ds

    # ---------------------------------------------------------------------------------------------- the scope
    def test_submit_data_is_offered_and_a_token_without_it_can_list_but_not_hand_over(self):
        self.assertIn("submit_data", self.admin("select ryagram_private.connect_offered_scopes()"))
        a = self.alice()
        r = self.hand(a)
        self.assertEqual((r["state"], r["where"]), ("waiting", "Your data"))                              # control: with the scope it works
        _, plain, _ = self.connect(ALICE, scopes=("read", "write", "render_free", "edit", "fetch_data"))
        listed = self.runner().one("select connect_list_my_data(%s)", h(plain))
        self.assertEqual((listed["datasets"], listed["waiting_for_you"]), ([], 1))                       # listing needs only 'read'; a waiting table is not a dataset
        before = self.staged()
        with self.assertRaises(psycopg.Error) as cm:
            self.hand(plain)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.assertEqual(self.staged(), before)

    def test_a_revoked_grant_ends_the_ais_access_at_once(self):
        a = self.alice()
        self.hand(a)
        self.db.c.execute("reset role")
        self.db.c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        before = self.staged()
        with self.assertRaises(psycopg.Error) as cm:
            self.hand(a)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.assertEqual(self.staged(), before)

    # ---------------------------------------------------------------------------------------------- inert text, closed table
    def test_the_staging_table_is_closed_to_every_role_and_the_connector_cannot_accept_anything(self):
        a = self.alice()
        self.hand(a)
        for role in ("anon", "authenticated", "service_role", "connect_runner"):
            self.assertFalse(self.admin("select has_table_privilege(%s, 'public.prepared_data', 'select, insert, update, delete')", role), role)
        names = {r[0] for r in self.db.c.execute("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'connect\\_%' and has_function_privilege('connect_runner', p.oid, 'execute')").fetchall()}
        self.assertIn("connect_submit_prepared_data", names)
        self.assertFalse({n for n in names if "prepared" in n and any(w in n for w in ("accept", "confirm", "attach", "approve"))})
        self.assertEqual(self.admin("select count(*) from public.datasets where prepared_from is not null"), 0)

    # ---------------------------------------------------------------------------------------------- what may be sent
    def test_what_may_be_sent_is_checked_and_nothing_is_stored_when_it_is_refused(self):
        a = self.alice()
        self.refused(a, sources={**SOURCES, "urls": ["http://www.census.gov/a"]})
        self.refused(a, sources={**SOURCES, "urls": ["https://user:pw@www.census.gov/a"]})
        self.refused(a, sources={**SOURCES, "urls": ["https://93.184.216.34/a"]})
        self.refused(a, sources={**SOURCES, "urls": []})
        self.refused(a, sources={**SOURCES, "urls": ["https://x.example.org/a"] * 6})
        self.refused(a, sources={k: v for k, v in SOURCES.items() if k != "licence"})
        self.refused(a, sources={k: v for k, v in SOURCES.items() if k != "units"})
        self.refused(a, sources={**SOURCES, "licence": "see https://evil.example/terms"})
        self.refused(a, sources={**SOURCES, "surprise": "x"})
        self.refused(a, label="")
        self.refused(a, label="<b>hi</b>")
        self.refused(a, csv="")
        self.refused(a, csv=CSV.replace("Alabama", "Ala" + chr(0) + "bama"))
        self.refused(a, csv="x" * 204801)
        self.refused(a, log=["step " + str(i) for i in range(13)])
        self.refused(a, log=["see https://evil.example"])
        self.refused(a, measured={"rows": 0, "columns": 3})
        self.refused(a, measured={"rows": 5, "columns": 3, "surprise": 1})
        self.hand(a, measured={"rows": 5, "columns": 3, "shape": "wide", "non_numeric_values": 2})                  # the two keys the connector really sends are allowed
        self.assertEqual(self.staged(), 0)
        self.refused(a, sources={**SOURCES, "urls": ["https://x.example.org/a\"onclick=\"x"]})              # no quote, angle or backtick in an address
        self.hand(a, csv=CSV + "")                                                                          # control: the good table goes in

    def test_at_most_5_wait_and_10_a_day_and_the_words_say_what_to_do(self):
        a = self.alice()
        for i in range(5):
            self.hand(a, label=f"Table {i}")
        msg = self.refused(a, code="PT429")
        self.assertIn("5 tables waiting for the person", msg)
        self.admin("update public.prepared_data set state = 'discarded'")
        for i in range(5):
            self.hand(a, label=f"Again {i}")
        self.admin("update public.prepared_data set state = 'discarded'")
        self.assertIn("10 prepared tables in a day", self.refused(a, code="PT429"))

    # ---------------------------------------------------------------------------------------------- the person's side
    def test_the_person_previews_takes_the_text_and_discards_and_nobody_else_can(self):
        a = self.alice()
        pid = self.hand(a)["prepared_id"]
        mine = self.app(ALICE).one("select my_prepared_data()")
        self.assertEqual(len(mine), 1)
        self.assertEqual((mine[0]["id"], mine[0]["trust_label"], mine[0]["ai_name"]), (pid, "unverified_user", "Claude"))
        self.assertEqual(mine[0]["measured"]["periods_missing"], [2020])
        self.assertEqual(mine[0]["preview_lines"][0], "place,year,value")
        self.assertLessEqual(len(mine[0]["preview_lines"]), 21)
        self.assertNotIn("csv_text", mine[0])
        self.assertEqual(self.app(ALICE).one("select my_prepared_data_csv(%s)", pid), CSV)
        self.assertEqual(self.app(BOB).one("select my_prepared_data()"), [])                                # another person sees nothing
        self.app(BOB)
        self.fails("select my_prepared_data_csv(%s)", pid, code="22023")
        self.assertEqual(self.app(BOB).one("select discard_prepared_data(%s)", pid), {"discarded": False})
        self.assertEqual(self.staged(), 1)
        self.assertEqual(self.app(ALICE).one("select discard_prepared_data(%s)", pid), {"discarded": True})
        self.assertEqual(self.admin("select csv_text from public.prepared_data where id = %s", pid), "")      # the text is gone at once; the empty row stays a day so discarding cannot lower the day's count
        self.assertEqual(self.admin("select state from public.prepared_data where id = %s", pid), "discarded")
        self.assertEqual(self.app(ALICE).one("select my_prepared_data()"), [])

    def test_an_expired_table_is_invisible_and_refused_and_the_purge_removes_it(self):
        a = self.alice()
        pid = self.hand(a)["prepared_id"]
        self.admin("update public.prepared_data set expires_at = now() - interval '1 minute'")
        self.assertEqual(self.app(ALICE).one("select my_prepared_data()"), [])
        self.app(ALICE)
        self.fails("select my_prepared_data_csv(%s)", pid, code="22023")
        self.assertEqual(self.runner().one("select connect_list_my_data(%s)", h(a))["waiting_for_you"], 0)
        self.assertEqual(self.admin("select ryagram_private.prepared_purge()"), 1)
        self.assertEqual(self.staged(), 0)

    def test_accepting_records_who_prepared_it_and_what_was_declared_and_drops_the_text_and_works_once(self):
        a = self.alice()
        pid = self.hand(a)["prepared_id"]
        ds = self.upload_of(ALICE)
        out = self.app(ALICE).one("select mark_prepared_accepted(%s, %s)", pid, ds)
        self.assertEqual(out, {"accepted": True, "dataset_id": str(ds)})
        log = self.admin("select prep_log from public.datasets where id = %s", ds)
        self.assertEqual((log["declared_by"], log["change_log"], log["sources"]["licence"], log["measured"]["periods_missing"]), ("Claude", LOG, SOURCES["licence"], [2020]))
        self.assertEqual(self.admin("select prepared_from from public.datasets where id = %s", ds), pid)
        self.assertEqual(self.admin("select csv_text from public.prepared_data where id = %s", pid), "")
        self.assertEqual(self.app(ALICE).one("select my_prepared_data()"), [])
        self.app(ALICE)
        self.fails("select mark_prepared_accepted(%s, %s)", pid, ds, code="22023")                          # once
        listed = self.runner().one("select connect_list_my_data(%s)", h(a))
        self.assertEqual(len(listed["datasets"]), 1)
        d = listed["datasets"][0]
        self.assertEqual((d["name"], d["trust_label"], d["prepared_by_ai"], d["status"], d["geography"], d["cadence"]), ("u_" + str(ds).replace("-", "")[:24], "unverified_user", True, "approved", "us_states", "annual"))

    def test_accepting_refuses_someone_elses_upload_an_old_upload_and_someone_elses_table(self):
        a = self.alice()
        pid = self.hand(a)["prepared_id"]
        bobs = self.upload_of(BOB)
        self.app(ALICE)
        self.fails("select mark_prepared_accepted(%s, %s)", pid, bobs, code="22023")                        # not her upload
        old = self.upload_of(ALICE)
        self.admin("update public.datasets set created_at = now() - interval '3 hours' where id = %s", old)
        self.app(ALICE)
        self.fails("select mark_prepared_accepted(%s, %s)", pid, old, code="22023")                         # not one she just made
        fresh = self.upload_of(ALICE)
        self.app(BOB)
        self.fails("select mark_prepared_accepted(%s, %s)", pid, self.upload_of(BOB), code="22023")         # not Bob's table
        self.assertEqual(self.admin("select count(*) from public.datasets where prepared_from is not null"), 0)
        self.assertEqual(self.app(ALICE).one("select mark_prepared_accepted(%s, %s)", pid, fresh)["accepted"], True)     # control

    def test_a_person_sees_only_their_own_data_by_name_and_the_label_is_never_a_parameter(self):
        a = self.alice()
        self.hand(a)
        mine = self.upload_of(ALICE)
        theirs = self.upload_of(BOB)
        listed = self.runner().one("select connect_list_my_data(%s)", h(a))
        self.assertEqual([d["name"] for d in listed["datasets"]], ["u_" + str(mine).replace("-", "")[:24]])
        self.assertNotIn(str(theirs).replace("-", "")[:24], json.dumps(listed))
        src = self.admin("select string_agg(prosrc, ' ') from pg_proc where proname in ('connect_list_my_data', 'my_prepared_data')")
        self.assertEqual(src.count("'trust_label', 'unverified_user'"), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
