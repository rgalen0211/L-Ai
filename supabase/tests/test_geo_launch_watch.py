"""The launch-day watch, ONE read-only paste (GEO, Wed 11-25; Claude 08:05 wave 2 D, CC1 09:05): live-steps/watch_launch_day.sql.

On a throwaway Postgres built like live AFTER Ryan's sitting (the stub, every migration but A1-A19, the credits ledger as live has it
(main e947f26a), then A1-A19; plus stand-ins for pg_cron and pg_net, and auth.users.recovery_sent_at as Supabase has it):
  * a quiet, healthy hour reads 'OK: nothing to do (13 rows checked)';
  * each planted fault turns ITS row to LOOK and only that row, and the first row names it (rows 1 to 13, one test each);
  * just under each threshold stays ok (the must-fail margin: a check that only fires far past its line is caught);
  * after the welcome-credits undo drops its table, row 13 says 'not checked' and the paste does not error;
  * the paste changes nothing (a fingerprint of every table's row count is the same before and after).
Run from the repo root with TEMP/TMP on D: (the storage rule):
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_geo_launch_watch.py -v
"""
import hashlib
import subprocess
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

WATCH = core.ROOT / "live-steps" / "watch_launch_day.sql"
UNDO_WATCH = core.ROOT / "live-steps" / "watch_launch_day_after_welcome_undo.sql"
A_FROM = "20261120000100"            # A1 is the first of the sitting's 19 files; every later 2026112x file is A1-A19
A_FILES = {p.name for p in core.MIGRATIONS if p.name >= A_FROM + "_" and p.name.startswith("202611")}
LIVE_MAIN = "e947f26af8ccb8b58ba01754ca803e853f4e6f04"
LIVE_LEDGER = subprocess.run(["git", "-C", str(core.ROOT), "show", LIVE_MAIN + ":supabase/phase-2b/credits_ledger.sql"],
                             capture_output=True, text=True, encoding="utf-8", check=True).stdout
