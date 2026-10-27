"""The retention purge (migrations/20261016000300_retention_purge.sql) on a local Postgres: the Privacy Policy's promises, kept by a job that actually deletes.

Same setup as test_2a_core.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_retention_purge.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule
SLUG = "A" * 22


class Purge(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def svc(self):
        return self.db.as_("service")

    def app(self, n, decided_months_ago=None, status="approved"):
        """A creator application (and, if decided, its invite code the way admin_creator_invite labels it)."""
        a = self.admin("insert into public.creator_applications (name, email, kind, makes, link, question, status, decided_at, caller_key) "
                       "values (%s, %s, 'youtuber', 'things', 'https://example.com/x', 'A question about data to answer?', %s, "
                       "case when %s::int is null then null else now() - make_interval(months => %s::int) - interval '1 day' end, repeat('a', 64)) returning id",
                       f"Person {n}", f"p{n}@example.com", status if decided_months_ago is not None else "new", decided_months_ago, decided_months_ago)
        if decided_months_ago is not None:
            self.admin("select public.invite_issue(%s, 1, 30)", f"creator #{a} Person {n}")
        return a

    def test_applications_go_12_months_after_the_decision_with_their_invite_code_and_nothing_else(self):
        old, recent, undecided = self.app(1, 13), self.app(2, 11), self.app(3)
        self.admin("update public.creator_applications set created_at = now() - interval '2 years' where id = %s returning 1", undecided)      # an old application nobody decided
        old12 = self.app(12, 13)                                            # id with two digits: its code must not be confused with id 1's
        self.admin("insert into public.ops_alerts (key, detail) values (%s, 'x') returning 1", f"creator:{old}")
        r = self.svc().one("select retention_purge()")
        self.assertEqual((r["skipped"], r["applications"], r["invite_codes"]), (False, 2, 2))
        left = [x[0] for x in self.db.as_(None).all("select id from public.creator_applications order by id")]
        self.assertEqual(left, sorted([recent, undecided]))                  # 13 months decided: gone; 11 months: kept; undecided: kept however old
        labels = [x[0] for x in self.db.as_(None).all("select label from public.invite_codes")]
        self.assertEqual(labels, [f"creator #{recent} Person 2"])            # the purged ones' codes (which hold their names) are gone, the kept one stays
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = %s", f"creator:{old}"), 0)
        self.assertNotIn(old12, left)

    def test_an_invite_redemption_with_the_persons_email_goes_with_its_code(self):
        a = self.app(1, 14)
        h = self.admin("select code_hash from public.invite_codes where label = %s", f"creator #{a} Person 1")
        self.admin("insert into public.invite_redemptions (code_hash, email, status) values (%s, 'p1@example.com', 'sent') returning 1", h)
        self.svc().one("select retention_purge()")
        self.assertEqual(self.admin("select count(*) from public.invite_redemptions"), 0)

    def test_help_requests_go_3_years_after_they_were_answered_only(self):
        for n, answered in ((1, "4 years"), (2, "2 years"), (3, None)):
            self.admin("insert into public.support_requests (email, topic, message, answered_at, created_at) values (%s, 'other', 'hello there friend', "
                       "case when %s::text is null then null else now() - %s::interval end, now() - interval '5 years') returning 1", f"h{n}@x.co", answered, answered)
        r = self.svc().one("select retention_purge()")
        self.assertEqual(r["help_requests"], 1)
        self.assertEqual(sorted(x[0] for x in self.db.as_(None).all("select email from public.support_requests")), ["h2@x.co", "h3@x.co"])   # 2 years: kept; unanswered: kept

    def test_reports_go_3_years_after_review_but_child_safety_reports_and_unreviewed_ones_are_never_touched(self):
        rows = [("harassment", "4 years"), ("copyright", "2 years"), ("other", None), ("child_safety", "5 years"), ("child_safety", None)]
        for i, (reason, reviewed) in enumerate(rows):
            self.admin("insert into public.abuse_reports (slug, reason, reporter_email, reviewed_at, outcome, created_at) values (%s, %s, %s, "
                       "case when %s::text is null then null else now() - %s::interval end, case when %s::text is null then null else 'dismissed' end, now() - interval '6 years') returning 1",
                       SLUG, reason, f"r{i}@x.co", reviewed, reviewed, reviewed)
        r = self.svc().one("select retention_purge()")
        self.assertEqual(r["reports"], 1)                                   # only the 4-year-old reviewed harassment report
        self.assertEqual(sorted(x[0] for x in self.db.as_(None).all("select reporter_email from public.abuse_reports")), ["r1@x.co", "r2@x.co", "r3@x.co", "r4@x.co"])
        self.assertEqual(self.admin("select count(*) from public.abuse_reports where reason = 'child_safety'"), 2)       # child-safety reports are never purged by this job

    def test_it_does_real_work_once_per_new_york_day_and_a_new_day_runs_again(self):
        self.app(1, 13)
        first = self.svc().one("select retention_purge()")
        self.assertFalse(first["skipped"])
        second = self.svc().one("select retention_purge()")
        self.assertEqual(second, {"skipped": True})
        self.app(2, 13)                                                     # something new becomes due ...
        self.assertEqual(self.svc().one("select retention_purge()"), {"skipped": True})        # ... but today's run is done
        self.admin("update public.retention_runs set last_run_on = last_run_on - 1 returning 1")
        third = self.svc().one("select retention_purge()")
        self.assertEqual((third["skipped"], third["applications"]), (False, 1))

    def test_nothing_due_deletes_nothing(self):
        self.app(1, 11)
        r = self.svc().one("select retention_purge()")
        self.assertEqual((r["applications"], r["invite_codes"], r["help_requests"], r["reports"]), (0, 0, 0, 0))
        self.assertEqual(self.admin("select count(*) from public.creator_applications"), 1)

    def test_only_the_scheduler_can_run_it_and_the_state_table_is_closed(self):
        for who in ("anon", RYAN, OTHER):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select retention_purge()")
        for who in ("anon", RYAN, OTHER, "service"):
            with self.subTest(table=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select * from public.retention_runs")


if __name__ == "__main__":
    unittest.main()
