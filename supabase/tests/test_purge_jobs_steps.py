"""LIVE STEPS 54 to 57: scheduling the two purge jobs (purge-uploads, purge-partial-uploads), CONNECT 2026-11-23. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_purge_jobs_steps.py -v

pg_cron, pg_net and Vault are NOT in the local Postgres, so this builds minimal stand-ins (cron.job with schedule/unschedule that replace by name like the real one, cron.job_run_details, net._http_response,
vault.decrypted_secrets) and runs the four SQL files against them. It proves the SQL parses and does what its header says; it cannot prove the real extensions' behaviour (the paper's live run does).
What it proves, each with the opposite case beside it
  * 54 (before): with no secrets rows 2 to 4 are false; with good distinct secrets they are true; a short secret, a missing one, or a purge secret equal to an ops secret makes its row false; it never prints a secret;
  * 55 (schedule): REFUSES with an error and schedules NOTHING when a secret is missing or short; with the secrets it makes exactly the two jobs at :00 and :30, each reading its OWN Vault name, never the service-role key; run twice it still has two jobs;
  * 56 (after): right after 55 the job rows are true and the 'has run' rows false (expected); after a successful run and a 200 all six are true; a 403 in the last 2 hours or a failed last run makes its row false;
  * 57 (undo): removes exactly the two jobs, leaves every other job, and runs fine when they are not there.
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

STEPS = core.ROOT / "live-steps"
S53, S54, S55, S56 = (next(STEPS.glob(f"{n}_*.sql")).read_text(encoding="utf-8") for n in (54, 55, 56, 57))
_server = None
_count = 0
GOOD = {name: (name[-3:] * 20)[:40] + str(i) * 4 for i, name in enumerate(("cron_purge_uploads", "cron_purge_partial", "cron_ops_tick", "cron_ops_digest", "cron_cost_sync"))}
STUB = """
create schema cron; create schema net; create schema vault;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean not null default true, username text not null default 'postgres');
create table cron.job_run_details (jobid int, status text, start_time timestamptz not null default now());
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
create function cron.unschedule(n text) returns boolean language plpgsql as $$
begin
  if not exists (select 1 from cron.job where jobname = n) then raise exception 'could not find valid entry for job %', n; end if;
  delete from cron.job where jobname = n; return true;
