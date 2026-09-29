"""Runs the Supabase migrations against a local Postgres and checks the 2A rules.

Setup, once, in any scratch folder (not this repo):
    python -m venv pgvenv
    pgvenv/Scripts/python -m pip install pgserver "psycopg[binary]"
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_2a_core.py -v

supabase_stub.sql stands in for Supabase's auth/storage schemas and roles.
auth.uid() reads request.jwt.claim.sub, as PostgREST sets it.
"""
import os
import tempfile
import unittest
import uuid
from pathlib import Path

import pgserver
import psycopg

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [ROOT / "ryagram-waitlist.sql", *sorted((ROOT / "migrations").glob("*.sql"))]
RYAN, OTHER, WORKER, WORKER2 = (str(uuid.UUID(int=i)) for i in (1, 2, 3, 4))
STORY = '{"schema": 1, "engine": "sequence", "name": "t", "sequence": {}}'
_server = None
_count = 0


def setUpModule():
    global _server
    _server = pgserver.get_server(tempfile.mkdtemp(prefix="ryagram-pg-"), cleanup_mode="stop")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmpl")
        c.execute("create database tmpl")
    with psycopg.connect(_server.get_uri(database="tmpl"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in MIGRATIONS:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s,'ryan@x'),(%s,'other@x'),(%s,'worker@x'),(%s,'worker2@x')",
                  (RYAN, OTHER, WORKER, WORKER2))
        c.execute("insert into public.workers (user_id, name) values (%s, 'ryan-pc'), (%s, 'spare')", (WORKER, WORKER2))


class Db:
    def __init__(self, uri):
        self.c = psycopg.connect(uri, autocommit=True)

    def as_(self, who):
        """who: a user id, 'anon', 'service' (service_role), or None for the database owner (dashboard)."""
        self.c.execute("reset role")
        self.c.execute("select set_config('request.jwt.claim.sub', %s, false)", (who if who not in (None, "anon", "service") else "",))
        if who == "anon":
            self.c.execute("set role anon")
        elif who == "service":
            self.c.execute("set role service_role")
        elif who is not None:
            self.c.execute("set role authenticated")
        return self

    def one(self, sql, *args):
        row = self.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def all(self, sql, *args):
        return self.c.execute(sql, args).fetchall()


class Base(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        name = f"t{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name} template tmpl")
        self.db = Db(_server.get_uri(database=name))

    def tearDown(self):
        self.db.c.close()

    def denied(self, who, sql, *args):
        with self.assertRaises(psycopg.Error):
            self.db.as_(who).one(sql, *args)


# The Phase 1 waitlist, after the Turnstile change: visitors can no longer insert directly;
# the only way in is waitlist_join, which only service_role (the Edge Function) may call.
class Waitlist(Base):
    def test_only_the_edge_function_can_add(self):
        svc = self.db.as_("service")
        svc.one("select waitlist_join('a@b.co', ' films ', 'uselai.com/ryagram')")
        svc.one("select waitlist_join('A@B.CO', null, null)")                    # already listed: no error
        rows = self.db.as_(None).all("select email, use_case, source from public.ryagram_waitlist")
        self.assertEqual(rows, [("a@b.co", "films", "uselai.com/ryagram")])
        for who in ("anon", RYAN, WORKER):
            self.denied(who, "select waitlist_join('x@y.co', null, null)")
            self.denied(who, "insert into public.ryagram_waitlist (email) values ('x@y.co') returning id")

    def test_nobody_outside_can_read_or_change_it(self):
        self.db.as_(None).c.execute("insert into public.ryagram_waitlist (email) values ('x@y.co')")
        for who in ("anon", RYAN):
            self.denied(who, "select * from public.ryagram_waitlist")
            self.denied(who, "update public.ryagram_waitlist set email = 'z@y.co' returning id")
            self.denied(who, "delete from public.ryagram_waitlist returning id")


