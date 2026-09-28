"""The 2B credits ledger (supabase/phase-2b/credits_ledger.sql) on a local Postgres.

Same setup as test_2a_core.py. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_2b_credits.py -v

Covers the spec's 2B-1 and 2B-2 acceptance tests and the Test drill items that touch
credits: 3, 4, 5, 6, 7, 8, 9, 10, 11, 18 (held prices), 19 (grants), 20, 21.
"""
import json
import sys
import tempfile
import threading
import unittest
import uuid
from pathlib import Path

import pgserver
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402  (reuses Db, the ids and the 2A file list)

ROOT = core.ROOT
LEDGER = ROOT / "phase-2b" / "credits_ledger.sql"
RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
_server = None
_count = 0


def story(*views, dataset="test_standard"):
    return json.dumps({"schema": 1, "engine": "sequence", "name": "t",
                       "sequence": {"clips": [{"kind": "render", "view": v, "dataset": dataset} for v in views]}})


def setUpModule():
    global _server
    _server = pgserver.get_server(tempfile.mkdtemp(prefix="ryagram-2b-"), cleanup_mode="stop")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmpl2b")
        c.execute("create database tmpl2b")
    with psycopg.connect(_server.get_uri(database="tmpl2b"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in [*core.MIGRATIONS, LEDGER]:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s,'ryan@x'),(%s,'other@x'),(%s,'worker@x'),(%s,'worker2@x')",
                  (RYAN, OTHER, WORKER, WORKER2))
        c.execute("insert into public.workers (user_id, name) values (%s, 'ryan-pc'), (%s, 'spare')", (WORKER, WORKER2))
        c.execute("insert into public.credit_dataset_shapes (dataset, shape, noted_by) values "
                  "('test_standard', 'standard', 'test'), ('test_path', 'path', 'test'), ('test_flows', 'flows', 'test')")


