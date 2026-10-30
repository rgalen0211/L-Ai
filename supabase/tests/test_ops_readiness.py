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
        # attempt 2 is the last (retry once, Ryan 2026-10-17; PIPE-1): lost again, it fails
        self.admin("update public.jobs set state = 'running', attempt = 2, lease_expires_at = now() - interval '1 minute', worker_user_id = %s where id = %s returning 1", WORKER, job)
        self.admin("select ryagram_private.reap_lost_leases()")
        self.assertEqual(self.shape(job), ("failed", 2, "worker_lost", True, True))

    ROW = ("select state::text, attempt, error_code, error_class::text, error_detail, ended_at is null, claimed_at is null, started_at is null, "
           "lease_expires_at is null, heartbeat_at is null, worker_id is null, worker_user_id is null, progress is null, "
           "queued_at > now() - interval '1 minute' from public.jobs where id = %s")

    def test_reaper_does_exactly_what_claim_next_jobs_lease_block_does_row_for_row(self):
        for attempt, cancel in ((1, False), (2, False), (1, True)):      # 2 = the last attempt (retry once, PIPE-1)
            with self.subTest(attempt=attempt, cancel=cancel):
                self.db.as_(None).c.execute("delete from public.job_metering")
                self.db.as_(None).c.execute("delete from public.jobs")
                a = self.lost_job(attempt)
                self.admin("update public.jobs set cancel_requested = %s, queued_at = now() - interval '2 hours' where id = %s returning 1", cancel, a)
                self.admin("update public.control set claims_enabled = false returning 1")          # claim_next_job now ONLY runs its lease block
                self.db.as_(WORKER).one("select count(*) from claim_next_job()")
                via_claim = (self.admin(self.ROW, a), self.admin("select error_code from public.job_metering where job_id = %s", a))
                self.db.as_(None).c.execute("delete from public.job_metering")
                self.db.as_(None).c.execute("delete from public.jobs")
                self.admin("update public.control set claims_enabled = true returning 1")
                b = self.lost_job(attempt)
                self.admin("update public.jobs set cancel_requested = %s, queued_at = now() - interval '2 hours' where id = %s returning 1", cancel, b)
                self.assertEqual(self.admin("select ryagram_private.reap_lost_leases()"), 1)
                via_reaper = (self.admin(self.ROW, b), self.admin("select error_code from public.job_metering where job_id = %s", b))
                self.assertEqual(via_reaper, via_claim)

    def test_the_reaper_leaves_a_job_whose_lease_is_still_fresh_alone(self):
        job = self.lost_job(1)
        self.admin("update public.jobs set lease_expires_at = now() + interval '90 seconds' where id = %s returning 1", job)
        self.assertEqual(self.admin("select ryagram_private.reap_lost_leases()"), 0)
        self.assertEqual(self.admin("select state::text, attempt from public.jobs where id = %s", job), ("claimed", 1))

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
        self.db.as_("anon").c.execute("select report_film_page(%s, 'child_safety', 'rep@x.co', 'details')", (SLUG,))
        self.assertEqual(self.page(), (False, True))
        self.admin("update public.film_pages set published = true where slug = %s returning 1", SLUG)
        self.assertEqual(self.page(), (False, True))                        # the hold wins, even over the table owner's update
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'urgent:child_safety:%%'"), 1)        # child safety raises the URGENT alert

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
        self.assertEqual(self.page(), (False, True))                          # the row stays, held for good...
        self.admin("update public.film_pages set published = true where slug = %s returning 1", SLUG)
        self.assertEqual(self.page(), (False, True))                          # ...so the owner cannot publish it again

    def test_admin_ops_is_admin_only_and_tables_are_closed(self):
        self.denied(OTHER, "select admin_ops()")
        self.denied("anon", "select admin_ops()")
        for t in ("ops_settings", "ops_alerts", "support_requests", "abuse_reports"):
            for who in ("anon", RYAN, "service"):
                self.denied(who, f"select * from public.{t}")

    # -- outbox and digest data
    def test_digest_data_is_not_actionable_when_all_is_well_and_actionable_with_an_open_alert_or_ticket(self):
        svc = lambda: self.db.as_("service").one("select ops_digest_data()")
        d = svc()
        self.assertFalse(d["actionable"])                                  # silent day
        self.db.as_("anon").one("select submit_support('a@x.co', 'other', 'hello there', null)")
        self.assertTrue(svc()["actionable"])
        self.assertEqual(svc()["support_open"], 1)

    def test_one_digest_a_day_and_the_outbox_is_closed_to_everyone_but_the_function(self):
        add = lambda kind="digest": self.db.as_("service").one("select ops_outbox_add(%s, 'dry_run', 'ryagram@uselai.com', 's', 'b')", kind)
        self.assertTrue(add())
        self.assertFalse(add())                                            # a second digest the same day is refused
        self.assertTrue(add("alert")); self.assertTrue(add("alert"))       # alerts are not limited this way
        self.assertTrue(self.db.as_("service").one("select ops_digest_data()")["digest_sent_today"])
        for who in ("anon", RYAN, "service"):
            self.denied(who, "select * from public.ops_outbox")
        for who in ("anon", RYAN):
            self.denied(who, "select ops_outbox_add('alert', 'live', 'x@y.co', 's', 'b')")
            self.denied(who, "select ops_digest_data()")

    # -- backups report in (Ryan: alert when the newest good backup is older than 2 days)
    def tick(self):
        return self.db.as_("service").one("select ops_tick()")

    def alert_keys(self):
        return sorted(r[0] for r in self.db.as_(None).all("select key from public.ops_alerts where resolved_at is null and (key like '%%backup%%' or key like 'restore%%')"))

    def test_only_the_worker_login_can_record_a_backup_and_only_known_kinds(self):
        self.db.as_(WORKER).one("select record_backup('daily', true, 123456, 'ok')")
        for who in (RYAN, "anon", OTHER):
            self.denied(who, "select record_backup('daily', true)")
        with self.assertRaises(psycopg.Error):
            self.db.as_(WORKER).one("select record_backup('weird', true)")
        self.assertEqual(self.admin("select count(*) from public.ops_backups"), 1)
        for who in ("anon", RYAN, "service"):
            self.denied(who, "select * from public.ops_backups")

    def test_a_stale_backup_alerts_once_after_backups_are_expected_and_clears_on_the_next_good_one(self):
        self.tick()
        self.assertEqual(self.alert_keys(), [])                                  # not expected yet: silent
        self.admin("update public.ops_settings set backups_expected = true returning 1")
        self.assertEqual([a["key"] for a in self.tick()["new_alerts"] if "backup" in a["key"]], ["backup_stale"])
        self.db.as_("service").one("select ops_mark_notified(%s)", ["backup_stale"])                       # the Edge Function does this after emailing
        self.assertEqual([a["key"] for a in self.tick()["new_alerts"] if "backup" in a["key"]], [])        # one alert, not one per tick
        self.db.as_(WORKER).one("select record_backup('daily', true, 5000000)")
        self.tick()
        self.assertEqual(self.alert_keys(), [])
        self.admin("update public.ops_backups set created_at = now() - interval '3 days' returning 1")
        self.assertEqual([a["key"] for a in self.tick()["new_alerts"] if "backup" in a["key"]], ["backup_stale"])   # older than 2 days: alert again
        self.db.as_(WORKER).one("select record_backup('daily', false, null, 'pg_dump failed')")                  # a FAILED dump does not count as a backup
        self.tick()
        self.assertEqual(self.alert_keys(), ["backup_stale"])

    def test_a_failed_restore_test_alerts(self):
        self.admin("update public.ops_settings set backups_expected = true returning 1")
        self.db.as_(WORKER).one("select record_backup('daily', true, 1)")
        self.db.as_(WORKER).one("select record_backup('restore_test', false, null, 'row counts differ')")
        self.assertIn("restore_test_failed", [a["key"] for a in self.tick()["new_alerts"]])
        self.db.as_(WORKER).one("select record_backup('restore_test', true)")
        self.tick()
        self.assertEqual(self.alert_keys(), [])

    # -- #/admin/ops
    def test_admin_ops_shows_everything_ryan_needs_and_only_to_ryan(self):
        self.make_ryan_admin()
        self.ping("10 minutes")
        job = self.lost_job()
        self.db.as_("anon").one("select submit_support('a@x.co', 'render', 'film stuck please help', null)")
        self.publish_page()
        self.db.as_("anon").c.execute("select report_film_page(%s, 'harassment', 'rep@x.co', 'bad')", (SLUG,))
        self.db.as_("service").one("select ops_outbox_add('alert', 'dry_run', 'ryagram@uselai.com', 'Ryagram: x', 'b')")
        self.db.as_(WORKER).one("select record_backup('daily', true, 42)")
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual((d["rendering"], d["free_gb"] is not None, d["queued"], d["running"]), ("delayed", True, 0, 1))
        self.assertEqual([j["id"] for j in d["stuck"]], [str(job)])
        self.assertEqual(d["ai"]["state"], "ok")
        self.assertEqual(set(d["ai"]) >= {"day_spent", "day_cap", "month_spent", "month_cap", "enabled"}, True)
        self.assertEqual([o["kind"] for o in d["outbox"]], ["alert"])
        self.assertEqual((d["backups"]["last_daily_bytes"], d["backups"]["expected"]), (42, False))
        self.assertEqual((d["support_open"], d["support"][0]["topic"], d["support"][0]["email"]), (1, "render", "a@x.co"))
        self.assertEqual((d["abuse_waiting"], d["abuse"][0]["reason"], d["abuse"][0]["auto_held"]), (1, "harassment", True))
        self.assertTrue(any(a["key"].startswith("abuse:") for a in d["open_alerts"]))
        self.denied(OTHER, "select admin_ops()")

    def test_ryan_marks_a_ticket_answered_and_nobody_else_can(self):
        self.make_ryan_admin()
        n = self.db.as_("anon").one("select submit_support('a@x.co', 'other', 'hello there', null)")
        self.denied(OTHER, "select admin_answer_support(%s)", n)
        self.db.as_(RYAN).one("select admin_answer_support(%s)", n)
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual((d["support_open"], d["support"]), (0, []))
        self.assertEqual(self.admin("select resolved_at is not null from public.ops_alerts where key = %s", f"support:{n}"), True)

    # -- CC1's MEDs
    def test_a_mail_budget_is_reported_and_shrinks_with_each_alert_mail_sent_today(self):
        self.admin("update public.ops_settings set max_alert_mails_per_day = 2 returning 1")
        self.assertEqual(self.tick()["alert_mail_budget"], 2)
        for _ in range(2):
            self.db.as_("service").one("select ops_outbox_add('alert', 'dry_run', 'ryagram@uselai.com', 's', 'b')")
        self.assertEqual(self.tick()["alert_mail_budget"], 0)
        self.db.as_("service").one("select ops_outbox_add('digest', 'dry_run', 'ryagram@uselai.com', 's', 'b')")
        self.assertEqual(self.tick()["alert_mail_budget"], 0)                  # digests do not use the alert allowance, and it never goes below 0

    def test_the_digest_counts_tickets_and_reports_but_does_not_list_them_twice_and_goes_quiet_once_answered(self):
        self.make_ryan_admin()
        n = self.db.as_("anon").one("select submit_support('a@x.co', 'other', 'hello there', null)")
        d = self.db.as_("service").one("select ops_digest_data()")
        self.assertEqual((d["actionable"], d["items"], d["support_open"]), (True, [], 1))
        self.db.as_(RYAN).one("select admin_answer_support(%s)", n)
        self.assertFalse(self.db.as_("service").one("select ops_digest_data()")["actionable"])

    def test_a_report_from_a_new_email_each_time_does_not_get_around_the_caller_limits(self):
        self.publish_page()
        c = self.db.as_("anon").c
        c.execute("select set_config('request.headers', %s, false)", ('{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}',))
        for i in range(5):
            c.execute("select report_film_page(%s, 'other', %s)", (SLUG, f"new{i}@x.co"))                 # a different email every time
        with self.assertRaisesRegex(psycopg.Error, "Too many"):
            c.execute("select report_film_page(%s, 'other', 'yet-another@x.co')", (SLUG,))
        self.assertEqual(self.admin("select count(*) from public.abuse_reports"), 5)
        stored = self.admin("select reporter_key from public.abuse_reports limit 1")
        self.assertNotIn("203.0.113.9", stored)                                                          # the address itself is never stored
        c.execute("select set_config('request.headers', %s, false)", ('{"x-forwarded-for": "198.51.100.7"}',))
        c.execute("select report_film_page(%s, 'other', 'someone@x.co')", (SLUG,))                       # another caller is not blocked

    def test_there_is_a_global_cap_on_reports_and_on_auto_hides(self):
        self.publish_page()
        self.admin("insert into public.abuse_reports (slug, reason, reporter_email, reporter_key, auto_held) "
                   "select %s, 'harassment', 'f' || g || '@x.co', 'k' || g, true from generate_series(1, 10) g returning 1", SLUG)
        self.db.as_("anon").c.execute("select report_film_page(%s, 'harassment', 'late@x.co')", (SLUG,))
        self.assertEqual(self.page(), (True, False))                                  # ten holds an hour already: this one only queues
        self.admin("insert into public.abuse_reports (slug, reason, reporter_email, reporter_key) "
                   "select %s, 'other', 'g' || g || '@x.co', 'j' || g from generate_series(1, 20) g returning 1", SLUG)
        with self.assertRaisesRegex(psycopg.Error, "Too many"):
            self.db.as_("anon").c.execute("select report_film_page(%s, 'other', 'toomany@x.co')", (SLUG,))

    def test_service_only_functions_are_closed_to_signed_in_users_even_under_supabases_default_grants(self):
        # Supabase grants execute on every new public function to anon, authenticated and service_role. Rebuild a database under
        # THOSE defaults (the stub models the strictest reading), apply everything, then look at what this migration exposed.
        name = "dg" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        listing = ("select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                   "where n.nspname = 'public'")
        with psycopg.connect(core._server.get_uri(database=name), autocommit=True) as c:
            stub = "".join(l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role"))   # roles are cluster-wide
            c.execute(stub)
            c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
            before = set()
            for path in core.MIGRATIONS:
                if path.name.startswith("20261010000100"):
                    before = {r[0] for r in c.execute(listing).fetchall()}
                c.execute(path.read_text(encoding="utf-8"))
            new = sorted({r[0] for r in c.execute(listing).fetchall()} - before)
            self.assertTrue(new)
            may_sign_in = {"worker_ping(numeric)", "service_status()", "submit_support(text,text,text,uuid,text)",
                           "report_film_page(text,text,text,text,text)", "admin_review_report(bigint,text)", "admin_ops()",
                           "admin_answer_support(bigint)", "admin_ack_stripe(text)", "record_backup(text,boolean,bigint,text)",
                           # creator beta: Ryan's list and decisions (each refuses everyone but is_app_admin() inside)
                           "admin_creator_beta()", "admin_decide_creator(bigint,text)",
                           # cost ledger: Ryan's screen and settings (same rule)
                           "admin_cost_rollup(integer)", "admin_cost_set_threshold(text,text,numeric,integer)", "admin_cost_delete_threshold(bigint)",
                           "admin_cost_set_plan(text,text,numeric,date,jsonb)", "admin_cost_set_rate(text,text,numeric,text)", "admin_cost_record(text,numeric,date,text)",
                           # creator flow: a signed-in person asks for a film (the database needs their id); the rest are Ryan's, each refusing everyone else inside
                           "request_film(text,text)", "film_request_cost()", "admin_creator_invite(bigint,integer)", "admin_invite_person(text,integer)", "admin_invite_send_begin(text,text)", "admin_invite_app_link_make(text)", "admin_invite_send_undo(text)", "admin_connect_access_set(text,boolean,text)", "admin_connect_access_audit()", "admin_connect_access_list()", "funnel_attach_source(text,text,text,text)", "funnel_return_visit()", "admin_funnel(integer)", "funnel_anon(text,text,text,text,text)", "admin_film_requests()",
                           "admin_film_request_set(bigint,text,text,text)", "admin_creator_flow_set(integer,integer)",
                           # uploads, Recently deleted (20261027000200): a person restores or removes their OWN upload; each checks auth.uid() ownership inside
                           "restore_dataset(uuid)", "delete_dataset_forever(uuid)", "my_recently_deleted_uploads()",
                           # engine profiles: the only write path to a person's own look; checks the key tree inside
                           "set_engine_profile(jsonb,boolean)",
                           # render orders (PIPE-1, JOB-CONTRACT-v1 section 3): a person's own orders (app session only, checked inside);
                           # the rest are Ryan's, each refusing everyone but is_app_admin() from an app session inside
                           "submit_render_order(jsonb,text,order_want,text)", "request_final_render(uuid,text)",
                           "render_order_status(uuid)", "cancel_render_order(uuid)",
                           "admin_set_auto_render(boolean)", "admin_render_queue()", "admin_render_decide(uuid,boolean,text)",
                           "admin_user_caps()", "admin_set_user_cap(uuid,integer)",
                           # connect your own AI: the person's own consent and settings (each refuses a token that carries client_id and
                           # anyone who is not signed in) and Ryan's two admin switches (each refuses everyone but is_app_admin() inside)
                           "connect_consent_check(uuid)", "connect_consent_decide(uuid,boolean,text[])", "my_connected_ais()", "disconnect_ai(text)",
                           "admin_set_connect_access(text,boolean)", "admin_connect_allowlist_set(text,text,text,boolean)",
                           "admin_connect_set_enabled(boolean)", "admin_connect_revoke_all()",
                           # r9 render node: the person's own device sign-in page and computers (app session, own rows only, checked
                           # inside); Ryan's tester switch, its history and the storage view (each refuses everyone but an admin inside).
                           # The node_* functions are NOT here: they stay closed to anon and authenticated (node_runner only).
                           "device_request_check(text)", "device_decide(text,boolean)", "my_computers()", "remove_computer(uuid)",
                           "admin_set_local_compute(uuid,boolean,text)", "admin_set_local_compute_by_email(text,boolean,text)",
                           "admin_local_compute_audit()", "admin_storage_usage()",
                           # trust label on uploads (find-data S0, 20261026000200): the person's own upload, signed in, checked inside (owner and source);
                           # the third argument is the tick of "use it anyway" and the function refuses unless it is true
                           "confirm_dataset_mapping(uuid,jsonb,boolean)",
                           # the invite-only app download (20261026000500): the signed-in person lists their OWN links (time and file name only); request_app_download is the service role's alone
                           "my_app_downloads()",
                           # departments in the top bar (20261027000100): the signed-in INVITED person's own list and interest (checked inside); the counts refuse everyone but an admin inside
                           "my_departments()", "my_department_interests()", "register_department_interest(text)", "withdraw_department_interest(text)", "admin_department_interest_counts()",
                           # the live preview editor (20261027000400): the signed-in person's own editor, resolved from their app session and checked inside (the connector and the computer have their own functions)
                           "editor_apply_ops(uuid,text,bigint,jsonb)", "editor_undo(uuid,text,bigint)", "editor_undo_all_ai(uuid,text)", "my_edit_ops_since(uuid,text,bigint)", "editor_heartbeat(uuid,text)"}
            for fn in new:
                if fn in may_sign_in:
                    continue
                for role in ("authenticated", "anon"):
                    with self.subTest(fn=fn, role=role):
                        self.assertFalse(c.execute("select has_function_privilege(%s, %s::regprocedure, 'execute')", (role, fn)).fetchone()[0],
                                         f"{role} can run {fn}")
            for fn in ("ops_tick()", "ops_mark_notified(text[])", "ai_budget_ok(uuid)", "ops_outbox_add(text,text,text,text,text)", "ops_digest_data()"):
                self.assertIn(fn, new)
                self.assertTrue(c.execute("select has_function_privilege('service_role', %s::regprocedure, 'execute')", (fn,)).fetchone()[0], fn)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"drop database {name}")

    # -- the whole worker-offline path, end to end, in dry-run (Ryan, 2026-10-11):
    #    stale heartbeat -> banner -> ONE alert row in ops_outbox -> a digest line -> recovery clears it
    def bridge(self, payload):
        import json as _json
        import subprocess
        node = "node"
        root = core.ROOT.parent
        out = subprocess.run([node, str(root / "tests" / "ops_bridge.mjs")], input=_json.dumps(payload, default=str), capture_output=True,
                             text=True, cwd=str(root), timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return _json.loads(out.stdout)

    def run_tick(self):
        """The real ops_tick (SQL) -> the real ops-tick handler (TS) -> its mail goes to the REAL ops_outbox and the alerts are marked."""
        r = self.db.as_("service").one("select ops_tick()")
        b = self.bridge({"kind": "tick", "tick": r})
        for m in b["adds"]:
            self.db.as_("service").one("select ops_outbox_add(%s, %s, %s, %s, %s)", m["kind"], m["mode"], m["to"], m["subject"], m["body"])
        if b["marked"]:
            self.db.as_("service").one("select ops_mark_notified(%s)", b["marked"])
        return r, b

    def run_digest(self):
        d = self.db.as_("service").one("select ops_digest_data()")
        b = self.bridge({"kind": "digest", "data": d})
        for m in b["adds"]:
            self.assertTrue(self.db.as_("service").one("select ops_outbox_add(%s, %s, %s, %s, %s)", m["kind"], m["mode"], m["to"], m["subject"], m["body"]))
        return d, b

    def outbox(self, kind=None):
        sql = "select kind, mode, to_addr, subject, body from public.ops_outbox" + (" where kind = %s" if kind else "") + " order by id"
        return self.admin_all(sql, *([kind] if kind else []))

    def admin_all(self, sql, *args):
        return self.db.as_(None).all(sql, *args)

    def test_worker_goes_offline_banner_one_alert_in_the_outbox_a_digest_line_and_recovery_clears_it(self):
        self.make_ryan_admin()
        # 0. a healthy worker: no banner, no alert, no mail, a silent digest day
        self.ping()
        self.assertEqual(self.bridge({"kind": "banner", "status": self.status()})["banner"], None)
        r, b = self.run_tick()
        self.assertEqual((r["rendering"], r["new_alerts"], b["adds"]), ("ok", [], []))
        d, bd = self.run_digest()
        self.assertEqual((d["actionable"], bd["adds"], bd["response"]["sent"]), (False, [], False))
        # 1. the heartbeat goes stale (the PC sleeps): status -> delayed, and the app shows the banner
        self.ping("10 minutes")
        status = self.status()
        self.assertEqual(status["rendering"], "delayed")
        banner = self.bridge({"kind": "banner", "status": status})["banner"]
        self.assertRegex(banner, r"^Rendering is delayed\. The render machine last checked in at ")
        self.assertIn("give your credits back", banner)
        # 2. the tick raises ONE alert; the real ops-tick handler turns it into ONE dry-run message in the REAL ops_outbox
        r, b = self.run_tick()
        self.assertEqual([a["key"] for a in r["new_alerts"]], ["worker_stale"])
        self.assertEqual((b["response"]["alerts"], b["response"]["notified"], b["mode"]), (1, 1, "dry_run"))
        rows = self.outbox("alert")
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0][1], rows[0][2]), ("dry_run", "ryagram@uselai.com"))                    # NOT sent: recorded only
        self.assertIn("has not checked in", rows[0][3])
        self.assertIsNotNone(self.admin("select notified_at from public.ops_alerts where key = 'worker_stale'"))
        # 3. still down: more ticks make NO second alert row and no second mail
        for _ in range(3):
            r, b = self.run_tick()
            self.assertEqual((r["new_alerts"], b["adds"]), ([], []))
        self.assertEqual(len(self.outbox("alert")), 1)
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = 'worker_stale'"), 1)
        # 4. the daily digest has a line for it, goes to the outbox once, and is not repeated the same day
        d, bd = self.run_digest()
        self.assertEqual(d["actionable"], True)
        self.assertEqual(d["rendering"], "delayed")
        self.assertEqual(bd["response"], {"sent": True, "mode": "dry_run"})
        digests = self.outbox("digest")
        self.assertEqual(len(digests), 1)
        self.assertIn("Rendering has not checked in", digests[0][4])
        self.assertIn("Rendering: delayed", digests[0][4])
        d2, bd2 = self.run_digest()
        self.assertEqual((bd2["response"]["sent"], bd2["adds"]), (False, []))
        self.assertEqual(len(self.outbox("digest")), 1)
        # 5. the worker comes back: the banner goes, the alert clears, and the next digest is silent (it lists it as recovered only
        #    alongside a real item, so with nothing else open it sends nothing)
        self.ping()
        self.assertEqual(self.bridge({"kind": "banner", "status": self.status()})["banner"], None)
        r, b = self.run_tick()
        self.assertEqual((r["rendering"], r["new_alerts"], b["adds"]), ("ok", [], []))
        self.assertIsNotNone(self.admin("select resolved_at from public.ops_alerts where key = 'worker_stale'"))
        d3 = self.db.as_("service").one("select ops_digest_data()")
        self.assertEqual((d3["actionable"], d3["items"]), (False, []))
        # 6. and a NEW outage is a new incident: one more alert row and one more mail
        self.ping("10 minutes")
        r, b = self.run_tick()
        self.assertEqual([a["key"] for a in r["new_alerts"]], ["worker_stale"])
        self.assertEqual(len(self.outbox("alert")), 2)
        # 7. Ryan's view: the Operations summary shows it too
        ops = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual(ops["rendering"], "delayed")
        self.assertTrue(any(a["key"] == "worker_stale" for a in ops["open_alerts"]))
        self.assertEqual([o["mode"] for o in ops["outbox"]], ["dry_run"] * len(ops["outbox"]))              # nothing was ever sent live

    # -- CC1's second review (bb56101): report keys, restored/removed pages, permanent removal
    def headers(self, c, **h):
        import json as _json
        c.execute("select set_config('request.headers', %s, false)", (_json.dumps(h),))

    def test_a_forged_first_forwarded_hop_cannot_reset_the_report_limits(self):
        self.publish_page()
        c = self.db.as_("anon").c
        for i in range(5):                                                       # the client writes the FIRST hop; our proxy appends the last
            self.headers(c, **{"x-forwarded-for": f"198.51.100.{i}, 203.0.113.9"})
            c.execute("select report_film_page(%s, 'other', %s)", (SLUG, f"a{i}@x.co"))
        self.headers(c, **{"x-forwarded-for": "198.51.100.99, 203.0.113.9"})
        with self.assertRaisesRegex(psycopg.Error, "Too many"):
            c.execute("select report_film_page(%s, 'other', 'b@x.co')", (SLUG,))
        self.assertEqual(self.admin("select count(distinct reporter_key) from public.abuse_reports"), 1)
        # Cloudflare's header wins over anything in x-forwarded-for
        self.db.as_(None).c.execute("delete from public.abuse_reports")
        for i in range(5):
            self.headers(c, **{"cf-connecting-ip": "203.0.113.50", "x-forwarded-for": f"10.0.0.{i}, 203.0.113.9"})
            c.execute("select report_film_page(%s, 'other', %s)", (SLUG, f"c{i}@x.co"))
        self.headers(c, **{"cf-connecting-ip": "203.0.113.50", "x-forwarded-for": "10.9.9.9, 203.0.113.1"})
        with self.assertRaisesRegex(psycopg.Error, "Too many"):
            c.execute("select report_film_page(%s, 'other', 'd@x.co')", (SLUG,))

    def test_child_safety_reports_are_never_blocked_by_the_global_caps(self):
        self.publish_page()
        self.admin("insert into public.abuse_reports (slug, reason, reporter_email, reporter_key) "
                   "select %s, 'other', 'f' || g || '@x.co', 'k' || g from generate_series(1, 30) g returning 1", SLUG)
        c = self.db.as_("anon").c
        with self.assertRaisesRegex(psycopg.Error, "Too many"):
            c.execute("select report_film_page(%s, 'harassment', 'late@x.co')", (SLUG,))
        c.execute("select report_film_page(%s, 'child_safety', 'brave@x.co', 'please look')", (SLUG,))
        self.assertEqual(self.page(), (False, True))                                          # accepted AND the page is held
        self.db.as_(None).c.execute("update public.film_pages set held_at = null, published = true")
        self.admin("insert into public.abuse_reports (slug, reason, reporter_email, reporter_key, auto_held, created_at) "
                   "select %s, 'harassment', 'h' || g || '@x.co', 'h' || g, true, now() - interval '2 hours' from generate_series(1, 10) g returning 1", SLUG)
        self.admin("update public.abuse_reports set created_at = now() - interval '10 minutes' where reporter_key like 'h%%' returning 1")
        self.db.as_(None).c.execute("delete from public.abuse_reports where reporter_key like 'k%%'")                  # only the hold cap is in play
        c.execute("select report_film_page(%s, 'child_safety', 'brave2@x.co')", (SLUG,))
        self.assertEqual(self.page(), (False, True))                                          # 10 holds an hour: child safety is still held

    def test_a_page_ryan_restored_is_not_auto_held_again_and_a_review_is_final(self):
        self.make_ryan_admin()
        self.publish_page()
        c = self.db.as_("anon").c
        c.execute("select report_film_page(%s, 'copyright', 'one@x.co')", (SLUG,))
        rid = self.admin("select id from public.abuse_reports")
        self.db.as_(RYAN).one("select admin_review_report(%s, 'restored')", rid)
        with self.assertRaisesRegex(psycopg.Error, "already reviewed"):
            self.db.as_(RYAN).one("select admin_review_report(%s, 'removed')", rid)               # one decision per report
        self.db.as_(RYAN).one("select admin_ops()")
        self.admin("update public.film_pages set published = true where slug = %s returning 1", SLUG)
        c.execute("select report_film_page(%s, 'harassment', 'two@x.co')", (SLUG,))
        self.assertEqual(self.page(), (True, False))                                          # queued for review, NOT hidden again
        self.assertEqual(self.admin("select auto_held from public.abuse_reports order by id desc limit 1"), False)

    def test_a_removed_page_stays_removed_whatever_happens_to_other_reports_on_it(self):
        self.make_ryan_admin()
        self.publish_page()
        c = self.db.as_("anon").c
        c.execute("select report_film_page(%s, 'copyright', 'one@x.co')", (SLUG,))
        c.execute("select report_film_page(%s, 'other', 'two@x.co')", (SLUG,))
        first, second = [r[0] for r in self.db.as_(None).all("select id from public.abuse_reports order by id")]
        self.db.as_(RYAN).one("select admin_review_report(%s, 'removed')", first)
        self.assertEqual(self.admin("select count(*) from public.abuse_reports where reviewed_at is null"), 0)   # the other report was settled with it
        with self.assertRaisesRegex(psycopg.Error, "already reviewed"):
            self.db.as_(RYAN).one("select admin_review_report(%s, 'dismissed')", second)            # the click order CC1 probed now refuses
        self.assertEqual(self.page(), (False, True))
        self.admin("update public.film_pages set published = true where slug = %s returning 1", SLUG)
        self.assertEqual(self.page(), (False, True))                                          # the owner cannot republish it
        c.execute("select report_film_page(%s, 'other', 'three@x.co')", (SLUG,))              # a LATER report dismissed or restored does not lift it either
        third = self.admin("select max(id) from public.abuse_reports")
        self.db.as_(RYAN).one("select admin_review_report(%s, 'restored')", third)
        self.assertEqual(self.page(), (False, True))
        self.assertIsNotNone(self.admin("select removed_at from public.film_pages where slug = %s", SLUG))

    def test_dismissing_one_report_does_not_lift_a_hold_while_another_report_on_the_page_is_open(self):
        self.make_ryan_admin()
        self.publish_page()
        self.admin("update public.ops_settings set abuse_hide_per_reporter_day = 5 returning 1")
        c = self.db.as_("anon").c
        c.execute("select report_film_page(%s, 'harassment', 'one@x.co')", (SLUG,))
        c.execute("select report_film_page(%s, 'other', 'two@x.co')", (SLUG,))
        first, second = [r[0] for r in self.db.as_(None).all("select id from public.abuse_reports order by id")]
        self.db.as_(RYAN).one("select admin_review_report(%s, 'dismissed')", second)
        self.assertEqual(self.page(), (False, True))                                          # report 1 is still open: still held
        self.db.as_(RYAN).one("select admin_review_report(%s, 'dismissed')", first)
        self.assertEqual(self.page(), (False, False))                                         # nothing open any more: the hold lifts

    def test_back_to_normal_does_not_list_answered_tickets_or_reports(self):
        self.make_ryan_admin()
        n = self.db.as_("anon").one("select submit_support('a@x.co', 'other', 'hello there', null)")
        self.db.as_(RYAN).one("select admin_answer_support(%s)", n)
        self.assertEqual(self.db.as_("service").one("select ops_digest_data()")["recovered"], [])

    def test_an_alert_from_an_earlier_period_is_resolved_even_when_this_periods_spend_is_unchanged(self):
        self.db.as_(None).c.execute("insert into public.ops_alerts (key, detail) values ('ai_day_80:2020-01-01', 'old'), ('ai_month_100:2020-01', 'old')")
        self.db.as_("service").one("select ops_tick()")
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where resolved_at is null and key like 'ai%%'"), 0)

    # -- CHILD SAFETY (Ryan, 2026-10-12): always recorded, URGENT alert at once, auto-hide capped per hour site-wide
    def publish_many(self, n):
        slugs = []
        for i in range(n):
            _, vid = self.project_with_version()
            slug = f"{chr(65 + i)}" * 22
            self.admin("insert into public.film_pages (version_id, owner_id, slug, title, summary) values (%s, %s, %s, 'T', %s::jsonb) returning 1", vid, RYAN, slug, SUMMARY)
            slugs.append(slug)
        return slugs

    def page_of(self, slug):
        return self.admin("select published, held_at is not null from public.film_pages where slug = %s", slug)

    def test_child_safety_hides_pages_only_up_to_the_hourly_cap_but_always_records_and_always_alerts_urgently(self):
        self.assertEqual(self.admin("select child_safety_holds_per_hour from public.ops_settings"), 10)         # the default Ryan chose
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 2 returning 1")
        a, b, c = self.publish_many(3)
        anon = self.db.as_("anon").c
        for i, slug in enumerate((a, b, c)):
            anon.execute("select report_film_page(%s, 'child_safety', %s, 'details')", (slug, f"r{i}@x.co"))
        self.assertEqual([self.page_of(a), self.page_of(b), self.page_of(c)], [(False, True), (False, True), (True, False)])   # the third is queued, NOT hidden
        self.assertEqual(self.admin("select count(*) from public.abuse_reports where reason = 'child_safety'"), 3)           # all three recorded
        rows = self.db.as_(None).all("select key, detail from public.ops_alerts where key like 'urgent:%%' order by key")
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r[1].startswith("URGENT: child-safety report #") for r in rows))
        self.assertIn("HIDDEN pending your review", rows[0][1])
        self.assertIn("NOT hidden", rows[2][1])
        self.assertIn("hourly cap on automatic hiding (2) is reached", rows[2][1])
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'abuse:%%'"), 0)         # no second, ordinary alert for the same report
        new = self.db.as_("service").one("select ops_tick()")["new_alerts"]
        self.assertEqual([x["urgent"] for x in new[:3]], [True, True, True])                                         # urgent ones come first, flagged

    def test_child_safety_reports_are_recorded_even_from_one_caller_past_every_per_caller_limit(self):
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 100 returning 1")
        slugs = self.publish_many(8)
        c = self.db.as_("anon").c
        self.headers(c, **{"cf-connecting-ip": "203.0.113.77"})
        for slug in slugs:                                                                  # eight reports from ONE caller: ordinary reports stop at five
            c.execute("select report_film_page(%s, 'child_safety', 'same@x.co')", (slug,))
        self.assertEqual(self.admin("select count(*) from public.abuse_reports where reason = 'child_safety'"), 8)
        self.assertEqual(self.admin("select count(*) from public.film_pages where held_at is not null"), 8)

    def test_a_cap_of_zero_never_hides_automatically_but_still_records_and_alerts(self):
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 0 returning 1")
        (a,) = self.publish_many(1)
        self.db.as_("anon").c.execute("select report_film_page(%s, 'child_safety', 'r@x.co')", (a,))
        self.assertEqual(self.page_of(a), (True, False))
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'urgent:child_safety:%%' and detail like '%%NOT hidden%%'"), 1)

    def test_the_hourly_hold_cap_counts_child_safety_holds_only_and_old_holds_age_out(self):
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 1 returning 1")
        a, b, c = self.publish_many(3)
        self.admin("insert into public.abuse_reports (slug, reason, reporter_email, reporter_key, auto_held) "
                   "select %s, 'harassment', 'h' || g || '@x.co', 'h' || g, true from generate_series(1, 20) g returning 1", a)   # ordinary holds do not count
        anon = self.db.as_("anon").c
        anon.execute("select report_film_page(%s, 'child_safety', 'one@x.co')", (a,))
        self.assertEqual(self.page_of(a), (False, True))
        anon.execute("select report_film_page(%s, 'child_safety', 'two@x.co')", (b,))
        self.assertEqual(self.page_of(b), (True, False))                                    # the cap of 1 an hour is used
        self.admin("update public.abuse_reports set created_at = now() - interval '2 hours' where reason = 'child_safety' returning 1")
        anon.execute("select report_film_page(%s, 'child_safety', 'three@x.co')", (c,))
        self.assertEqual(self.page_of(c), (False, True))                                    # an hour later the cap has room again

    def test_ryans_screen_and_review_know_about_child_safety_reports(self):
        self.make_ryan_admin()
        self.admin("update public.ops_settings set child_safety_holds_per_hour = 1 returning 1")
        a, b = self.publish_many(2)
        anon = self.db.as_("anon").c
        anon.execute("select report_film_page(%s, 'child_safety', 'one@x.co')", (a,))
        anon.execute("select report_film_page(%s, 'child_safety', 'two@x.co')", (b,))
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual(plain(d["child_safety"]), {"open": 2, "open_not_hidden": 1, "holds_this_hour": 1, "holds_cap": 1})
        self.assertEqual(self.db.as_("service").one("select ops_digest_data()")["actionable"], True)
        ids = [r[0] for r in self.db.as_(None).all("select id from public.abuse_reports order by id")]
        for rid in ids:
            self.db.as_(RYAN).one("select admin_review_report(%s, 'dismissed')", rid)
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'urgent:%%' and resolved_at is null"), 0)
        self.assertEqual(self.db.as_("service").one("select ops_digest_data()")["recovered"], [])          # an answered urgent alert is not "back to normal"
        self.assertEqual(plain(self.db.as_(RYAN).one("select admin_ops()")["child_safety"])["open"], 0)

    # -- Stripe payments that need review (Phase 2B's stripe_events, read dynamically)
    STRIPE_TABLE = ("create table public.stripe_events (event_id text primary key, type text not null, livemode boolean not null, "
                    "outcome text not null, detail text, owner_id uuid, received_at timestamptz not null default now())")

    def test_stripe_review_is_unavailable_until_the_table_exists_then_lists_counts_alerts_once_and_clears_when_reviewed(self):
        self.make_ryan_admin()
        d = self.db.as_(RYAN).one("select admin_ops()")
        self.assertEqual(plain(d["stripe"]), {"available": False, "open": 0, "items": []})        # no stripe_events yet: nothing breaks
        self.assertEqual([a["key"] for a in self.tick()["new_alerts"]], [])
        self.db.as_(None).c.execute(self.STRIPE_TABLE)
        for i, (outcome, detail) in enumerate((("needs_review", "Paid for an unknown pack: pack_x."), ("needs_review", "Checkout has no Ryagram user."),
                                               ("applied", None), ("ignored", None), ("refused_live", None))):
            self.admin("insert into public.stripe_events (event_id, type, livemode, outcome, detail) values (%s, 'checkout.session.completed', false, %s, %s) returning 1", f"evt_a{i}", outcome, detail)
        st = self.db.as_(RYAN).one("select admin_ops()")["stripe"]
        self.assertEqual((st["available"], st["open"], [e["event_id"] for e in st["items"]]), (True, 2, ["evt_a0", "evt_a1"]))
        self.assertEqual(st["items"][0]["detail"], "Paid for an unknown pack: pack_x.")
        new = self.tick()["new_alerts"]
        self.assertEqual([(a["key"], a["urgent"]) for a in new if a["key"] == "stripe_needs_review"], [("stripe_needs_review", False)])
        self.assertIn("2 Stripe payment events need review", [a["detail"] for a in new if a["key"] == "stripe_needs_review"][0])
        self.db.as_("service").one("select ops_mark_notified(%s)", ["stripe_needs_review"])
        self.assertEqual([a["key"] for a in self.tick()["new_alerts"]], [])                    # one alert, not one per tick
        self.db.as_(RYAN).one("select admin_ack_stripe('evt_a0')")
        self.db.as_(RYAN).one("select admin_ack_stripe('evt_a0')")                              # idempotent
        self.assertEqual(self.db.as_(RYAN).one("select admin_ops()")["stripe"]["open"], 1)
        self.tick()
        self.assertIn("1 Stripe payment events need review", self.admin("select detail from public.ops_alerts where key = 'stripe_needs_review'"))
        self.db.as_(RYAN).one("select admin_ack_stripe('evt_a1')")
        self.tick()
        self.assertIsNotNone(self.admin("select resolved_at from public.ops_alerts where key = 'stripe_needs_review'"))
        self.assertEqual(plain(self.db.as_(RYAN).one("select admin_ops()")["stripe"]), {"available": True, "open": 0, "items": []})
        self.admin("insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_later', 'invoice.paid', false, 'needs_review') returning 1")
        self.assertEqual([a["key"] for a in self.tick()["new_alerts"] if a["key"] == "stripe_needs_review"], ["stripe_needs_review"])   # a new incident alerts again

    def test_only_ryan_can_mark_a_payment_reviewed_and_only_with_a_real_event_id(self):
        self.make_ryan_admin()
        for who in (OTHER, "anon"):
            self.denied(who, "select admin_ack_stripe('evt_x1')")
        for bad in ("", "x1", "evt_", "evt_a b", "evt_x'; drop table"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(RYAN).one("select admin_ack_stripe(%s)", bad)
        for who in ("anon", RYAN, "service"):
            self.denied(who, "select * from public.ops_stripe_reviewed")


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
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 0)      # a 10-minute outage never cancels an hour-old backlog
        self.assertEqual(self.admin("select state::text from public.jobs where id = %s", job), "queued")
        self.admin("update public.workers set last_seen_at = now() - interval '2 hours' where name = 'ryan-pc' returning 1")
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 1)
        self.assertEqual(self.admin("select state::text, error_code, error_class::text from public.jobs where id = %s", job), ("failed", "queue_timeout", "infrastructure"))
        self.assertEqual(self.available(), 100)
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 0)      # nothing is refunded twice
        self.assertEqual(self.available(), 100)

    def test_a_started_job_is_not_cancelled_by_the_queue_timeout(self):
        self.grant(100)
        _, job = self.final("paired")
        self.admin("update public.jobs set created_at = now() - interval '2 hours', state = 'running' where id = %s returning 1", job)
        self.admin("update public.workers set last_seen_at = now() - interval '2 hours' where name = 'ryan-pc' returning 1")
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 0)



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

    def test_infrastructure_failures_retry_once_then_fail_and_refund(self):
        # retry once: two attempts in all (Ryan, 2026-10-17; PIPE-1 / JOB-CONTRACT-v1)
        job = self.held_final()
        self.assertEqual(self.claim(), job)
        self.assertEqual(self.db.as_(WORKER).one("select retry_job(%s, 'crash')", job), "queued")
        self.assertEqual(self.available(), 90)                                              # still held while it can still run
        self.assertEqual(self.claim(), job)
        self.assertEqual(self.db.as_(WORKER).one("select retry_job(%s, 'crash')", job), "failed")
        self.assertEqual(self.admin("select attempt, error_code from public.jobs where id = %s", job), (2, "crash"))
        self.assertEqual(self.available(), 100)


