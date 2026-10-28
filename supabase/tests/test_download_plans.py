"""Download plans, the AI half (migrations/20261027000500_download_plans.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 152.

Same setup as test_live_editor.py / test_connect.py (their helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_download_plans.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the new scope 'fetch_data' is offered; a token without it cannot write a plan (it can still LIST plans with 'read'); a revoked grant ends the AI's access
  * a plan is DATA: an https address (website name, no user name, no port, no bare IP number, no spaces), a short plain reason, a folder NAME; anything else is refused in words and nothing is written
  * at most 5 plans wait at once and 20 a day per person (code PT429); another person's plans are never listed
  * writing a plan starts nothing: no job, no credit, no story; the connector's role has no table privilege on the plans
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

SCOPES = ("read", "write", "render_free", "edit", "fetch_data")
URL = "https://www.census.gov/data/counties.csv"


class DownloadPlans(core.Base):
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

    def ask(self, access, url=URL, why="the county table for your map", folder="Census"):
        return self.runner().one("select connect_request_download(%s, %s, %s, %s)", h(access), url, why, folder)

    def refused(self, access, url=URL, why="a reason", folder="Census", code="22023"):
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(access, url, why, folder)
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        return str(cm.exception)

    def count(self):
        return self.admin("select count(*) from public.download_plans")

    # ---------------------------------------------------------------------------------------------- the scope
    def test_fetch_data_is_offered_and_a_token_without_it_can_list_but_not_ask(self):
        self.assertIn("fetch_data", self.admin("select ryagram_private.connect_offered_scopes()"))
        a = self.alice()
        r = self.ask(a)
        self.assertEqual((r["host"], r["state"]), ("www.census.gov", "waiting"))                          # control: with the scope it works
        _, plain, _ = self.connect(ALICE, scopes=("read", "write", "render_free", "edit"))
        self.assertEqual(len(self.runner().one("select connect_list_downloads(%s)", h(plain))), 1)        # listing needs only 'read'
        before = self.count()
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(plain)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.assertEqual(self.count(), before)

    def test_a_revoked_grant_ends_the_ais_access_at_once(self):
        a = self.alice()
        self.ask(a)
        self.db.c.execute("reset role")
        self.db.c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        before = self.count()
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(a)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.assertEqual(self.count(), before)

    # ---------------------------------------------------------------------------------------------- what a plan may hold
    def test_a_plan_is_an_https_website_a_plain_reason_and_a_folder_name(self):
        a = self.alice()
        for ok in ("https://www.census.gov/a.csv", "https://data.example.org/x/y.zip?year=2020", "https://example.org", "https://a.b.c.example.co.uk/path%20x/file.parquet"):
            self.ask(a, ok)
            self.db.c.execute("reset role")
            self.db.c.execute("delete from public.download_plans")
        self.assertEqual(self.count(), 0)
        bad = {"http": "http://www.census.gov/a.csv", "user": "https://user:pw@www.census.gov/a.csv", "at": "https://www.census.gov@evil.example/a.csv", "ip": "https://93.184.216.34/a.csv",
               "port": "https://www.census.gov:8443/a.csv", "no dot": "https://localhost/a.csv", "file": "file:///C:/x.csv", "space": "https://www.census.gov/a b.csv",
               "control": "https://www.census.gov/a" + chr(1) + ".csv", "non-ascii": "https://www.census.gov/\u00e9.csv", "empty": "", "ftp": "ftp://x.example.org/a", "long": "https://x.example.org/" + "a" * 2100}
        for label, u in bad.items():
            self.refused(a, u)
        self.assertEqual(self.count(), 0)
        for why in ("", "x" * 301, "see https://evil.example", "save it in C:" + chr(92) + "Users" + chr(92) + "me", "<b>hi</b>", "tab" + chr(9) + "ed"):
            self.refused(a, URL, why)
        for folder in ("C:" + chr(92) + "Users", "../up", "..", ".", "a/b", "x" * 61):
            self.refused(a, URL, "reason", folder)
        self.assertEqual(self.count(), 0)
        self.ask(a, URL, "fine", "")                                                                       # an empty folder name means the app's default

    # ---------------------------------------------------------------------------------------------- limits and privacy
    def test_five_waiting_at_once_and_twenty_a_day_and_nobody_elses_plans_are_listed(self):
        a = self.alice()
        b = self.connect(BOB, scopes=SCOPES)[1]
        for i in range(5):
            self.ask(a, f"https://www.census.gov/f{i}.csv")
        self.refused(a, URL, "one more", "Census", code="PT429")
        self.assertEqual(self.count(), 5)
        self.ask(b, "https://data.example.org/bob.csv")                                                    # control: Bob has his own allowance
        self.db.c.execute("reset role")
        self.db.c.execute("update public.download_plans set state = 'done' where owner_id = %s", (ALICE,))
        self.ask(a, URL)                                                                                   # finished plans no longer wait
        self.db.c.execute("reset role")
        self.db.c.execute("insert into public.download_plans (owner_id, request, host, state, created_at) select %s, '{}'::jsonb, 'x.example.org', 'done', now() - interval '1 hour' from generate_series(1, 20)", (ALICE,))
        self.refused(a, URL, "too many today", "Census", code="PT429")
        mine = self.runner().one("select connect_list_downloads(%s)", h(a))
        self.assertTrue(all(r["host"] != "data.example.org" for r in mine))
        theirs = self.runner().one("select connect_list_downloads(%s)", h(b))
        self.assertEqual([r["host"] for r in theirs], ["data.example.org"])

    def test_the_list_shows_the_state_and_a_small_receipt_and_never_a_file_name(self):
        a = self.alice()
        r = self.ask(a)
        self.db.c.execute("reset role")
        self.db.c.execute("update public.download_plans set state = 'done', receipt = %s::jsonb where id = %s",
                          (json.dumps({"schema": "ryagram.download-receipt/0", "address_host": "www.census.gov", "final_host": "www.census.gov", "retrieved": "2026-10-27", "bytes": 1234, "sha256": "a" * 64,
                                       "kind": "text", "members": 0, "licence": "not stated", "trust_label": "official"}), r["id"]))
        row = self.runner().one("select connect_list_downloads(%s)", h(a))[0]
        self.assertEqual((row["state"], row["receipt"]["bytes"], row["receipt"]["sha256"], row["receipt"]["trust_label"]), ("done", 1234, "a" * 64, "official"))
        self.assertEqual(set(row), {"id", "host", "url", "why", "folder", "state", "created_at", "receipt"})
        self.assertEqual(set(row["receipt"]), {"bytes", "sha256", "members", "trust_label", "retrieved"})

    def test_asking_starts_nothing_and_the_connector_role_has_no_table_privilege(self):
        a = self.alice()
        before = [self.admin(f"select count(*) from {t}") for t in ("public.jobs", "public.versions", "public.projects")]
        self.ask(a)
        self.assertEqual(before, [self.admin(f"select count(*) from {t}") for t in ("public.jobs", "public.versions", "public.projects")])
        with self.assertRaises(psycopg.Error):
            self.runner().one("select count(*) from public.download_plans")
        for fn in ("public.connect_request_download(text,text,text,text)", "public.connect_list_downloads(text)"):
            self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", fn))
            for role in ("anon", "authenticated", "node_runner"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), f"{role} {fn}")

    def test_the_rollback_removes_everything_and_puts_the_old_scope_list_back(self):
        self.ask(self.alice())
        self.db.c.execute("reset role")
        self.db.c.execute((core.ROOT / "rollbacks" / "20261027000500_download_plans_rollback.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select ryagram_private.connect_offered_scopes()"), ["read", "write", "render_free", "edit"])
        self.assertIsNone(self.admin("select to_regclass('public.download_plans')"))
        self.db.c.execute((core.ROOT / "migrations" / "20261027000500_download_plans.sql").read_text(encoding="utf-8"))          # and it applies again
        self.assertIn("fetch_data", self.admin("select ryagram_private.connect_offered_scopes()"))


if __name__ == "__main__":
    unittest.main()