class Ledger(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"l{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template tmpl2b")
        self.db = core.Db(_server.get_uri(database=self.name))

    def tearDown(self):
        self.db.c.close()

    # -- helpers
    def denied(self, who, sql, *args):
        with self.assertRaises(psycopg.Error):
            self.db.as_(who).one(sql, *args)

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def grant(self, n, who=RYAN, entry="grant", **kw):
        return self.db.as_("service").one(
            "select grant_credits(%s, %s, %s, 'test grant', 'admin:test', %s, %s, %s)",
            who, entry, n, kw.get("event"), kw.get("period"), kw.get("code"))

    def available(self, who=RYAN, pool=None):
        sql = "select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s" + (" and pool = %s" if pool else "")
        return self.admin(sql, *([who, pool] if pool else [who]))

    def version(self, *views, who=RYAN, title_only=False, dataset="test_standard"):
        views = () if title_only else (views or ("map",))
        d = self.db.as_(who)
        pid = d.one("insert into projects (title) values ('p') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        d.one("update versions set story_spec = %s::jsonb where id = %s returning id", story(*views, dataset=dataset), vid)
        return vid

    def submit(self, vid, kind, *ladder, who=RYAN):
        args = (vid, kind, "{}", *ladder) if ladder else (vid, kind)
        sql = "select id from submit_job(%s, %s, %s, %s, %s)" if ladder else "select id from submit_job(%s, %s)"
        return self.db.as_(who).one(sql, *args)

    def settle(self, job, state, error_class=None):
        self.admin("update jobs set state = %s, error_class = %s, ended_at = now() where id = %s returning 1",
                   state, error_class, job)

    def final(self, *views, grant=None, title_only=False, dataset="test_standard"):
        """A version with a completed sheet and preview, and its final render submitted."""
        if grant:
            self.grant(grant)
        vid = self.version(*views, title_only=title_only, dataset=dataset)
        sheet = self.submit(vid, "contact_sheet"); self.settle(sheet, "complete")
        prev = self.submit(vid, "preview"); self.settle(prev, "complete")
        return vid, self.submit(vid, "final_render", sheet, prev)

    # -- 2B-1 acceptance: grant 100, hold 10 -> 90, fail -> 100, success -> 90, nothing mutated
    def test_2b1_hold_release_capture(self):
        self.grant(100)
        _, job = self.final("paired")
        self.assertEqual(self.available(), 90)
        self.settle(job, "failed", "infrastructure")
        self.assertEqual(self.available(), 100)
        _, job2 = self.final("paired")
        self.assertEqual(self.available(), 90)
        self.settle(job2, "complete")
        self.assertEqual(self.available(), 90)
        rows = self.admin("select count(*) from credit_ledger")
        for stmt in ("update credit_ledger set amount = 1", "delete from credit_ledger", "truncate credit_ledger"):
            self.denied(None, stmt)
            self.denied("service", stmt)
        self.assertEqual(self.admin("select count(*) from credit_ledger"), rows)

    # -- Test 3: a new account has nothing and no path to credits from the browser
    def test_new_account_starts_empty_and_cannot_grant_itself(self):
        self.assertEqual(self.available(), 0)
        self.denied(RYAN, "select grant_credits(%s, 'grant', 100, 'x', 'me')", RYAN)
        self.denied(RYAN, "insert into credit_ledger (owner_id, entry, pool, amount, reason, created_by) "
                          "values (%s, 'grant', 'granted', 100, 'x', 'me') returning id", RYAN)
        self.denied(RYAN, "select adjust_credits(%s, 'granted', 5, 'x', 'me')", RYAN)
        self.denied(WORKER, "select grant_credits(%s, 'grant', 100, 'x', 'me')", WORKER)

    # -- Tests 4 and 5: a purchase is granted once however often the webhook repeats
    def test_purchase_webhook_replay_grants_once(self):
        for _ in range(4):
            self.grant(10, entry="purchase", event="evt_starter_1", code="pack_starter")
        self.assertEqual(self.available(), 10)
        self.assertEqual(self.admin("select count(*) from credit_ledger where entry = 'purchase'"), 1)

    # -- Test 6: contact sheets are free, and the job still records its price
    def test_contact_sheet_is_free_and_quoted(self):
        vid = self.version()
        job = self.submit(vid, "contact_sheet")
        self.assertEqual(self.admin("select price_code, credits_quoted, hold_id from jobs where id = %s", job),
                         ("contact_sheet", 0, None))
        self.assertEqual(self.admin("select count(*) from credit_ledger"), 0)

    # -- Test 7 and 2B-2: 6 free per project AND 15 free per rolling 24 h; new projects don't bypass it
    def test_preview_allowance(self):
        self.grant(100)
        charged = free = 0
        for _ in range(10):                          # 2B-2: ten projects, six previews each
            vid = self.version()
            for _ in range(6):
                job = self.submit(vid, "preview")
                is_free, quoted = self.admin("select free_preview, credits_quoted from jobs where id = %s", job)
                free += is_free
                charged += quoted
                self.settle(job, "complete")
        self.assertEqual((free, charged), (15, 45))
        self.assertEqual(self.available(), 100 - 45)

    def test_seventh_preview_in_a_project_costs_one(self):
        self.grant(5)
        vid = self.version()
        for _ in range(6):
            job = self.submit(vid, "preview"); self.settle(job, "complete")
        self.assertEqual(self.available(), 5)
        seventh = self.submit(vid, "preview")
        self.assertEqual(self.admin("select price_code, credits_quoted from jobs where id = %s", seventh), ("preview_extra", 1))
        self.assertEqual(self.available(), 4)

    def test_allowance_rolls_and_infrastructure_failures_do_not_count(self):
        vid = self.version()
        jobs = []
        for _ in range(6):
            job = self.submit(vid, "preview"); self.settle(job, "complete"); jobs.append(job)
        self.denied(RYAN, "select submit_job(%s, 'preview')", vid)          # 7th: no credits to hold
        self.settle(jobs[0], "failed", "infrastructure")                    # render machine's fault
        job = self.submit(vid, "preview")                                   # so one free preview comes back
        self.assertTrue(self.admin("select free_preview from jobs where id = %s", job))
        self.settle(job, "complete")
        # The per-project 6 is lifetime; the 15 is rolling 24 h.
        for _ in range(9):                                                   # 6 counted + 9 = 15
            v2 = self.version()
            j = self.submit(v2, "preview"); self.settle(j, "complete")
        self.assertEqual(self.admin("select count(*) from jobs where free_preview and job_type = 'preview' "
                                    "and not (state = 'failed' and error_class = 'infrastructure')"), 15)
        v3 = self.version()
        self.denied(RYAN, "select submit_job(%s, 'preview')", v3)           # 16th in 24 h: not free
        self.admin("update jobs set created_at = now() - interval '25 hours' returning 1")
        self.assertTrue(self.admin("select free_preview from jobs where id = %s", self.submit(v3, "preview")))

    # -- no credits, or a negative balance, blocks holds but never free work
    def test_short_or_negative_balance_blocks_holds_only(self):
        self.grant(9)
        with self.assertRaises(psycopg.Error) as err:
            self.final("paired")                                            # needs 10
        self.assertIn("Not enough credits", str(err.exception))
        self.assertEqual(self.available(), 9)
        self.assertEqual(self.admin("select count(*) from jobs where job_type = 'final_render'"), 0)

    # -- Test 8 and 21: paired final quotes 10, holds, captures, and the job answers for itself
    def test_paid_paired_render_and_its_accounting(self):
        self.grant(30)
        vid = self.version("map", "paired", "line")
        quote = self.db.as_(RYAN).one("select price_code, credits, free_preview, available from credit_quote(%s, 'final_render')", vid)
        self.assertEqual(quote, ("final_paired", 10, False, 30))
        _, job = self.final("map", "paired", "line")
        self.assertEqual(self.available(), 20)
        self.settle(job, "complete")
        acct = self.db.as_(RYAN).one("select price_code, credits_quoted, held, captured, released, refunded "
                                     "from job_accounting where job_id = %s", job)
        self.assertEqual(acct, ("final_paired", 10, 10, 10, 0, 0))
        self.assertEqual(self.db.as_(RYAN).one("select sum(available), sum(held) from credit_balances"), (20, 0))

    def test_most_expensive_view_sets_the_price_and_unknown_views_are_refused(self):
        self.grant(100)
        for views, code, credits in ((("line",), "final_line", 6), (("line", "map"), "final_map", 8),
                                     (("map", "bars"), "final_paired", 10), (("panel",), "final_paired", 10)):
            _, job = self.final(*views)
            self.assertEqual(self.admin("select price_code, credits_quoted from jobs where id = %s", job), (code, credits))
            self.settle(job, "complete")
        for views, code in ((("split",), "final_map"), (("globe", "line"), "final_map"), (("river",), "final_map")):
            _, job = self.final(*views)
            self.assertEqual(self.admin("select price_code from jobs where id = %s", job), code)
            self.settle(job, "complete")
        with self.assertRaises(psycopg.Error) as err:
            self.final("hologram")
        self.assertIn("Can't price", str(err.exception))
        with self.assertRaises(psycopg.Error) as err:                        # title cards only: never 0
            self.final(title_only=True)
        self.assertIn("at least one data view", str(err.exception))

    # -- Ryan's ruling: path/flows datasets can't have final renders until measured
    def test_path_and_flows_datasets_are_refused_for_final_renders(self):
        self.grant(100)
        for dataset, message in (("test_path", "aren't available yet"), ("test_flows", "aren't available yet"),
                                 ("not_in_the_table", "isn't recorded yet")):
            with self.assertRaises(psycopg.Error) as err:
                self.final("line", dataset=dataset)                          # the view name doesn't matter
            self.assertIn(message, str(err.exception), dataset)
            vid = self.version("line", dataset=dataset)                      # sheets and previews still work
            self.assertEqual(self.admin("select credits_quoted from jobs where id = %s", self.submit(vid, "preview")), 0)
        self.assertEqual(self.available(), 100)                              # nothing was held
        self.assertEqual(self.admin("select count(*) from jobs where job_type = 'final_render'"), 0)
        vid = self.version("line", dataset="test_path")
        with self.assertRaises(psycopg.Error):                               # the quote says the same
            self.db.as_(RYAN).one("select * from credit_quote(%s, 'final_render')", vid)

    def test_catalog_shapes_from_cc1(self):
        self.grant(100)
        self.assertEqual(self.admin("select count(*) from credit_dataset_shapes where noted_by like 'CC1%%'"), 22)
        _, job = self.final("map", dataset="state_obesity_fastfood")
        self.assertEqual(self.admin("select credits_quoted from jobs where id = %s", job), 8)
        for dataset, message in (("lewis_clark_expedition", "aren't available yet"),
                                 ("ryan_spending_flows", "isn't available for films"),
                                 ("example_corp_states", "isn't available for films")):
            with self.assertRaises(psycopg.Error) as err:
                self.final("map", dataset=dataset)
            self.assertIn(message, str(err.exception), dataset)

    # -- Test 9: a gate failure releases the hold and returns the version to its editorial step
    def test_gate_failure_releases(self):
        vid, job = self.final("paired", grant=10)
        self.assertEqual(self.available(), 0)
        self.admin("update jobs set state = 'editorial_action_required', error_class = 'gate' where id = %s returning 1", job)
        self.assertEqual(self.available(), 10)
        self.assertEqual(self.admin("select state from versions where id = %s", vid), "editorial_action_required")

    # -- Test 10: a retried crash is not charged again; Test 11: persistent failure releases
    def test_transient_failure_is_charged_once(self):
        _, job = self.final("paired", grant=10)
        w = self.db.as_(WORKER)
        self.assertEqual(w.one("select id from claim_next_job()"), job)
        w.one("select report_state(%s, 'running')", job)
        self.assertEqual(w.one("select retry_job(%s, 'crash')", job), "queued")
        self.assertEqual(self.available(), 0)                                # still one hold
        self.assertEqual(self.db.as_(WORKER).one("select id from claim_next_job()"), job)
        self.settle(job, "complete")
        self.assertEqual(self.admin("select count(*) from credit_ledger where entry = 'hold'"), 1)
        self.assertEqual(self.available(), 0)

    def test_persistent_failure_releases_and_keeps_metering(self):
        _, job = self.final("paired", grant=10)
        for attempt in (1, 2, 3):
            w = self.db.as_(WORKER)
            self.assertEqual(w.one("select id from claim_next_job()"), job)
            w.one("select write_metering(%s, %s, '{\"wall_s\": 12.5}')", job, attempt)
            self.db.as_(WORKER).one("select retry_job(%s, 'crash')", job)
        self.assertEqual(self.admin("select state, error_class from jobs where id = %s", job), ("failed", "infrastructure"))
        self.assertEqual(self.available(), 10)
        self.assertEqual(self.admin("select count(*), sum(wall_s) from job_metering where job_id = %s", job), (3, 37.5))

    def test_cancel_releases(self):
        _, job = self.final("paired", grant=10)
        self.db.as_(RYAN).one("select state from cancel_job(%s)", job)
        self.assertEqual(self.available(), 10)

    # -- Test 18 (held prices): a price change never alters a job already quoted
    def test_price_change_keeps_existing_quotes(self):
        self.grant(40)
        _, held = self.final("paired")
        self.admin("insert into credit_prices select '2026-12', code, case when code = 'final_paired' then 20 else credits end, "
                   "price_cents, monthly, now() from credit_prices where price_version = '2026-09' returning 1")
        self.settle(held, "complete")
        self.assertEqual(self.admin("select credits_quoted, price_version from jobs where id = %s", held), (10, "2026-09"))
        _, fresh = self.final("paired")
        self.assertEqual(self.admin("select credits_quoted, price_version from jobs where id = %s", fresh), (20, "2026-12"))
        self.assertEqual(self.available(), 40 - 10 - 20)

    # -- Test 19: exactly one grant per paid period; rollover capped at 2x
    def test_subscription_months_and_rollover(self):
        for period in ("sub_1:2026-10", "sub_1:2026-10", "sub_1:2026-11"):
            self.grant(30, entry="subscription_grant", period=period, code="sub_creator")
        self.assertEqual(self.available(pool="subscription"), 60)
        self.grant(30, entry="subscription_grant", period="sub_1:2026-12", event="evt_dec", code="sub_creator")
        self.assertEqual(self.available(pool="subscription"), 60)              # 90 capped to 2 x 30
        self.assertEqual(self.admin("select amount from credit_ledger where entry = 'rollover_expiry'"), -30)
        self.grant(30, entry="subscription_grant", period="sub_1:2027-01", event="evt_dec", code="sub_creator")
        self.assertEqual(self.admin("select count(*) from credit_ledger where entry = 'subscription_grant'"), 3)

    # -- pools: spend subscription, then granted, then purchased; releases go back where they came from
    def test_pool_order(self):
        self.grant(3, entry="subscription_grant", period="p1")
        self.grant(4)
        self.grant(10, entry="purchase", event="evt_p")
        _, job = self.final("map")                                           # 8 credits
        holds = self.admin("select string_agg(pool::text || ':' || amount, ',' order by id) from credit_ledger where entry = 'hold'")
        self.assertEqual(holds, "subscription:-3,granted:-4,purchased:-1")
        self.settle(job, "cancelled")
        self.assertEqual([self.available(pool=p) for p in ("subscription", "granted", "purchased")], [3, 4, 10])

    # -- Test 20: refunds
    def test_refunds(self):
        self.grant(10, entry="purchase", event="evt_buy", code="pack_starter")
        _, job = self.final("paired")
        self.settle(job, "complete")
        self.assertEqual(self.available(), 0)
        s = self.db.as_("service")
        self.assertEqual(s.one("select refund_job(%s, 'Wrong colours on our side', 'admin:ryan')", job), 10)
        self.assertEqual(self.available(), 10)
        self.denied("service", "select refund_job(%s, 'again', 'admin:ryan')", job)       # once only
        # Cash refund of the pack after its credits were spent again: the balance goes negative...
        _, job2 = self.final("paired"); self.settle(job2, "complete")
        self.assertIsNotNone(self.db.as_("service").one("select reverse_purchase('evt_buy', 'evt_refund', 'stripe')"))
        self.assertIsNone(self.db.as_("service").one("select reverse_purchase('evt_buy', 'evt_refund', 'stripe')"))  # replay
        self.assertEqual(self.available(), -10)
        # ...and blocks new holds, while free work continues.
        with self.assertRaises(psycopg.Error):
            self.final("paired")
        self.assertTrue(self.admin("select free_preview from jobs where job_type = 'preview' order by created_at desc limit 1"))
        acct = self.admin("select captured, refunded from job_accounting where job_id = %s", job)
        self.assertEqual(acct, (10, 10))

    # -- privacy: people see only their own money
    def test_other_people_and_the_worker_see_nothing(self):
        _, job = self.final("paired", grant=10)
        for who in (OTHER, WORKER):
            d = self.db.as_(who)
            self.assertEqual(d.one("select count(*) from credit_ledger"), 0, who)
            self.assertEqual(d.one("select count(*) from credit_balances"), 0, who)
            self.assertEqual(d.one("select count(*) from job_accounting"), 0, who)
        self.denied(OTHER, "select * from credit_quote(%s, 'preview')", self.admin("select version_id from jobs where id = %s", job))
        self.denied("anon", "select count(*) from credit_ledger")

    # -- two jobs racing for the last credits: exactly one gets them
    def test_concurrent_holds_cannot_overspend(self):
        self.grant(10)
        v1, v2 = self.version("paired"), self.version("paired")
        ladders = []
        for vid in (v1, v2):
            sheet = self.submit(vid, "contact_sheet"); self.settle(sheet, "complete")
            prev = self.submit(vid, "preview"); self.settle(prev, "complete")
            ladders.append((vid, sheet, prev))
        results = []
        barrier = threading.Barrier(2)

        def race(vid, sheet, prev):
            db = core.Db(_server.get_uri(database=self.name)).as_(RYAN)
            barrier.wait()
            try:
                db.one("select id from submit_job(%s, 'final_render', '{}', %s, %s)", vid, sheet, prev)
                results.append("ok")
            except psycopg.Error:
                results.append("refused")
            finally:
                db.c.close()

        threads = [threading.Thread(target=race, args=l) for l in ladders]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(sorted(results), ["ok", "refused"])
        self.assertEqual(self.available(), 0)


if __name__ == "__main__":
    unittest.main()
