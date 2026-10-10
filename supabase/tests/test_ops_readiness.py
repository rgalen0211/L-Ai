"""Hands-off operations (migrations/20261010000100_ops_readiness.sql) on a local Postgres.

Two groups: Ops (the 2A harness) and OpsLedger (the 2B harness, because a refund needs the credits ledger). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_ops_readiness.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
SLUG = "A" * 22
SUMMARY = json.dumps({"sources": [{"label": "x", "links": []}]})


def setUpModule():
    core.setUpModule()
    credits.setUpModule()


class Ops(core.Base):
    project_with_version = core.Core.project_with_version
    claim = core.Core.claim

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def make_ryan_admin(self):
        self.admin("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com' returning 1")

    def status(self, who="anon"):
        return self.db.as_(who).one("select service_status()")

    def ping(self, ago="0 seconds", who=WORKER):
        self.db.as_(who).one("select worker_ping(40)")
        self.admin("update public.workers set last_seen_at = now() - %s::interval where user_id = %s returning 1", ago, who)

    # -- liveness
    def test_status_is_unknown_until_a_worker_pings_then_ok_then_delayed(self):
        self.assertEqual(self.status()["rendering"], "unknown")            # no false alarm before WORKER adds the call
        self.ping()
        self.assertEqual(self.status()["rendering"], "ok")
        self.ping("4 minutes")
        self.assertEqual(self.status()["rendering"], "delayed")
        self.ping("0 seconds", WORKER2)                                    # any enabled worker alive is enough
        self.assertEqual(self.status("anon")["rendering"], "ok")

    def test_only_a_worker_can_ping_and_status_shows_nothing_private(self):
        self.denied(RYAN, "select worker_ping(1)")
        self.denied("anon", "select worker_ping(1)")
        self.ping()
        self.assertEqual(set(self.status()), {"rendering", "last_check_in"})

    # -- the reaper must do exactly what claim_next_job does
    def lost_job(self, attempt=1):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.claim()
        self.admin("update public.jobs set attempt = %s, lease_expires_at = now() - interval '5 minutes' where id = %s returning 1", attempt, job)
        return job

    def shape(self, job):
        return self.admin("select state::text, attempt, error_code, ended_at is not null, worker_user_id is null from public.jobs where id = %s", job)

    def test_reaper_requeues_then_fails_with_no_worker_polling(self):
        job = self.lost_job(1)
        self.assertEqual(self.admin("select ryagram_private.reap_lost_leases()"), 1)
        self.assertEqual(self.shape(job), ("queued", 2, "worker_lost", False, True))
        self.admin("update public.jobs set state = 'running', attempt = 3, lease_expires_at = now() - interval '1 minute', worker_user_id = %s where id = %s returning 1", WORKER, job)
        self.admin("select ryagram_private.reap_lost_leases()")
        self.assertEqual(self.shape(job), ("failed", 3, "worker_lost", True, True))

    def test_reaper_matches_claim_next_job_on_identical_fixtures(self):
        a = self.lost_job(2)
        via_reaper = (self.admin("select ryagram_private.reap_lost_leases()"), self.shape(a))
        self.db.as_(None).c.execute("delete from public.jobs")
        b = self.lost_job(2)
        self.db.as_(WORKER).one("select count(*) from claim_next_job()")           # the worker's own path
        state_b = self.shape(b)
        # claim_next_job then claims the requeued job, so compare the lost-attempt record, which both write identically.
        self.assertEqual(via_reaper[1][2], state_b[2])
        self.assertEqual(self.admin("select count(*) from public.job_metering where error_code = 'worker_lost'"), 1)

    # -- one alert per incident
    def test_ops_tick_raises_one_alert_per_incident_and_none_before_pings_exist(self):
        t = lambda: self.db.as_("service").one("select ops_tick()")
        self.assertEqual(t()["new_alerts"], [])                            # unknown: nothing
        self.ping("10 minutes")
        first = t()
        self.assertEqual([a["key"] for a in first["new_alerts"]], ["worker_stale"])
        self.db.as_("service").one("select ops_mark_notified(%s)", ["worker_stale"])
        self.assertEqual(t()["new_alerts"], [])                            # still down: no second email
        self.ping()
        t()                                                                # recovered: resolved
        self.assertIsNotNone(self.admin("select resolved_at from public.ops_alerts where key = 'worker_stale'"))
        self.ping("10 minutes")
        self.assertEqual([a["key"] for a in t()["new_alerts"]], ["worker_stale"])   # a NEW incident alerts again

    def test_ops_tick_is_for_the_scheduler_only(self):
        for who in (RYAN, "anon", WORKER):
            self.denied(who, "select ops_tick()")

    # -- support
    def test_support_attaches_the_job_state_but_only_for_its_owner_and_drops_honeypot_and_floods(self):
        _, vid = self.project_with_version()
        job = self.db.as_(RYAN).one("select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        n = self.db.as_(RYAN).one("select submit_support('r@x.co', 'render', 'my film is stuck', %s)", job)
        self.assertEqual(self.admin("select job_id::text, job_state, owner_id::text from public.support_requests where id = %s", n), (str(job), "queued", RYAN))
        m = self.db.as_(OTHER).one("select submit_support('o@x.co', 'render', 'looking at someone else job', %s)", job)
        self.assertIsNone(self.admin("select job_id from public.support_requests where id = %s", m))
        self.assertEqual(self.db.as_("anon").one("select submit_support('a@x.co', 'other', 'hello there', null, 'http://spam')"), 0)
        self.assertEqual(self.admin("select count(*) from public.support_requests"), 2)
        for i in range(5):
            self.db.as_("anon").one("select submit_support('f@x.co', 'other', 'flood flood', null)")
        with self.assertRaisesRegex(psycopg.Error, "Too many"):
            self.db.as_("anon").one("select submit_support('f@x.co', 'other', 'flood flood', null)")
        self.denied("anon", "select submit_support('bad', 'other', 'hello there')")
        self.denied("anon", "select * from public.support_requests")

    # -- abuse
    def publish_page(self, owner=RYAN):
        _, vid = self.project_with_version(owner)
        self.admin("insert into public.film_pages (version_id, owner_id, slug, title, summary) values (%s, %s, %s, 'T', %s::jsonb) returning 1", vid, owner, SLUG, SUMMARY)

    def page(self):
        return self.admin("select published, held_at is not null from public.film_pages where slug = %s", SLUG)

    def test_a_serious_report_hides_the_page_at_once_and_the_owner_cannot_republish_it(self):
        self.publish_page()
        self.db.as_("anon").one("select report_film_page(%s, 'child_safety', 'rep@x.co', 'details')", SLUG) if False else \
            self.db.as_("anon").c.execute("select report_film_page(%s, 'child_safety', 'rep@x.co', 'details')", (SLUG,))
        self.assertEqual(self.page(), (False, True))
        self.admin("update public.film_pages set published = true where slug = %s returning 1", SLUG)
        self.assertEqual(self.page(), (False, True))                        # the hold wins, even over the table owner's update
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'abuse:%%'"), 1)

    def test_other_reports_only_queue_unknown_slugs_are_silent_and_the_honeypot_does_nothing(self):
        self.publish_page()
        c = self.db.as_("anon").c
        c.execute("select report_film_page(%s, 'other', 'rep@x.co', 'meh')", (SLUG,))
        self.assertEqual(self.page(), (True, False))
        c.execute("select report_film_page(%s, 'harassment', 'rep@x.co', 'x', 'spam')", (SLUG,))
        c.execute("select report_film_page(%s, 'harassment', 'rep@x.co')", ("B" * 22,))
        self.assertEqual(self.admin("select count(*) from public.abuse_reports"), 1)
        self.assertEqual(self.page(), (True, False))

    def test_one_reporter_can_only_auto_hide_a_few_pages_a_day(self):
        self.publish_page()
        self.admin("update public.ops_settings set abuse_hide_per_reporter_day = 0 returning 1")
        self.db.as_("anon").c.execute("select report_film_page(%s, 'harassment', 'rep@x.co')", (SLUG,))
        self.assertEqual(self.page(), (True, False))                         # queued for review, not hidden
        self.assertEqual(self.admin("select auto_held from public.abuse_reports"), False)

    def test_only_ryan_reviews_and_restoring_lifts_the_hold_removing_deletes_the_page(self):
        self.make_ryan_admin()
        self.publish_page()
        self.db.as_("anon").c.execute("select report_film_page(%s, 'copyright', 'rep@x.co')", (SLUG,))
        rid = self.admin("select id from public.abuse_reports")
        self.denied(OTHER, "select admin_review_report(%s, 'restored')", rid)
        self.db.as_(RYAN).one("select admin_review_report(%s, 'restored')", rid)
        self.assertEqual(self.page(), (False, False))                        # hold lifted; the owner may publish again
        self.assertEqual(self.db.as_(RYAN).one("select admin_ops()")["abuse_waiting"], 0)
        self.db.as_(None).c.execute("update public.abuse_reports set reviewed_at = null, outcome = null")
        self.db.as_(RYAN).one("select admin_review_report(%s, 'removed')", rid)
        self.assertEqual(self.admin("select count(*) from public.film_pages"), 0)

    def test_admin_ops_is_admin_only_and_tables_are_closed(self):
        self.denied(OTHER, "select admin_ops()")
        self.denied("anon", "select admin_ops()")
        for t in ("ops_settings", "ops_alerts", "support_requests", "abuse_reports"):
            for who in ("anon", RYAN, "service"):
                self.denied(who, f"select * from public.{t}")


class OpsLedger(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, denied = credits.Ledger.admin, credits.Ledger.denied
    grant, available = credits.Ledger.grant, credits.Ledger.available
    version, submit, final, settle = credits.Ledger.version, credits.Ledger.submit, credits.Ledger.final, credits.Ledger.settle

    def test_a_job_queued_too_long_while_delayed_is_cancelled_and_its_credits_come_back(self):
        self.grant(100)
        _, job = self.final("paired")
        self.assertEqual(self.available(), 90)
        self.admin("update public.jobs set created_at = now() - interval '2 hours' where id = %s returning 1", job)
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 0)      # service 'unknown': never cancels
        self.admin("update public.workers set last_seen_at = now() - interval '10 minutes' where name = 'ryan-pc' returning 1")
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 1)
        self.assertEqual(self.admin("select state::text, error_code from public.jobs where id = %s", job), ("cancelled", "queue_timeout"))
        self.assertEqual(self.available(), 100)
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 0)      # nothing is refunded twice
        self.assertEqual(self.available(), 100)

    def test_a_started_job_is_not_cancelled_by_the_queue_timeout(self):
        self.grant(100)
        _, job = self.final("paired")
        self.admin("update public.jobs set created_at = now() - interval '2 hours', state = 'running' where id = %s returning 1", job)
        self.admin("update public.workers set last_seen_at = now() - interval '10 minutes' where name = 'ryan-pc' returning 1")
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 0)


if __name__ == "__main__":
    unittest.main()


class RetryPolicy(unittest.TestCase):
    """Ryan, 2026-10-10: infrastructure failures keep up to 3 attempts; failures that repeat identically get NO retry, and the
    credits come back at once (ledger 3a). These pin the existing 2A rules so nobody loosens them."""
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, denied = credits.Ledger.admin, credits.Ledger.denied
    grant, available = credits.Ledger.grant, credits.Ledger.available
    version, submit, final, settle = credits.Ledger.version, credits.Ledger.submit, credits.Ledger.final, credits.Ledger.settle

    def held_final(self):
        self.grant(100)
        _, job = self.final("paired")
        return job

    def claim(self):
        return self.db.as_(WORKER).one("select id from claim_next_job()")

    def test_deterministic_failures_are_never_retried_and_refund_at_once(self):
        granted = 0
        for code in ("schema_rejected", "engine_unsupported", "engine_refused", "dataset_not_allowed", "ladder_missing",
                     "gate_failed", "timeout", "limit_exceeded", "no_receipt", "no_commit"):
            with self.subTest(code=code):
                job = self.held_final()
                granted += 100
                self.assertEqual(self.claim(), job)
                w = self.db.as_(WORKER)
                with self.assertRaisesRegex(psycopg.Error, "not retryable"):
                    w.one("select retry_job(%s, %s)", job, code)
                self.db.as_(WORKER).c.execute("select state from report_state(%s, 'running', null, null, 'abc1234', false)", (job,))
                self.db.as_(WORKER).c.execute("select state from report_state(%s, 'failed', %s, 'plain reason')", (job, code))
                self.assertEqual(self.admin("select state::text, attempt from public.jobs where id = %s", job), ("failed", 1))
                self.assertEqual(self.available(), granted)                                 # credits back, immediately

    def test_infrastructure_failures_retry_up_to_three_attempts_then_fail_and_refund(self):
        job = self.held_final()
        for attempt in (1, 2):
            self.assertEqual(self.claim(), job)
            self.assertEqual(self.db.as_(WORKER).one("select retry_job(%s, 'crash')", job), "queued")
            self.assertEqual(self.available(), 90)                                          # still held while it can still run
        self.assertEqual(self.claim(), job)
        self.assertEqual(self.db.as_(WORKER).one("select retry_job(%s, 'crash')", job), "failed")
        self.assertEqual(self.admin("select attempt, error_code from public.jobs where id = %s", job), (3, "crash"))
        self.assertEqual(self.available(), 100)


def _usage(output_tokens, mid):
    # claude-haiku-4-5 output is $5 per million tokens: 200_000 output tokens = $1.00
    return json.dumps({"model": "claude-haiku-4-5", "message_id": mid, "input_tokens": 0, "output_tokens": output_tokens,
                       "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0})


class AiCaps(core.Base):
    def setUp(self):
        super().setUp()
        d = self.db.as_(RYAN)
        self.pid = d.one("insert into projects (title) values ('p') returning id")
        self.vid = d.one("select id from create_version(%s)", self.pid)

    def svc(self, sql, *args):
        return self.db.as_("service").one(sql, *args)

    def caps(self, **kw):
        sets = ", ".join(["ai_enabled = true"] + [f"{k} = {v}" for k, v in kw.items()])
        self.db.as_(None).one(f"update control set {sets} returning 1")

    def turn(self, who=RYAN, vid=None):
        s = self.svc("select id from ai_session_for(%s, %s)", who, vid or self.vid)
        return self.svc("select ai_reserve_turn(%s, %s)", who, s)

    def spend(self, turn, dollars, mid):
        self.svc("select ai_record_usage(%s, %s::jsonb)", turn, _usage(int(dollars * 200000), mid))

    def alerts(self):
        return sorted(r[0].split(":")[0] for r in self.db.as_(None).all("select key from public.ops_alerts where key like 'ai%%'"))

    def test_daily_cap_warns_once_at_80_then_pauses_the_editor_with_a_friendly_message(self):
        self.caps(ai_daily_usd_cap=1.00, ai_project_cap_usd=100, ai_project_alert_usd=100)
        t = self.turn()
        self.spend(t, 0.5, "m1")
        self.assertTrue(self.svc("select ai_budget_ok(%s)", t))
        self.assertEqual(self.alerts(), [])
        self.spend(t, 0.4, "m2")                                            # 90%
        self.assertTrue(self.svc("select ai_budget_ok(%s)", t))
        for _ in range(3):
            self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(self.alerts(), ["ai_day_80"])                       # ONE alert however often it is checked
        self.spend(t, 0.2, "m3")                                             # over 100%
        self.assertFalse(self.svc("select ai_budget_ok(%s)", t))             # no further Anthropic call in this turn
        with self.assertRaisesRegex(psycopg.Error, "paused to keep costs in check"):
            self.turn()
        self.assertEqual(self.alerts(), ["ai_day_100", "ai_day_80"])
        self.db.as_(RYAN).one("insert into projects (title) values ('other app work') returning id")   # the rest of the app works

    def test_monthly_cap_pauses_too_and_a_new_day_does_not_unpause_it(self):
        self.caps(ai_daily_usd_cap=100, ai_monthly_usd_cap=1.00, ai_project_cap_usd=100, ai_project_alert_usd=100)
        t = self.turn()
        self.spend(t, 1.1, "m1")
        self.assertFalse(self.svc("select ai_budget_ok(%s)", t))
        self.db.as_(None).one("update ai_usage set created_at = now() - interval '1 day' returning 1")
        if self.db.as_(None).one("select date_trunc('month', now() at time zone 'EST5EDT') = date_trunc('month', (now() - interval '1 day') at time zone 'EST5EDT')"):
            with self.assertRaisesRegex(psycopg.Error, "paused"):
                self.turn()

    def test_old_spend_does_not_count_against_todays_cap(self):
        self.caps(ai_daily_usd_cap=1.00, ai_monthly_usd_cap=1000, ai_project_cap_usd=100, ai_project_alert_usd=100)
        t = self.turn()
        self.spend(t, 2.0, "m1")
        self.db.as_(None).one("update ai_usage set created_at = now() - interval '3 days' returning 1")
        self.assertTrue(self.svc("select ai_budget_ok(%s)", t))

    def test_the_per_project_cap_is_enforced_for_that_project_only(self):
        self.caps(ai_project_cap_usd=0.50, ai_project_alert_usd=0.10)
        t = self.turn()
        self.spend(t, 0.6, "m1")
        self.assertFalse(self.svc("select ai_budget_ok(%s)", t))
        with self.assertRaisesRegex(psycopg.Error, "done a lot of work"):
            self.turn()
        d = self.db.as_(OTHER)
        vid = d.one("select id from create_version(%s)", d.one("insert into projects (title) values ('q') returning id"))
        self.turn(OTHER, vid)                                                 # someone else's film is not affected

    def test_budget_functions_are_service_only_and_a_finished_turn_is_refused(self):
        self.caps()
        t = self.turn()
        for who in ("anon", RYAN):
            self.denied(who, "select ai_budget_ok(%s)", t)
        self.svc("select ai_finish_turn(%s, 'done', false, 0, null, null, null)", t)
        self.assertFalse(self.svc("select ai_budget_ok(%s)", t))