class Core(Base):
    # -- helpers

    def project_with_version(self, who=RYAN, story=STORY):
        d = self.db.as_(who)
        pid = d.one("insert into projects (title) values ('Obesity') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        d.one("update versions set story_spec = %s::jsonb where id = %s returning id", story, vid)
        return pid, vid

    def run_job(self, job_id, kinds, worker=WORKER):
        """Worker path for a claimed job: running -> ... -> complete, with uploads."""
        d = self.db.as_(worker)
        d.one("select state from report_state(%s, 'running', p_engine_commit => 'abc1234', p_engine_dirty => false)", job_id)
        d.one("select state from report_state(%s, 'validating')", job_id)
        d.one("select state from report_state(%s, 'uploading')", job_id)
        mimes = {"contact_sheet": "image/png", "preview": "video/mp4", "final_video": "video/mp4",
                 "thumbnail": "image/jpeg", "receipt": "application/json"}
        for kind in kinds:
            path = d.one("select register_artifact(%s, %s, 100, %s)", job_id, kind, "a" * 64)
            d.one("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, "
                  "jsonb_build_object('size', 100, 'mimetype', %s::text)) returning name", path, mimes[kind])
        d.one("select write_metering(%s, 1, '{\"wall_s\": 2.5, \"gate_result\": \"pass\"}')", job_id)
        return d.one("select state from report_state(%s, 'complete')", job_id)

    def claim(self, worker=WORKER):
        return self.db.as_(worker).one("select id from claim_next_job()")

    # -- 2A-1 / 2A-2: privacy and versions
    def test_r1_and_r2_are_independent(self):
        pid, r1 = self.project_with_version()
        d = self.db.as_(RYAN)
        r2 = d.one("select id from create_version(%s, %s)", pid, r1)
        d.one("update versions set story_spec = '{\"schema\": 1, \"engine\": \"sequence\", \"name\": \"r2\"}' where id = %s returning id", r2)
        self.assertEqual(d.all("select number, story_spec->>'name', parent_version_id is not null from versions order by number"),
                         [(1, "t", False), (2, "r2", True)])

    def test_other_users_and_anonymous_see_nothing(self):
        pid, vid = self.project_with_version()
        o = self.db.as_(OTHER)
        for table in ("projects", "versions", "jobs", "artifacts", "job_metering", "datasets"):
            self.assertEqual(o.one(f"select count(*) from {table}"), 0, table)
        self.assertIsNone(o.one("update versions set note = 'x' where id = %s returning id", vid))
        self.denied(OTHER, "select create_version(%s)", pid)
        self.denied(OTHER, "select submit_job(%s, 'preview')", vid)
        for sql in ("select count(*) from projects", "select create_version(gen_random_uuid())",
                    "select claim_next_job()", "select count(*) from control"):
            self.denied("anon", sql)
        self.denied(RYAN, "select count(*) from workers")
        self.denied(RYAN, "update control set claims_enabled = false")
        self.denied(RYAN, "insert into jobs (owner_id) values (auth.uid())")
        self.denied(RYAN, "update versions set owner_id = %s", OTHER)

    # -- submit_job input rules
    def test_submit_rejects_bad_params_and_unready_stories(self):
        _, vid = self.project_with_version(story='{"schema": 1}')
        self.denied(RYAN, "select submit_job(%s, 'preview')", vid)
        _, vid = self.project_with_version()
        for params in ('{"window_s": 5}', '{"window_s": [2, 13]}', '{"window_s": [5, 1]}', '{"window_s": ["0", "5"]}',
                       '{"cmd": "rm -rf"}', '{"periods": ["2016", "../x", "2018"]}', '{"periods": ["2016-03", "2017", "2018"]}',
                       '{"periods": ["2016", "2017"]}'):
            kind = "contact_sheet" if "periods" in params else "preview"
            self.denied(RYAN, "select submit_job(%s, %s, %s::jsonb)", vid, kind, params)
        self.denied(RYAN, "select submit_job(%s, 'final_render', '{\"window_s\": 1}')", vid)
        self.assertEqual(self.db.as_(RYAN).one("select state from submit_job(%s, 'preview', '{\"window_s\": [4, 14]}')", vid), "queued")
        self.denied(RYAN, "select submit_job(%s, 'preview')", vid)  # one in flight per type

    # -- the render ladder
    def ladder(self):
        pid, vid = self.project_with_version()
        d = self.db.as_(RYAN)
        sheet = d.one("select id from submit_job(%s, 'contact_sheet', '{\"periods\": [\"2016\", \"2018\", \"2020\"]}')", vid)
        prev = d.one("select id from submit_job(%s, 'preview')", vid)
        self.denied(RYAN, "select submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)  # not complete yet
        self.assertEqual(self.claim(), sheet)
        self.assertEqual(self.run_job(sheet, ["contact_sheet"]), "complete")
        self.assertEqual(self.claim(), prev)
        self.assertEqual(self.run_job(prev, ["preview"]), "complete")
        return pid, vid, sheet, prev

    def test_final_render_needs_complete_ladder_for_the_same_story(self):
        _, vid, sheet, prev = self.ladder()
        d = self.db.as_(RYAN)
        d.one("update versions set story_spec = story_spec || '{\"name\": \"edited\"}' where id = %s returning id", vid)
        self.denied(RYAN, "select submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        d.one("update versions set story_spec = story_spec || '{\"name\": \"t\"}' where id = %s returning id", vid)
        final = d.one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.assertEqual(d.one("select state from versions where id = %s", vid), "queued")
        with self.assertRaises(psycopg.Error):   # story frozen while queued
            d.one("update versions set story_spec = '{}' where id = %s returning id", vid)
        self.assertEqual(self.claim(), final)
        self.assertEqual(self.db.as_(RYAN).one("select state from versions where id = %s", vid), "rendering")
        self.assertEqual(self.run_job(final, ["final_video", "thumbnail", "receipt"]), "complete")
        d = self.db.as_(RYAN)
        self.assertEqual(d.one("select state from versions where id = %s", vid), "complete")
        self.assertEqual(d.one("select count(*) from artifacts where job_id = %s", final), 3)
        self.assertEqual(d.one("select count(*) from storage.objects"), 5)

    def test_claim_rechecks_the_ladder(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.db.as_(None).one("update jobs set state = 'failed' where id = %s returning id", prev)  # evidence withdrawn
        self.assertIsNone(self.claim())
        self.assertEqual(self.db.as_(None).one("select error_code from jobs where id = %s", final), "ladder_missing")

    # -- worker boundary
    def test_worker_is_confined(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.denied(RYAN, "select claim_next_job()")               # not a worker
        # The worker login can't act as a person: no projects, versions or jobs of its own.
        self.denied(WORKER, "insert into projects (title) values ('mine') returning id")
        self.denied(WORKER, "select create_version(%s)", self.db.as_(None).one("select project_id from versions where id = %s", vid))
        self.denied(WORKER, "select submit_job(%s, 'preview')", vid)
        self.denied(WORKER, "select queue_position(%s)", job)
        w = self.db.as_(WORKER)
        self.assertEqual(w.one("select count(*) from jobs"), 0)     # owns nothing
        self.denied(WORKER, "update jobs set state = 'complete'")
        self.assertEqual(self.claim(), job)
        self.assertIsNone(self.claim())                             # one at a time
        self.denied(WORKER2, "select heartbeat(%s)", job)           # not its job
        self.denied(WORKER, "select report_state(%s, 'complete')", job)  # illegal jump
        w.one("select report_state(%s, 'running')", job)
        self.denied(WORKER, "select register_artifact(%s, 'preview', 1, %s)", job, "a" * 64)  # not uploading yet
        w.one("select report_state(%s, 'validating')", job)
        w.one("select report_state(%s, 'uploading')", job)
        self.denied(WORKER, "select register_artifact(%s, 'final_video', 1, %s)", job, "a" * 64)  # wrong kind
        self.denied(WORKER, "select register_artifact(%s, 'preview', 60000001, %s)", job, "a" * 64)  # too big
        self.denied(WORKER, "insert into storage.objects (bucket_id, name) values ('ryagram-artifacts', %s)",
                    f"{RYAN}/../../evil.mp4")
        path = w.one("select register_artifact(%s, 'preview', 10, %s)", job, "b" * 64)
        self.assertTrue(path.endswith(f"/{job}/preview.mp4") and path.startswith(RYAN))
        self.denied(WORKER, "select write_metering(%s, 1, '{\"cmd\": 1}')", job)
        self.denied(WORKER, "select write_metering(%s, 2, '{}')", job)   # no such attempt
        self.denied(WORKER2, "select write_metering(%s, 1, '{}')", job)  # not its attempt
        self.db.as_(None).one("update workers set enabled = false where user_id = %s returning 1", WORKER)
        self.denied(WORKER, "select heartbeat(%s)", job)            # revoked immediately

    def test_uploaded_file_must_match_registration(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.claim()
        w = self.db.as_(WORKER)
        for s in ("running", "validating", "uploading"):
            w.one("select report_state(%s, %s)", job, s)
        self.denied(WORKER, "select report_state(%s, 'complete')", job)  # no engine_commit, no artifact
        path = w.one("select register_artifact(%s, 'preview', 100, %s)", job, "c" * 64)
        w.one("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, "
              "'{\"size\": 99, \"mimetype\": \"video/mp4\"}') returning 1", path)
        self.db.as_(None).one("update jobs set engine_commit = 'abc1234' where id = %s returning 1", job)
        self.denied(WORKER, "select report_state(%s, 'complete')", job)  # size mismatch

    # -- queue behaviour
    def test_three_jobs_run_in_order_exactly_once(self):
        ids = []
        for _ in range(3):
            _, vid = self.project_with_version()
            ids.append(self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid))
        d = self.db.as_(RYAN)
        self.assertEqual([d.one("select queue_position(%s)", j) for j in ids], [1, 2, 3])
        done = []
        while (job := self.claim()) is not None:
            self.assertEqual(self.run_job(job, ["preview"]), "complete")
            done.append(job)
        self.assertEqual(done, ids)
        self.assertEqual(self.db.as_(None).one("select count(*) from jobs where state = 'complete'"), 3)

    def test_two_workers_never_share_a_job(self):
        for _ in range(2):
            _, vid = self.project_with_version()
            self.db.as_(RYAN).one("select submit_job(%s, 'preview')", vid)
        a, b = self.claim(WORKER), self.claim(WORKER2)
        self.assertIsNotNone(a)
        self.assertIsNotNone(b)
        self.assertNotEqual(a, b)

    def test_lost_worker_retries_then_fails(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        for attempt in (1, 2, 3):
            self.assertEqual(self.claim(), job)
            self.db.as_(None).one("update jobs set lease_expires_at = now() - interval '1 second' where id = %s returning 1", job)
        self.assertIsNone(self.claim())
        self.assertEqual(self.db.as_(None).one("select state, attempt, error_class from jobs where id = %s", job),
                         ("failed", 3, "infrastructure"))
        self.assertEqual(self.db.as_(None).one("select count(*) from job_metering where job_id = %s and error_code = 'worker_lost'", job), 3)

    def test_crash_is_retried_but_gate_failure_and_timeout_are_not(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.claim()
        w = self.db.as_(WORKER)
        w.one("select report_state(%s, 'running')", job)
        self.denied(WORKER, "select retry_job(%s, 'timeout')", job)
        self.denied(WORKER, "select retry_job(%s, 'gate_failed')", job)
        self.assertEqual(w.one("select retry_job(%s, 'crash', 'segfault')", job), "queued")
        self.assertEqual(self.db.as_(None).one("select attempt, error_class from jobs where id = %s", job),
                         (2, "infrastructure"))
        # The handed-back attempt still gets its metering.
        self.db.as_(WORKER).one("select write_metering(%s, 1, '{\"wall_s\": 3, \"notes\": {\"why\": \"crash\"}}')", job)
        self.assertEqual(self.db.as_(None).one("select wall_s, error_code from job_metering where job_id = %s and attempt = 1", job),
                         (3, "crash"))
        self.claim()
        w = self.db.as_(WORKER)
        w.one("select report_state(%s, 'running')", job)
        self.assertEqual(w.one("select state, error_class from report_state(%s, 'editorial_action_required')", job),
                         ("editorial_action_required", "gate"))

    def test_failed_is_final_and_timeouts_fail(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.claim()
        w = self.db.as_(WORKER)
        self.denied(WORKER, "select report_state(%s, 'editorial_action_required')", job)  # not from claimed
        w.one("select report_state(%s, 'running')", job)
        self.assertEqual(w.one("select state, attempt, error_class from report_state(%s, 'failed', 'timeout')", job),
                         ("failed", 1, "timeout"))
        self.assertIsNone(self.claim())

    def test_finished_versions_stay_finished(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.claim()
        self.run_job(final, ["final_video", "thumbnail", "receipt"])
        d = self.db.as_(RYAN)
        self.assertEqual(d.one("select state from versions where id = %s", vid), "complete")
        for kind in ("preview", "contact_sheet"):                    # finished: no new jobs either
            self.denied(RYAN, "select submit_job(%s, %s)", vid, kind)
        self.denied(RYAN, "select submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.denied(RYAN, "update versions set state = 'draft' where id = %s returning id", vid)
        self.denied(RYAN, "update versions set story_spec = '{}' where id = %s returning id", vid)
        self.assertEqual(self.db.as_(RYAN).one("update versions set state = 'archived' where id = %s returning state", vid), "archived")
        for state in ("complete", "draft"):
            self.denied(RYAN, "update versions set state = %s where id = %s returning id", state, vid)
        self.db.as_(None).one("update versions set state = 'failed' where id = %s returning 1", vid)
        self.denied(RYAN, "update versions set state = 'draft' where id = %s returning id", vid)

    def test_kill_switch_and_cancel(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.db.as_(None).one("update control set claims_enabled = false returning 1")
        self.assertIsNone(self.claim())
        self.db.as_(None).one("update control set claims_enabled = true, disabled_job_types = '{preview}' returning 1")
        self.assertIsNone(self.claim())
        self.db.as_(None).one("update control set disabled_job_types = '{}' returning 1")
        self.assertEqual(self.claim(), job)
        self.assertFalse(self.db.as_(WORKER).one("select heartbeat(%s, 0.5)", job))
        self.db.as_(RYAN).one("select cancel_requested from cancel_job(%s)", job)
        self.assertTrue(self.db.as_(WORKER).one("select heartbeat(%s)", job))
        self.assertEqual(self.db.as_(WORKER).one("select state from report_state(%s, 'cancelled')", job), "cancelled")

    # -- fixes from WORKER's real-SQL tests (migration 0400)
    def test_no_output_is_infrastructure_and_not_retried(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.claim()
        w = self.db.as_(WORKER)
        w.one("select report_state(%s, 'running')", job)
        self.denied(WORKER, "select retry_job(%s, 'no_output')", job)
        self.assertEqual(w.one("select state, error_class from report_state(%s, 'failed', 'no_output')", job),
                         ("failed", "infrastructure"))

    def test_cancel_is_honoured_while_validating_or_uploading(self):
        for stop_at in ("validating", "uploading"):
            _, vid = self.project_with_version()
            job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
            self.claim()
            w = self.db.as_(WORKER)
            w.one("select report_state(%s, 'running')", job)
            w.one("select report_state(%s, 'validating')", job)
            if stop_at == "uploading":
                w.one("select report_state(%s, 'uploading')", job)
            self.denied(WORKER, "select report_state(%s, 'cancelled')", job)      # nobody asked
            self.db.as_(RYAN).one("select cancel_requested from cancel_job(%s)", job)
            self.assertEqual(self.db.as_(WORKER).one("select state from report_state(%s, 'cancelled')", job), "cancelled")
            self.assertIsNone(self.claim())                                        # worker is free at once

    def test_queue_wait_is_per_attempt(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        admin = lambda sql, *a: self.db.as_(None).one(sql, *a)
        admin("update jobs set created_at = now() - interval '1 hour', queued_at = now() - interval '1 hour' where id = %s returning 1", job)
        self.claim()
        self.db.as_(WORKER).one("select retry_job(%s, 'crash')", job)
        created, queued = admin("select created_at, queued_at from jobs where id = %s", job)
        self.assertGreater(queued, created)                                      # reset on hand-back
        self.assertEqual(self.claim(), job)
        self.assertLess(admin("select extract(epoch from claimed_at - queued_at) from jobs where id = %s", job), 5)
        admin("update jobs set lease_expires_at = now() - interval '1 second' where id = %s returning 1", job)
        before = admin("select queued_at from jobs where id = %s", job)
        self.assertEqual(self.claim(WORKER2), job)                               # reclaimed and re-claimed as attempt 3
        self.assertGreaterEqual(admin("select queued_at from jobs where id = %s", job), before)
        self.assertEqual(admin("select state, attempt from jobs where id = %s", job), ("claimed", 3))

    def partial_upload(self):
        """A preview cancelled mid-upload, leaving one registered, uploaded file."""
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        self.claim()
        w = self.db.as_(WORKER)
        for state in ("running", "validating", "uploading"):
            w.one("select report_state(%s, %s)", job, state)
        path = w.one("select register_artifact(%s, 'preview', 10, %s)", job, "d" * 64)
        w.one("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, "
              "'{\"size\": 10, \"mimetype\": \"video/mp4\"}') returning 1", path)
        self.db.as_(RYAN).one("select cancel_requested from cancel_job(%s)", job)
        self.db.as_(WORKER).one("select report_state(%s, 'cancelled')", job)
        return job, path

    def test_partial_uploads_are_hidden_at_once(self):
        job, path = self.partial_upload()
        d = self.db.as_(RYAN)
        self.assertEqual(d.one("select count(*) from artifacts where job_id = %s", job), 0)
        self.assertEqual(d.one("select count(*) from storage.objects where name = %s", path), 0)
        self.assertEqual(self.db.as_(None).one("select count(*) from artifacts where job_id = %s", job), 1)  # still there

    def test_partial_uploads_are_purged_after_24_hours(self):
        job, path = self.partial_upload()
        svc = self.db.as_("service")
        self.assertEqual(svc.all("select * from partial_uploads_due()"), [])        # not yet 24 h
        self.db.as_(None).one("update jobs set ended_at = now() - interval '25 hours' where id = %s returning 1", job)
        due = self.db.as_("service").all("select artifact_id, storage_path from partial_uploads_due()")
        self.assertEqual([r[1] for r in due], [path])
        ids = [due[0][0]]
        self.assertEqual(self.db.as_("service").one("select mark_uploads_deleted(%s::uuid[])", ids), 0)  # file still there
        self.db.as_(None).one("delete from storage.objects where name = %s returning 1", path)          # Storage API removes it
        self.assertEqual(self.db.as_("service").one("select mark_uploads_deleted(%s::uuid[])", ids), 1)
        self.assertEqual(self.db.as_("service").all("select * from partial_uploads_due()"), [])
        for who in (RYAN, WORKER, "anon"):
            self.denied(who, "select * from partial_uploads_due()")
            self.denied(who, "select mark_uploads_deleted(array[]::uuid[])")

    def test_purge_never_touches_a_finished_job(self):
        _, vid, sheet, _ = self.ladder()
        self.db.as_(None).one("update jobs set ended_at = now() - interval '48 hours' where id = %s returning 1", sheet)
        self.assertEqual(self.db.as_("service").all("select * from partial_uploads_due()"), [])
        ids = [r[0] for r in self.db.as_(None).all("select id from artifacts where job_id = %s", sheet)]
        self.assertEqual(self.db.as_("service").one("select mark_uploads_deleted(%s::uuid[])", ids), 0)

    def test_not_found_is_http_404(self):
        # PostgREST turns SQLSTATE PTxxx into HTTP xxx; P0002 used to surface as 500.
        pid, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview')", vid)
        for sql, args in (("select create_version(%s)", (pid,)), ("select submit_job(%s, 'contact_sheet')", (vid,)),
                          ("select cancel_job(%s)", (job,)),
                          ("update versions set dataset_id = gen_random_uuid() where id = %s returning 1", (vid,))):
            who = RYAN if sql.startswith("update") else OTHER
            with self.assertRaises(psycopg.Error) as err:
                self.db.as_(who).one(sql, *args)
            self.assertEqual(err.exception.sqlstate, "PT404", sql)

    def test_owner_reads_own_files_only(self):
        _, vid, _, _ = self.ladder()
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from storage.objects"), 2)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from storage.objects"), 0)
        self.assertEqual(self.db.as_(WORKER).one("select count(*) from storage.objects"), 0)  # jobs finished


if __name__ == "__main__":
    unittest.main()
