"""Find-data step S0: the trust label on every upload (migration 20261026000100_trust_label_uploads.sql, NOT APPLIED) on a local Postgres.

Same setup as test_uploads.py (the files are among the migrations it loads, in order, so the new one is included). Run from the repo root with the SQL venv:
    pgvenv/Scripts/python -m unittest supabase/tests/test_trust_label.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * a new upload is 'unverified_user' and has not been acknowledged; the label is set by the server (a person has no UPDATE on it)
  * confirming the mapping (the "use it anyway" press) records WHEN, and an approved upload always has that moment
  * the film's source row carries the label, and keeps it when the upload is attached again
  * NOBODY, not even the table owner, can make an upload 'official' or 'published_by_others', approve one with no acknowledgement, or give an upload source row another label
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_uploads as up  # noqa: E402
from test_uploads import MAPPING, RYAN, report, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)


class TrustLabel(core.Base):
    admin = up.Uploads.admin
    create = up.Uploads.create
    put_file = up.Uploads.put_file
    uploaded = up.Uploads.uploaded
    read_by_worker = up.Uploads.read_by_worker
    project_version = up.Uploads.project_version

    def approved(self):
        ds, _ = self.uploaded()
        self.read_by_worker(ds)
        return ds

    def test_a_new_upload_is_unverified_and_not_acknowledged(self):
        ds, _ = self.create()
        self.assertEqual(self.admin("select trust_label, trust_ack_at is null from datasets where id = %s", ds), ("unverified_user", True))

    def test_confirming_the_mapping_records_the_acknowledgement(self):
        ds = self.approved()
        self.assertEqual(self.admin("select status, trust_ack_at is null from datasets where id = %s", ds), ("pending_validation", True))   # control: read, not yet used
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        self.assertEqual(self.admin("select status, trust_label, trust_ack_at is not null from datasets where id = %s", ds), ("approved", "unverified_user", True))
        first = self.admin("select trust_ack_at from datasets where id = %s", ds)
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))      # confirming again keeps the first moment
        self.assertEqual(self.admin("select trust_ack_at from datasets where id = %s", ds), first)

    def test_the_source_row_of_a_film_carries_the_label(self):
        ds = self.approved()
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        _, vid = self.project_version()
        ref = self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        self.assertEqual(self.db.as_(RYAN).one("select trust_label from version_sources where version_id = %s and dataset_ref = %s", vid, ref), "unverified_user")
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)                                   # attached again: still one row, still labelled
        self.assertEqual(self.db.as_(RYAN).all("select trust_label from version_sources where version_id = %s", vid), [("unverified_user",)])

    def test_a_person_cannot_change_a_label_or_an_acknowledgement(self):
        ds = self.approved()
        for sql in ("update datasets set trust_label = 'official' where id = %s", "update datasets set trust_ack_at = now() where id = %s",
                    "update datasets set trust_label = 'unverified_user' where id = %s"):
            with self.assertRaises(psycopg.Error, msg=sql):
                self.db.as_(RYAN).c.execute(sql, (ds,))

    def test_nobody_can_make_an_upload_official_or_approve_it_unacknowledged(self):
        ds = self.approved()
        admin = self.db.as_(None)
        for label in ("official", "published_by_others"):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=label):          # MUST-FAIL, even for the table owner
                admin.c.execute("update datasets set trust_label = %s where id = %s", (label, ds))
        with self.assertRaises(psycopg.errors.CheckViolation):                         # a label outside the closed list
            admin.c.execute("update datasets set trust_label = 'trusted' where id = %s", (ds,))
        with self.assertRaises(psycopg.errors.CheckViolation):                         # approved with no acknowledgement
            admin.c.execute("update datasets set status = 'approved' where id = %s", (ds,))
        # control: the same row IS approvable the proper way, and unchanged by the refusals above
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        self.assertEqual(self.admin("select status, trust_label from datasets where id = %s", ds), ("approved", "unverified_user"))

    def test_an_upload_source_row_cannot_carry_another_label(self):
        ds = self.approved()
        self.db.as_(RYAN).one("select confirm_dataset_mapping(%s, %s::jsonb) is null", ds, json.dumps(MAPPING))
        _, vid = self.project_version()
        self.db.as_(RYAN).one("select attach_upload_to_version(%s, %s)", vid, ds)
        admin = self.db.as_(None)
        for bad in ("official", "published_by_others", None):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=str(bad)):
                admin.c.execute("update version_sources set trust_label = %s where version_id = %s and kind = 'upload'", (bad, vid))
        with self.assertRaises(psycopg.errors.CheckViolation):
            admin.c.execute("update version_sources set trust_label = 'trusted' where version_id = %s", (vid,))

    def test_a_catalog_source_row_may_have_no_label_yet(self):
        _, vid = self.project_version()
        owner = self.admin("select owner_id from versions where id = %s", vid)
        self.admin("insert into version_sources (owner_id, version_id, kind, dataset_ref, title) values (%s, %s, 'catalog', 'x_catalog', 'X') returning 1", owner, vid)
        self.assertIsNone(self.admin("select trust_label from version_sources where dataset_ref = 'x_catalog'"))


if __name__ == "__main__":
    unittest.main()
