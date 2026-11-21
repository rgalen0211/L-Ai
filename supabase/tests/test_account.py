"""Account basics (migrations/20260929000900_account_basics.sql) on a local Postgres.

Same setup as test_2a_core.py (the file is one of the migrations it loads). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_account.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
setUpModule = core.setUpModule


class Account(core.Base):
    project_with_version = core.Core.project_with_version
    run_job = core.Core.run_job
    claim = core.Core.claim

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def dataset(self, retention="keep", who=RYAN):
        return self.admin("insert into datasets (owner_id, name, retention, status, trust_ack_at) values (%s, 'upload.csv', %s, 'approved', now()) "
                          "returning id", who, retention)

    # -- the data choice
    def test_upload_default_is_keep_and_only_the_owner_sets_it(self):
        d = self.db.as_(RYAN)
        self.assertIsNone(d.one("select upload_retention from account_settings"))
        d.one("insert into account_settings (upload_retention) values ('dont_keep') returning 1")
        self.assertEqual(d.one("select upload_retention from account_settings"), "dont_keep")
        d.one("update account_settings set upload_retention = 'keep' returning 1")
        self.assertIsNone(self.db.as_(OTHER).one("select upload_retention from account_settings"))
        self.assertIsNone(self.db.as_(OTHER).one("update account_settings set upload_retention = 'dont_keep' returning 1"))
        self.assertEqual(self.db.as_(RYAN).one("select upload_retention from account_settings"), "keep")
        with self.assertRaises(psycopg.Error):
            self.db.as_(OTHER).one("insert into account_settings (owner_id, upload_retention) values (%s, 'keep') returning 1", RYAN)
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select * from account_settings")
        self.assertEqual(self.admin("select count(*) from account_settings"), 1)

    def test_dont_keep_data_makes_its_versions_non_restorable_for_good(self):
        _, vid = self.project_with_version()
        kept, dropped = self.dataset("keep"), self.dataset("dont_keep")
        d = self.db.as_(RYAN)
        d.one("update versions set dataset_id = %s where id = %s returning 1", kept, vid)
        self.assertEqual(self.admin("select restorability from versions where id = %s", vid), "unknown")
        d.one("update versions set dataset_id = %s where id = %s returning 1", dropped, vid)
        self.assertEqual(self.admin("select restorability from versions where id = %s", vid), "non_restorable")
        # The system can't mark it restorable while it uses that data.
        self.admin("update versions set restorability = 'restorable' where id = %s returning 1", vid)
        self.assertEqual(self.admin("select restorability from versions where id = %s", vid), "non_restorable")
        # A kept dataset switched to dont_keep later takes its versions with it; never back.
        _, v2 = self.project_with_version()
        d.one("update versions set dataset_id = %s where id = %s returning 1", kept, v2)
        self.admin("update datasets set retention = 'dont_keep' where id = %s returning 1", kept)
        self.assertEqual(self.admin("select restorability from versions where id = %s", v2), "non_restorable")
        with self.assertRaisesRegex(psycopg.Error, "can't be marked as kept"):
            self.admin("update datasets set retention = 'keep' where id = %s returning 1", kept)

    # -- deleting an account
    def check(self):
        return self.db.as_("service").one("select account_deletion_check(%s)", RYAN)

    def test_deletion_check_lists_files_and_running_jobs(self):
        check = self.check()
        self.assertEqual((check["active_jobs"], check["has_credit_history"], check["storage_paths"]), (0, False, []))
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'contact_sheet')", vid)
        self.assertEqual(self.check()["active_jobs"], 1)
        self.claim()
        self.run_job(job, ["contact_sheet"])
        # A stray object under the person's folder counts too; someone else's never does.
        self.admin("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, '{}') returning 1",
                   f"{RYAN}/stray/partial.mp4")
        self.admin("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, '{}') returning 1",
                   f"{OTHER}/x/film.mp4")
        check = self.check()
        self.assertEqual(check["active_jobs"], 0)
        self.assertEqual(len(check["storage_paths"]), 2)
        self.assertTrue(all(p.startswith(RYAN + "/") for p in check["storage_paths"]))

    def test_deleting_the_login_removes_every_row_the_person_owns(self):
        _, vid = self.project_with_version()
        self.db.as_(RYAN).one("insert into account_settings (upload_retention) values ('keep') returning 1")
        self.dataset()
        self.admin("delete from auth.users where id = %s returning 1", RYAN)
        for table in ("projects", "versions", "jobs", "artifacts", "datasets", "account_settings"):
            self.assertEqual(self.admin(f"select count(*) from {table} where owner_id = %s", RYAN), 0, table)

    def test_a_request_is_recorded_once_and_only_the_service_role_can_do_any_of_this(self):
        for reason in ("credit history", "again"):
            self.db.as_("service").one("select account_request_deletion(%s, 'ryan@x', %s) is null", RYAN, reason)
        self.assertEqual(self.admin("select count(*) from account_deletion_requests"), 1)
        self.assertIsNotNone(self.db.as_(RYAN).one("select requested_at from account_deletion_requests"))
        self.assertIsNone(self.db.as_(OTHER).one("select requested_at from account_deletion_requests"))
        for who in (RYAN, "anon"):
            for sql in ("select account_deletion_check(%s)", "select account_request_deletion(%s, 'x', 'y')"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql, RYAN)
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select email from account_deletion_requests")


    # -- GEO 11-21 (GEO-SECURITY-PRIVACY-REVIEW-1121): a paid account's files go now (M1); the email leaves support and invite rows (M5)
    def upload(self, path, who=RYAN, with_file=True):
        did = self.admin("insert into datasets (owner_id, name, source, storage_path, bytes, status, retention, filename_label, ext, trust_ack_at) "
                         "values (%s, 'Sales by street.csv', 'upload', %s, 10, 'approved', 'keep', 'Sales by street.csv', 'csv', now()) returning id",
                         who, path)
        if with_file:
            self.admin("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-uploads', %s, '{}') returning 1", path)
        return did

    def erase(self, who=RYAN):
        return self.db.as_("service").one("select account_erase_paid_content(%s)", who)

    def test_GEO_a_paid_account_s_uploads_become_tombstones_only_once_their_files_are_gone(self):
        gone = self.upload(f"{RYAN}/d1/source.csv", with_file=False)          # the function already removed its file
        kept = self.upload(f"{RYAN}/d2/source.csv")                            # its file is still in storage
        theirs = self.upload(f"{OTHER}/d3/source.csv", who=OTHER, with_file=False)
        out = self.erase()
        self.assertEqual((out["uploads_erased"], out["uploads_left"]), (1, 1))
        self.assertEqual(self.admin("select name, filename_label, storage_path, deleted_at is not null from datasets where id = %s", gone),
                         ("Deleted data", None, None, True))                    # MUST-FAIL: before the fix a paid account kept every row
        self.assertEqual(self.admin("select name, deleted_at is null from datasets where id = %s", kept), ("Sales by street.csv", True))
        self.assertEqual(self.admin("select deleted_at is null from datasets where id = %s", theirs), True)   # someone else's never
        self.admin("delete from storage.objects where name = %s returning 1", f"{RYAN}/d2/source.csv")
        self.assertEqual(self.erase()["uploads_left"], 0)                    # asked again after the file goes: erased

    def test_GEO_a_paid_account_s_films_are_marked_deleted_only_once_their_files_are_gone(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'contact_sheet')", vid)
        self.claim()
        self.run_job(job, ["contact_sheet"])
        out = self.erase()
        self.assertEqual((out["films_marked_deleted"], out["films_left"]), (0, 1))     # its file is still there
        self.admin("delete from storage.objects where bucket_id = 'ryagram-artifacts' and name like %s returning 1", f"{RYAN}/%")
        out = self.erase()
        self.assertEqual((out["films_marked_deleted"], out["films_left"]), (1, 0))
        self.assertEqual(self.admin("select count(*) from artifacts where owner_id = %s and deleted_at is null", RYAN), 0)

    def test_GEO_the_email_leaves_support_and_invite_rows_and_only_the_person_s_own(self):
        add = "insert into support_requests (owner_id, email, topic, message) values (%s, %s, 'credits', 'Please help with my credits.') returning id"
        mine = self.admin(add, RYAN, "ryan@example.com")
        by_addr = self.admin(add, None, "Ryan@Example.COM")                    # sent before signing in, the same address in another case
        other = self.admin(add, OTHER, "other@example.com")
        self.admin("insert into invite_codes (code_hash, label, max_uses, expires_at) values (%s, 'test', 5, now() + interval '1 day') returning 1",
                   "a" * 64)
        r_mine = self.admin("insert into invite_redemptions (code_hash, email, user_id) values (%s, 'ryan@example.com', %s) returning id", "a" * 64, RYAN)
        r_other = self.admin("insert into invite_redemptions (code_hash, email, user_id) values (%s, 'other@example.com', %s) returning id", "a" * 64, OTHER)
        out = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "  RYAN@example.com ")
        self.assertEqual(out, {"support_requests_redacted": 2, "invite_redemptions_redacted": 1})   # MUST-FAIL: before the fix nothing
        for sid in (mine, by_addr):
            self.assertEqual(self.admin("select email from support_requests where id = %s", sid), "redacted@deleted.invalid")
        self.assertEqual(self.admin("select message from support_requests where id = %s", mine), "Please help with my credits.")
        self.assertEqual(self.admin("select email from support_requests where id = %s", other), "other@example.com")
        self.assertEqual(self.admin("select email from invite_redemptions where id = %s", r_mine), "redacted")
        self.assertEqual(self.admin("select email from invite_redemptions where id = %s", r_other), "other@example.com")
        self.assertEqual(self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com"),
                         {"support_requests_redacted": 0, "invite_redemptions_redacted": 0})     # safe to run twice

    def test_GEO_only_the_service_role_can_erase_or_redact(self):
        for who in (RYAN, "anon"):
            for sql in ("select account_erase_paid_content(%s)", "select account_redact_contact(%s, 'x@y.z')"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.db.as_(who).one(sql, RYAN)


if __name__ == "__main__":
    unittest.main()
