"""Ryan's two child-safety answers (2026-10-14) and CC1's three LOWs (10-12 / 10-15) on ops-readiness-v2, on a local Postgres.

  (1) urgent email: the FIRST at once, then ONE grouped email every 15 minutes covering everything since, nothing dropped, outside the 20/day allowance
  (2) report details: FULL for a reporter's first 5 reports in an hour, then a SHORT record (time, reporter, target, reason)
  LOW-1 child-safety holds do not use up the ordinary hold allowances; LOW-2 a lock around the cap checks; LOW-3 the digest does not double count
        urgent reports and #/admin/ops lists child safety first, then newest

Same setup as test_ops_readiness.py (whose helpers it reuses). Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_ops_child_safety.py -v
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_ops_readiness as ops  # noqa: E402

RYAN = core.RYAN
setUpModule = core.setUpModule


class ChildSafety(core.Base):
    project_with_version = core.Core.project_with_version
    admin = ops.Ops.admin
    make_ryan_admin = ops.Ops.make_ryan_admin
    publish_many = ops.Ops.publish_many
    bridge = ops.Ops.bridge
    run_tick = ops.Ops.run_tick

    def report(self, slug, reporter, reason="child_safety", details="details here"):
        return self.db.as_("anon").c.execute("select report_film_page(%s, %s, %s, %s)", (slug, reason, reporter, details))

    def urgent_mails(self):
        return self.db.as_(None).all("select id, subject, body from public.ops_outbox where kind = 'urgent' order by id")

    # ---- (1) the urgent email cadence
    def test_urgent_mail_is_first_at_once_then_one_grouped_mail_every_15_minutes_and_every_report_is_in_some_mail(self):
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 100 returning 1")
        slugs = self.publish_many(20)
        sent_at, seen = [], 0
        for minute in range(0, 51):                                         # 50 simulated minutes, one scheduler tick a minute
            if minute < 40 and minute % 2 == 0:
                self.report(slugs[minute // 2], f"reporter{minute}@x.co")   # 20 reports in 40 minutes, a different reporter each time
            self.run_tick()
            now_count = len(self.urgent_mails())
            if now_count > seen:
                sent_at.append(minute)
                seen = now_count
            # time passes: every stored time moves one minute into the past
            self.db.as_(None).c.execute("update public.ops_outbox set created_at = created_at - interval '1 minute'")
        self.assertEqual(sent_at, [0, 15, 30, 45])                          # the first at once (minute 0), then one grouped mail per 15 minutes
        ids = [int(i) for _, _, body in self.urgent_mails() for i in re.findall(r"child-safety report #(\d+)", body)]
        all_ids = [r[0] for r in self.db.as_(None).all("select id from public.abuse_reports where reason = 'child_safety' order by id")]
        self.assertEqual(sorted(ids), all_ids)                              # every one of the 20 reports is in some mail ...
        self.assertEqual(len(ids), len(set(ids)))                           # ... exactly once
        self.assertEqual(len(ids), 20)
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'urgent:%%' and notified_at is null"), 0)
        subjects = [s for _, s, _ in self.urgent_mails()]
        self.assertTrue(subjects[0].startswith("URGENT: child-safety report #"))              # the first mail names the single report
        self.assertTrue(all(s.startswith("URGENT: ") for s in subjects))

    def test_urgent_mail_is_outside_the_daily_allowance_and_never_swallowed_by_it(self):
        self.admin("update public.ops_settings set max_alert_mails_per_day = 1 returning 1")
        for i in range(3):                                                  # the ordinary allowance for today is already used up
            self.admin("insert into public.ops_outbox (kind, mode, to_addr, subject, body) values ('alert', 'dry_run', 'x@y.co', 's', 'b') returning 1")
        a, = self.publish_many(1)
        self.report(a, "r@x.co")
        r, b = self.run_tick()
        self.assertEqual(r["alert_mail_budget"], 0)
        self.assertEqual(b["response"]["urgent"], 1)                        # sent anyway
        self.assertEqual(len(self.urgent_mails()), 1)
        # and an urgent mail does not use up the ordinary allowance: with a fresh day's budget the count still ignores it
        self.admin("delete from public.ops_outbox where kind = 'alert' returning 1")
        self.assertEqual(self.db.as_("service").one("select ops_tick()")["alert_mail_budget"], 1)

    def test_the_tick_says_how_long_the_urgent_cadence_still_waits(self):
        wait = lambda: self.db.as_("service").one("select ops_tick()")["urgent_wait_s"]
        self.assertEqual(wait(), 0)                                         # never sent: nothing to wait for
        self.admin("insert into public.ops_outbox (kind, mode, to_addr, subject, body, created_at) values ('urgent', 'dry_run', 'x@y.co', 's', 'b', now() - interval '5 minutes') returning 1")
        self.assertIn(wait(), range(599, 602))                              # 15 minutes minus 5
        self.admin("update public.ops_outbox set created_at = now() - interval '16 minutes' where kind = 'urgent' returning 1")
        self.assertEqual(wait(), 0)
        self.admin("update public.ops_settings set urgent_mail_every_min = 30 returning 1")
        self.assertIn(wait(), range(839, 842))                              # the interval is a setting (30 - 16 minutes)

    # ---- (2) report details: full for the first 5 per reporter per hour, then a short record
    def test_the_sixth_report_from_one_reporter_in_an_hour_keeps_time_reporter_target_reason_but_no_details(self):
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 100 returning 1")
        slugs = self.publish_many(9)
        for i in range(7):
            self.report(slugs[i], "same@x.co", details=f"free text {i}")
        self.report(slugs[7], "other@x.co", details="free text from another reporter")           # a different reporter still gets full details
        rows = self.db.as_(None).all("select slug, reason, reporter_email, details, details_omitted, created_at is not null from public.abuse_reports order by id")
        self.assertEqual([r[3] for r in rows[:5]], [f"free text {i}" for i in range(5)])
        self.assertEqual([r[4] for r in rows[:5]], [False] * 5)
        for r in rows[5:7]:                                                 # the 6th and 7th: a SHORT record
            self.assertEqual((r[1], r[2], r[3], r[4], r[5]), ("child_safety", "same@x.co", "", True, True))
        self.assertEqual((rows[5][0], rows[6][0]), (slugs[5], slugs[6]))   # the target is kept
        self.assertEqual((rows[7][2], rows[7][3], rows[7][4]), ("other@x.co", "free text from another reporter", False))
        self.assertEqual(len(rows), 8)                                      # every report is recorded; none refused
        # an hour later the same reporter gets full details again
        self.admin("update public.abuse_reports set created_at = now() - interval '2 hours' returning 1")
        self.report(slugs[8], "same@x.co", details="a new hour")
        self.assertEqual(self.admin("select details from public.abuse_reports order by id desc limit 1"), "a new hour")

    def test_other_reasons_keep_their_existing_per_reporter_limit(self):
        slugs = self.publish_many(7)
        for i in range(5):
            self.report(slugs[i], "same@x.co", reason="harassment")
        with self.assertRaisesRegex(psycopg.Error, "Too many reports"):
            self.report(slugs[5], "same@x.co", reason="harassment")

    def test_ryans_screen_says_when_a_report_is_only_a_short_record(self):
        self.make_ryan_admin()
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 100 returning 1")
        slugs = self.publish_many(6)
        for i in range(6):
            self.report(slugs[i], "same@x.co", details=f"text {i}")
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual(sorted((r["details_omitted"], r["reporter"]) for r in d["abuse"])[-1], (True, "same@x.co"))
        self.assertEqual(sum(1 for r in d["abuse"] if r["details_omitted"]), 1)
        self.assertTrue(all(r["details"] == "" for r in d["abuse"] if r["details_omitted"]))

    # ---- LOW-1: child-safety holds do not use up the ordinary allowances
    def test_child_safety_holds_never_use_up_the_ordinary_per_reporter_or_hourly_hide_allowance(self):
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 100 returning 1")
        slugs = self.publish_many(14)
        for i in range(3):                                                  # a reporter's 3 child-safety holds (the ordinary per-reporter day limit is 3) ...
            self.report(slugs[i], "same@x.co")
        self.report(slugs[3], "same@x.co", reason="harassment")             # ... must not stop their next ordinary report from holding
        self.assertEqual(self.admin("select held_at is not null from public.film_pages where slug = %s", slugs[3]), True)
        for i in range(4, 14):                                              # ten more child-safety holds from other reporters (the ordinary hourly cap is 10) ...
            self.report(slugs[i], f"c{i}@x.co")
        _, vid = self.project_with_version()
        self.admin("insert into public.film_pages (version_id, owner_id, slug, title, summary) values (%s, %s, %s, 'T', %s::jsonb) returning 1", vid, RYAN, "Z" * 22, ops.SUMMARY)
        self.report("Z" * 22, "fresh@x.co", reason="copyright")           # ... must not stop an ordinary hold either
        self.assertEqual(self.admin("select held_at is not null from public.film_pages where slug = %s", "Z" * 22), True)

    # ---- LOW-2: the cap checks run one report at a time
    def test_reports_take_a_lock_so_concurrent_reports_cannot_race_past_the_caps(self):
        slugs = self.publish_many(2)
        other = psycopg.connect(self.db.c.info.dsn, autocommit=True)
        try:
            other.execute("select pg_advisory_lock(hashtext('report_film_page'))")      # another report is mid-flight
            anon = self.db.as_("anon").c
            anon.execute("set lock_timeout = '300ms'")
            with self.assertRaises(psycopg.errors.LockNotAvailable):
                anon.execute("select report_film_page(%s, 'child_safety', 'a@x.co', 'x')", (slugs[0],))
            other.execute("select pg_advisory_unlock(hashtext('report_film_page'))")
        finally:
            other.close()
        anon = self.db.as_("anon").c
        anon.execute("set lock_timeout = '2s'")
        anon.execute("select report_film_page(%s, 'child_safety', 'a@x.co', 'x')", (slugs[0],))        # free again: it goes through
        self.assertEqual(self.admin("select count(*) from public.abuse_reports"), 1)

    # ---- LOW-3: no double counting, and the screen's order
    def test_the_digest_counts_an_urgent_report_once_in_abuse_waiting_not_also_as_a_listed_item(self):
        a, = self.publish_many(1)
        self.report(a, "r@x.co")
        d = self.db.as_("service").one("select ops_digest_data()")
        self.assertEqual(d["abuse_waiting"], 1)
        self.assertEqual([i for i in d["items"] if "child-safety" in i], [])
        self.assertTrue(d["actionable"])                                    # it still makes the digest worth sending, once

    def test_ryans_screen_lists_child_safety_first_then_newest_and_still_caps_at_20(self):
        self.make_ryan_admin()
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 100 returning 1")
        slugs = self.publish_many(25)
        self.report(slugs[0], "a@x.co", reason="harassment")                # id 1
        self.report(slugs[1], "b@x.co", reason="child_safety")              # id 2
        self.report(slugs[2], "c@x.co", reason="copyright")                 # id 3
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual([(r["id"], r["reason"]) for r in d["abuse"]], [(2, "child_safety"), (3, "copyright"), (1, "harassment")])
        for i in range(3, 25):
            self.report(slugs[i], f"x{i}@x.co", reason="other")
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual(len(d["abuse"]), 20)
        self.assertEqual(d["abuse"][0]["reason"], "child_safety")           # child safety stays on top
        self.assertEqual(d["abuse"][1]["id"], 25)                           # then the newest


if __name__ == "__main__":
    unittest.main()
