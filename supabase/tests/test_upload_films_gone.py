"""Films made FROM a customer's upload go when the upload goes (WORKER 2026-11-21, GEO's privacy review M3;
migrations/20261121000300_upload_films_gone.sql).

THE RULE: the person deleted their data -> every film made from it goes, the final film too; 'Don't keep' -> the drafts
(sheet, preview) go and a paid final film stays until its own 30 days. A file is marked removed only when Storage no
longer holds it, so a failed remove is retried on the next hourly sweep.

MUST-FAIL (proved on L-Ai main 7cf4a389 without the new migration): test_a_deleted_uploads_films_are_listed_and_marked_only_when_gone
fails there (main never lists or removes them: the function does not exist).

Same setup as test_uploads.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_upload_films_gone.py -v
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_uploads as up  # noqa: E402

RYAN, OTHER = up.RYAN, up.OTHER


def setUpModule():
    up.setUpModule()


class UploadFilmsGone(up.core.Base):
    admin, create, put_file, uploaded = up.Uploads.admin, up.Uploads.create, up.Uploads.put_file, up.Uploads.uploaded
    read_by_worker, project_version, job = up.Uploads.read_by_worker, up.Uploads.project_version, up.Uploads.job

    # ---------------------------------------------------------------- helpers
    def ready_upload(self, retention=None):
        """An upload read by the worker, mapped and attached to a version, as a person would make it."""
        ds, path = self.uploaded(retention=retention)
        self.read_by_worker(ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb, true) is null", ds, json.dumps(up.MAPPING))
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        return ds, path, vid

    def film(self, vid, ds, kind, art_kind, n):
        """A finished job made from the upload, with one stored artifact (its file in storage.objects)."""
        jid = self.job(vid, ds, kind, "complete")
        pid = self.admin("select project_id from versions where id = %s", vid)
        path = f"{RYAN}/{pid}/{vid}/{jid}/{art_kind}-{n}.bin"
        aid = self.admin("insert into artifacts (owner_id, project_id, version_id, job_id, kind, storage_path, mime, bytes, sha256) "
                         "values (%s, %s, %s, %s, %s, %s, 'application/octet-stream', 10, %s) returning id",
                         RYAN, pid, vid, jid, art_kind, path, "b" * 64)
        self.admin("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, '{}'::jsonb) returning 1", path)
        return aid, path

    def sweep_the_upload(self, ds):
        """What purge-uploads does for the spreadsheet itself: remove the file, then mark it."""
        self.admin("delete from storage.objects where bucket_id = 'ryagram-uploads' returning 1")
        self.assertEqual(self.db.as_("service").one("select mark_uploads_removed(%s::uuid[])", [str(ds)]), 1)

    def due(self):
        return sorted(str(r[0]) for r in self.db.as_("service").all("select artifact_id from upload_films_due_for_deletion()"))

    def mark(self, *aids):
        return self.db.as_("service").one("select mark_upload_films_removed(%s::uuid[])", [str(a) for a in aids])

    def gone(self, aid):
        return self.admin("select deleted_at is not null from artifacts where id = %s", aid)

    def remove_file(self, path):
        self.admin("delete from storage.objects where bucket_id = 'ryagram-artifacts' and name = %s returning 1", path)

    # ---------------------------------------------------------------- scenarios
    def test_a_deleted_uploads_films_are_listed_and_marked_only_when_gone(self):
        """MUST-FAIL on main: nothing lists the films made from a deleted upload."""
        ds, _, vid = self.ready_upload()
        sheet, sheet_path = self.film(vid, ds, "contact_sheet", "contact_sheet", 1)
        prev, prev_path = self.film(vid, ds, "preview", "preview", 2)
        self.db.as_(RYAN).one("select request_dataset_deletion(%s) is null", ds)
        self.db.as_(RYAN).one("select delete_dataset_forever(%s) is null", ds)
        self.sweep_the_upload(ds)
        self.assertEqual(self.due(), sorted([str(sheet), str(prev)]), "the films made from it are due")
        self.assertEqual(self.mark(sheet, prev), 0, "nothing is marked while the files are still stored")
        self.remove_file(sheet_path)                                 # one remove succeeded, one failed
        self.assertEqual(self.mark(sheet, prev), 1)
        self.assertEqual((self.gone(sheet), self.gone(prev)), (True, False))
        self.assertEqual(self.due(), [str(prev)], "the failed one is still due: retried next run")
        self.remove_file(prev_path)
        self.assertEqual(self.mark(prev), 1)
        self.assertEqual(self.due(), [])

    def test_when_the_person_deleted_it_the_final_film_goes_too(self):
        ds, _, vid = self.ready_upload()
        final, _ = self.film(vid, ds, "final_render", "final_video", 3)
        self.db.as_(RYAN).one("select request_dataset_deletion(%s) is null", ds)
        self.db.as_(RYAN).one("select delete_dataset_forever(%s) is null", ds)
        self.sweep_the_upload(ds)
        self.assertIn(str(final), self.due())

    def test_dont_keep_removes_the_drafts_but_keeps_the_paid_final_film(self):
        ds, _, vid = self.ready_upload(retention="dont_keep")
        prev, _ = self.film(vid, ds, "preview", "preview", 4)
        final, _ = self.film(vid, ds, "final_render", "final_video", 5)
        self.assertIn(str(ds), [str(r[0]) for r in self.db.as_("service").all("select dataset_id from uploads_due_for_deletion()")])
        self.sweep_the_upload(ds)
        due = self.due()
        self.assertIn(str(prev), due, "the preview made from it goes")
        self.assertNotIn(str(final), due, "the final film the person paid for stays until its own 30 days")

    def test_nothing_goes_while_the_upload_is_only_in_recently_deleted(self):
        ds, _, vid = self.ready_upload()
        self.film(vid, ds, "preview", "preview", 6)
        self.db.as_(RYAN).one("select request_dataset_deletion(%s) is null", ds)         # restorable for 7 days
        self.assertEqual(self.due(), [])

    def test_films_of_a_kept_upload_are_never_listed_or_marked(self):
        ds, _, vid = self.ready_upload()
        prev, path = self.film(vid, ds, "preview", "preview", 7)
        self.remove_file(path)                                       # even with its file missing
        self.assertEqual(self.due(), [])
        self.assertEqual(self.mark(prev), 0)
        self.assertFalse(self.gone(prev))

    def test_both_functions_are_for_the_service_only(self):
        ds, _, vid = self.ready_upload()
        prev, _ = self.film(vid, ds, "preview", "preview", 8)
        self.denied(RYAN, "select * from upload_films_due_for_deletion()")
        self.denied(RYAN, "select mark_upload_films_removed(%s::uuid[])", [str(prev)])


if __name__ == "__main__":
    unittest.main()
