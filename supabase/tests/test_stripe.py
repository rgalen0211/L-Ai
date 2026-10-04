"""Stripe in test mode (supabase/phase-2b/stripe_test_mode.sql) on a local Postgres.

Same setup as test_2b_credits.py, plus the Stripe file. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_stripe.py -v

stripe_apply receives what the stripe-webhook function extracts from each event
(tests/stripe.test.mjs checks that extraction against Stripe's own fixtures).
"""
import json
import sys
import threading
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pgtemp  # noqa: E402
import test_2a_core as core  # noqa: E402
import test_2b_credits as ledger  # noqa: E402

ROOT = core.ROOT
STRIPE = ROOT / "phase-2b" / "stripe_test_mode.sql"
RYAN, OTHER = core.RYAN, core.OTHER
_server = None
_count = 0


def setUpModule():
    global _server
    _server = pgtemp.start("stripe")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmplst")
        c.execute("create database tmplst")
    with psycopg.connect(_server.get_uri(database="tmplst"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in [*core.MIGRATIONS, ledger.LEDGER, STRIPE]:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s,'ryan@x'),(%s,'other@x')", (RYAN, OTHER))
        c.execute("insert into public.stripe_prices (price_code, stripe_price_id, mode) values "
                  "('pack_starter', 'price_Starter1', 'payment'), ('pack_maker', 'price_Maker1', 'payment'), "
                  "('sub_creator', 'price_Creator1', 'subscription'), ('sub_pro', 'price_Pro1', 'subscription')")
        c.execute("insert into public.stripe_customers (owner_id, customer_id) values (%s, 'cus_Ryan'), (%s, 'cus_Other')",
                  (RYAN, OTHER))


class Stripe(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"s{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template tmplst")
        self.db = core.Db(_server.get_uri(database=self.name))
        self.n = 0

    def tearDown(self):
        self.db.c.close()
        pgtemp.drop_database(_server, self.name)

    # -- helpers
    def apply(self, type_, data, event=None, livemode=False, created="2026-10-01T00:00:00Z"):
        self.n += 1
        event = event or f"evt_T{self.n}"
        return self.db.as_("service").one("select stripe_apply(%s, %s, %s, %s, %s::jsonb)",
                                          event, type_, created, livemode, json.dumps(data))

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def balance(self, who=RYAN, pool=None):
        sql = "select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s" + (" and pool = %s" if pool else "")
        return self.admin(sql, *([who, pool] if pool else [who]))

    def detail(self, event):
        return self.admin("select outcome, detail from stripe_events where event_id = %s", event)

    @staticmethod
    def pack(code="pack_starter", cents=1200, owner=RYAN, customer="cus_Ryan", session="cs_test_1", pi="pi_1",
             status="paid", currency="usd"):
        return {"session_id": session, "mode": "payment", "payment_status": status, "owner_id": owner,
                "customer": customer, "price_code": code, "amount_total": cents, "currency": currency,
                "payment_intent": pi, "subscription": None}

    @staticmethod
    def invoice(price="price_Creator1", paid=2400, sub="sub_A", customer="cus_Ryan", reason="subscription_cycle",
                start=1790812800):                                       # 2026-10-01 UTC
        return {"invoice_id": "in_1", "customer": customer, "subscription": sub, "price_id": price,
                "billing_reason": reason, "amount_paid": paid, "currency": "usd", "period_start": start}

    # -- the chain: Stripe fixture -> webhook extraction (pinned by tests/stripe.test.mjs) -> stripe_apply
    def test_events_extracted_from_stripe_fixtures_apply_as_expected(self):
        steps = json.loads((ROOT.parent / "tests" / "fixtures" / "stripe" / "extracted.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(steps), 9)
        for step in steps:
            with self.subTest(step=step["name"]):
                got = self.apply(step["type"], step["data"], event=step["id"], livemode=step["livemode"], created=step["created"])
                self.assertEqual(got, step["expect"], self.detail(step["id"]))
        self.assertEqual(self.balance(pool="subscription"), 60)   # two paid months
        self.assertEqual(self.balance(pool="purchased"), 0)       # a pack bought, then refunded in full
        self.assertEqual(self.admin("select status, price_code from stripe_subscriptions"), ("active", "sub_creator"))

    # -- packs
    def test_buying_a_pack_grants_its_credits_once(self):
        self.assertEqual(self.apply("checkout.session.completed", self.pack(), event="evt_Buy"), "applied")
        self.assertEqual(self.balance(pool="purchased"), 10)
        self.assertEqual(self.apply("checkout.session.completed", self.pack(), event="evt_Buy"), "replay")
        self.assertEqual(self.balance(), 10)
        # The same checkout under a different event id (Stripe can't do this, but still): no second grant.
        self.assertEqual(self.apply("checkout.session.async_payment_succeeded", self.pack()), "ignored")
        self.assertEqual(self.balance(), 10)
        self.assertEqual(self.admin("select price_code, stripe_event_id from credit_ledger where entry = 'purchase'"),
                         ("pack_starter", "evt_Buy"))

    def test_a_pack_paid_later_is_granted_when_it_settles(self):
        self.assertEqual(self.apply("checkout.session.completed", self.pack(status="unpaid")), "ignored")
        self.assertEqual(self.balance(), 0)
        self.assertEqual(self.apply("checkout.session.async_payment_succeeded", self.pack()), "applied")
        self.assertEqual(self.balance(), 10)

    def test_a_wrong_amount_unknown_pack_or_stranger_gets_no_credits(self):
        cases = [
            self.pack(cents=100),                                   # paid less than the price
            self.pack(currency="eur"),
            self.pack(code="pack_imaginary"),
            self.pack(code="sub_creator", cents=2400),              # a plan code in payment mode
            self.pack(code="final_map", cents=0),                   # not for sale
            self.pack(owner="not-a-uuid"),
            self.pack(owner="00000000-0000-0000-0000-00000000dead"),
            self.pack(customer="cus_Other"),                        # someone else's customer
            self.pack(customer=None),
            self.pack(pi=None),
        ]
        for i, data in enumerate(cases):
            with self.subTest(case=i):
                data = {**data, "session_id": f"cs_{i}", "payment_intent": data["payment_intent"] and f"pi_{i}"}
                event = f"evt_Bad{i}"
                self.assertEqual(self.apply("checkout.session.completed", data, event=event), "needs_review")
                self.assertTrue(self.detail(event)[1])
        self.assertEqual(self.balance(RYAN) + self.balance(OTHER), 0)

    def test_a_full_refund_removes_the_pack_and_may_leave_a_negative_balance(self):
        self.apply("checkout.session.completed", self.pack(code="pack_maker", cents=3000, pi="pi_M"), event="evt_Maker")
        self.admin("select adjust_credits(%s, 'purchased', -20, 'spent in a test', 'admin:test')", RYAN)
        refund = {"charge": "ch_1", "payment_intent": "pi_M", "amount": 3000, "amount_refunded": 3000, "currency": "usd"}
        self.assertEqual(self.apply("charge.refunded", refund, event="evt_Refund"), "applied")
        self.assertEqual(self.balance(), -20)                     # 28 - 20 spent - 28 reversed
        self.assertEqual(self.apply("charge.refunded", refund, event="evt_Refund"), "replay")
        self.assertEqual(self.apply("charge.refunded", refund), "ignored")      # a second refund event: already reversed
        self.assertEqual(self.balance(), -20)
        # A negative balance blocks new holds (the ledger's rule) until credits are added.
        quote = self.db.as_(RYAN).one("select available from credit_balances")
        self.assertEqual(quote, -20)

    def test_a_partial_refund_or_an_unknown_payment_changes_nothing(self):
        self.apply("checkout.session.completed", self.pack(pi="pi_P"))
        partial = {"charge": "ch_2", "payment_intent": "pi_P", "amount": 1200, "amount_refunded": 600, "currency": "usd"}
        self.assertEqual(self.apply("charge.refunded", partial, event="evt_Part"), "needs_review")
        self.assertIn("Partial refund", self.detail("evt_Part")[1])
        missing = {**partial, "amount_refunded": None}
        self.assertEqual(self.apply("charge.refunded", missing), "needs_review")
        self.assertEqual(self.apply("charge.refunded", {**partial, "payment_intent": "pi_Plan", "amount_refunded": 1200}),
                         "needs_review")
        self.assertEqual(self.balance(), 10)

    # -- plans
    def test_each_paid_month_grants_once_with_the_rollover_cap(self):
        self.assertEqual(self.apply("invoice.paid", self.invoice(reason="subscription_create"), event="evt_M1"), "applied")
        self.assertEqual(self.balance(pool="subscription"), 30)
        self.assertEqual(self.apply("invoice.paid", self.invoice(), event="evt_M1b"), "ignored")   # same period again
        self.assertEqual(self.apply("invoice.paid", self.invoice(start=1793491200)), "applied")      # 2026-11-01
        self.assertEqual(self.apply("invoice.paid", self.invoice(start=1796083200)), "applied")      # 2026-12-01
        self.assertEqual(self.balance(pool="subscription"), 60)   # 90 capped at 2x the allowance
        self.assertEqual(self.admin("select period_key from credit_ledger where entry = 'subscription_grant' order by id limit 1"),
                         "sub_A:2026-10-01")

    def test_odd_invoices_are_held_for_review(self):
        self.assertEqual(self.apply("invoice.paid", self.invoice(paid=1200)), "needs_review")            # discounted
        self.assertEqual(self.apply("invoice.paid", self.invoice(price="price_Unknown")), "needs_review")
        self.assertEqual(self.apply("invoice.paid", self.invoice(price="price_Starter1")), "needs_review")  # a pack price
        self.assertEqual(self.apply("invoice.paid", self.invoice(reason="subscription_update")), "needs_review")
        self.assertEqual(self.apply("invoice.paid", self.invoice(customer="cus_Stranger")), "needs_review")
        self.assertEqual(self.apply("invoice.paid", self.invoice(start=None)), "needs_review")
        self.assertEqual(self.apply("invoice.paid", self.invoice(paid=0)), "ignored")                     # trial
        self.assertEqual(self.apply("invoice.paid", {**self.invoice(), "subscription": None}), "ignored")
        self.assertEqual(self.balance(), 0)

    def test_plan_state_follows_the_newest_event(self):
        sub = {"subscription": "sub_A", "customer": "cus_Ryan", "status": "active", "price_id": "price_Pro1",
               "current_period_end": 1793491200, "cancel_at_period_end": False}
        self.assertEqual(self.apply("customer.subscription.created", sub, created="2026-10-01T00:00:00Z"), "applied")
        self.assertEqual(self.apply("customer.subscription.updated", {**sub, "cancel_at_period_end": True},
                                    created="2026-10-05T00:00:00Z"), "applied")
        # An older event delivered late does not undo the cancellation.
        self.assertEqual(self.apply("customer.subscription.updated", sub, created="2026-10-02T00:00:00Z"), "ignored")
        self.assertEqual(self.admin("select price_code, status, cancel_at_period_end from stripe_subscriptions"),
                         ("sub_pro", "active", True))
        self.assertEqual(self.apply("customer.subscription.deleted", {**sub, "status": "canceled"},
                                    created="2026-11-01T00:00:00Z"), "applied")
        # The person sees their own plan, and only theirs.
        self.assertEqual(self.db.as_(RYAN).one("select status from stripe_subscriptions"), "canceled")
        self.assertIsNone(self.db.as_(OTHER).one("select status from stripe_subscriptions"))
        self.assertEqual(self.apply("customer.subscription.updated", {**sub, "customer": "cus_Stranger"}), "needs_review")

    def test_plan_checkout_records_the_plan_but_grants_nothing(self):
        data = {**self.pack(code="sub_creator", cents=2400, pi=None), "mode": "subscription", "subscription": "sub_New"}
        self.assertEqual(self.apply("checkout.session.completed", data), "applied")
        self.assertEqual(self.balance(), 0)
        ctx = self.db.as_("service").one("select stripe_checkout_context(%s, 'sub_pro')", RYAN)
        self.assertTrue(ctx["has_plan"])       # stripe-checkout refuses a second plan

    # -- guards
    def test_live_events_are_refused_while_in_test_mode(self):
        self.assertEqual(self.apply("checkout.session.completed", self.pack(), event="evt_Live", livemode=True), "refused_live")
        self.assertEqual(self.balance(), 0)
        self.admin("update stripe_settings set live_ok = true returning 1")
        self.assertEqual(self.apply("checkout.session.completed", self.pack(session="cs_2", pi="pi_2"), livemode=True), "applied")

    def test_unknown_types_are_ignored_and_bad_ids_raise(self):
        self.assertEqual(self.apply("payment_intent.created", {}), "ignored")
        with self.assertRaises(psycopg.Error):
            self.apply("invoice.paid", self.invoice(), event="evt_bad id; drop table jobs")

    def test_only_the_service_role_can_call_stripe_functions(self):
        for who in (RYAN, "anon"):
            for sql, args in (("select stripe_apply('evt_X', 'invoice.paid', now(), false, '{}')", ()),
                              ("select stripe_checkout_context(%s, 'pack_starter')", (RYAN,)),
                              ("select stripe_set_customer(%s, 'cus_Evil')", (RYAN,)),
                              ("select * from stripe_events", ()), ("select * from stripe_customers", ()),
                              ("select * from stripe_payments", ()), ("select stripe_price_id from stripe_prices", ()),
                              ("update stripe_settings set live_ok = true", ())):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql, *args)
        self.assertEqual(self.db.as_(RYAN).one("select count(*) from stripe_prices"), 4)   # codes on sale, no Stripe ids

    def test_checkout_context_and_customer_mapping(self):
        svc = self.db.as_("service")
        ctx = svc.one("select stripe_checkout_context(%s, 'pack_starter')", RYAN)
        self.assertEqual((ctx["stripe_price_id"], ctx["mode"], ctx["customer_id"], ctx["has_plan"], ctx["live_ok"]),
                         ("price_Starter1", "payment", "cus_Ryan", False, False))
        self.assertIsNone(svc.one("select stripe_checkout_context(%s, 'final_map')", RYAN)["stripe_price_id"])
        self.admin("delete from stripe_customers where owner_id = %s returning 1", OTHER)
        svc.one("select stripe_set_customer(%s, 'cus_New')", OTHER)
        svc.one("select stripe_set_customer(%s, 'cus_New')", OTHER)                 # repeat is fine
        with self.assertRaises(psycopg.Error):
            svc.one("select stripe_set_customer(%s, 'cus_Other2')", OTHER)

    def test_two_deliveries_at_once_grant_once(self):
        uri = _server.get_uri(database=self.name)
        results = []

        def deliver():
            with psycopg.connect(uri, autocommit=True) as c:
                c.execute("set role service_role")
                results.append(c.execute("select stripe_apply('evt_Twice', 'checkout.session.completed', now(), false, %s::jsonb)",
                                         (json.dumps(self.pack()),)).fetchone()[0])
        threads = [threading.Thread(target=deliver) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), ["applied", "replay", "replay", "replay"])
        self.assertEqual(self.balance(), 10)


if __name__ == "__main__":
    unittest.main()
