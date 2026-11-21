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
        same_addr_other_owner = self.admin(add, OTHER, "ryan@example.com")       # CC1 10:57 LOW 5: another person's row, the same address
        app = self.admin("insert into creator_applications (name, email, kind, makes, link, question) values (%s, %s, 'teacher', 'lessons', 'https://example.invalid/c', 'What would you ask the data?') returning id", "Ryan Tester", "RYAN@example.com")
        self.admin("insert into invite_codes (code_hash, label, max_uses, expires_at) values (%s, 'test', 5, now() + interval '1 day') returning 1",
                   "a" * 64)
        r_mine = self.admin("insert into invite_redemptions (code_hash, email, user_id) values (%s, 'ryan@example.com', %s) returning id", "a" * 64, RYAN)
        r_other = self.admin("insert into invite_redemptions (code_hash, email, user_id) values (%s, 'other@example.com', %s) returning id", "a" * 64, OTHER)
        out = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "  RYAN@example.com ")
        self.assertEqual({k: out[k] for k in ("support_requests_redacted", "invite_redemptions_redacted", "creator_applications_redacted")},
                         {"support_requests_redacted": 2, "invite_redemptions_redacted": 1, "creator_applications_redacted": 1})   # MUST-FAIL: before the fix nothing
        self.assertEqual(self.admin("select email from support_requests where id = %s", same_addr_other_owner), "ryan@example.com")   # never another person's
        self.assertEqual(self.admin("select name, email from creator_applications where id = %s", app), ("Deleted", f"redacted+{app}@deleted.invalid"))
        for sid in (mine, by_addr):
            self.assertEqual(self.admin("select email from support_requests where id = %s", sid), "redacted@deleted.invalid")
        self.assertEqual(self.admin("select message from support_requests where id = %s", mine), "Please help with my credits.")
        self.assertEqual(self.admin("select email from support_requests where id = %s", other), "other@example.com")
        self.assertEqual(self.admin("select email from invite_redemptions where id = %s", r_mine), "redacted")
        self.assertEqual(self.admin("select email from invite_redemptions where id = %s", r_other), "other@example.com")
        again = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com")
        self.assertEqual(sum(v for v in again.values()), 0)                                                  # safe to run twice

    # -- GEO 11-21 r3 (CC1 11:15)
    APP = ("insert into creator_applications (name, email, kind, makes, link, question) values (%s, %s, 'teacher', 'lessons', "
           "'https://example.invalid/c', 'What would you ask the data?') returning id")

    def test_GEO_two_applicants_who_delete_their_accounts_each_get_their_own_redacted_address(self):
        a1 = self.admin(self.APP, "Ryan Tester", "ryan@example.com")
        a2 = self.admin(self.APP, "Other Tester", "other@example.com")
        svc = self.db.as_("service")
        self.assertEqual(svc.one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com")["creator_applications_redacted"], 1)
        # MUST-FAIL: r2 gave every application one fixed address; creator_applications_email_key (UNIQUE lower(email)) refused the second
        self.assertEqual(svc.one("select account_redact_contact(%s, %s)", OTHER, "other@example.com")["creator_applications_redacted"], 1)
        got = dict(self.db.as_(None).all("select id, email from creator_applications"))
        self.assertEqual(got, {a1: f"redacted+{a1}@deleted.invalid", a2: f"redacted+{a2}@deleted.invalid"})

    def test_GEO_each_count_is_its_own_update_s(self):
        self.admin("insert into invite_codes (code_hash, label, max_uses, expires_at) values (%s, 'test', 5, now() + interval '1 day') returning 1", "b" * 64)
        self.admin("insert into invite_redemptions (code_hash, email, user_id) values (%s, 'ryan@example.com', %s) returning id", "b" * 64, RYAN)
        self.admin("insert into invite_redemptions (code_hash, email, user_id) values (%s, 'Ryan@Example.com', null) returning id", "b" * 64)
        out = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com")
        # MUST-FAIL: r2 read the invite count AFTER the applications update, so it said 0 here (no application)
        self.assertEqual((out["invite_redemptions_redacted"], out["creator_applications_redacted"]), (2, 0))

    def test_GEO_the_name_on_the_person_s_invite_codes_goes_too_but_a_group_label_stays(self):
        code = "insert into invite_codes (code_hash, label, max_uses, expires_at) values (%s, %s, 5, now() + interval '1 day') returning 1"
        redeem = "insert into invite_redemptions (code_hash, email, user_id) values (%s, %s, %s) returning id"
        app = self.admin(self.APP, "Ryan Tester", "Ryan@Example.com")
        for h, label in (("c", "invite: Ryan Tester"), ("d", "invite: Other Tester"), ("e", "Beta wave 1"), ("f", f"creator #{app} Ryan Tester")):
            self.admin(code, h * 64, label)
        self.admin(redeem, "c" * 64, "ryan@example.com", RYAN)
        self.admin(redeem, "d" * 64, "other@example.com", OTHER)
        self.admin(redeem, "e" * 64, "ryan@example.com", RYAN)
        out = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com")
        labels = dict(self.db.as_(None).all("select left(code_hash, 1), label from invite_codes"))
        # MUST-FAIL: r2 left 'invite: Ryan Tester' and 'creator #N Ryan Tester' on the codes
        self.assertEqual(labels, {"c": "invite: (deleted)", "d": "invite: Other Tester", "e": "Beta wave 1", "f": f"creator #{app} (deleted)"})
        self.assertEqual(out["invite_labels_redacted"], 2)
        self.assertEqual(self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com")["invite_labels_redacted"], 0)

    def test_GEO_on_delete_mail_we_sent_the_person_is_erased_and_their_address_leaves_other_messages(self):
        add = "insert into ops_outbox (kind, mode, to_addr, subject, body) values (%s, 'dry_run', %s, 's', %s) returning id"
        invite = self.admin(add, "invite", "Ryan@Example.com", "Join with this link: https://uselai.com/join?e=ryan@example.com")
        urgent = self.admin(add, "urgent", "ryan@example.com", "kept as the law requires")
        alert = self.admin(add, "alert", "ops@uselai.com", "New application from Ryan@Example.com (also ryan@example.com).")
        other = self.admin(add, "invite", "other@example.com", "Join with this link")
        out = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "Ryan@Example.com")
        self.assertIsNone(self.admin("select id from ops_outbox where id = %s", invite))       # MUST-FAIL: before the fix the outbox kept it all
        self.assertEqual(self.admin("select to_addr from ops_outbox where id = %s", urgent), "ryan@example.com")
        body = self.admin("select body from ops_outbox where id = %s", alert)
        self.assertNotIn("ryan@example.com", body.lower())
        self.assertEqual(body.count("[deleted address]"), 2)
        self.assertEqual(self.admin("select to_addr from ops_outbox where id = %s", other), "other@example.com")
        self.assertEqual((out.get("outbox_rows_erased"), out.get("outbox_rows_redacted")), (1, 1))

    def test_GEO_only_the_whole_address_leaves_a_message_never_a_longer_one_containing_it(self):
        add = "insert into ops_outbox (kind, mode, to_addr, subject, body) values (%s, 'dry_run', %s, 's', %s) returning id"
        body = "From bryan@example.com, ryan@example.company, ryan@exampleXcom, ryan.x@example.com and RYAN@example.com."
        alert = self.admin(add, "alert", "ops@uselai.com", body)
        other = self.admin(add, "invite", "bryan@example.com", "Join with this link")
        out = self.db.as_("service").one("select account_redact_contact(%s, %s)", RYAN, "ryan@example.com")
        # MUST-FAIL: r2's strpos/replace turned bryan@example.com into b[deleted address] and cut into ryan@example.company
        self.assertEqual(self.admin("select body from ops_outbox where id = %s", alert),
                         "From bryan@example.com, ryan@example.company, ryan@exampleXcom, ryan.x@example.com and [deleted address].")
        self.assertEqual(self.admin("select to_addr from ops_outbox where id = %s", other), "bryan@example.com")
        self.assertEqual((out["outbox_rows_erased"], out["outbox_rows_redacted"]), (0, 1))

    def test_GEO_only_the_service_role_can_erase_or_redact(self):
        for who in (RYAN, "anon"):
            for sql in ("select account_erase_paid_content(%s)", "select account_redact_contact(%s, 'x@y.z')"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.db.as_(who).one(sql, RYAN)


if __name__ == "__main__":
    unittest.main()
