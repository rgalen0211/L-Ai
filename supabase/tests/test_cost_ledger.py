"""The cost ledger (migrations/20261016000100_cost_ledger.sql) on a local Postgres.

Same setup as test_2a_core.py. Run from the repo root, with TEMP/TMP pointing at D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_cost_ledger.py -v
"""
import calendar
import datetime
import json
import sys
import unittest
from decimal import Decimal
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
setUpModule = core.setUpModule

TABLES = ["cost_events", "cost_plans", "cost_rates", "cost_thresholds", "cost_sync_state"]


def ev(ref, amount=1.5, vendor="stripe", kind="stripe_fee", when="2026-10-16T16:00:00Z", **extra):
    """A cost event as the sync function sends it. It says live (livemode true) unless told otherwise; pass livemode=None to leave the flag out entirely."""
    e = {"occurred_at": when, "vendor": vendor, "kind": kind, "amount_usd": amount, "quantity": 10, "unit": "usd_gross", "ref": ref, "livemode": True, **extra}
    if e["livemode"] is None and "livemode" in extra:
        del e["livemode"]
    return e


class CostLedger(core.Base):
    project_with_version = core.Core.project_with_version
    run_job = core.Core.run_job
    claim = core.Core.claim
    ladder = core.Core.ladder

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def svc(self):
        return self.db.as_("service")

    def setUp(self):
        super().setUp()
        # Ryan's starting limits and the $0 render rate are seeded by the migration (tested on their own); every other test starts from a clean slate.
        if "seed" not in self._testMethodName:
            self.db.as_(None).c.execute("delete from public.cost_thresholds")
            self.db.as_(None).c.execute("delete from public.cost_rates")

    def ryan(self):
        return self.db.as_(RYAN)          # (one shared connection: every call must pick its role again)

    def make_ryan_admin(self):
        self.admin("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com' returning 1")

    def record(self, *events):
        return self.svc().one("select cost_record_events(%s::jsonb)", json.dumps(list(events)))

    def rollup(self, days=14):
        return self.db.as_(RYAN).one("select admin_cost_rollup(%s)", days)

    def today(self):
        return self.admin("select (now() at time zone 'EST5EDT')::date")

    def finished(self):
        _, vid, sheet, prev = self.ladder()
        final = self.db.as_(RYAN).one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
        self.claim()
        self.run_job(final, ["final_video", "thumbnail", "receipt"])
        return vid, final

    # ---- who can touch what
    def test_the_tables_are_closed_to_everyone_and_the_functions_to_the_right_roles(self):
        self.make_ryan_admin()
        for table in TABLES:
            for who in ("anon", "service", RYAN, OTHER):
                with self.subTest(table=table, who=who):
                    self.denied(who, f"select * from public.{table}")
                    self.denied(who, f"delete from public.{table} returning 1")
            self.assertTrue(self.admin("select relrowsecurity from pg_class where oid = %s::regclass", f"public.{table}"))
        self.denied("service", "insert into public.cost_events (occurred_at, vendor, kind, ref) values (now(), 'stripe', 'stripe_fee', 'x') returning 1")
        for who in ("anon", RYAN, OTHER):                                      # even Ryan's signed-in browser cannot call the automatic writers
            for sql in ("select cost_record_events('[]'::jsonb)", "select cost_tick()", "select cost_ingest_render_meter('[]'::jsonb)",
                        "select cost_sync_get('x')", "select cost_sync_set('x', 'y')"):
                self.denied(who, sql)
        for who in ("anon", OTHER, "service"):                                 # and only Ryan can use the screen's functions
            for sql in ("select admin_cost_rollup(7)", "select admin_cost_set_threshold('stripe', 'day', 5, 80)", "select admin_cost_delete_threshold(1)",
                        "select admin_cost_set_plan('supabase', 'Pro', 25, (now() at time zone 'EST5EDT')::date, '{}')", "select admin_cost_set_rate('render', 'cpu_hour', 0.04, '')",
                        "select admin_cost_record('domain', 12, (now() at time zone 'EST5EDT')::date, 'x')"):
                with self.subTest(who=who, sql=sql[:40]):
                    self.denied(who, sql)
        self.assertEqual(self.admin("select count(*) from public.cost_events"), 0)

    # ---- Ryan's starting decisions, seeded as data
    def test_seed_ryans_starting_limits_alert_only_and_the_zero_cash_render_rate(self):
        self.make_ryan_admin()
        rows = self.db.as_(None).all("select vendor, period, limit_usd::float, warn_pct, enabled from public.cost_thresholds order by period")
        self.assertEqual(rows, [(None, "day", 5.0, 80, True), (None, "month", 50.0, 80, True)])     # $5 a day and $50 a month, every vendor, warn at 80%
        self.assertEqual(self.db.as_(None).all("select vendor, kind, unit_usd::float from public.cost_rates"), [("render", "cpu_hour", 0.0)])
        # alerts only: crossing a limit raises an ops alert and changes nothing else (no function here can pause, block or switch anything off)
        control_before = self.admin("select to_jsonb(c) from public.control c where id")
        self.record(ev("big", amount=6, when=f"{self.today()}T16:00:00Z"))
        self.svc().one("select cost_tick()")
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'cost:%%:over:%%' and resolved_at is null"), 1)
        self.assertEqual(self.admin("select to_jsonb(c) from public.control c where id"), control_before)          # the kill switches and AI settings are untouched
        # re-applying the migration's inserts changes nothing (and does not undo a limit Ryan edited)
        self.ryan().one("select admin_cost_set_threshold(null, 'day', 12, 90)")
        self.assertEqual(self.admin("select count(*), min(limit_usd)::float from public.cost_thresholds where period = 'day'"), (1, 12.0))
        # with the $0 rate a render is a KNOWN $0 (not unknown), priced from cpu seconds
        vid, final = self.finished()
        self.admin("update public.job_metering set cpu_user_s = 3000, cpu_kernel_s = 600 where job_id = %s returning 1", final)
        self.svc().one("select cost_tick()")
        self.assertEqual(float(self.admin("select amount_usd from public.cost_events where vendor = 'render'")), 0.0)

    # ---- recording
    def test_events_are_recorded_once_and_unknown_stays_unknown(self):
        self.assertEqual(self.record(ev("txn_1"), ev("txn_2", amount=None), ev("txn_3", vendor="resend", kind="email_sent", amount=None)), 3)
        self.assertEqual(self.record(ev("txn_1"), ev("txn_2", amount=None)), 0)                     # a repeat adds nothing
        self.assertEqual(self.admin("select count(*) from public.cost_events"), 3)
        self.assertIsNone(self.admin("select amount_usd from public.cost_events where ref = 'txn_2'"))        # NULL, not 0
        self.assertEqual(self.admin("select mode from public.cost_events where ref = 'txn_1'"), "live")        # said live, so live

    def test_bad_events_are_refused_whole(self):
        for bad in (ev("a", vendor="paypal"), ev("b", kind="Bad Kind!"), ev("c", amount=-1), ev("", amount=1), ev("d", when="not a time")):
            with self.subTest(bad=str(bad)[:50]), self.assertRaises(psycopg.Error):
                self.record(ev("ok-before"), bad)
        self.assertEqual(self.admin("select count(*) from public.cost_events"), 0)               # one bad row stops the whole call
        with self.assertRaises(psycopg.Error):
            self.svc().one("select cost_record_events('{}'::jsonb)")
        with self.assertRaises(psycopg.Error):
            self.record(*[ev(f"n{i}") for i in range(501)])

    def test_an_event_with_no_live_or_test_flag_is_UNKNOWN_mode_never_live_money_and_never_alarmed(self):
        """Ryan 2026-10-16: a cost event that arrives WITHOUT a live/test flag is recorded as unknown mode, never defaulted to live."""
        self.make_ryan_admin()
        today = self.today()
        tid = self.ryan().one("select admin_cost_set_threshold(null, 'day', 5, 80)")
        self.record(ev("m1", amount=500, livemode=None, when=f"{today}T16:00:00Z"),                       # no flag at all
                    ev("m2", amount=500, livemode="yes", when=f"{today}T16:00:00Z"),                      # not a real boolean
                    ev("m3", amount=500, livemode="true", when=f"{today}T16:00:00Z"),                     # a string is not a boolean either
                    ev("m4", amount=500, livemode=0, when=f"{today}T16:00:00Z"),
                    ev("m5", amount=500, livemode=None, vendor="resend", kind="x_other", when=f"{today}T16:00:00Z"),
                    ev("ok", amount=1, when=f"{today}T16:00:00Z"))
        modes = dict(self.db.as_(None).all("select ref, mode from public.cost_events"))
        self.assertEqual(modes, {"m1": "unknown", "m2": "unknown", "m3": "unknown", "m4": "unknown", "m5": "unknown", "ok": "live"})
        self.assertEqual(self.admin("select mode from public.cost_events where ref = 'm1'"), "unknown")
        self.svc().one("select cost_tick()")
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'cost:%%' and resolved_at is null"), 0)   # $2,500 of unknown-mode money: no alarm
        r = self.rollup()
        self.assertEqual(Decimal(str(r["days"][0]["total_usd"])), Decimal("1"))                           # only the one live dollar counts
        self.assertEqual(Decimal(str(r["month"]["total_usd"])), Decimal("1"))
        self.assertEqual((r["unknown_mode"]["events"], float(r["unknown_mode"]["total_usd"])), (5, 2500.0))   # shown apart, labelled
        self.assertEqual(r["thresholds"][0]["status"], "ok")
        self.assertEqual({x["mode"] for x in r["recent"]}, {"unknown", "live"})
        # the same transaction sent once with a flag and once without is two different records (the flag is part of its identity)
        self.record(ev("m1", amount=500, livemode=True, when=f"{today}T16:00:00Z"))
        self.assertEqual(self.admin("select count(*) from public.cost_events where ref = 'm1'"), 2)
        with self.assertRaises(psycopg.Error):
            self.admin("insert into public.cost_events (occurred_at, vendor, kind, ref, mode) values (now(), 'stripe', 'stripe_fee', 'bad', 'maybe') returning 1")
        self.assertEqual(self.admin("select column_default from information_schema.columns where table_name = 'cost_events' and column_name = 'mode'"), "'unknown'::text")

    # ---- the rollup
    def test_rollup_counts_unknown_separately_never_as_zero_and_keeps_test_money_apart(self):
        self.make_ryan_admin()
        today = self.today()
        self.record(ev("t1", amount=1.25, when=f"{today}T16:00:00Z"), ev("t2", amount=0.75, vendor="supabase", kind="plan_fee", when=f"{today}T16:00:00Z"),
                    ev("t3", amount=None, vendor="render", kind="render_compute", when=f"{today}T16:00:00Z"), ev("t5", amount=None, vendor="resend", kind="email_sent", when=f"{today}T16:00:00Z"),
                    ev("t4", amount=99, livemode=False, when=f"{today}T16:00:00Z"))            # Stripe TEST mode: shown, never counted as real money
        r = self.rollup()
        day = r["days"][0]
        self.assertEqual(day["day"], str(today))
        self.assertEqual(Decimal(str(day["total_usd"])), Decimal("2.00"))
        self.assertEqual(day["unknown_events"], 1)
        self.assertEqual({k: float(v) for k, v in day["by_vendor"].items()}, {"stripe": 1.25, "supabase": 0.75})
        self.assertEqual(Decimal(str(r["month"]["total_usd"])), Decimal("2.00"))
        self.assertEqual(r["month"]["unknown_events"], 1)
        self.assertEqual((r["test"]["events"], float(r["test"]["total_usd"])), (1, 99.0))
        self.assertEqual(len(r["days"]), 14)
        self.assertEqual(len(r["recent"]), 5)                                                 # (the email reading is not a charge, so it is not an "unknown cost")
        self.assertEqual(len(self.rollup(3)["days"]), 3)

    def test_days_are_new_york_days(self):
        """03:00 UTC on the 16th is 23:00 on the 15th in New York: it belongs to the 15th."""
        self.make_ryan_admin()
        self.record(ev("ny1", amount=2, when="2026-10-16T03:00:00Z"), ev("ny2", amount=3, when="2026-10-16T05:00:00Z"))
        self.assertEqual(sorted(self.db.as_(None).all("select day::text, sum(amount_usd)::float from ryagram_private.cost_events_day group by day")), [("2026-10-15", 2.0), ("2026-10-16", 3.0)])

    # ---- plan fees
    def test_a_plan_accrues_a_daily_share_once_and_a_new_plan_ends_the_old_one(self):
        self.make_ryan_admin()
        today = self.today()
        pid = self.ryan().one("select admin_cost_set_plan('supabase', 'Pro', 25, %s::date - 3, '{\"storage_gb\": 100}')", today)
        first = self.svc().one("select cost_tick()")
        self.assertEqual(first["plan_fee_rows"], 4)                                           # four days: today and the three before
        self.assertEqual(self.svc().one("select cost_tick()")["plan_fee_rows"], 0)           # running again adds nothing
        total = self.admin("select sum(amount_usd) from public.cost_events where vendor = 'supabase' and kind = 'plan_fee'")
        expected = sum(25 / calendar.monthrange((today - datetime.timedelta(days=i)).year, (today - datetime.timedelta(days=i)).month)[1] for i in range(4))
        self.assertAlmostEqual(float(total), expected, places=4)                               # $25 a month, split by the days of each month
        self.assertTrue(all(r[0] for r in self.db.as_(None).all("select mode = 'live' from public.cost_events where kind = 'plan_fee'")))
        self.ryan().one("select admin_cost_set_plan('supabase', 'Team', 599, %s::date, '{}')", today)
        plans = self.ryan().one("select admin_cost_rollup(1)")["plans"]
        self.assertEqual([(p["plan"], p["ends_on"]) for p in plans if p["vendor"] == "supabase"], [("Team", None)])          # the screen lists plans still running
        self.assertEqual(str(self.admin("select ends_on from public.cost_plans where plan = 'Pro'")), str(today - datetime.timedelta(days=1)))   # Pro ended the day before
        for bad in ("select admin_cost_set_plan('paypal', 'x', 1, (now() at time zone 'EST5EDT')::date, '{}')", "select admin_cost_set_plan('stripe', '', 1, (now() at time zone 'EST5EDT')::date, '{}')",
                    "select admin_cost_set_plan('stripe', 'x', -1, (now() at time zone 'EST5EDT')::date, '{}')", "select admin_cost_set_plan('stripe', 'x', 1, null, '{}')"):
            with self.assertRaises(psycopg.Error):
                self.ryan().one(bad)

    # ---- render compute from the worker's own metering
    def test_render_cost_is_unknown_until_ryan_states_a_rate_then_priced_from_cpu_seconds(self):
        self.make_ryan_admin()
        vid, final = self.finished()
        self.admin("update public.job_metering set cpu_user_s = 3000, cpu_kernel_s = 600 where job_id = %s returning 1", final)
        self.svc().one("select cost_tick()")
        row = self.admin("select amount_usd, quantity, unit, ref from public.cost_events where vendor = 'render'")
        self.assertIsNone(row[0])                                                             # no rate stated: UNKNOWN, not $0
        self.assertEqual((float(row[1]), row[2], row[3]), (3600.0, "cpu_s", f"job:{final}:1"))
        self.assertEqual(self.rollup()["days"][0]["unknown_events"] >= 1, True)
        self.db.as_(RYAN).one("select admin_cost_set_rate('render', 'cpu_hour', 0.04, 'placeholder: a cloud vCPU hour')")
        self.svc().one("select cost_tick()")
        row = self.admin("select amount_usd, detail ? 'priced_later_at' from public.cost_events where vendor = 'render'")
        self.assertEqual((float(row[0]), row[1]), (0.04, True))                              # 3600 cpu seconds = 1 core-hour
        self.svc().one("select cost_tick()")
        self.assertEqual(self.admin("select count(*) from public.cost_events where vendor = 'render'"), 1)    # still one event for the job

    def test_renders_jsonl_lines_are_taken_only_when_not_already_metered_and_without_double_counting(self):
        self.make_ryan_admin()
        self.db.as_(RYAN).one("select admin_cost_set_rate('render', 'cpu_hour', 0.10, '')")
        lines = [{"render_id": "roads-final-1", "finished_at": "2026-10-15T08:36:14Z", "wall_s": 1640.1, "cpu_user_s": 30000, "cpu_kernel_s": 6000},
                 {"render_id": "with-own-cost", "cost_usd": 0.5, "cpu_s": 100},
                 {"render_id": "app-job", "job_id": "3f9d6b7e-1111-4111-8111-111111111111", "cpu_s": 999},   # already in job_metering: skipped
                 {"cpu_s": 5},                                                                                   # no id: skipped
                 "not an object"]
        self.assertEqual(self.svc().one("select cost_ingest_render_meter(%s::jsonb)", json.dumps(lines)), 2)
        self.assertEqual(self.svc().one("select cost_ingest_render_meter(%s::jsonb)", json.dumps(lines)), 0)    # a repeat adds nothing
        rows = {r[0]: r for r in self.db.as_(None).all("select ref, amount_usd, quantity, unit from public.cost_events where vendor = 'render'")}
        self.assertEqual(float(rows["meter:roads-final-1"][1]), 1.0)                           # 36,000 cpu s = 10 core-hours x $0.10
        self.assertEqual(float(rows["meter:with-own-cost"][1]), 0.5)                           # the line's own cost wins
        with self.assertRaises(psycopg.Error):
            self.svc().one("select cost_ingest_render_meter('{}'::jsonb)")

    # ---- gauges
    def test_storage_and_email_gauges_and_the_storage_price_only_when_the_plan_is_known(self):
        self.make_ryan_admin()
        self.finished()
        stored = int(self.admin("select coalesce(sum(bytes), 0) from public.artifacts where deleted_at is null"))
        self.assertGreater(stored, 0)
        self.svc().one("select cost_tick()")
        row = self.admin("select amount_usd, quantity, unit from public.cost_events where kind = 'storage_gauge'")
        self.assertIsNone(row[0])                                                             # no plan stated: the price is UNKNOWN
        self.assertEqual((int(row[1]), row[2]), (stored, "bytes"))
        self.db.as_(RYAN).one("select admin_cost_set_plan('supabase', 'Pro', 25, (now() at time zone 'EST5EDT')::date, '{\"storage_gb\": 100}')")
        self.svc().one("select cost_tick()")
        self.assertEqual(float(self.admin("select amount_usd from public.cost_events where kind = 'storage_gauge'")), 0.0)    # well inside 100 GB: known, $0
        self.assertEqual(self.admin("select count(*) from public.cost_events where kind = 'storage_gauge'"), 1)               # one gauge row per day, updated
        # emails: only live rows of our own ops mail count; dry-run rows are not sends
        self.admin("insert into public.ops_outbox (kind, mode, to_addr, subject, body) values ('alert', 'dry_run', 'a@b.co', 's', 'b') returning 1")
        self.admin("insert into public.ops_outbox (kind, mode, to_addr, subject, body) values ('alert', 'live', 'a@b.co', 's', 'b'), ('ack', 'live', 'a@b.co', 's', 'b') returning 1")
        self.assertEqual(self.svc().one("select cost_tick()")["emails_today"] >= 0, True)
        row = self.admin("select quantity, amount_usd, unit from public.cost_events where kind = 'email_sent' and ref = 'day:' || (now() at time zone 'EST5EDT')::date::text")
        self.assertEqual((int(row[0]), row[1], row[2]), (2, None, "emails"))                  # 2 live sends; the cost is the plan fee, not a per-email guess
        usage = self.rollup()["usage"]
        self.assertEqual((int(usage["emails_today"]), int(usage["storage_bytes"])), (2, stored))
        self.assertEqual(self.rollup()["days"][0]["unknown_events"], 0)                        # readings are not unknown charges

    # ---- thresholds and alarms
    def test_thresholds_alarm_once_per_period_clear_when_the_period_ends_and_ignore_test_money(self):
        self.make_ryan_admin()
        today = self.today()
        tid = self.ryan().one("select admin_cost_set_threshold('stripe', 'day', 10, 80)")
        self.ryan().one("select admin_cost_set_threshold(null, 'month', 100, 50)")
        alerts = lambda: sorted(r[0] for r in self.db.as_(None).all("select key from public.ops_alerts where key like 'cost:%%' and resolved_at is null"))
        self.record(ev("s1", amount=7, when=f"{today}T16:00:00Z"))
        self.svc().one("select cost_tick()")
        self.assertEqual(alerts(), [])                                                         # $7 of $10 is under 80%
        self.record(ev("s2", amount=1.5, when=f"{today}T16:00:00Z"))
        self.svc().one("select cost_tick()")
        self.assertEqual(alerts(), [f"cost:{tid}:warn:{today}"])                               # $8.50: warning
        self.assertEqual(self.svc().one("select cost_tick()")["alarms_raised"], 0)             # not raised again
        self.record(ev("s3", amount=2, when=f"{today}T16:00:00Z"), ev("test-money", amount=500, livemode=False, when=f"{today}T16:00:00Z"))
        self.svc().one("select cost_tick()")
        keys = alerts()
        self.assertIn(f"cost:{tid}:over:{today}", keys)                                        # $10.50: over
        self.assertNotIn(f"cost:{tid}:warn:{today}", keys)                                     # the warning is replaced by the over-limit alarm
        self.assertTrue(all(k.startswith(f"cost:{tid}:") for k in keys))                       # only the day limit fired: $500 of TEST money never counted toward the monthly one
        detail = self.admin("select detail from public.ops_alerts where key = %s", f"cost:{tid}:over:{today}")
        self.assertRegex(detail, r"over your \$10\.00 limit")
        # the over-limit alert is an ordinary ops alert, so ops_tick emails it once and #/admin/ops lists it
        self.assertTrue(any("Cost alarm" in a["detail"] for a in self.ryan().one("select admin_ops()")["open_alerts"]))
        # raising the limit clears it at once; deleting the threshold clears everything of it
        self.ryan().one("select admin_cost_set_threshold('stripe', 'day', 50, 80)")
        self.assertEqual([k for k in alerts() if k.startswith(f"cost:{tid}:")], [])
        self.ryan().one("select admin_cost_set_threshold('stripe', 'day', 10, 80)")
        self.assertIn(f"cost:{tid}:over:{today}", alerts())
        self.ryan().one("select admin_cost_delete_threshold(%s)", tid)
        self.assertEqual([k for k in alerts() if k.startswith(f"cost:{tid}:")], [])

    def test_a_past_days_alarm_does_not_linger(self):
        self.make_ryan_admin()
        tid = self.db.as_(RYAN).one("select admin_cost_set_threshold('stripe', 'day', 1, 80)")
        self.admin("insert into public.ops_alerts (key, detail) values (%s, 'Cost alarm: old') returning 1", f"cost:{tid}:over:2026-01-01")
        self.svc().one("select cost_tick()")
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = %s and resolved_at is null", f"cost:{tid}:over:2026-01-01"), 0)

    def test_unknown_costs_are_named_in_the_alarm_and_never_counted_as_zero_or_as_a_guess(self):
        self.make_ryan_admin()
        today = self.today()
        tid = self.db.as_(RYAN).one("select admin_cost_set_threshold(null, 'day', 5, 80)")
        self.record(ev("u1", amount=6, when=f"{today}T16:00:00Z"), ev("u2", amount=None, vendor="render", kind="render_compute", when=f"{today}T16:00:00Z"))
        self.svc().one("select cost_tick()")
        self.assertRegex(self.admin("select detail from public.ops_alerts where key = %s", f"cost:{tid}:over:{today}"), r"1 events have an unknown cost and are not counted")

    def test_threshold_and_manual_cost_inputs_are_validated(self):
        self.make_ryan_admin()
        d = self.ryan()
        for bad in ("select admin_cost_set_threshold('stripe', 'week', 5, 80)", "select admin_cost_set_threshold('stripe', 'day', 0, 80)",
                    "select admin_cost_set_threshold('stripe', 'day', 5, 100)", "select admin_cost_set_threshold('paypal', 'day', 5, 80)",
                    "select admin_cost_record('domain', -5, (now() at time zone 'EST5EDT')::date, '')", "select admin_cost_record('domain', 5, (now() at time zone 'EST5EDT')::date + 30, '')",
                    "select admin_cost_record('paypal', 5, (now() at time zone 'EST5EDT')::date, '')", "select admin_cost_set_rate('render', 'Bad Kind', 1, '')"):
            with self.assertRaises(psycopg.Error):
                d.one(bad)
        d.one("select admin_cost_record('domain', 14.99, (now() at time zone 'EST5EDT')::date, 'uselai.com renewal')")
        row = self.admin("select vendor, kind, amount_usd, mode = 'live', detail->>'source' from public.cost_events")
        self.assertEqual((row[0], row[1], float(row[2]), row[3], row[4]), ("domain", "manual_invoice", 14.99, True, "typed by Ryan"))
        self.assertEqual(float(self.rollup()["month"]["by_vendor"]["domain"]), 14.99)

    def test_the_sync_bookmark_is_kept(self):
        self.assertIsNone(self.svc().one("select cost_sync_get('stripe')"))
        self.svc().one("select cost_sync_set('stripe', '1760000000')")
        self.svc().one("select cost_sync_set('stripe', '1760000999')")
        self.assertEqual(self.svc().one("select cost_sync_get('stripe')"), "1760000999")


if __name__ == "__main__":
    unittest.main()
