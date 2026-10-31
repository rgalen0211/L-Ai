"""The admin's list of each tester's computers (migrations/20261031000100_admin_tester_devices.sql, NOT APPLIED) on a local Postgres. NEXT-WEB 187.

Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_admin_tester_devices.py -v

Rules proved (each with a control and a fault)
  * only an admin can run it: a plain account, a signed-out caller and the render node are refused; an admin gets rows
  * it lists accounts with the tester flag ON and only those: a plain account's computers never appear; a tester with no computer appears once, with no computer
  * a computer shows with its name and dates; a REVOKED sign-in and an EXPIRED one are not listed
  * it only reads: nothing in node_tokens, account_settings or jobs changes by running it; the after-check for Ryan is all true and goes false when the function is dropped (the rollback) and true again
NOT covered here (said plainly): the two film counts are not driven by real jobs in this test (a job needs a project, a version and the credits ledger); they are 0 and typed integers, and the SQL that counts is
the only thing that would be wrong.
"""
import hashlib
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
from test_connect import setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

SAM, PAT, LEE, ADMIN, PLAIN = (str(uuid.UUID(int=i)) for i in (301, 302, 303, 304, 305))
MIG = core.ROOT / "migrations" / "20261031000100_admin_tester_devices.sql"
RB = core.ROOT / "rollbacks" / "20261031000100_admin_tester_devices_rollback.sql"
CHK = core.ROOT / "live-steps" / "17_admin_tester_devices_after_check.sql"
h = lambda s: hashlib.sha256(s.encode()).hexdigest()  # noqa: E731


class TesterDevices(core.Base):
    def setUp(self):
        super().setUp()
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'sam@x'),(%s,'pat@x'),(%s,'lee@x'),(%s,'admin@x'),(%s,'plain@x')", (SAM, PAT, LEE, ADMIN, PLAIN))
        c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        for u in (SAM, PAT, LEE):
            c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true)", (u,))
        c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, false)", (PLAIN,))
        for who, name, tok, rev, exp, used in ((SAM, "SAM-PC", "a", None, "30 days", "20 seconds"), (SAM, "SAM-OLD", "b", "now()", "30 days", "9 days"), (SAM, "SAM-GONE", "c", None, "-1 minute", "40 days"),
                                               (PAT, "PAT-LAPTOP", "d", None, "10 days", "2 days"), (PLAIN, "PLAIN-PC", "e", None, "30 days", "1 minute")):
            c.execute("insert into public.node_tokens (user_id, computer_name, token_hash, expires_at, revoked_at, last_used_at) values (%s,%s,%s, now() + %s::interval, " + ("now()" if rev else "null") + ", now() - %s::interval)",
                      (who, name, h(tok), exp, used))

    def rows(self, who=ADMIN):
        d = self.db.as_(who)
        return d.c.execute("select * from public.admin_tester_devices()").fetchall()

    def test_only_an_admin_can_run_it(self):
        self.assertGreaterEqual(len(self.rows(ADMIN)), 3)
        for who in (PLAIN, SAM, "anon"):
            with self.assertRaises(psycopg.Error):
                self.rows(who)
            self.db.c.rollback()
        d = self.db.as_(None)
        d.c.execute("set role node_runner")
        with self.assertRaises(psycopg.Error):
            d.c.execute("select * from public.admin_tester_devices()")

    def test_it_lists_testers_only_with_their_live_computers(self):
        rows = self.rows()
        emails = {r[0] for r in rows}
        self.assertEqual(emails, {"sam@x", "pat@x", "lee@x"}, "a plain account never appears")
        names = sorted(r[1] for r in rows if r[1])
        self.assertEqual(names, ["PAT-LAPTOP", "SAM-PC"], "a revoked and an expired sign-in are not listed")
        lee = [r for r in rows if r[0] == "lee@x"]
        self.assertEqual(len(lee), 1); self.assertIsNone(lee[0][1]); self.assertEqual((lee[0][5], lee[0][6]), (0, 0))
        sam = [r for r in rows if r[0] == "sam@x"][0]
        self.assertIsNotNone(sam[2]); self.assertIsNotNone(sam[3]); self.assertIsNotNone(sam[4])
        self.assertEqual((sam[5], sam[6]), (0, 0))

    def test_it_only_reads(self):
        before = [self.db.as_(None).c.execute(q).fetchone()[0] for q in ("select count(*)::text || sum(extract(epoch from last_used_at))::text from public.node_tokens",
                                                                          "select count(*)::text from public.account_settings", "select count(*)::text from public.jobs")]
        self.rows(); self.rows()
        after = [self.db.as_(None).c.execute(q).fetchone()[0] for q in ("select count(*)::text || sum(extract(epoch from last_used_at))::text from public.node_tokens",
                                                                         "select count(*)::text from public.account_settings", "select count(*)::text from public.jobs")]
        self.assertEqual(before, after)

    def test_the_after_check_is_all_true_goes_false_without_the_function_and_true_again(self):
        sql = CHK.read_text(encoding="utf-8")
        self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [])
        self.db.as_(None).c.execute(RB.read_text(encoding="utf-8"))
        bad = [r for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]]
        self.assertGreaterEqual(len(bad), 1, "without the function the check must fail")
        self.db.as_(None).c.execute(MIG.read_text(encoding="utf-8"))
        self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [])


if __name__ == "__main__":
    unittest.main()
