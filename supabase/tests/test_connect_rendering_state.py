"""The render machine's state for the connected AI (migrations/20261027001100_connect_rendering_state.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 153.

Same setup as test_live_editor.py / test_connect.py (their helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_rendering_state.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the answer is the public status page's own word: unknown (the machine was never seen), ok (checked in recently) or delayed (not checking in); it names no worker and no person
  * it needs the 'read' scope; a revoked grant ends it; it changes nothing
  * only the connector's role may run it
  * the rollback removes it
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

WORKER = "00000000-0000-4000-8000-0000000000c1"


class RenderingState(core.Base):
    def setUp(self):
        core.Base.setUp(self)
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x'),(%s,'w@x')", (ALICE, BOB, tc.ADMIN, tc.NOBODY, WORKER))
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

    def alice(self, scopes=("read", "write", "render_free")):
        _, a, _ = self.connect(ALICE, scopes=scopes)
        return a

    def state(self, access):
        return self.runner().one("select connect_rendering_state(%s)", h(access))

    def worker(self, ago=None, enabled=True):
        self.db.c.execute("reset role")
        self.db.c.execute("delete from public.workers")
        self.db.c.execute("insert into public.workers (user_id, name, enabled, last_seen_at) values (%s, 'render-1', %s, case when %s::text is null then null else now() - %s::interval end)", (WORKER, enabled, ago, ago))

    def test_the_answer_is_the_status_pages_word_for_the_machines_last_check_in(self):
        a = self.alice()
        self.assertEqual(self.state(a), "unknown")                                                         # never seen: no false alarm
        self.worker(None)
        self.assertEqual(self.state(a), "unknown")                                                         # a worker row that never checked in
        self.worker("10 seconds")
        self.assertEqual(self.state(a), "ok")
        self.worker("2 hours")
        self.assertEqual(self.state(a), "delayed")
        self.worker("10 seconds", enabled=False)
        self.assertEqual(self.state(a), "unknown")                                                         # a disabled machine does not count
        self.assertEqual(self.admin("select ryagram_private.service_state()"), "unknown")                  # and it is exactly the status page's own word

    def test_it_names_nobody_and_changes_nothing(self):
        a = self.alice()
        self.worker("2 hours")
        before = [self.admin(f"select count(*) from {t}") for t in ("public.jobs", "public.workers", "public.projects", "public.versions")]
        got = self.state(a)
        self.assertIn(got, ("ok", "delayed", "unknown"))
        self.assertIsInstance(got, str)
        self.assertEqual(before, [self.admin(f"select count(*) from {t}") for t in ("public.jobs", "public.workers", "public.projects", "public.versions")])

    def test_it_needs_the_read_scope_and_a_live_grant(self):
        a = self.alice()
        self.assertEqual(self.state(a), "unknown")                                                         # control
        _, w, _ = self.connect(ALICE, scopes=("write",))
        with self.assertRaises(psycopg.Error) as cm:
            self.state(w)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.db.c.execute("reset role")
        self.db.c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        with self.assertRaises(psycopg.Error) as cm2:
            self.state(a)
        self.assertEqual(cm2.exception.sqlstate, "PT403")

    def test_only_the_connector_role_may_run_it(self):
        fn = "public.connect_rendering_state(text)"
        self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", fn))
        for role in ("anon", "authenticated", "node_runner", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), role)

    def test_the_rollback_removes_it(self):
        self.db.c.execute("reset role")
        self.db.c.execute((core.ROOT / "rollbacks" / "20261027001100_connect_rendering_state_rollback.sql").read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regprocedure('public.connect_rendering_state(text)')"))
        self.db.c.execute((core.ROOT / "migrations" / "20261027001100_connect_rendering_state.sql").read_text(encoding="utf-8"))          # and it applies again
        self.assertIsNotNone(self.admin("select to_regprocedure('public.connect_rendering_state(text)')"))


if __name__ == "__main__":
    unittest.main()
