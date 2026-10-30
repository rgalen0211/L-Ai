"""Footage plans, the AI half (migrations/20261030000200_footage_plans.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 168, slice P1b.

Same setup as test_download_plans.py (test_connect's helpers, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_footage_plans.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * THE SWITCH IS OFF: public.footage_flags.footage_enabled is false by default; while it is false the AI's request is refused in words (PT400) and nothing is written; turning it on is a deliberate update
  * a token without 'fetch_data' cannot write a plan (PT403) but can still LIST with 'read'; a revoked grant ends the AI's access
  * a plan is a SOURCE (nasa or nara), that source's ITEM ID and a plain reason: an address, a path, a bad id for that source, a bad reason or another source is refused in words and nothing is written
  * asking again for the item already waiting returns the same plan; at most 5 wait at once and 20 a day per person (PT429); another person's plans are never listed
  * writing a plan starts nothing (no job, version or project); the connector's role has no table privilege on the plans; the rollback removes everything and the migration applies again
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

SCOPES = ("read", "write", "render_free", "edit", "fetch_data")
NASA = ("nasa", "NHQ_2019_0716", "the launch for the intro of my film")


class FootagePlans(core.Base):
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

    def switch(self, on=True):
        self.db.c.execute("reset role")
        self.db.c.execute("update public.footage_flags set footage_enabled = %s", (on,))

    def alice(self, scopes=SCOPES):
        _, a, _ = self.connect(ALICE, scopes=scopes)
        return a

    def ask(self, access, source="nasa", item="NHQ_2019_0716", why="the launch for the intro of my film"):
        return self.runner().one("select connect_request_footage(%s, %s, %s, %s)", h(access), source, item, why)

    def refused(self, access, source, item, why, code="22023"):
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(access, source, item, why)
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        return str(cm.exception)

    def count(self):
        return self.admin("select count(*) from public.footage_plans")

    # ---------------------------------------------------------------------------------------------- the switch
    def test_the_switch_is_off_by_default_and_nothing_is_written_until_it_is_turned_on(self):
        self.assertFalse(self.admin("select footage_enabled from public.footage_flags"))
        self.assertFalse(self.admin("select ryagram_private.footage_on()"))
        a = self.alice()
        msg = self.refused(a, *NASA, code="PT400")
        self.assertIn("not available yet", msg)
        self.assertEqual(self.count(), 0)
        self.switch(True)
        self.assertTrue(self.admin("select ryagram_private.footage_on()"))
        r = self.ask(a)                                                                                    # control: with the switch on it works
        self.assertEqual((r["state"], r["already"]), ("waiting", False))
        self.switch(False)
        self.refused(a, "nasa", "NHQ_2019_0717", "another", code="PT400")                                  # and off again stops new requests
        self.assertEqual(len(self.runner().one("select connect_list_footage(%s)", h(a))), 1)                  # listing still answers while the switch is off

    def test_the_scope_and_a_revoked_grant(self):
        self.switch(True)
        a = self.alice()
        self.ask(a)
        _, plain, _ = self.connect(ALICE, scopes=("read", "write", "render_free", "edit"))
        self.assertEqual(len(self.runner().one("select connect_list_footage(%s)", h(plain))), 1)             # listing needs only 'read'
        before = self.count()
        self.refused(plain, "nasa", "NHQ_2019_0718", "x", code="PT403")
        self.assertEqual(self.count(), before)
        self.db.c.execute("reset role")
        self.db.c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        self.refused(a, "nasa", "NHQ_2019_0719", "x", code="PT403")
        self.assertEqual(self.count(), before)

    # ---------------------------------------------------------------------------------------------- what a plan may hold
    def test_a_plan_is_a_source_an_item_id_and_a_plain_reason_never_an_address(self):
        self.switch(True)
        a = self.alice()
        self.ask(a, "nasa", "NHQ_2019_0716")
        self.ask(a, "nara", "12345678")
        self.db.c.execute("reset role")
        self.db.c.execute("delete from public.footage_plans")
        bad = [("youtube", "abcdefghijk"), ("nasa", "https://evil.example/a.mp4"), ("nasa", "../../etc/passwd"), ("nasa", "ab"), ("nasa", "abc?x=1"), ("nasa", "x" * 101), ("nasa", ""),
               ("nara", "abc12345"), ("nara", "12"), ("nara", "1234567890123"), ("nara", "NHQ_2019_0716"), (None, "12345678"), ("nasa", None), ("NASA", "NHQ_2019_0716")]
        for src, item in bad:
            self.refused(a, src, item, "a reason")
        for why in ("", "x" * 301, "see https://evil.example", "save it in C:" + chr(92) + "Users" + chr(92) + "me", "<b>hi</b>", "tab" + chr(9) + "ed", None):
            self.refused(a, "nasa", "NHQ_2019_0716", why)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.admin("select count(*) from information_schema.columns where table_name = 'footage_plans' and column_name in ('url', 'host', 'folder', 'path')"), 0, "the table has no place for an address")

    def test_asking_again_for_the_waiting_item_is_the_same_plan_then_five_waiting_and_twenty_a_day(self):
        self.switch(True)
        a = self.alice()
        b = self.connect(BOB, scopes=SCOPES)[1]
        first = self.ask(a)
        again = self.ask(a, why="a different sentence")
        self.assertEqual((again["id"], again["already"]), (first["id"], True))
        self.assertEqual(self.count(), 1)
        for i in range(4):
            self.ask(a, "nasa", f"NHQ_2019_10{i}")
        self.refused(a, "nasa", "NHQ_2019_9999", "one more", code="PT429")
        self.assertEqual(self.count(), 5)
        self.ask(b)                                                                                        # control: Bob has his own allowance and his own plan of the same item
        self.db.c.execute("reset role")
        self.db.c.execute("update public.footage_plans set state = 'done' where owner_id = %s", (ALICE,))
        self.ask(a, "nara", "55555555")                                                                    # finished plans no longer wait
        self.db.c.execute("reset role")
        self.db.c.execute("insert into public.footage_plans (owner_id, source, item_id, why, state, created_at) select %s, 'nara', (100000 + g)::text, 'x', 'done', now() - interval '1 hour' from generate_series(1, 20) g", (ALICE,))
        self.refused(a, "nasa", "NHQ_2019_0000", "too many today", code="PT429")
        mine = self.runner().one("select connect_list_footage(%s)", h(a))
        self.assertTrue(all(set(r) == {"id", "source", "item_id", "why", "state", "created_at", "receipt"} for r in mine))
        theirs = self.runner().one("select connect_list_footage(%s)", h(b))
        self.assertEqual([(r["source"], r["item_id"]) for r in theirs], [("nasa", "NHQ_2019_0716")])

    def test_the_list_shows_a_small_receipt_and_never_a_file_name_or_a_title(self):
        self.switch(True)
        a = self.alice()
        r = self.ask(a)
        self.db.c.execute("reset role")
        self.db.c.execute("update public.footage_plans set state = 'done', receipt = %s::jsonb where id = %s",
                          ('{"source": "nasa", "item_id": "NHQ_2019_0716", "rights_label_as_shown": "NASA media guidelines: generally not subject to copyright", "retrieved": "2026-10-30", "host": "images-assets.nasa.gov", "bytes": 123456, "sha256": "' + "a" * 64 + '"}', r["id"]))
        row = self.runner().one("select connect_list_footage(%s)", h(a))[0]
        self.assertEqual(set(row["receipt"]), {"bytes", "sha256", "retrieved", "rights_label_as_shown"})
        self.assertEqual((row["state"], row["receipt"]["bytes"]), ("done", 123456))

    def test_asking_starts_nothing_and_the_connector_role_has_no_table_privilege(self):
        self.switch(True)
        a = self.alice()
        tables = ("public.jobs", "public.versions", "public.projects")
        before = [self.admin(f"select count(*) from {t}") for t in tables]
        self.ask(a)
        self.assertEqual(before, [self.admin(f"select count(*) from {t}") for t in tables])
        with self.assertRaises(psycopg.Error):
            self.runner().one("select count(*) from public.footage_plans")
        for fn in ("public.connect_request_footage(text,text,text,text)", "public.connect_list_footage(text)"):
            self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", fn))
            for role in ("anon", "authenticated", "node_runner"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), f"{role} {fn}")
        for fn in ("public.node_footage_plans(text)", "public.node_footage_update(text,uuid,text,jsonb)"):
            self.assertTrue(self.admin("select has_function_privilege('node_runner', %s, 'execute')", fn))
            self.assertFalse(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", fn))
        for role in ("anon", "authenticated", "connect_runner", "node_runner"):
            self.assertFalse(self.admin("select has_function_privilege(%s, 'ryagram_private.footage_on()', 'execute')", role), role)

    def test_the_rollback_removes_everything_and_the_migration_applies_again(self):
        self.switch(True)
        self.ask(self.alice())
        self.db.c.execute("reset role")
        self.db.c.execute((core.ROOT / "rollbacks" / "20261030000200_footage_plans_rollback.sql").read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regclass('public.footage_plans')"))
        self.assertIsNone(self.admin("select to_regprocedure('public.connect_request_footage(text,text,text,text)')"))
        self.assertEqual(self.admin("select count(*) from pg_class where relname = 'footage_flags' and relnamespace = 'public'::regnamespace"), 0)
        self.assertIn("fetch_data", self.admin("select ryagram_private.connect_offered_scopes()"), "the download plans' scope is untouched")
        self.db.c.execute((core.ROOT / "migrations" / "20261030000200_footage_plans.sql").read_text(encoding="utf-8"))
        self.assertFalse(self.admin("select footage_enabled from public.footage_flags"), "applied again, the switch is OFF")


if __name__ == "__main__":
    unittest.main()
