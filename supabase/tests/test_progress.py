"""Live render progress (migrations/20261003000100_job_progress_detail.sql) on a local Postgres.

Same setup as test_2a_core.py (the file is one of the migrations it loads). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_progress.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
setUpModule = core.setUpModule
DRAWING = {"stage": "drawing", "done": 1200, "total": 3000, "unit": "frames", "eta_s": 118.4,
           "eta_is_a_guess": True, "total_is_provisional": False}


class Progress(core.Base):
    project_with_version = core.Core.project_with_version
    claim = core.Core.claim

    def running_job(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.assertEqual(self.claim(), job)
        self.db.as_(WORKER).one("select state from report_state(%s, 'running', p_engine_commit => 'abc1234', p_engine_dirty => false)", job)
        return job

    def beat(self, job, detail=None, who=WORKER, progress=None, note=None):
        return self.db.as_(who).one("select heartbeat(%s, %s::numeric, %s::text, %s::jsonb)", job, progress, note,
                                    None if detail is None else json.dumps(detail))

    def detail(self, job):
        return self.db.as_(RYAN).one("select progress_detail from jobs where id = %s", job)

    def test_the_owner_sees_the_workers_stage_count_and_eta(self):
        job = self.running_job()
        self.assertIs(self.beat(job, {"stage": "starting"}, note="Building the data."), False)
        self.assertEqual(self.detail(job), {"stage": "starting"})
        self.beat(job, DRAWING, progress=0.4)
        self.assertEqual(self.detail(job), DRAWING)
        self.assertEqual(float(self.db.as_(RYAN).one("select progress from jobs where id = %s", job)), 0.4)
        # A beat with no detail keeps the last one, like progress and the note.
        self.beat(job)
        self.assertEqual(self.detail(job), DRAWING)
        self.beat(job, {"stage": "encoding", "done": 0, "total": None, "unit": None, "eta_s": None, "eta_is_a_guess": True})
        self.assertEqual(self.detail(job)["stage"], "encoding")
        self.assertIsNone(self.db.as_(OTHER).one("select progress_detail from jobs where id = %s", job))

    def test_old_workers_still_beat_with_three_arguments(self):
        job = self.running_job()
        self.assertIs(self.db.as_(WORKER).one("select heartbeat(%s, 0.5, 'Drawing frames.')", job), False)
        self.assertIs(self.db.as_(WORKER).one("select heartbeat(p_job_id => %s, p_progress => 0.6, p_note => 'x')", job), False)
        self.assertIsNone(self.detail(job))

    def test_only_the_known_shape_is_stored(self):
        job = self.running_job()
        bad = [
            [], "drawing", {"stage": "hacking"}, {"stage": 3}, {"extra": 1}, {"done": -1}, {"total": "3000"},
            {"eta_s": -5}, {"unit": "pixels"}, {"eta_is_a_guess": "yes"}, {"total_is_provisional": 1},
            {"stage": "drawing", "note": "<script>"},
        ]
        for d in bad:
            with self.subTest(detail=d), self.assertRaises(psycopg.Error):
                self.beat(job, d)
        self.assertIsNone(self.detail(job))

    def test_only_the_holding_worker_can_beat_and_a_requeue_starts_over(self):
        job = self.running_job()
        for who in (WORKER2, RYAN, OTHER):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.beat(job, DRAWING, who=who)
        self.beat(job, DRAWING)
        self.db.as_(WORKER).one("select retry_job(%s, 'crash', 'test')", job)
        self.assertEqual(self.db.as_(RYAN).one("select state from jobs where id = %s", job), "queued")
        self.assertIsNone(self.detail(job))


if __name__ == "__main__":
    unittest.main()
