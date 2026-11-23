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
        # GEO 11-21 (review M5): the 5-year-old UNANSWERED request now goes too (unanswered: 12 months after it was sent)
        self.assertEqual(sorted(x[0] for x in self.db.as_(None).all("select email from public.support_requests")), ["h2@x.co"])   # 2 years answered: kept
        self.assertEqual(r.get("help_requests_unanswered"), 1)

    # -- GEO 11-21 (GEO-SECURITY-PRIVACY-REVIEW-1121 M4, M5): unanswered help requests and the mail we sent
    def test_GEO_an_unanswered_help_request_goes_12_months_after_it_was_sent(self):
        for n, age in ((1, "13 months"), (2, "11 months")):
            self.admin("insert into public.support_requests (email, topic, message, created_at) values (%s, 'other', 'hello there friend', now() - %s::interval) returning 1",
                       f"u{n}@x.co", age)
        r = self.svc().one("select retention_purge()")
        # MUST-FAIL: before the fix an unanswered request was kept forever (the rows first, so the old code fails on what it kept)
        self.assertEqual([x[0] for x in self.db.as_(None).all("select email from public.support_requests")], ["u2@x.co"])
        self.assertEqual(r.get("help_requests_unanswered"), 1)

    def test_GEO_the_mail_we_sent_goes_after_12_months_but_urgent_mail_is_kept(self):
        rows = [("invite", "13 months", "a@x.co"), ("invite", "11 months", "b@x.co"), ("alert", "13 months", "ops@x.co"),
                ("digest", "13 months", "ops@x.co"), ("ack", "13 months", "c@x.co"), ("alert", "11 months", "ops@x.co"),
                ("urgent", "5 years", "ops@x.co")]
        for kind, age, to in rows:
            self.admin("insert into public.ops_outbox (kind, mode, to_addr, subject, body, created_at) values (%s, 'dry_run', %s, 's', 'b', now() - %s::interval) returning 1",
                       kind, to, age)
        r = self.svc().one("select retention_purge()")
        left = sorted((k, to) for k, to in self.db.as_(None).all("select kind, to_addr from public.ops_outbox"))
        # MUST-FAIL: before the fix the outbox was never purged; urgent mail is kept, however old
        self.assertEqual(left, [("alert", "ops@x.co"), ("invite", "b@x.co"), ("urgent", "ops@x.co")])
        self.assertEqual((r.get("outbox_invites"), r.get("outbox_ops_mail")), (1, 3))

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

    # -- CONNECT 11-23 (CC1 09:48 audit): Privacy says a join attempt's scrambled address and email go after 2 days; join_reserve cleaned them only when a join was tried
    def test_CONNECT_join_attempts_go_after_2_days_and_invite_guesses_after_a_day_even_when_nobody_calls_join(self):
        eh = "ab" * 32
        for hrs in (96, 49, 47, 1):
            self.admin("insert into public.join_attempts (ip_hash, email_hash, at) values (%s, %s, now() - make_interval(hours => %s)) returning 1", f"ip{hrs}", eh, hrs)
        for hrs in (48, 12):
            self.admin("insert into public.invite_attempts (ip_hash, at) values (%s, now() - make_interval(hours => %s)) returning 1", f"g{hrs}", hrs)
        r = self.svc().one("select retention_purge()")
        self.assertEqual((r["skipped"], r["join_attempts"], r["invite_attempts"]), (False, 2, 1))
        self.assertEqual(sorted(x[0] for x in self.db.as_(None).all("select ip_hash from public.join_attempts")), ["ip1", "ip47"], "96 and 49 hours old: gone; 47 and 1: kept")
        self.assertEqual([x[0] for x in self.db.as_(None).all("select ip_hash from public.invite_attempts")], ["g12"], "48 hours old: gone; 12: kept")
        self.assertEqual(self.svc().one("select retention_purge()"), {"skipped": True}, "the same New York day: nothing more happens")

    def test_CONNECT_the_old_answer_keys_are_still_there_and_the_rollback_puts_the_old_function_back(self):
        r = self.svc().one("select retention_purge()")
        for k in ("applications", "invite_codes", "person_invites", "help_requests", "reports", "funnel_events", "help_requests_unanswered", "outbox_invites", "outbox_ops_mail"):
            self.assertIn(k, r, k)
        self.admin("update public.retention_runs set last_run_on = null returning 1")
        self.db.as_(None).c.execute((core.ROOT / "rollbacks" / "20261123000400_retention_join_attempts_rollback.sql").read_text(encoding="utf-8"))
        self.admin("insert into public.join_attempts (ip_hash, email_hash, at) values ('old', %s, now() - interval '5 days') returning 1", "cd" * 32)
        r = self.svc().one("select retention_purge()")
        self.assertNotIn("join_attempts", r)
        self.assertEqual(self.admin("select count(*) from public.join_attempts where ip_hash = 'old'"), 1, "the old function does not touch it")
        self.assertIn("applications", r)

    def test_CONNECT_the_older_retention_undo_refuses_while_the_join_attempts_purge_is_applied_and_works_after_its_own_undo(self):
        """GEO 11:2x undo audit: undoing 20261121000400 while 20261123000400 is applied would quietly put back a purge that no longer deletes join and invite-guess records. The older undo refuses by itself; after the newer undo it runs."""
        older = (core.ROOT / "rollbacks" / "20261121000400_retention_outbox_support_rollback.sql").read_text(encoding="utf-8")
        newer = (core.ROOT / "rollbacks" / "20261123000400_retention_join_attempts_rollback.sql").read_text(encoding="utf-8")
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(None).c.execute(older)
        self.assertIn("Undo 20261123000400 first", str(cm.exception))
        self.db.c.execute("rollback")                  # the refused file had opened its own transaction (begin;) and the error left it open
        self.assertIn("join_attempts", self.admin("select pg_get_functiondef('public.retention_purge()'::regprocedure)"), "the refused undo left the newer function in place")
        self.db.as_(None).c.execute(newer)
        self.db.as_(None).c.execute(older)
        self.assertNotIn("join_attempts", self.admin("select pg_get_functiondef('public.retention_purge()'::regprocedure)"))

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