end $$;
create table net._http_response (id bigint primary key, status_code int, content text, created timestamptz not null default now());
create table net.http_request_queue (id bigint primary key, url text);
create table vault.decrypted_secrets (name text, decrypted_secret text);
"""


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-purge-")


class PurgeJobSteps(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"pj{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name}")
        self.c = psycopg.connect(_server.get_uri(database=self.name), autocommit=True)
        self.c.execute(STUB)

    def tearDown(self):
        self.c.close()

    def secrets(self, **over):
        self.c.execute("delete from vault.decrypted_secrets")
        for name, val in {**GOOD, **over}.items():
            if val is not None:
                self.c.execute("insert into vault.decrypted_secrets (name, decrypted_secret) values (%s, %s)", (name, val))

    def rows(self, sql):
        return self.last(sql)

    def last(self, sql):
        """the rows of the LAST statement that returns any (a step can be a DO block followed by a SELECT)"""
        cur = self.c.execute(sql)
        while cur.description is None and cur.nextset():
            pass
        return cur.fetchall()

    def jobs(self):
        return {r[0]: r for r in self.c.execute("select jobname, schedule, command from cron.job").fetchall()}

    def test_53_before_check_rows_follow_the_secrets_and_never_print_one(self):
        r = self.rows(S53)
        self.assertEqual(len(r), 6)
        self.assertEqual([x[1] for x in r[1:5]], [False, False, False, True], "no secrets: rows 2, 3, 4 false (row 5, no job reads the key, is true on an empty list)")
        self.assertIn("none", r[5][0])
        self.secrets()
        r = self.rows(S53)
        self.assertEqual([x[1] for x in r[1:]], [True] * 5, r)
        for x in r:
            for v in GOOD.values():
                self.assertNotIn(v, str(x), "no secret value is ever printed")
        self.secrets(cron_purge_uploads="short")
        self.assertFalse(self.rows(S53)[1][1])
        self.secrets(cron_purge_partial=None)
        self.assertFalse(self.rows(S53)[2][1])
        self.secrets(cron_purge_partial=GOOD["cron_ops_tick"])
        self.assertFalse(self.rows(S53)[3][1], "a purge secret equal to an ops secret opens the other job: refused")
        self.secrets()
        self.c.execute("select cron.schedule('old', '* * * * *', 'select 1 -- service_role_key')")
        self.assertFalse(self.rows(S53)[4][1], "an existing job that still reads the service key is flagged")
        self.assertIn("old", self.rows(S53)[5][0])

    def test_54_refuses_and_schedules_nothing_without_good_secrets(self):
        for over in ({"cron_purge_uploads": None}, {"cron_purge_partial": None}, {"cron_purge_uploads": "x" * 31}, {"cron_purge_partial": "y" * 5}):
            self.secrets(**over)
            with self.assertRaises(psycopg.Error) as e:
                self.c.execute(S54)
            self.assertIn("Not scheduled", str(e.exception))
            self.assertEqual(self.jobs(), {}, "nothing was scheduled: " + str(over))

    def test_54_schedules_exactly_the_two_jobs_with_their_own_secret_and_twice_is_the_same(self):
        self.secrets()
        out = self.last(S54)
        self.assertEqual([(r[0], r[1], r[2]) for r in out], [("purge-partial-uploads", "30 * * * *", True), ("purge-uploads", "0 * * * *", True)])
        for _ in range(2):
            j = self.jobs()
            self.assertEqual(sorted(j), ["purge-partial-uploads", "purge-uploads"])
            self.assertEqual(j["purge-uploads"][1], "0 * * * *")
            self.assertEqual(j["purge-partial-uploads"][1], "30 * * * *")
            self.assertIn("/functions/v1/purge-uploads'", j["purge-uploads"][2])
            self.assertIn("name = 'cron_purge_uploads'", j["purge-uploads"][2])
            self.assertIn("/functions/v1/purge-partial-uploads'", j["purge-partial-uploads"][2])
            self.assertIn("name = 'cron_purge_partial'", j["purge-partial-uploads"][2])
            for _, _, cmd in j.values():
                self.assertNotIn("service_role", cmd)
                for v in GOOD.values():
                    self.assertNotIn(v, cmd, "the secret is read from the Vault at run time, never written into the job")
            self.c.execute(S54)

    def test_55_after_check_before_and_after_the_first_run(self):
        self.secrets()
        for n in ("connect-purge", "cost-sync", "ops-digest", "ops-tick"):
            self.c.execute("select cron.schedule(%s, '* * * * *', 'select 1')", (n,))
        self.c.execute(S54)
        r = self.rows(S55)
        self.assertEqual(len(r), 7)
        self.assertEqual([x[1] for x in r], [True, True, True, True, False, False, False], "right after 55: the jobs are right, 'has run' is not yet (expected)")
        for jid in [x[0] for x in self.c.execute("select jobid from cron.job where jobname like 'purge%'").fetchall()]:
            self.c.execute("insert into cron.job_run_details (jobid, status) values (%s, 'succeeded')", (jid,))
        # other cron jobs answer {"ok":true} too (ops-tick every minute): they prove nothing about a purge job, and a failing one must not break the check
        self.c.execute("insert into net._http_response (id, status_code, content) values (1, 200, '{\"ok\":true}'), (2, 503, 'an ops call failed'), (3, 200, '{\"ok\":true}')")
        r = self.rows(S55)
        self.assertEqual([x[1] for x in r], [True, True, True, True, True, False, False], "only generic ok:true replies: neither purge row is true")
        self.c.execute("insert into net._http_response (id, status_code, content) values (4, 200, '{\"ok\":true,\"fn\":\"purge-uploads\"}')")
        r = self.rows(S55)
        self.assertEqual([x[1] for x in r], [True, True, True, True, True, True, False], "purge-uploads answered with its own name; purge-partial-uploads did not")
        self.c.execute("insert into net._http_response (id, status_code, content) values (5, 200, '{\"ok\":true,\"fn\":\"purge-partial-uploads\"}')")
        self.assertTrue(all(x[1] is True for x in self.rows(S55)), "a failing ops-tick call must NOT break the purge check: " + str(self.rows(S55)))
        self.c.execute("insert into net._http_response (id, status_code, content) values (6, 403, 'forbidden')")
        self.assertTrue(all(x[1] is True for x in self.rows(S55)), "an unattributed refusal changes nothing (it shows as the missing name when it is a purge call)")
        self.c.execute("update net._http_response set status_code = 500 where id = 4")
        self.assertFalse(self.rows(S55)[5][1], "a 500 is not a 200")
        self.c.execute("update net._http_response set status_code = 200 where id = 4")
        self.c.execute("update net._http_response set created = now() - interval '3 hours' where id = 5")
        self.assertFalse(self.rows(S55)[6][1], "older than 2 hours does not count")
        self.c.execute("update net._http_response set created = now() where id = 5")
        self.c.execute("update net._http_response set created = now() - interval '3 hours' where id = 4")
        self.assertFalse(self.rows(S55)[5][1], "purge-uploads' reply older than 2 hours does not count either")
        self.c.execute("update net._http_response set created = now() where id = 4")
        self.c.execute("insert into cron.job_run_details (jobid, status, start_time) select jobid, 'failed', now() + interval '1 minute' from cron.job where jobname = 'purge-uploads'")
        self.assertFalse(self.rows(S55)[4][1], "the last run of a job failed")
        self.c.execute("update cron.job set command = command || ' -- service_role_key' where jobname = 'purge-uploads'")
        self.assertFalse(self.rows(S55)[1][1], "a purge job that reads the service key is flagged on its own row")
        self.c.execute("update cron.job set command = replace(command, ' -- service_role_key', '') where jobname = 'purge-uploads'")
        self.c.execute("update cron.job set command = command || ' -- service_role_key' where jobname = 'ops-tick'")
        self.assertFalse(self.rows(S55)[2][1], "a job still reading the service key is flagged")
        self.c.execute("update cron.job set command = replace(command, 'cron_purge_partial', 'cron_ops_tick') where jobname = 'purge-partial-uploads'")
        self.assertFalse(self.rows(S55)[1][1], "a purge job reading another job's secret is flagged")

    def test_56_undo_removes_only_the_two_jobs_and_runs_when_they_are_not_there(self):
        self.secrets()
        self.c.execute("select cron.schedule('ops-tick', '* * * * *', 'select 1')")
        self.c.execute(S54)
        out = self.last(S56)
        self.assertEqual([r[0] for r in out], ["ops-tick"])
        self.assertEqual(sorted(self.jobs()), ["ops-tick"])
        self.c.execute(S56)                                   # again: nothing to remove, no error
        self.assertEqual(sorted(self.jobs()), ["ops-tick"])

    def test_the_steps_read_only_what_they_say_53_and_55_are_one_select_without_writes(self):
        import re
        for name, text in (("54", S53), ("56", S55)):
            code = re.sub(r"--[^\n]*", "", text)
            self.assertFalse(re.search(r"\b(insert|update|delete|drop|alter|create|unschedule)\b|(?<![.\w])schedule\b", code, re.I), name)
            self.assertEqual(code.strip().count(";"), 1, name + " is ONE statement")


if __name__ == "__main__":
    unittest.main()