def plain(x):
    return json.loads(json.dumps(x))


def _usage(output_tokens, mid, model="claude-haiku-4-5"):
    # claude-haiku-4-5 output is $5 per million tokens: 200_000 output tokens = $1.00
    return json.dumps({"model": model, "message_id": mid, "input_tokens": 0, "output_tokens": output_tokens,
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

    def test_a_call_with_no_known_price_counts_at_the_most_expensive_price_and_alerts_once(self):
        self.caps(ai_daily_usd_cap=3.00, ai_project_cap_usd=100, ai_project_alert_usd=100)
        t = self.turn()
        self.svc("select ai_record_usage(%s, %s::jsonb)", t, _usage(200000, "m1", "claude-mystery-9"))
        self.assertIsNone(self.db.as_(None).one("select cost_usd from ai_usage where message_id = 'm1'"))     # recorded as unknown...
        # ...but counted at sonnet's $10 per million output tokens (the dearest known): 200,000 tokens = $2.00, not $0
        self.assertAlmostEqual(float(self.db.as_(None).one("select ryagram_private.ai_budget()->>'day_spent'")), 2.0, places=4)
        self.assertTrue(self.svc("select ai_budget_ok(%s)", t))
        for _ in range(3):
            self.svc("select ai_budget_ok(%s)", t)
        keys = [r[0] for r in self.db.as_(None).all("select key from public.ops_alerts where key like 'ai_price_missing%%'")]
        self.assertEqual(keys, ["ai_price_missing:claude-mystery-9"])                                       # ONE alert, however often
        self.svc("select ai_record_usage(%s, %s::jsonb)", t, _usage(100000, "m2", "claude-mystery-9"))       # $1.00 more = $3.00 = the cap
        self.assertFalse(self.svc("select ai_budget_ok(%s)", t))
        self.db.as_(None).one("insert into public.ai_prices values ('2026-10', 'claude-mystery-9', 1, 5, 0.1, 1.25, now()) returning 1")
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(self.db.as_(None).one("select count(*) from public.ops_alerts where key like 'ai_price_missing%%'"), 1)

    def test_cap_alerts_clear_when_the_period_turns_or_spend_falls_and_a_price_alert_clears_when_the_price_is_added(self):
        self.caps(ai_daily_usd_cap=1.00, ai_project_cap_usd=100, ai_project_alert_usd=100)
        t = self.turn()
        self.spend(t, 0.9, "m1")
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(self.alerts(), ["ai_day_80"])
        open_ = lambda: self.db.as_(None).one("select count(*) from public.ops_alerts where resolved_at is null and key like 'ai%%'")
        self.assertEqual(open_(), 1)
        self.db.as_(None).one("update ai_usage set created_at = now() - interval '2 days' returning 1")        # the day turned
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(open_(), 0)                                                                         # yesterday's 80% is not open any more
        self.spend(t, 0.9, "m2")
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(open_(), 1)
        self.caps(ai_daily_usd_cap=100)                                                                      # cap raised: spend is far under it
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(open_(), 0)
        self.svc("select ai_record_usage(%s, %s::jsonb)", t, _usage(1000, "m3", "claude-mystery-9"))
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(open_(), 1)
        self.db.as_(None).one("insert into public.ai_prices values ('2026-10', 'claude-mystery-9', 1, 5, 0.1, 1.25, now()) returning 1")
        self.svc("select ai_budget_ok(%s)", t)
        self.assertEqual(open_(), 0)

    def test_a_call_without_cache_token_counts_is_still_priced_and_a_dated_model_name_is_unpriced_not_free(self):
        self.caps(ai_project_cap_usd=100, ai_project_alert_usd=100)
        t = self.turn()
        u = json.dumps({"model": "claude-haiku-4-5", "message_id": "n1", "input_tokens": 1000, "output_tokens": 200})   # no cache fields at all
        spend = self.svc("select ai_record_usage(%s, %s::jsonb)", t, u)
        self.assertAlmostEqual(float(spend), (1000 * 1 + 200 * 5) / 1e6, places=6)                          # priced, not NULL
        self.svc("select ai_record_usage(%s, %s::jsonb)", t, _usage(200000, "n2", "claude-haiku-4-5-20251001"))
        self.assertIsNone(self.db.as_(None).one("select cost_usd from ai_usage where message_id = 'n2'"))      # unknown to ai_prices...
        self.assertGreaterEqual(float(self.db.as_(None).one("select ryagram_private.ai_budget()->>'day_spent'")), 2.0)   # ...but never counted as 0

if __name__ == "__main__":
    unittest.main()
