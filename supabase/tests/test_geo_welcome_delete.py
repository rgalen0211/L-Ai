"""A VERIFIED free-preview stranger (Ryan 15:46 Q679 B: 8 welcome credits) who deletes their account (GEO 2026-11-23; CONNECT 15:59, CC1 16:00).

On the 2B ledger's own database (test_2b_credits' template: every migration + phase-2b/credits_ledger.sql). The welcome grant is written
the way any grant is (grant_credits, the only way to give credits), so this holds whatever CONNECT's 20261123000600 calls it:
  * account_deletion_check says has_credit_history = true for that stranger (an unverified one, with no grant, says false), so the
    delete function takes the 'requested' path, not the hard delete;
  * the login CANNOT simply be deleted: credit_ledger.owner_id is ON DELETE RESTRICT, so 'close by hand' must not mean 'delete the user';
  * the request path's database calls, in remove.ts's own order (the contact is redacted first, then the content erased, then the
    request recorded): the email leaves support rows; a planted upload whose file is already gone becomes a tombstone and the erase
    answers uploads_left 0 and films_left 0 (remove.ts refuses with a 500 otherwise); the request is recorded ONCE; live step 58's
    row 11 then counts it;
  * the 8-credit ledger row stays, with the stranger's id, as the financial record (what WEB's Privacy f3f5cf55 says).
Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_welcome_delete.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
STEP58 = core.ROOT / "live-steps" / "58_wednesday_watch.sql"
CRON_STANDIN = """
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
create table if not exists cron.job_run_details (jobid int, status text, start_time timestamptz not null default now());
create schema if not exists net;
create table if not exists net._http_response (id bigint primary key, status_code int, content text, created timestamptz not null default now());
"""


def setUpModule():
    credits.setUpModule()


class WelcomeDelete(unittest.TestCase):
    setUp = credits.Ledger.setUp
    tearDown = credits.Ledger.tearDown
    admin = credits.Ledger.admin

    def welcome(self, who):
        return self.db.as_("service").one("select grant_credits(%s, 'grant', 8, 'Welcome credits', %s, null, null, null)", who, f"welcome:{who}")

    def check(self, who):
        return self.db.as_("service").one("select account_deletion_check(%s)", who)

    def test_GEO_a_verified_stranger_with_welcome_credits_gets_the_by_hand_path(self):
        self.assertFalse(self.check(OTHER)["has_credit_history"], "an unverified stranger (no grant) still takes the clean delete")
        self.welcome(RYAN)
        self.assertEqual(self.admin("select coalesce(sum(available), 0)::int from credit_balances where owner_id = %s", RYAN), 8)
        check = self.check(RYAN)
        self.assertEqual((check["active_jobs"], check["has_credit_history"]), (0, True), "8 welcome credits = credit history = the requested path")
        # the login cannot simply be deleted: the ledger keeps its rows (ON DELETE RESTRICT)
        with self.assertRaises(psycopg.Error):
            self.admin("delete from auth.users where id = %s returning 1", RYAN)
        # the requested path's database calls, as remove.ts makes them (files first, then the contact, then the request)
        self.admin("insert into support_requests (owner_id, email, topic, message) values (%s, 'ryan@x', 'other', 'Please delete me.') returning 1", RYAN)
        up = self.admin("insert into datasets (owner_id, name, source, storage_path, bytes, status, retention, filename_label, ext, trust_ack_at) "
                        "values (%s, 'Sales by street.csv', 'upload', %s, 10, 'approved', 'keep', 'Sales by street.csv', 'csv', now()) returning id", RYAN, f"{RYAN}/d1/source.csv")
        self.db.as_("service").one("select account_redact_contact(%s, 'ryan@x')", RYAN)          # remove.ts: the contact first
        out = self.db.as_("service").one("select account_erase_paid_content(%s)", RYAN)           # then the content (its files are already gone)
        self.assertEqual((out["uploads_left"], out["films_left"]), (0, 0), "remove.ts answers 202 only on (0, 0)")
        self.assertEqual(self.admin("select name, storage_path, deleted_at is not null from datasets where id = %s", up), ("Deleted data", None, True))
        for _ in range(2):
            self.db.as_("service").one("select account_request_deletion(%s, 'ryan@x', 'credit history') is null", RYAN)
        self.assertEqual(self.admin("select count(*) from account_deletion_requests where owner_id = %s", RYAN), 1, "recorded once")
        self.assertEqual(self.admin("select count(*) from support_requests where email = 'ryan@x'"), 0, "the email left support rows")
        self.assertEqual(self.admin("select count(*) from credit_ledger where owner_id = %s", RYAN) >= 1, True, "the welcome row stays as the financial record")
        # live step 58's row 11 shows it to Ryan
        self.db.as_(None)
        self.db.c.execute(CRON_STANDIN)
        rows = {r[0]: r[1] for r in self.db.c.execute(STEP58.read_text(encoding="utf-8")).fetchall()}
        self.assertTrue(rows["account deletions waiting for YOU to close by hand"].startswith("1 waiting"), rows.get("account deletions waiting for YOU to close by hand"))


if __name__ == "__main__":
    unittest.main()
