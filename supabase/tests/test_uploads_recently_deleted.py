"""Uploads: Recently deleted for 7 days (migration 20261004000700). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_uploads_recently_deleted.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_uploads as up  # noqa: E402
from test_uploads import setUpModule  # noqa: E402,F401  (loads the migrations and the catalog seed)

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
MIB = 1024 * 1024


class RecentlyDeleted(core.Base):
    # Reuse the upload helpers without inheriting (and re-running) every test of that class.
    admin = up.Uploads.admin
    create = up.Uploads.create
    put_file = up.Uploads.put_file
    uploaded = up.Uploads.uploaded
    read_by_worker = up.Uploads.read_by_worker
    job = up.Uploads.job
    project_version = up.Uploads.project_version

    def confirmed(self):
        ds, path = self.uploaded()
        self.read_by_worker(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(up.MAPPING))
        return ds, path

    def trash(self, ds, who=RYAN):
        self.db.as_(who).one("select request_dataset_deletion(%s) is null", ds)

    def due(self):
        return sorted(str(r[0]) for r in self.db.as_("service").all("select dataset_id from uploads_due_for_deletion()"))

    def listed(self, who=RYAN):
        return [r[0] for r in self.db.as_(who).all("select * from my_recently_deleted_uploads()")]

    def file_count(self):
        return self.admin("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'")

    # -- delete now means Recently deleted
    def test_delete_moves_it_to_recently_deleted_and_keeps_the_file(self):
        ds, _ = self.confirmed()
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        self.trash(ds)
        self.assertIsNotNone(self.admin("select trashed_at from datasets where id = %s", ds))
        self.assertIsNone(self.admin("select delete_requested_at from datasets where id = %s", ds))
        self.assertEqual(self.file_count(), 1)                                       # restorable: the file is still there
        self.assertEqual(self.due(), [])                                             # and the sweeper does not touch it yet
        self.assertEqual(self.listed(), [ds])
        self.assertIsNone(self.admin("select dataset_id from versions where id = %s", vid))
        self.assertEqual(self.admin("select count(*) from version_sources where version_id = %s", vid), 0)
        self.trash(ds)                                                               # deleting twice is harmless
        self.assertEqual(self.listed(), [ds])

    def test_a_recently_deleted_upload_cannot_be_used_or_read(self):
        ds, _ = self.confirmed()
        _, vid = self.project_version()
        self.trash(ds)
        calls = (("attach", "select attach_upload_to_version(%s, %s)", (vid, ds)),
                 ("confirm", "select confirm_dataset_mapping(%s, '{}'::jsonb)", (ds,)),
                 ("finish", "select finish_upload(%s)", (ds,)))
        for name, sql, args in calls:
            with self.subTest(call=name), self.assertRaises(psycopg.Error) as e:
                self.db.as_(RYAN).one(sql, *args)
            self.assertEqual(e.exception.sqlstate, "PT404")
        # A story naming it cannot sync it in as a source.
        ref = "u_" + str(ds).replace("-", "")[:24]
        story = {"schema": 1, "engine": "sequence", "name": "t", "sequence": {"clips": [{"kind": "render", "dataset": ref, "view": "map"}]}}
        self.db.as_(RYAN).one("update versions set story_spec = %s::jsonb where id = %s returning 1", json.dumps(story), vid)
        with self.assertRaisesRegex(psycopg.Error, "isn't ready"):
            self.db.as_(RYAN).all("select * from sync_version_sources(%s)", vid)
        # Not even a worker that holds a job on it (a row inserted behind the application's back) can read the file or ask for it.
        job = self.job(vid, ds, "preview", "running", worker=WORKER)
        self.assertEqual(self.db.as_(WORKER).one("select count(*) from storage.objects where bucket_id = 'ryagram-uploads'"), 0)
        with self.assertRaisesRegex(psycopg.Error, "has been deleted"):
            self.db.as_(WORKER).one("select * from worker_job_upload(%s)", job)

    def test_a_running_render_still_blocks_the_first_delete(self):
        ds, _ = self.confirmed()
        _, vid = self.project_version()
        self.job(vid, ds, "preview", "running")
        with self.assertRaisesRegex(psycopg.Error, "still running"):
            self.trash(ds)
        self.assertIsNone(self.admin("select trashed_at from datasets where id = %s", ds))

    # -- restore
    def test_restore_brings_it_back_as_it_was_and_does_not_relink_films(self):
        ds, _ = self.confirmed()
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        before = self.admin("select status, mapping, retention, geography from datasets where id = %s", ds)
        self.trash(ds)
        self.db.as_(RYAN).one("select restore_dataset(%s) is null", ds)
        self.assertIsNone(self.admin("select trashed_at from datasets where id = %s", ds))
        self.assertEqual(self.admin("select status, mapping, retention, geography from datasets where id = %s", ds), before)
        self.assertEqual(self.listed(), [])
        self.assertIsNone(self.admin("select dataset_id from versions where id = %s", vid))          # not silently re-linked
        self.assertEqual(self.admin("select count(*) from version_sources where version_id = %s", vid), 0)
        _, vid2 = self.project_version()                                                              # but usable again
        self.assertTrue(self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid2, ds).startswith("u_"))

    def test_restore_is_refused_after_seven_days_for_other_people_and_when_not_deleted(self):
        ds, _ = self.confirmed()
        with self.assertRaises(psycopg.Error) as e:
            self.db.as_(RYAN).one("select restore_dataset(%s)", ds)                                   # not in Recently deleted
        self.assertEqual(e.exception.sqlstate, "PT404")
        self.trash(ds)
        for who in (OTHER, WORKER, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select restore_dataset(%s)", ds)
        self.assertEqual(self.listed(OTHER), [])
        self.admin("update datasets set trashed_at = now() - interval '6 days 23 hours' where id = %s returning 1", ds)
        self.db.as_(RYAN).one("select restore_dataset(%s) is null", ds)                               # still inside the window
        self.trash(ds)
        self.admin("update datasets set trashed_at = now() - interval '7 days 1 minute' where id = %s returning 1", ds)
        with self.assertRaisesRegex(psycopg.Error, "more than 7 days"):
            self.db.as_(RYAN).one("select restore_dataset(%s)", ds)

    # -- the 7 days, and Delete forever now
    def test_the_sweeper_removes_it_after_seven_days_and_not_before(self):
        ds, _ = self.confirmed()
        self.trash(ds)
        self.admin("update datasets set trashed_at = now() - interval '6 days 23 hours' where id = %s returning 1", ds)
        self.assertEqual(self.due(), [])
        self.admin("update datasets set trashed_at = now() - interval '7 days 1 minute' where id = %s returning 1", ds)
        self.assertEqual(self.due(), [str(ds)])
        self.admin("delete from storage.objects where bucket_id = 'ryagram-uploads' returning 1")
        self.assertEqual(self.db.as_("service").one("select mark_uploads_removed(%s::uuid[])", [ds]), 1)
        row = self.admin("select name, filename_label, mapping is null, storage_path is null, deleted_at is not null from datasets where id = %s", ds)
        self.assertEqual(row, ("Deleted data", None, True, True, True))                                # the same tombstone as before
        self.assertEqual(self.listed(), [])

    def test_delete_forever_now_only_from_recently_deleted_and_is_removed_within_the_sweep(self):
        ds, _ = self.confirmed()
        for who in (RYAN, OTHER):
            with self.subTest(who=who), self.assertRaises(psycopg.Error) as e:
                self.db.as_(who).one("select delete_dataset_forever(%s)", ds)                          # not in Recently deleted yet
            self.assertEqual(e.exception.sqlstate, "PT404")
        self.trash(ds)
        for who in (OTHER, WORKER, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select delete_dataset_forever(%s)", ds)
        self.assertEqual(self.due(), [])
        self.db.as_(RYAN).one("select delete_dataset_forever(%s) is null", ds)
        self.assertEqual(self.due(), [str(ds)])                                                        # due at once (the next hourly sweep)
        self.assertEqual(self.listed(), [])
        with self.assertRaises(psycopg.Error) as e:
            self.db.as_(RYAN).one("select restore_dataset(%s)", ds)                                    # no way back
        self.assertEqual(e.exception.sqlstate, "PT404")
        with self.assertRaises(psycopg.Error) as e:
            self.trash(ds)
        self.assertEqual(e.exception.sqlstate, "PT404")

    # -- the quota
    def test_recently_deleted_counts_toward_the_quota_until_it_is_gone(self):
        ids = [self.create(label=f"f{i}.csv")[0] for i in range(20)]
        with self.assertRaisesRegex(psycopg.Error, "20 uploaded datasets"):
            self.create(label="one more.csv")
        self.trash(ids[0])                                                                            # trashed, not gone: still counts
        with self.assertRaisesRegex(psycopg.Error, "20 uploaded datasets"):
            self.create(label="one more.csv")
        self.db.as_(RYAN).one("select delete_dataset_forever(%s) is null", ids[0])                     # forever frees it at once
        self.create(label="now it fits.csv")

    def test_recently_deleted_bytes_count_toward_the_100_mb_quota(self):
        a, _ = self.create(size=9 * MIB)
        for i in range(10):
            self.create(label=f"b{i}.csv", size=9 * MIB)
        # 11 x 9 MB = 99 MB held; 2 MB more would pass 100 MB.
        with self.assertRaisesRegex(psycopg.Error, "100 MB"):
            self.create(label="c.csv", size=2 * MIB)
        self.trash(a)
        with self.assertRaisesRegex(psycopg.Error, "100 MB"):
            self.create(label="c.csv", size=2 * MIB)
        self.db.as_(RYAN).one("select delete_dataset_forever(%s) is null", a)
        self.create(label="c.csv", size=2 * MIB)

    # -- what did not change
    def test_dont_keep_and_unreadable_uploads_are_still_removed_without_a_wait_and_the_worker_cannot_trash(self):
        ds, _ = self.uploaded(retention="dont_keep")
        self.admin("update datasets set last_activity_at = now() - interval '8 days' where id = %s returning 1", ds)
        bad, _ = self.uploaded()
        self.admin("update datasets set status = 'rejected', last_activity_at = now() - interval '2 days' where id = %s returning 1", bad)
        self.assertEqual(self.due(), sorted([str(ds), str(bad)]))                                      # no Recently deleted stop for these
        for fn in ("restore_dataset(%s)", "delete_dataset_forever(%s)", "request_dataset_deletion(%s)"):
            with self.subTest(fn=fn), self.assertRaises(psycopg.Error):
                self.db.as_(WORKER).one("select " + fn, ds)
        with self.assertRaises(psycopg.Error):
            self.db.as_("service").one("select * from my_recently_deleted_uploads()")                  # needs a signed-in person

    def test_the_list_shows_a_label_a_size_and_a_date_and_nothing_about_the_data(self):
        ds, _ = self.confirmed()
        self.trash(ds)
        cols = self.db.as_(RYAN).c.execute("select * from my_recently_deleted_uploads()").description
        self.assertEqual([c.name for c in cols], ["dataset_id", "label", "bytes", "trashed_at", "removed_after"])
        row = self.db.as_(RYAN).one("select removed_after - trashed_at from my_recently_deleted_uploads()")
        self.assertEqual(str(row), "7 days, 0:00:00")


if __name__ == "__main__":
    unittest.main()