STANDINS = """
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
create table if not exists cron.job_run_details (jobid int, status text, start_time timestamptz not null default now());
create schema if not exists net;
create table if not exists net._http_response (id bigserial primary key, status_code int, content text, created timestamptz not null default now());
alter table auth.users add column if not exists recovery_sent_at timestamptz;
"""
_server = None
_n = 0


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-pg-geo-watch-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database after_tmpl")
    with psycopg.connect(_server.get_uri(database="after_tmpl"), autocommit=True) as c:
        c.execute((core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        c.execute(STANDINS)
        for path in core.MIGRATIONS:
            if path.name not in A_FILES:
                c.execute(path.read_text(encoding="utf-8"))
        c.execute(LIVE_LEDGER)
        for path in core.MIGRATIONS:
            if path.name in A_FILES:
                c.execute(path.read_text(encoding="utf-8"))


class Watch(unittest.TestCase):
    def setUp(self):
        global _n
        _n += 1
        name = f"w{_n}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name} template after_tmpl")
        self.c = psycopg.connect(_server.get_uri(database=name), autocommit=True)
        self.healthy()

    def tearDown(self):
        self.c.close()

    # -- a healthy hour: ops-tick ran a minute ago, the render PC checked in a minute ago, nothing else
    def healthy(self):
        x = self.c.execute
        x("insert into cron.job (jobname, schedule, active) values ('ops-tick', '* * * * *', true), ('purge-uploads', '0 * * * *', true)")
        x("insert into cron.job_run_details (jobid, status, start_time) select jobid, 'succeeded', now() - interval '1 minute' from cron.job")
        self.worker = str(uuid.uuid4())
        x("insert into auth.users (id, email) values (%s, 'worker@x')", (self.worker,))
        x("delete from public.workers")
        x("insert into public.workers (user_id, name, enabled, last_seen_at) values (%s, 'ryan-pc', true, now() - interval '1 minute')", (self.worker,))

    def run_watch(self):
        rows = self.c.execute(WATCH.read_text(encoding="utf-8")).fetchall()
        return rows[0][1], {r[0]: r[3] for r in rows[1:]}, rows

    def assert_only(self, n):
        verdict, status, rows = self.run_watch()
        looks = sorted(k for k, s in status.items() if s == "LOOK")
        self.assertEqual(looks, [n], "\n".join(map(str, rows)))
        self.assertEqual(verdict, f"LOOK: row(s) {n}: read their what_you_do")

    def assert_ok(self):
        verdict, status, rows = self.run_watch()
        self.assertEqual(verdict, "OK: nothing to do (13 rows checked)", "\n".join(map(str, rows)))

    def users(self, k, *, made="now()", confirmed=None):
        for _ in range(k):
            self.c.execute(f"insert into auth.users (id, email, created_at, email_confirmed_at) values (gen_random_uuid(), 'u' || gen_random_uuid() || '@x', {made}, {confirmed or 'null'})")

    def asks(self, k, at="now()"):
        for i in range(k):
            self.c.execute(f"insert into public.join_attempts (ip_hash, email_hash, at) values ('ip', encode(sha256(convert_to(random()::text, 'UTF8')), 'hex'), {at})")

    def jobs(self, k, state, *, made="now()", claimed=None, ended=None, code=None):
        self.c.execute("set session_replication_role = replica")          # the throwaway database only: no project/version rows needed
        for _ in range(k):
            self.c.execute(f"insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, state, created_at, queued_at, claimed_at, ended_at, error_code) "
                           f"values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'preview', '{{}}', repeat('a', 64), '{state}', {made}, {made}, {claimed or 'null'}, {ended or 'null'}, {code and repr(code) or 'null'})")
        self.c.execute("set session_replication_role = origin")

    # -- the tests
    def test_GEO_00_a_quiet_healthy_hour_is_ok(self):
        self.assert_ok()

    def test_GEO_00b_the_paste_changes_nothing(self):
        fp = "select string_agg(t, ',' order by t) from (select schemaname || '.' || relname || '=' || n_live_tup as t from pg_stat_user_tables) s"
        self.c.execute("analyze")
        before = self.c.execute("select md5(string_agg(x, '|' order by x)) from (select table_schema || '.' || table_name as x from information_schema.tables) t").fetchone()[0]
        counts = self.c.execute("select count(*) from auth.users").fetchone()[0], self.c.execute("select count(*) from public.join_attempts").fetchone()[0]
        self.run_watch()
        after = self.c.execute("select md5(string_agg(x, '|' order by x)) from (select table_schema || '.' || table_name as x from information_schema.tables) t").fetchone()[0]
        self.assertEqual(before, after)
        self.assertEqual(counts, (self.c.execute("select count(*) from auth.users").fetchone()[0], self.c.execute("select count(*) from public.join_attempts").fetchone()[0]))

    def test_GEO_01_emails_near_the_100(self):
        self.c.execute("update public.ops_settings set join_daily_max = 500")       # keep row 2 out of it
        self.asks(60, "now() - interval '2 hours'")
        self.c.execute("insert into public.ops_outbox (kind, mode, to_addr, subject, body) select 'alert', 'live', 'a@x', 's', 'b' from generate_series(1, 9)")
        self.c.execute("insert into public.ops_outbox (kind, mode, to_addr, subject, body) select 'alert', 'dry_run', 'a@x', 's', 'b' from generate_series(1, 50)")   # dry runs send nothing
        self.assert_ok()                                                              # 69: just under
        self.c.execute("insert into auth.users (id, email, recovery_sent_at) values (gen_random_uuid(), 'r@x', now())")
        self.assert_only(1)                                                           # 70

    def test_GEO_02_sign_up_size_nearly_full(self):
        self.c.execute("update public.ops_settings set join_daily_max = 35")
        self.asks(29, "now() - interval '3 hours'")
        self.assert_ok()
        self.asks(1, "now() - interval '3 hours'")
        self.assert_only(2)

    def test_GEO_03_a_flood_of_made_up_addresses(self):
        self.c.execute("update public.ops_settings set join_daily_max = 500")
        self.asks(10, "now() - interval '5 minutes'")
        self.assert_ok()                                                              # a real first rush: 10 asks 5 min old, nobody has opened yet (RENDERER 09:27)
        self.asks(9, "now() - interval '30 minutes'")
        self.assert_ok()                                                              # 9 asks 30 min old, 0 opened: under the line
        self.asks(1, "now() - interval '30 minutes'")
        self.assert_only(3)                                                           # 10 asks 20 to 60 min old, 0 opened
        self.users(1, confirmed="now()")
        self.assert_ok()                                                              # one real person opened: not a flood

    def test_GEO_04_emails_not_arriving(self):
        self.users(1, made="now() - interval '30 minutes'", confirmed="now()")
        self.users(1, made="now() - interval '30 minutes'")
        self.assert_ok()                                                              # half, not more than half
        self.users(1, made="now() - interval '30 minutes'")
        self.assert_only(4)

    def test_GEO_05_a_long_wait(self):
        self.jobs(1, "queued", made="now() - interval '29 minutes'")
        self.assert_ok()
        self.jobs(1, "queued", made="now() - interval '31 minutes'")
        self.assert_only(5)

    def test_GEO_05b_a_retried_job_waits_from_its_new_queue_time(self):
        self.jobs(1, "queued", made="now() - interval '3 hours'")
        self.c.execute("update public.jobs set queued_at = now() - interval '10 minutes'")   # made 3 h ago, queued again 10 min ago (RENDERER LOW a)
        self.assert_ok()

    def test_GEO_06_claimed_not_started(self):
        self.jobs(1, "claimed", claimed="now() - interval '9 minutes'")
        self.assert_ok()
        self.jobs(1, "claimed", claimed="now() - interval '11 minutes'")
        self.assert_only(6)

    def test_GEO_07_render_pc_silent(self):
        self.c.execute("update public.workers set last_seen_at = now() - interval '4 minutes'")
        self.assert_ok()
        self.c.execute("update public.workers set last_seen_at = now() - interval '6 minutes'")
        self.assert_only(7)

    def test_GEO_08_failed_jobs(self):
        self.jobs(2, "failed", ended="now() - interval '10 minutes'", code="bad_story")
        self.assert_ok()                                                              # 2 of a user-side code
        self.jobs(1, "failed", ended="now() - interval '10 minutes'", code="bad_story")
        self.assert_only(8)                                                           # 3 of one code

    def test_GEO_08b_one_machine_side_failure(self):
        self.jobs(1, "failed", ended="now() - interval '10 minutes'", code="queue_timeout")
        self.assert_only(8)

    def test_GEO_09_scheduled_call_errors(self):
        self.c.execute("insert into net._http_response (status_code) values (200), (200)")
        self.assert_ok()
        self.c.execute("insert into net._http_response (status_code) values (500)")
        self.assert_only(9)

    def test_GEO_10_ops_tick_late(self):
        self.c.execute("update cron.job_run_details set start_time = now() - interval '2 minutes'")
        self.assert_ok()
        self.c.execute("update cron.job_run_details set start_time = now() - interval '4 minutes'")
        self.assert_only(10)

    def test_GEO_10b_a_job_not_active(self):
        self.c.execute("update cron.job set active = false where jobname = 'purge-uploads'")
        self.assert_only(10)

    def test_GEO_11_a_full_film_waiting(self):
        self.jobs(1, "awaiting_approval")
        self.assert_only(11)

    def test_GEO_12_a_deletion_waiting(self):
        u = str(uuid.uuid4())
        self.c.execute("insert into auth.users (id, email) values (%s, 'd@x')", (u,))
        self.c.execute("set session_replication_role = replica")
        self.c.execute("insert into public.account_deletion_requests (owner_id, reason) values (%s, 'test')", (u,))
        self.c.execute("set session_replication_role = origin")
        self.assert_only(12)

    def test_GEO_13_a_verified_stranger_without_welcome_credits(self):
        self.c.execute("update public.ops_settings set welcome_credits = 0")
        self.c.execute("set session_replication_role = replica")                 # no trigger: the grant does not happen
        self.users(1, made="now() - interval '2 hours'", confirmed="now() - interval '1 hour'")
        self.c.execute("set session_replication_role = origin")
        self.assert_ok()                                                              # setting 0: not a failure
        self.c.execute("update public.ops_settings set welcome_credits = 8")
        self.assert_only(13)

    def test_GEO_13b_after_the_welcome_undo_the_second_file_runs(self):
        self.c.execute("drop table ryagram_private.welcome_credit_grants cascade")
        with self.assertRaises(psycopg.Error):
            self.run_watch()                                                          # the main paste needs the table (it says so at its top)
        self.c.rollback() if not self.c.autocommit else None
        rows = self.c.execute(UNDO_WATCH.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(rows[0][1], "OK: nothing to do (12 rows checked)")
        self.assertNotIn(13, [r[0] for r in rows])

    def test_GEO_13c_the_second_file_is_the_first_without_row_13(self):
        lines = WATCH.read_text(encoding="utf-8").split("\n")
        a = [i for i, l in enumerate(lines) if l.strip().startswith("-- ROW 13 START")]
        b = [i for i, l in enumerate(lines) if l.strip() == "-- ROW 13 END"]
        self.assertEqual((len(a), len(b)), (1, 1))
        want = "\n".join(lines[:a[0]] + lines[b[0] + 1:]).replace("LAUNCH-DAY WATCH, ONE PASTE", "LAUNCH-DAY WATCH AFTER A WELCOME-CREDITS UNDO (row 13 left out), ONE PASTE")
        self.assertEqual(UNDO_WATCH.read_text(encoding="utf-8").replace("\r\n", "\n"), want.replace("\r\n", "\n"))


if __name__ == "__main__":
    unittest.main()
