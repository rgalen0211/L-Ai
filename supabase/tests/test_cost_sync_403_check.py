"""LIVE STEP 76, the cost-sync 403 check (CONNECT 2026-11-26): read-only, on minimal stand-ins for pg_cron, pg_net and Vault (the same stand-ins as test_purge_jobs_steps.py; it proves the SQL parses and answers as its header says, not the real extensions).
    pgvenv/Scripts/python -m unittest supabase/tests/test_cost_sync_403_check.py -v
What it proves, each with the opposite case beside it
  * all rows true with the job at :00 reading cron_cost_sync, a long distinct secret and no 403; each fault makes its own row false: no job, an inactive job, another schedule, a command that sends the service-role key or another job's secret, a missing or short secret, a secret equal to another job's, a 'Not allowed' 403 in the last 2 hours (an OLD one, 3 hours, does not);
  * it never prints a secret, and changes nothing."""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_purge_jobs_steps as pj  # noqa: E402

LS = core.ROOT / "live-steps"
S76 = (LS / "76_cost_sync_403_check.sql").read_text(encoding="utf-8")
S76B = (LS / "76b_cost_sync_secret_digests.sql").read_text(encoding="utf-8")
S77 = (LS / "77_cost_sync_reschedule.sql").read_text(encoding="utf-8")
S77B = (LS / "77b_cost_sync_unschedule.sql").read_text(encoding="utf-8")
_server = None
_count = 0
JOB = ("insert into cron.job (jobname, schedule, command) values ('cost-sync', '0 * * * *', "
       "$q$ select net.http_post(url := 'https://x.supabase.co/functions/v1/cost-sync', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_cost_sync')), body := '{}'::jsonb) $q$)")


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-costsync-")


class CostSync403(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"cs{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name}")
        self.c = psycopg.connect(_server.get_uri(database=self.name), autocommit=True)
        self.c.execute(pj.STUB)
        self.c.execute(JOB)
        for name, val in pj.GOOD.items():
            self.c.execute("insert into vault.decrypted_secrets (name, decrypted_secret) values (%s, %s)", (name, val))

    def tearDown(self):
        self.c.close()

    def grid(self):
        return [r[1] for r in self.c.execute(S76).fetchall()]

    def test_all_true_when_the_scheduler_side_is_right_and_no_403(self):
        self.assertEqual(self.grid(), [True] * 6)
        self.c.execute("insert into net._http_response (id, status_code, content) values (1, 200, '{\"ok\":true}')")
        self.assertEqual(self.grid(), [True] * 6)

    def test_each_scheduler_side_fault_makes_its_own_row_false(self):
        for what, sql, row in (("no job", "delete from cron.job", 0), ("inactive", "update cron.job set active = false", 0), ("another schedule", "update cron.job set schedule = '30 * * * *'", 0),
                                ("sends the service key", "update cron.job set command = replace(command, 'cron_cost_sync', 'service_role_key')", 1),
                                ("sends another job's secret", "update cron.job set command = replace(command, 'cron_cost_sync', 'cron_ops_tick')", 1),
                                ("secret missing", "delete from vault.decrypted_secrets where name = 'cron_cost_sync'", 2),
                                ("secret short", "update vault.decrypted_secrets set decrypted_secret = 'short' where name = 'cron_cost_sync'", 2),
                                ("secret equals another job's", "update vault.decrypted_secrets set decrypted_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'cron_ops_tick') where name = 'cron_cost_sync'", 3)):
            with self.subTest(what=what):
                self.setUp()
                self.c.execute(sql)
                g = self.grid()
                self.assertFalse(g[row], (what, g))

    def test_a_recent_not_allowed_makes_row_5_false_and_an_old_one_does_not(self):
        self.c.execute("insert into net._http_response (id, status_code, content, created) values (1, 403, '{\"error\":\"Not allowed.\"}', now() - interval '3 hours')")
        self.assertEqual(self.grid(), [True] * 6, "3 hours ago is outside the 2-hour window")
        self.c.execute("insert into net._http_response (id, status_code, content, created) values (2, 403, '{\"error\":\"Not allowed.\"}', now() - interval '30 minutes')")
        g = self.grid()
        self.assertFalse(g[4])
        self.assertEqual(g[:4], [True] * 4, "the scheduler side is still fine: the fault is on the function side")

    def test_it_changes_and_prints_nothing_secret(self):
        before = self.c.execute("select count(*) from vault.decrypted_secrets").fetchone()[0]
        text = "\n".join(str(r) for r in self.c.execute(S76).fetchall())
        for v in pj.GOOD.values():
            self.assertNotIn(v, text)
        self.assertEqual(self.c.execute("select count(*) from vault.decrypted_secrets").fetchone()[0], before)
        self.assertFalse(re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", re.sub(r"--[^\n]*", "", S76), re.I))


    # ---- 76b (digests), 77 (schedule), 77b (undo)
    def test_76b_shows_names_lengths_and_digest_starts_never_a_secret(self):
        rows = self.c.execute(S76B).fetchall()
        self.assertEqual([r[0] for r in rows], ["cron_cost_sync", "cron_ops_digest", "cron_ops_tick"])
        for name, length, digest in rows:
            self.assertGreaterEqual(length, 32)
            self.assertRegex(digest, r"^[0-9a-f]{12}$")
            self.assertNotIn(pj.GOOD[name], digest)
        self.assertNotIn(pj.GOOD["cron_cost_sync"], "\n".join(str(r) for r in rows))

    def test_77_schedules_the_job_with_its_own_secret_and_replaces_a_wrong_one(self):
        self.c.execute("update cron.job set command = replace(command, 'cron_cost_sync', 'service_role_key') where jobname = 'cost-sync'")
        self.assertFalse(self.grid()[1])
        self.assertEqual(self.last_rows(S77)[0], ("cost-sync", "0 * * * *", True, True, True))
        self.assertTrue(all(self.grid()[:4]), "the scheduler side is right after step 77")
        self.assertEqual(self.c.execute("select count(*) from cron.job where jobname = 'cost-sync'").fetchone()[0], 1)

    def last_rows(self, sql):
        cur = self.c.execute(sql)
        while cur.description is None and cur.nextset():
            pass
        return cur.fetchall()

    def test_77_refuses_and_schedules_nothing_with_a_missing_short_or_shared_secret(self):
        self.c.execute("delete from cron.job")
        for what, sql, word in (("missing", "delete from vault.decrypted_secrets where name = 'cron_cost_sync'", "missing or shorter"),
                                ("short", "update vault.decrypted_secrets set decrypted_secret = 'short' where name = 'cron_cost_sync'", "missing or shorter"),
                                ("shared", "update vault.decrypted_secrets set decrypted_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'cron_ops_tick') where name = 'cron_cost_sync'", "same value")):
            with self.subTest(what=what):
                self.setUp()
                self.c.execute("delete from cron.job")
                self.c.execute(sql)
                with self.assertRaises(psycopg.Error) as cm:
                    self.c.execute(S77)
                self.assertIn(word, str(cm.exception))
                self.assertEqual(self.c.execute("select count(*) from cron.job").fetchone()[0], 0)

    def test_77b_removes_the_job_and_runs_fine_when_it_is_not_there(self):
        self.assertEqual(self.last_rows(S77B)[0], (0,))
        self.assertEqual(self.last_rows(S77B)[0], (0,))


if __name__ == "__main__":
    unittest.main()
