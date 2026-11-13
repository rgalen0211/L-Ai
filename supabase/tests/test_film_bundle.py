"""Film bundles for the editor's real frames (migrations/20261113000300_film_bundle_types.sql and 20261113000400_film_bundles.sql) on a local Postgres.

Ported from BUILDER's scene-bundle tests (the design is the same) to today's main and to WORKER's film_bundle job (one WINDOW of at most 10 seconds per job). Same setup as test_2a_core.py (the files are among the
migrations it loads). Run from the repo root with TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_film_bundle.py -v

Access: only the version's owner can ask for a window or read it; nobody else, no visitor, no worker; submit_job and direct inserts cannot make one.
The window: whole seconds, ASCII digits, A < B, at most 10 s; anything else is refused before a job exists.
Cache: a finished window is reused while the story and the engine are unchanged, and only then, per window; a deleted file, a new story or a new engine builds a new one.
Credits: with the 2B ledger loaded, a bundle is priced at 0 and writes no ledger rows; a ledger that was loaded BEFORE this migration is taught by the migration itself, and a drifted ledger is refused in words.
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
setUpModule = core.setUpModule
STORY2 = '{"schema": 1, "engine": "sequence", "name": "t2", "sequence": {}}'
LEDGER = core.ROOT / "phase-2b" / "credits_ledger.sql"
MIG = core.ROOT / "migrations" / "20261113000400_film_bundles.sql"
RB = core.ROOT / "rollbacks" / "20261113000400_film_bundles_rollback.sql"
CHECK = core.ROOT / "live-steps" / "27_film_bundle_after_check.sql"
W = "0:10"


class Bundles(core.Base):
    project_with_version = core.Core.project_with_version
    claim = core.Core.claim
    ladder = core.Core.ladder
    run_job = core.Core.run_job

    def setUp(self):
        super().setUp()
        self.admin("update control set disabled_job_types = '{}' where id returning 1")   # turned on

    # -- helpers
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def request(self, vid, who=RYAN, window=W):
        return self.db.as_(who).one("select status, job_id, storage_path, engine_commit, error_detail from request_film_bundle(%s, %s)", vid, window)

    def jobs(self, vid):
        return self.admin("select count(*) from jobs where version_id = %s and job_type = 'film_bundle'", vid)

    def start(self, job, commit="abc1234"):
        self.assertEqual(self.claim(), job)
        self.db.as_(WORKER).one("select state from report_state(%s, 'running', p_engine_commit => %s, p_engine_dirty => false)", job, commit)

    def build(self, job, commit="abc1234"):
        """The worker path for a bundle: running -> validating -> uploading -> complete."""
        self.start(job, commit)
        w = self.db.as_(WORKER)
        w.one("select state from report_state(%s, 'validating')", job)
        w.one("select state from report_state(%s, 'uploading')", job)
        path = w.one("select register_artifact(%s, 'film_bundle', 100, %s)", job, "b" * 64)
        w.one("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, jsonb_build_object('size', 100, 'mimetype', 'application/zip')) returning name", path)
        w.one("select write_metering(%s, 1, '{\"wall_s\": 1.5}')", job)
        self.assertEqual(w.one("select state from report_state(%s, 'complete')", job), "complete")
        return path

    def ready(self, commit="abc1234", window=W):
        _, vid = self.project_with_version()
        status, job, *_ = self.request(vid, window=window)
        self.assertEqual(status, "building")
        path = self.build(job, commit)
        return vid, job, path

    # -- switched off until the worker builds bundles
    def test_off_by_default(self):
        with psycopg.connect(core._server.get_uri(database="tmpl")) as c:
            off = c.execute("select disabled_job_types::text from control").fetchone()[0]
            self.assertIn("film_bundle", off)
            self.assertIn("scene_bundle", off)
        self.admin("update control set disabled_job_types = '{film_bundle}' where id returning 1")
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "paused"):
            self.request(vid)
        self.assertEqual(self.jobs(vid), 0)

    # -- the window
    def test_a_window_is_whole_seconds_a_less_than_b_at_most_ten_and_anything_else_is_no_job(self):
        _, vid = self.project_with_version()
        bad = ["0:11", "5:5", "10:0", "-1:5", "01:5", "0:010", "1.5:3", " 0:10", "0:10 ", "0:0", "a:b", "0-10", "0:10:20", "", ":", "1:", ":5", "1000000:1000005", "٣:٤", "0:10\n"]
        for window in bad:
            with self.assertRaises(psycopg.Error, msg=repr(window)) as e:
                self.request(vid, window=window)
            self.assertEqual(e.exception.sqlstate, "22023", repr(window))
            self.assertIn("window like 0:10", str(e.exception), repr(window))
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select status from request_film_bundle(%s, null)", vid)
        self.assertEqual(self.jobs(vid), 0, "no job for a bad window")
        for window in ("0:10", "7:12", "100:110", "3:4", "59990:60000"):
            self.assertEqual(self.request(vid, window=window)[0], "building", window)
            self.admin("update jobs set state = 'cancelled', ended_at = now() where version_id = %s and job_type = 'film_bundle' returning 1", vid)

    # -- the worker's contract names both bundle types (ryagram/worker/contract.py, read by tests/worker_contract.py): the SQL must agree byte for byte
    def test_the_artifact_helpers_agree_with_the_workers_contract_for_both_bundle_types(self):
        got = {k: self.admin("select filename, mime, max_bytes from ryagram_private.artifact_file(%s::public.artifact_kind)", k) for k in ("scene_bundle", "film_bundle")}
        self.assertEqual(got, {"scene_bundle": ("scene.bundle.zip", "application/zip", 50000000), "film_bundle": ("film.bundle.zip", "application/zip", 50000000)})
        for t in ("scene_bundle", "film_bundle"):
            allowed = {k for (k,) in self.db.as_(None).all("select unnest(enum_range(null::public.artifact_kind))::text") if self.admin("select ryagram_private.kind_allowed(%s::public.job_type, %s::public.artifact_kind)", t, k)}
            self.assertEqual(allowed, {t, "metering"}, t)
            self.assertEqual(self.admin("select ryagram_private.required_kinds(%s::public.job_type)::text[]", t), [t])
        self.assertEqual(self.admin("select count(*) from unnest(enum_range(null::public.job_type)) t where t::text in ('scene_bundle', 'film_bundle')"), 2)

    def test_a_scene_bundle_job_cannot_be_made_by_anyone(self):
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "Scene bundles are not available"):
            self.db.as_(RYAN).one("select id from submit_job(%s, 'scene_bundle')", vid)
        with self.assertRaisesRegex(psycopg.Error, "Scene bundles are not available"):
            self.admin("insert into jobs (owner_id, project_id, version_id, job_type, story, story_sha256) select owner_id, project_id, id, 'scene_bundle', story_spec, story_sha256 from versions where id = %s returning id", vid)

    def test_a_window_wholly_past_the_end_of_a_film_whose_length_is_known_is_refused_in_words_before_a_job_exists(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.assertEqual(self.claim(), final)
        self.run_job(final, ["final_video", "thumbnail", "receipt"])
        self.assertEqual(self.request(vid, window="500:510")[0], "building", "the length is not known yet (the video has no duration): the window is accepted")
        self.admin("update jobs set state = 'cancelled', ended_at = now() where version_id = %s and job_type = 'film_bundle' returning 1", vid)
        self.admin("update artifacts set duration_s = 12.4 where job_id = %s and kind = 'final_video' returning 1", final)
        for window in ("13:20", "100:110"):
            before = self.jobs(vid)
            with self.assertRaises(psycopg.Error, msg=window) as e:
                self.request(vid, window=window)
            self.assertEqual(e.exception.sqlstate, "22023", window)
            self.assertIn("past its end: the film is 12.4 seconds long", str(e.exception), window)
            self.assertEqual(self.jobs(vid), before, "no job for " + window)
        self.assertEqual(self.request(vid, window="5:15")[0], "building", "a window that starts inside the film is fine even when it runs past the end")
        self.assertEqual(self.request(vid, window="11:21")[0], "building")
        self.assertEqual(self.request(vid, window="12:20")[0], "building", "12 is before 12.4: the window starts inside the film")
        self.admin("update jobs set state = 'cancelled', ended_at = now() where version_id = %s and job_type = 'film_bundle' returning 1", vid)
        self.admin("update artifacts set deleted_at = now() where job_id = %s and kind = 'final_video' returning 1", final)
        self.assertEqual(self.request(vid, window="100:110")[0], "building", "a deleted video tells nothing about the length")

    def test_the_length_of_an_older_story_is_not_the_length_of_this_one(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.assertEqual(self.claim(), final)
        self.run_job(final, ["final_video", "thumbnail", "receipt"])
        self.admin("update artifacts set duration_s = 12.4 where job_id = %s and kind = 'final_video' returning 1", final)
        self.admin("update jobs set story_sha256 = %s where id = %s returning 1", "f" * 64, final)          # as if the film had been rendered from another story
        self.assertEqual(self.request(vid, window="100:110")[0], "building")

    # -- access
    def test_owner_request_queues_one_job_per_window(self):
        _, vid = self.project_with_version()
        status, job, path, commit, err = self.request(vid)
        self.assertEqual((status, path, err), ("building", None, None))
        self.assertEqual(self.admin("select job_type::text, state::text, params ->> 'seconds', params::text from jobs where id = %s", job),
                         ("film_bundle", "queued", W, '{"seconds": "0:10"}'))
        self.assertEqual(self.request(vid)[:2], ("building", job))                    # asking again for the same window: the same job
        self.assertEqual(self.jobs(vid), 1)
        job2 = self.request(vid, window="10:20")[1]                                   # another window: its own job
        self.assertNotEqual(job2, job)
        self.assertEqual(self.jobs(vid), 2)
        self.assertEqual(self.admin("select state::text from versions where id = %s", vid), "draft", "a bundle is not a render")

    def test_nobody_else_can_ask(self):
        _, vid = self.project_with_version()
        for who in (OTHER, WORKER, "anon"):
            with self.assertRaises(psycopg.Error):
                self.request(vid, who)
        with self.assertRaisesRegex(psycopg.Error, "Version not found") as e:
            self.request(vid, OTHER)
        self.assertEqual(e.exception.sqlstate, "PT404")                              # not "forbidden": it isn't theirs
        self.assertEqual(self.jobs(vid), 0)
        self.assertEqual(self.admin("select has_function_privilege('anon', 'public.request_film_bundle(uuid, text)', 'execute')"), False)

    def test_only_request_film_bundle_makes_one(self):
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "request_film_bundle"):
            self.db.as_(RYAN).one("select id from submit_job(%s, 'film_bundle')", vid)
        with self.assertRaisesRegex(psycopg.Error, "request_film_bundle"):             # even the table owner
            self.admin("insert into jobs (owner_id, project_id, version_id, job_type, story, story_sha256) select owner_id, project_id, id, 'film_bundle', story_spec, story_sha256 from versions where id = %s returning id", vid)
        self.assertEqual(self.jobs(vid), 0)

    def test_only_the_owner_reads_the_bundle(self):
        vid, job, path = self.ready()
        count = "select count(*) from storage.objects where name = %s"
        self.assertEqual(self.db.as_(RYAN).one(count, path), 1)
        self.assertEqual(self.db.as_(OTHER).one(count, path), 0)
        self.assertEqual(self.db.as_(WORKER).one(count, path), 0)                    # job finished
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from jobs where id = %s", job), 0)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from artifacts where job_id = %s", job), 0)

    def test_finished_and_archived_versions(self):
        _, vid = self.project_with_version()
        self.admin("update versions set state = 'complete' where id = %s returning 1", vid)
        self.assertEqual(self.request(vid)[0], "building")                             # a finished film can be previewed
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
            w.one("select register_artifact(%s, 'film_bundle', 50000001, %s)", job, "a" * 64)
        with self.assertRaisesRegex(psycopg.Error, "Missing artifacts: film_bundle"):
            w.one("select state from report_state(%s, 'complete')", job)
        path = w.one("select register_artifact(%s, 'film_bundle', 100, %s)", job, "a" * 64)
        self.assertTrue(path.endswith(f"/{vid}/{job}/film.bundle.zip"), path)
        self.assertTrue(path.startswith(RYAN + "/"))
        self.assertEqual(self.admin("select 'application/zip' = any(allowed_mime_types) from storage.buckets where id = 'ryagram-artifacts'"), True)

    def test_other_jobs_cannot_upload_a_bundle(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.start(job)
        w = self.db.as_(WORKER)
        w.one("select state from report_state(%s, 'validating')", job)
        w.one("select state from report_state(%s, 'uploading')", job)
        with self.assertRaisesRegex(psycopg.Error, "does not produce"):
            w.one("select register_artifact(%s, 'film_bundle', 100, %s)", job, "a" * 64)

    # -- the claim order: a window someone is scrubbing jumps the queue, but never starves a film
    def queued_final(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        return final

    def test_a_queued_window_is_claimed_before_an_earlier_queued_render(self):
        final = self.queued_final()
        _, vid = self.project_with_version()
        window = self.request(vid)[1]
        self.assertEqual(self.admin("select state::text from jobs where id = %s", final), "queued")
        self.assertEqual(self.claim(), window, "the window jumps the queue")
        self.admin("update jobs set state = 'cancelled', ended_at = now() where id = %s returning 1", window)
        self.assertEqual(self.claim(), final, "and the render is next")

    def test_a_render_that_has_waited_two_minutes_goes_before_a_later_window(self):
        final = self.queued_final()
        self.admin("update jobs set created_at = now() - interval '3 minutes' where id = %s returning 1", final)
        _, vid = self.project_with_version()
        window = self.request(vid)[1]
        self.assertEqual(self.claim(), final, "a film that has waited two minutes is not overtaken by editing")
        self.admin("update jobs set state = 'cancelled', ended_at = now() where id = %s returning 1", final)
        self.assertEqual(self.claim(), window)

    def test_a_render_that_has_waited_a_minute_is_still_overtaken_and_windows_keep_their_own_order(self):
        final = self.queued_final()
        self.admin("update jobs set created_at = now() - interval '110 seconds' where id = %s returning 1", final)
        _, v1 = self.project_with_version()
        _, v2 = self.project_with_version()
        w1 = self.request(v1)[1]
        w2 = self.request(v2)[1]
        self.assertEqual(self.claim(), w1, "oldest window first")
        self.admin("update jobs set state = 'cancelled', ended_at = now() where id = %s returning 1", w1)
        self.assertEqual(self.claim(), w2)
        self.admin("update jobs set state = 'cancelled', ended_at = now() where id = %s returning 1", w2)
        self.assertEqual(self.claim(), final)

    def test_a_waiting_job_of_a_disabled_type_does_not_hold_windows_back(self):
        final = self.queued_final()
        self.admin("update jobs set created_at = now() - interval '5 minutes' where id = %s returning 1", final)
        _, vx = self.project_with_version()
        x = self.db.as_(RYAN).one("select id from submit_job(%s, 'contact_sheet', '{\"periods\": [\"2016\", \"2018\", \"2020\"]}')", vx)       # an enabled job, older than the window
        _, vid = self.project_with_version()
        window = self.request(vid)[1]
        self.admin("update control set disabled_job_types = '{final_render}' where id returning 1")           # the house may not run renders: the old one is not 'waiting'
        self.assertEqual(self.claim(), window, "a render the house is not allowed to run does not count as waiting")
        self.assertNotEqual(window, x)

    # -- the cache, per window
    def test_cache_hit_reuses_the_bundle_for_the_same_window_only(self):
        vid, job, path = self.ready()
        self.assertEqual(self.request(vid), ("ready", job, path, "abc1234", None))
        self.assertEqual(self.request(vid), ("ready", job, path, "abc1234", None))
        self.assertEqual(self.jobs(vid), 1)                                          # nothing new was built
        other = self.request(vid, window="10:20")
        self.assertEqual(other[0], "building")                                       # another window is not served by this one
        self.assertNotEqual(other[1], job)
        self.assertEqual(self.request(vid), ("ready", job, path, "abc1234", None), "and the first window is still ready")

    def test_cache_is_per_version(self):
        vid, job, path = self.ready()
        _, vid2 = self.project_with_version()                                        # same story text, other version
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
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", core.STORY, vid)
        self.assertEqual(self.request(vid)[:3], ("ready", job, path))                # back to the first story: its bundle is still valid for this engine

    def test_a_new_engine_builds_a_new_bundle(self):
        vid, job, path = self.ready("abc1234")
        _, other_vid = self.project_with_version()                                   # the worker updates and runs a job
        prev = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", other_vid)
        self.start(prev, "def5678")
        self.assertEqual(self.db.as_(RYAN).one("select current_engine_commit()"), "def5678")
        status, job2, *_ = self.request(vid)
        self.assertEqual(status, "building")
        self.assertNotEqual(job2, job)

    def test_no_known_engine_means_no_cache_hit(self):
        vid, job, path = self.ready()
        self.admin("update workers set enabled = false returning 1")                 # current_engine_commit() is null
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

    def test_a_stale_build_is_stopped_and_a_current_window_is_not(self):
        _, vid = self.project_with_version()
        queued = self.request(vid)[1]
        keep = self.request(vid, window="10:20")[1]
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", STORY2, vid)
        fresh = self.request(vid)[1]
        self.assertNotIn(fresh, (queued, keep))
        self.assertEqual(self.admin("select state::text from jobs where id = %s", queued), "cancelled")
        self.assertEqual(self.admin("select state::text from jobs where id = %s", keep), "cancelled", "every window of the older story is stopped")
        self.start(fresh)                                                            # now one is running...
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning id", core.STORY, vid)
        third = self.request(vid)[1]
        self.assertEqual(self.admin("select state::text, cancel_requested from jobs where id = %s", fresh), ("running", True))   # ...and is told to stop
        self.assertNotIn(third, (queued, fresh))

    def test_an_input_failure_is_not_rebuilt_for_that_window_but_a_machine_failure_is(self):
        _, vid = self.project_with_version()
        job = self.request(vid)[1]
        self.start(job)
        self.db.as_(WORKER).one("select state from report_state(%s, 'failed', 'engine_refused', 'No such view: x.')", job)
        self.assertEqual(self.request(vid), ("failed", job, None, "abc1234", "No such view: x."))
        self.assertEqual(self.jobs(vid), 1)
        other = self.request(vid, window="10:20")
        self.assertEqual(other[0], "building", "another window of the same film is its own question")
        self.admin("update jobs set state = 'cancelled', ended_at = now() where id = %s returning 1", other[1])       # keep the queue clear for the next claim
        _, other_vid = self.project_with_version()                                   # a new engine may fix it: build again
        prev = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", other_vid)
        self.start(prev, "def5678")
        self.assertEqual(self.request(vid)[0], "building")
        _, vid3 = self.project_with_version()                                        # infrastructure failures are retried on request
        job3 = self.request(vid3)[1]
        self.admin("update jobs set state = 'failed', error_code = 'crash', error_class = 'infrastructure', engine_commit = 'def5678', ended_at = now() where id = %s returning 1", job3)
        status, job3b, *_ = self.request(vid3)
        self.assertEqual(status, "building")
        self.assertNotEqual(job3b, job3)

    def test_at_most_six_building_per_person(self):
        vids = [self.project_with_version()[1] for _ in range(7)]
        for vid in vids[:6]:
            self.assertEqual(self.request(vid)[0], "building")
        with self.assertRaisesRegex(psycopg.Error, "Six parts"):
            self.request(vids[6])
        _, other_vid = self.project_with_version(who=OTHER)
        self.assertEqual(self.request(other_vid, OTHER)[0], "building")              # per person, not global

    def test_at_most_sixty_windows_an_hour(self):
        _, vid = self.project_with_version()
        for i in range(60):
            self.assertEqual(self.request(vid, window=f"{i * 10}:{i * 10 + 10}")[0], "building")
            self.admin("update jobs set state = 'cancelled', ended_at = now() where version_id = %s and job_type = 'film_bundle' returning 1", vid)   # not the in-flight cap
        with self.assertRaisesRegex(psycopg.Error, "60 parts"):
            self.request(vid, window="600:610")
        self.admin("update jobs set created_at = now() - interval '61 minutes' where job_type = 'film_bundle' returning 1")
        self.assertEqual(self.request(vid, window="600:610")[0], "building")         # an hour later

    def test_uploaded_data_films_are_not_bundled_in_v1(self):
        _, vid = self.project_with_version()
        ds = self.admin("insert into public.datasets (owner_id, name) values (%s, 'upload.csv') returning id", RYAN)
        self.admin("update versions set dataset_id = %s where id = %s returning 1", ds, vid)
        with self.assertRaisesRegex(psycopg.Error, "catalog films only"):
            self.request(vid)
        self.assertEqual(self.jobs(vid), 0)

    # -- the migration's own files
    def test_the_after_check_is_all_true_and_the_rollback_undoes_part_two_before_any_job_and_refuses_after_one(self):
        self.admin("update control set disabled_job_types = '{film_bundle,scene_bundle}' where id returning 1")           # the state the migration leaves it in
        rows = self.apply(CHECK.read_text(encoding="utf-8"), "the after-check").fetchall()
        self.assertEqual(len(rows), 9)
        self.assertTrue(all(ok for _, ok in rows), rows)
        self.admin("update control set disabled_job_types = '{}' where id returning 1")                      # turned on again for the rest
        _, vid = self.project_with_version()
        self.request(vid)
        try:
            self.admin(RB.read_text(encoding="utf-8"))
            self.fail("the rollback must refuse once a film bundle job exists")
        except psycopg.Error as e:
            self.db.c.execute("rollback")
            self.assertIn("A film bundle job exists", str(e))
        self.admin("delete from jobs where job_type = 'film_bundle' returning 1")
        self.apply(RB.read_text(encoding="utf-8"), "the rollback")
        self.assertIsNone(self.admin("select to_regprocedure('public.request_film_bundle(uuid,text)')"))
        self.assertEqual(self.admin("select count(*) from pg_trigger where tgname = 'jobs_film_bundle_by_request'"), 0)
        self.assertFalse(self.admin("select 'film_bundle' = any (disabled_job_types) from control where id"))
        self.apply(RB.read_text(encoding="utf-8"), "a second rollback")             # nothing to do
        self.apply(MIG.read_text(encoding="utf-8"), "the migration again")
        self.assertTrue(all(ok for _, ok in self.apply(CHECK.read_text(encoding="utf-8"), "the after-check").fetchall()))

    def apply(self, text, what):
        try:
            return self.db.as_(None).c.execute(text)
        except psycopg.Error as e:
            self.db.c.execute("rollback")
            self.fail(f"{what} stopped: {e}")

    def test_the_migration_ends_with_the_waiting_list_gate(self):
        sql = MIG.read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])


# The 2B ledger: a bundle is priced at 0, holds nothing, writes no rows; and a ledger loaded BEFORE the migration is taught by it.
class BundlesAreFree(core.Base):
    project_with_version = core.Core.project_with_version
    ADDED = ("  elsif new.job_type = 'film_bundle' then\n    new.price_code := 'film_bundle';                     -- film bundles are free (20261113000400)\n",
             "  elsif p_job_type = 'film_bundle' then code := 'film_bundle';\n",
             "  -- The editor's real-frame bundles (request_film_bundle, migration 20261113000400): always free.\n  ('2026-09', 'film_bundle', 0, null, false, '2026-09-01')")

    def original_ledger(self):
        """The ledger as it was applied by hand before this change: the same file without the three additions."""
        s = LEDGER.read_text(encoding="utf-8").replace("\r\n", "\n")
        for a in self.ADDED[:2]:
            self.assertEqual(s.count(a), 1)
            s = s.replace(a, "")
        extra = ",\n" + self.ADDED[2]
        self.assertEqual(s.count(extra), 1)
        return s.replace(extra, "")

    def setUp(self):
        super().setUp()
        self.db.as_(None).one("update control set disabled_job_types = '{}' where id returning 1")

    def quote(self, vid, jt="film_bundle"):
        return self.db.as_(RYAN).one("select price_code, credits from credit_quote(%s, %s::job_type)", vid, jt)

    def test_a_bundle_costs_nothing_with_no_credits_when_the_ledger_is_loaded_after_the_migration(self):
        self.db.as_(None).c.execute(LEDGER.read_text(encoding="utf-8"))
        _, vid = self.project_with_version()                                         # RYAN has no credits at all
        self.assertEqual(self.quote(vid), ("film_bundle", 0))
        status, job, *_ = self.db.as_(RYAN).one("select status, job_id from request_film_bundle(%s, '0:10')", vid)
        self.assertEqual(status, "building")
        self.assertEqual(self.db.as_(None).one("select price_code, credits_quoted, hold_id from jobs where id = %s", job), ("film_bundle", 0, None))
        self.assertEqual(self.db.as_(None).one("select count(*) from credit_ledger"), 0)

    def test_a_film_is_still_charged(self):
        self.db.as_(None).c.execute(LEDGER.read_text(encoding="utf-8"))
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "price"):                          # the film's price path is unchanged
            self.db.as_(RYAN).one("select credits from credit_quote(%s, 'final_render')", vid)

    def test_a_ledger_loaded_before_the_migration_is_taught_it_exactly_once_and_a_film_still_costs_what_it_did(self):
        orig = self.original_ledger()
        self.db.as_(None).c.execute(orig)
        _, vid = self.project_with_version()
        with self.assertRaisesRegex(psycopg.Error, "price"):                           # before: the old ledger prices an unknown type at the FILM's price path (which has no price for this story)
            self.quote(vid)
        self.db.as_(None).c.execute(MIG.read_text(encoding="utf-8"))
        self.db.as_(None).one("update control set disabled_job_types = '{}' where id returning 1")           # the migration switches bundles off: on again for this test
        self.assertEqual(self.quote(vid), ("film_bundle", 0))
        status, job, *_ = self.db.as_(RYAN).one("select status, job_id from request_film_bundle(%s, '0:10')", vid)
        self.assertEqual(self.db.as_(None).one("select price_code, credits_quoted, hold_id from jobs where id = %s", job), ("film_bundle", 0, None))
        before = self.db.as_(None).one("select pg_get_functiondef(to_regprocedure('ryagram_private.jobs_quote()'))")
        self.db.as_(None).c.execute(MIG.read_text(encoding="utf-8"))               # a second run changes nothing (and leaves bundles switched off, as the first did)
        self.assertTrue(self.db.as_(None).one("select 'film_bundle' = any (disabled_job_types) from control where id"))
        self.assertEqual(self.db.as_(None).one("select pg_get_functiondef(to_regprocedure('ryagram_private.jobs_quote()'))"), before)
        self.assertEqual(self.db.as_(None).one("select count(*) from credit_prices where code = 'film_bundle'"), 1)

    def test_a_ledger_that_is_not_the_expected_one_is_refused_in_words_and_nothing_is_changed(self):
        self.db.as_(None).c.execute(self.original_ledger())
        drifted = self.db.as_(None).one("select replace(pg_get_functiondef(to_regprocedure('ryagram_private.jobs_quote()')), E'  else\n    new.price_code', E'  else\n    new.price_code2')")
        self.db.as_(None).c.execute(drifted)                                          # as if someone had changed it by hand
        before = self.db.as_(None).one("select prosrc from pg_proc where oid = to_regprocedure('ryagram_private.jobs_quote()')")
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(None).c.execute(MIG.read_text(encoding="utf-8"))
        self.assertIn("is not the one this change expects", str(cm.exception))
        self.db.c.execute("rollback")                                                 # the failed migration left its explicit transaction open: end it
        self.assertEqual(self.db.as_(None).one("select prosrc from pg_proc where oid = to_regprocedure('ryagram_private.jobs_quote()')"), before, "nothing was changed")
        self.assertEqual(self.db.as_(None).one("select count(*) from credit_prices where code = 'film_bundle'"), 0)


if __name__ == "__main__":
    unittest.main()
