"""worker_job_upload (migrations/20261004000500): the worker learns which upload a job reads, and nothing else.

Same setup as test_uploads.py. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_worker_upload_access.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
ROOT = Path(__file__).resolve().parents[1]
_outer_setup = core.setUpModule
MAPPING = {"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": "us_states", "cadence": "annual",
           "measure_names": {"2": "Jobs"}, "banded_index": 2}
REPORT = {"format": "csv", "sha256": "a" * 64, "rows": 3,
          "columns": [{"index": 0, "header": "State", "kind": "place", "sample": ["Alabama"]},
                      {"index": 1, "header": "Year", "kind": "period", "sample": ["2019"]},
                      {"index": 2, "header": "Jobs", "kind": "number", "sample": ["100"]}],
          "guess": {"place_index": 0, "period_index": 1, "value_indexes": [2], "geography": "us_states", "cadence": "annual", "wide": False},
          "periods": {"first": "2019", "last": "2021", "count": 3}, "unmatched": {"count": 0, "names": []}}


def setUpModule():
    _outer_setup()


class WorkerUpload(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def confirmed_upload(self, who=RYAN):
        d = self.db.as_(who)
        ds, path = d.one("select * from create_upload('mine.csv', 'csv', 1000)")
        self.db.as_(who).c.execute("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-uploads', %s, %s::jsonb)",
                                   (path, json.dumps({"size": 1000, "mimetype": "text/csv"})))
        self.db.as_(who).one("select finish_upload(%s) is null", ds)
        claimed = self.db.as_(WORKER).one("select * from claim_next_ingest()")
        self.db.as_(WORKER).one("select report_ingest(%s, %s::jsonb) is null", claimed[0], json.dumps(REPORT))
        self.db.as_(who).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        return ds

    def job_on(self, ds, state="running", worker=WORKER):
        d = self.db.as_(RYAN)
        pid = d.one("insert into projects (title) values ('P') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        self.admin("update versions set dataset_id = %s where id = %s returning 1", ds, vid)
        return self.admin("insert into jobs (owner_id, project_id, version_id, job_type, state, story, story_sha256, dataset_id, params, worker_user_id) "
                          "values (%s, %s, %s, 'preview', %s, '{}'::jsonb, %s, %s, %s::jsonb, %s) returning id",
                          RYAN, pid, vid, state, "e" * 64, ds, json.dumps({"window_s": [0, 10]}), worker)

    def test_the_worker_holding_the_job_gets_the_file_the_confirmed_mapping_and_the_story_name(self):
        ds = self.confirmed_upload()
        job = self.job_on(ds)
        row = self.db.as_(WORKER).one("select * from worker_job_upload(%s)", job)
        self.assertEqual((str(row[0]), row[1], row[2], row[3], row[4], row[5], row[6]),
                         (str(ds), "u_" + str(ds).replace("-", "")[:24], f"{RYAN}/{ds}/source.csv", "csv", 1000, "a" * 64, "us_states"))
        self.assertEqual(row[7], MAPPING)
        result = self.admin("select pg_get_function_result('public.worker_job_upload'::regproc)")
        self.assertNotIn("label", result)                                            # the person's file name is never returned
        self.assertNotIn("ingest_report", result)                                    # nor anything the worker read from the file

    def test_only_the_worker_that_holds_the_job_may_ask(self):
        ds = self.confirmed_upload()
        job = self.job_on(ds)
        for who in (RYAN, OTHER, "anon", WORKER2):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select * from worker_job_upload(%s)", job)
        done = self.job_on(ds, state="complete")
        with self.assertRaises(psycopg.Error):                                       # a finished job is no longer held
            self.db.as_(WORKER).one("select * from worker_job_upload(%s)", done)
        queued = self.job_on(ds, state="queued", worker=None)
        with self.assertRaises(psycopg.Error):
            self.db.as_(WORKER).one("select * from worker_job_upload(%s)", queued)

    def test_a_catalog_film_has_no_upload_to_read(self):
        d = self.db.as_(RYAN)
        pid = d.one("insert into projects (title) values ('P') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        job = self.admin("insert into jobs (owner_id, project_id, version_id, job_type, state, story, story_sha256, params, worker_user_id) "
                         "values (%s, %s, %s, 'preview', 'running', '{}'::jsonb, %s, %s::jsonb, %s) returning id",
                         RYAN, pid, vid, "f" * 64, json.dumps({"window_s": [0, 10]}), WORKER)
        self.assertEqual(self.db.as_(WORKER).all("select * from worker_job_upload(%s)", job), [])

    def test_a_deleted_or_unconfirmed_upload_is_a_plain_error_not_a_file(self):
        ds = self.confirmed_upload()
        job = self.job_on(ds)
        self.admin("update datasets set status = 'pending_validation' where id = %s returning 1", ds)
        with self.assertRaisesRegex(psycopg.Error, "has not been confirmed"):
            self.db.as_(WORKER).one("select * from worker_job_upload(%s)", job)
        self.admin("update datasets set status = 'approved' where id = %s returning 1", ds)
        self.db.as_(WORKER).one("select * from worker_job_upload(%s)", job)         # control: approved again, it answers
        self.admin("update datasets set delete_requested_at = now() where id = %s returning 1", ds)
        with self.assertRaisesRegex(psycopg.Error, "has been deleted"):
            self.db.as_(WORKER).one("select * from worker_job_upload(%s)", job)

    def test_another_persons_upload_is_never_returned(self):
        ds = self.confirmed_upload(who=OTHER)
        d = self.db.as_(RYAN)
        pid = d.one("insert into projects (title) values ('P') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        job = self.admin("insert into jobs (owner_id, project_id, version_id, job_type, state, story, story_sha256, dataset_id, params, worker_user_id) "
                         "values (%s, %s, %s, 'preview', 'running', '{}'::jsonb, %s, %s, %s::jsonb, %s) returning id",
                         RYAN, pid, vid, "e" * 64, ds, json.dumps({"window_s": [0, 10]}), WORKER)
        self.assertEqual(self.db.as_(WORKER).all("select * from worker_job_upload(%s)", job), [])   # owner differs: not an upload of this job's owner

    def test_the_worker_can_read_the_file_only_while_it_holds_the_job(self):
        ds = self.confirmed_upload()
        count = lambda who: self.db.as_(who).one("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'")
        self.assertEqual(count(WORKER), 0)
        job = self.job_on(ds)
        self.assertEqual((count(WORKER), count(WORKER2)), (1, 0))
        self.admin("update jobs set state = 'complete' where id = %s returning 1", job)
        self.assertEqual(count(WORKER), 0)


if __name__ == "__main__":
    unittest.main()
