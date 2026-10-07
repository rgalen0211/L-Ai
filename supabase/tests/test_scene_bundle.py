"""Scene bundles for the interactive preview (migrations/20261006000200..300) on a local Postgres.

Same setup as test_2a_core.py (the files are among the migrations it loads). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_scene_bundle.py -v

Access: only the version's owner can ask for a bundle or read it; nobody else, no visitor,
no worker; submit_job and direct inserts cannot make one.
Cache: a finished bundle is reused while the story and the engine are unchanged, and only
then; a deleted file, a new story or a new engine builds a new one.
Credits: with the 2B ledger loaded, a bundle is priced at 0 and writes no ledger rows.
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pgtemp  # noqa: E402
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
setUpModule = core.setUpModule
STORY2 = '{"schema": 1, "engine": "sequence", "name": "t2", "sequence": {}}'
LEDGER = core.ROOT / "phase-2b" / "credits_ledger.sql"


class Bundles(core.Base):
    project_with_version = core.Core.project_with_version
    claim = core.Core.claim

    def setUp(self):
        super().setUp()
        self.admin("update control set disabled_job_types = '{}' where id returning 1")   # turned on

    # -- helpers
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def request(self, vid, who=RYAN):
        return self.db.as_(who).one(
            "select status, job_id, storage_path, engine_commit, error_detail from request_scene_bundle(%s)", vid)

    def jobs(self, vid):
        return self.admin("select count(*) from jobs where version_id = %s and job_type = 'scene_bundle'", vid)

    def start(self, job, commit="abc1234"):
        self.assertEqual(self.claim(), job)
        self.db.as_(WORKER).one("select state from report_state(%s, 'running', p_engine_commit => %s, p_engine_dirty => false)",
                                job, commit)

    def build(self, job, commit="abc1234"):
        """The worker path for a bundle: running -> validating -> uploading -> complete."""
        self.start(job, commit)
        w = self.db.as_(WORKER)
        w.one("select state from report_state(%s, 'validating')", job)
        w.one("select state from report_state(%s, 'uploading')", job)
        path = w.one("select register_artifact(%s, 'scene_bundle', 100, %s)", job, "b" * 64)
        w.one("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, "
              "jsonb_build_object('size', 100, 'mimetype', 'application/zip')) returning name", path)
        w.one("select write_metering(%s, 1, '{\"wall_s\": 1.5}')", job)
        self.assertEqual(w.one("select state from report_state(%s, 'complete')", job), "complete")
        return path

    def ready(self, commit="abc1234"):
        _, vid = self.project_with_version()
        status, job, *_ = self.request(vid)
        self.assertEqual(status, "building")
        path = self.build(job, commit)
        return vid, job, path

    # -- switched off until the worker builds bundles
    def test_off_by_default(self):
        self.admin("update control set disabled_job_types = default where id returning 1")
        with psycopg.connect(core._server.get_uri(database="tmpl")) as c:
            self.assertIn("scene_bundle", c.execute("select disabled_job_types::text from control").fetchone()[0])
        self.admin("update control set disabled_job_types = '{scene_bundle}' where id returning 1")
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "paused"):
            self.request(vid)
        self.assertEqual(self.jobs(vid), 0)

    # -- access
    def test_owner_request_queues_one_job(self):
        _, vid = self.project_with_version()
        status, job, path, commit, err = self.request(vid)
        self.assertEqual((status, path, err), ("building", None, None))
        self.assertEqual(self.admin("select job_type::text, state::text, params::text from jobs where id = %s", job),
                         ("scene_bundle", "queued", "{}"))
        self.assertEqual(self.request(vid)[:2], ("building", job))         # asking again: the same job
        self.assertEqual(self.jobs(vid), 1)
        # The version's own state is untouched: a bundle is not a render.
        self.assertEqual(self.admin("select state::text from versions where id = %s", vid), "draft")

    def test_nobody_else_can_ask(self):
        _, vid = self.project_with_version()
        for who in (OTHER, WORKER, "anon"):
            with self.assertRaises(psycopg.Error):
                self.request(vid, who)
        with self.assertRaisesRegex(psycopg.Error, "Version not found") as e:
            self.request(vid, OTHER)
        self.assertEqual(e.exception.sqlstate, "PT404")                    # not "forbidden": it isn't theirs
        self.assertEqual(self.jobs(vid), 0)
        # Both layers: visitors can't even call it (require_signed_in is the second lock).
        self.assertEqual(self.admin("select has_function_privilege('anon', 'public.request_scene_bundle(uuid)', 'execute')"),
                         False)

    def test_only_request_scene_bundle_makes_one(self):
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "request_scene_bundle"):
            self.db.as_(RYAN).one("select id from submit_job(%s, 'scene_bundle')", vid)
        with self.assertRaisesRegex(psycopg.Error, "request_scene_bundle"):   # even the table owner
            self.admin("insert into jobs (owner_id, project_id, version_id, job_type, story, story_sha256) "
                       "select owner_id, project_id, id, 'scene_bundle', story_spec, story_sha256 from versions "
                       "where id = %s returning id", vid)
        self.assertEqual(self.jobs(vid), 0)

    def test_only_the_owner_reads_the_bundle(self):
        vid, job, path = self.ready()
        count = "select count(*) from storage.objects where name = %s"
        self.assertEqual(self.db.as_(RYAN).one(count, path), 1)
        self.assertEqual(self.db.as_(OTHER).one(count, path), 0)
        self.assertEqual(self.db.as_(WORKER).one(count, path), 0)           # job finished
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from jobs where id = %s", job), 0)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from artifacts where job_id = %s", job), 0)

    def test_finished_and_archived_versions(self):
        _, vid = self.project_with_version()
        self.admin("update versions set state = 'complete' where id = %s returning 1", vid)
        self.assertEqual(self.request(vid)[0], "building")                  # a finished film can be previewed
        _, vid2 = self.project_with_version()
        self.admin("update versions set state = 'archived' where id = %s returning 1", vid2)
        with self.assertRaisesRegex(psycopg.Error, "archived"):
            self.request(vid2)

    def test_unready_story_is_refused(self):
        _, vid = self.project_with_version(story='{"schema": 1, "engine": "other"}')
        with self.assertRaisesRegex(psycopg.Error, "schema-1 sequence"):
            self.request(vid)

    # -- what a bundle job may produce
    def test_bundle_job_uploads_only_a_bundle(self):
        _, vid = self.project_with_version()
        job = self.request(vid)[1]
        self.start(job)
        w = self.db.as_(WORKER)
        w.one("select state from report_state(%s, 'validating')", job)
        w.one("select state from report_state(%s, 'uploading')", job)
        for kind in ("preview", "final_video", "thumbnail", "receipt"):
            with self.assertRaisesRegex(psycopg.Error, "does not produce"):
                w.one("select register_artifact(%s, %s, 100, %s)", job, kind, "a" * 64)
        with self.assertRaisesRegex(psycopg.Error, "at most"):
            w.one("select register_artifact(%s, 'scene_bundle', 50000001, %s)", job, "a" * 64)
        with self.assertRaisesRegex(psycopg.Error, "Missing artifacts: scene_bundle"):
            w.one("select state from report_state(%s, 'complete')", job)
        path = w.one("select register_artifact(%s, 'scene_bundle', 100, %s)", job, "a" * 64)
        self.assertTrue(path.endswith(f"/{vid}/{job}/scene.bundle.zip"))
        self.assertTrue(path.startswith(RYAN + "/"))
        self.assertEqual(self.admin("select 'application/zip' = any(allowed_mime_types) from storage.buckets "
                                    "where id = 'ryagram-artifacts'"), True)

    def test_other_jobs_cannot_upload_a_bundle(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.start(job)
        w = self.db.as_(WORKER)
        w.one("select state from report_state(%s, 'validating')", job)
        w.one("select state from report_state(%s, 'uploading')", job)
        with self.assertRaisesRegex(psycopg.Error, "does not produce"):
            w.one("select register_artifact(%s, 'scene_bundle', 100, %s)", job, "a" * 64)

    # -- the cache
    def test_cache_hit_reuses_the_bundle(self):
        vid, job, path = self.ready()
        self.assertEqual(self.request(vid), ("ready", job, path, "abc1234", None))
        self.assertEqual(self.request(vid), ("ready", job, path, "abc1234", None))
        self.assertEqual(self.jobs(vid), 1)                                # nothing new was built

    def test_cache_is_per_version(self):
        vid, job, path = self.ready()
        _, vid2 = self.project_with_version()                              # same story text, other version
        status, job2, *_ = self.request(vid2)
        self.assertEqual(status, "building")
        self.assertNotEqual(job2, job)

    def test_a_new_story_builds_a_new_bundle(self):
        vid, job, path = self.ready()
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", STORY2, vid)
        status, job2, path2, *_ = self.request(vid)
        self.assertEqual((status, path2), ("building", None))
        self.assertNotEqual(job2, job)
        path2 = self.build(job2)
        self.assertEqual(self.request(vid)[:3], ("ready", job2, path2))
        # Back to the first story: its bundle is still valid for this engine and is reused.
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", core.STORY, vid)
        self.assertEqual(self.request(vid)[:3], ("ready", job, path))

    def test_a_new_engine_builds_a_new_bundle(self):
        vid, job, path = self.ready("abc1234")
        _, other_vid = self.project_with_version()                         # the worker updates and runs a job
        prev = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", other_vid)
        self.start(prev, "def5678")
        self.assertEqual(self.db.as_(RYAN).one("select current_engine_commit()"), "def5678")
        status, job2, *_ = self.request(vid)
        self.assertEqual(status, "building")
        self.assertNotEqual(job2, job)

    def test_no_known_engine_means_no_cache_hit(self):
        vid, job, path = self.ready()
        self.admin("update workers set enabled = false returning 1")     # current_engine_commit() is null
        self.admin("update workers set enabled = true where user_id = %s returning 1", WORKER2)
        self.assertIsNone(self.db.as_(RYAN).one("select current_engine_commit()"))
        self.assertEqual(self.request(vid)[0], "building")

    def test_a_deleted_file_is_rebuilt(self):
        vid, job, path = self.ready()
        self.admin("update artifacts set deleted_at = now() where job_id = %s returning 1", job)
        status, job2, *_ = self.request(vid)
        self.assertEqual(status, "building")
        path2 = self.build(job2)
        self.assertEqual(self.request(vid)[:3], ("ready", job2, path2))
        self.admin("delete from storage.objects where name = %s returning 1", path2)
        self.assertEqual(self.request(vid)[0], "building")

    def test_a_stale_build_is_stopped(self):
        _, vid = self.project_with_version()
        queued = self.request(vid)[1]
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", STORY2, vid)
        fresh = self.request(vid)[1]
        self.assertNotEqual(fresh, queued)
        self.assertEqual(self.admin("select state::text from jobs where id = %s", queued), "cancelled")
        self.start(fresh)                                                  # now one is running...
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", core.STORY, vid)
        third = self.request(vid)[1]
        self.assertEqual(self.admin("select state::text, cancel_requested from jobs where id = %s", fresh),
                         ("running", True))                                # ...and is told to stop
        self.assertNotIn(third, (queued, fresh))

    def test_an_input_failure_is_not_rebuilt_but_a_machine_failure_is(self):
        _, vid = self.project_with_version()
        job = self.request(vid)[1]
        self.start(job)
        self.db.as_(WORKER).one("select state from report_state(%s, 'failed', 'engine_refused', 'No such view: x.')", job)
        self.assertEqual(self.request(vid), ("failed", job, None, "abc1234", "No such view: x."))
        self.assertEqual(self.jobs(vid), 1)
        # A new engine may fix it: build again.
        _, other_vid = self.project_with_version()
        prev = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", other_vid)
        self.start(prev, "def5678")
        self.assertEqual(self.request(vid)[0], "building")
        # Infrastructure failures are retried on request.
        _, vid3 = self.project_with_version()
        job3 = self.request(vid3)[1]
        self.admin("update jobs set state = 'failed', error_code = 'crash', error_class = 'infrastructure', "
                   "engine_commit = 'def5678', ended_at = now() where id = %s returning 1", job3)
        status, job3b, *_ = self.request(vid3)
        self.assertEqual(status, "building")
        self.assertNotEqual(job3b, job3)

    def test_at_most_three_building_per_person(self):
        vids = [self.project_with_version()[1] for _ in range(4)]
        for vid in vids[:3]:
            self.assertEqual(self.request(vid)[0], "building")
        with self.assertRaisesRegex(psycopg.Error, "Three previews"):
            self.request(vids[3])
        _, other_vid = self.project_with_version(who=OTHER)
        self.assertEqual(self.request(other_vid, OTHER)[0], "building")    # per person, not global


# The 2B ledger loaded on top: a bundle is priced at 0, holds nothing, writes no rows.
class BundlesAreFree(unittest.TestCase):
    TEMPLATE = "tmplsb2b"

    @classmethod
    def setUpClass(cls):
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"drop database if exists {cls.TEMPLATE}")
            c.execute(f"create database {cls.TEMPLATE} template tmpl")
        with psycopg.connect(core._server.get_uri(database=cls.TEMPLATE), autocommit=True) as c:
            c.execute(LEDGER.read_text(encoding="utf-8"))
            c.execute("update control set disabled_job_types = '{}' where id")

    @classmethod
    def tearDownClass(cls):
        pgtemp.drop_database(core._server, cls.TEMPLATE)

    def setUp(self):
        self.name = "sb2b_" + self._testMethodName[-20:]
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template {self.TEMPLATE}")
        self.db = core.Db(core._server.get_uri(database=self.name))

    def tearDown(self):
        self.db.c.close()
        pgtemp.drop_database(core._server, self.name)

    project_with_version = core.Core.project_with_version

    def test_a_bundle_costs_nothing_with_no_credits(self):
        _, vid = self.project_with_version()                               # RYAN has no credits at all
        self.assertEqual(self.db.as_(RYAN).one("select price_code, credits from credit_quote(%s, 'scene_bundle')", vid),
                         ("scene_bundle", 0))
        status, job, *_ = self.db.as_(RYAN).one("select status, job_id from request_scene_bundle(%s)", vid)
        self.assertEqual(status, "building")
        self.assertEqual(self.db.as_(None).one("select price_code, credits_quoted, hold_id from jobs where id = %s", job),
                         ("scene_bundle", 0, None))
        self.assertEqual(self.db.as_(None).one("select count(*) from credit_ledger"), 0)

    def test_a_film_is_still_charged(self):
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "price"):                # the film's price path is unchanged
            self.db.as_(RYAN).one("select credits from credit_quote(%s, 'final_render')", vid)


if __name__ == "__main__":
    unittest.main()
