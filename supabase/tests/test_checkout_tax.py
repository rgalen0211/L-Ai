"""CHECKOUT: THE USE-AND-PLACE QUESTION AND THE PLAN-ONLY OHIO TAX (migrations/20261123000900_checkout_tax_profile.sql, NOT APPLIED) plus live steps 69, 70 and 71, on a local Postgres.
CONNECT, 2026-11-24 (CC1 09:33 and 10:23, Ryan's Ohio answers). Same setup as test_stripe.py, but 000900 runs AFTER the phase-2b Stripe files (as it does live: stripe_checkout_context is defined there, and a later definition must win). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_checkout_tax.py -v

What it proves, each with the opposite case beside it
  * a person reads and writes ONLY their own answer, through the two functions; wrong shapes are refused with their code (use_invalid, country_invalid, state_required, zip_required, zip_unknown); an Ohio ZIP that is not placed is refused only for BUSINESS use;
  * the context: ONLY a plan, for business use in Ohio, gets a tax rate, from that ZIP's county; personal Ohio, business elsewhere, a pack in Ohio, and no answer at all get none; a rate that is missing, inactive or has no Stripe id means tax_unknown (the checkout refuses) and never an untaxed Ohio business plan; every old key is still there;
  * the answer and tax tables are closed to every API role; the functions are closed to anonymous callers;
  * the rollback puts the old context back and drops the tables; live step 72 says so before and after;
  * live step 69 refuses placeholders, a wrong set of codes, buying already open, and a second switch; swaps the ids, saves the old ones and sets live_ok; step 69 part 4 refuses until a live purchase AND refund exist and the Ohio rates are loaded; step 70 closes buying and restores the test ids and refuses once a live payment exists.
"""
import json
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as ledger  # noqa: E402

ROOT = core.ROOT
MIG = ROOT / "migrations" / "20261123000900_checkout_tax_profile.sql"
RB = ROOT / "rollbacks" / "20261123000900_checkout_tax_profile_rollback.sql"
S69 = (ROOT / "live-steps" / "69_buying_open.sql").read_text(encoding="utf-8")
S70 = (ROOT / "live-steps" / "70_buying_UNDO.sql").read_text(encoding="utf-8")
S72 = (ROOT / "live-steps" / "72_checkout_tax_profile_check.sql").read_text(encoding="utf-8")
RYAN, OTHER = core.RYAN, core.OTHER
_server = None
_count = 0


def parts(text):
    return {int(m.group(1)): m.group(2) for m in re.finditer(r"-- PART (\d)[^\n]*\n(.*?)(?=\n-- PART \d|\Z)", text, re.S)}


P69, P70 = parts(S69), parts(S70)


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-checkouttax-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmplct")
        c.execute("create database tmplct")
    with psycopg.connect(_server.get_uri(database="tmplct"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in [p for p in core.MIGRATIONS if p.name != MIG.name]:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute(ledger.LEDGER.read_text(encoding="utf-8"))
        c.execute((ROOT / "phase-2b" / "stripe_test_mode.sql").read_text(encoding="utf-8"))
        c.execute((ROOT / "phase-2b" / "stripe_refunds_disputes.sql").read_text(encoding="utf-8"))
        c.execute("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")           # Supabase's own defaults: a table or function made from here on is open to the API roles
        c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")    # until the migration closes it, so a missing revoke is a real hole here too
        c.execute(MIG.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s,'ryan@x'),(%s,'other@x')", (RYAN, OTHER))
        c.execute("insert into public.stripe_prices (price_code, stripe_price_id, mode) values "
                  "('pack_starter', 'price_Starter1', 'payment'), ('pack_maker', 'price_Maker1', 'payment'), "
                  "('sub_creator', 'price_Creator1', 'subscription'), ('sub_pro', 'price_Pro1', 'subscription')")
        c.execute("insert into public.stripe_customers (owner_id, customer_id) values (%s, 'cus_Ryan'), (%s, 'cus_Other')", (RYAN, OTHER))
        c.execute("update public.stripe_settings set buying_open = false where id")
        # a tiny Ohio: Franklin (rate txr_OhioA1), Cuyahoga (county with NO rate row), Lorain (rate with no Stripe id), Summit (inactive rate)
        c.execute("insert into public.tax_rates (code, percent, stripe_tax_rate_id, active) values ('oh_a', 7.5, 'txr_OhioA1', true), ('oh_b', 8.0, null, true), ('oh_c', 7.25, 'txr_OhioC1', false)")
        c.execute("insert into public.ohio_county_rate (county, rate_code) values ('Franklin', 'oh_a'), ('Lorain', 'oh_b'), ('Summit', 'oh_c')")
        c.execute("insert into public.ohio_zip_county (zip, county) values ('43004', 'Franklin'), ('44101', 'Cuyahoga'), ('44001', 'Lorain'), ('44301', 'Summit')")


class CheckoutTax(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"ct{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template tmplct")
        self.db = core.Db(_server.get_uri(database=self.name))

    def tearDown(self):
        self.db.c.close()

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def run_sql(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def setp(self, who, use, country="US", state="OH", zip_="43004"):
        return self.db.as_(who).one("select public.set_my_tax_profile(%s, %s, %s, %s)", use, country, state, zip_)

    def ctx(self, code, who=RYAN):
        return self.db.as_("service").one("select public.stripe_checkout_context(%s, %s)", who, code)

    # ---- the answer
    def test_a_person_reads_and_writes_only_their_own_answer(self):
        self.assertIsNone(self.db.as_(RYAN).one("select public.my_tax_profile()"))
        p = self.setp(RYAN, "business")
        self.assertEqual({k: p[k] for k in ("use", "country", "state", "zip")}, {"use": "business", "country": "US", "state": "OH", "zip": "43004"})
        self.assertIn("answered_at", p)
        self.assertNotIn("owner_id", p, "the id of the person is never given back")
        self.assertIsNone(self.db.as_(OTHER).one("select public.my_tax_profile()"), "another person sees nothing")
        self.setp(OTHER, "personal", state="TX", zip_=None)
        self.assertEqual(self.db.as_(RYAN).one("select public.my_tax_profile()")["state"], "OH")
        before = self.admin("select answered_at from public.account_tax_profile where owner_id = %s", RYAN)
        self.setp(RYAN, "personal", state="CA", zip_=None)
        row = self.admin("select use, state, zip, answered_at from public.account_tax_profile where owner_id = %s", RYAN)
        self.assertEqual((row[0], row[1], row[2]), ("personal", "CA", None), "changing the answer replaces it (the zip goes with Ohio)")
        self.assertGreaterEqual(row[3], before)
        self.assertEqual(self.admin("select count(*) from public.account_tax_profile"), 2)

    def test_wrong_shapes_are_refused_with_their_code(self):
        cases = [("use_invalid", ("neither", "US", "OH", "43004")), ("use_invalid", (None, "US", "OH", "43004")),
                 ("country_invalid", ("business", "usa", "OH", "43004")), ("country_invalid", ("business", None, "OH", "43004")),
                 ("state_required", ("business", "US", "", "43004")), ("state_required", ("business", "US", "Ohio", "43004")),
                 ("zip_required", ("business", "US", "OH", "4300")), ("zip_required", ("personal", "US", "OH", None)),
                 ("zip_unknown", ("business", "US", "OH", "45999"))]
        for code, args in cases:
            with self.assertRaises(psycopg.Error, msg=str(args)) as cm:
                self.db.as_(RYAN).one("select public.set_my_tax_profile(%s, %s, %s, %s)", *args)
            self.assertIn(code, str(cm.exception), str(args))
        self.assertEqual(self.admin("select count(*) from public.account_tax_profile"), 0)
        self.assertEqual(self.setp(RYAN, "personal", zip_="45999")["zip"], "45999", "a personal answer needs no known county")
        p = self.setp(RYAN, "business", country="CA", state="ON", zip_="12345")
        self.assertEqual((p["country"], p["state"], p["zip"]), ("CA", None, None), "outside the US the state and zip are not kept")
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select public.set_my_tax_profile('personal', 'US', 'TX', null)")
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select public.my_tax_profile()")

    def test_the_tables_are_closed_to_every_api_role(self):
        for table in ("account_tax_profile", "tax_rates", "ohio_county_rate", "ohio_zip_county"):
            for who in ("anon", RYAN, "service"):
                with self.assertRaises(psycopg.Error, msg=f"{table} {who}"):
                    self.db.as_(who).one(f"select count(*) from public.{table}")

    # ---- the rule
    def test_only_a_business_plan_in_ohio_is_taxed_with_that_zip_s_county_rate(self):
        self.assertIsNone(self.ctx("sub_creator")["tax_profile"])
        c = self.ctx("sub_creator")
        self.assertEqual((c["tax_rate_id"], c["tax_unknown"]), (None, False), "no answer: no rate here (the checkout refuses the missing answer itself)")
        self.setp(RYAN, "business")
        c = self.ctx("sub_creator")
        self.assertEqual((c["tax_rate_id"], c["tax_county"], c["tax_unknown"]), ("txr_OhioA1", "Franklin", False))
        self.assertEqual(c["tax_profile"], {"use": "business", "country": "US", "state": "OH", "zip": "43004"})
        for code in ("pack_starter", "pack_maker"):
            c = self.ctx(code)
            self.assertEqual((c["tax_rate_id"], c["tax_unknown"]), (None, False), f"{code}: a credit pack is never taxed at checkout")
        self.setp(RYAN, "personal")
        c = self.ctx("sub_creator")
        self.assertEqual((c["tax_rate_id"], c["tax_unknown"]), (None, False), "personal use in Ohio: never")
        self.setp(RYAN, "business", state="TX", zip_=None)
        c = self.ctx("sub_pro")
        self.assertEqual((c["tax_rate_id"], c["tax_unknown"]), (None, False), "business outside Ohio: none")
        self.setp(RYAN, "business", country="CA", state=None, zip_=None)
        self.assertEqual(self.ctx("sub_pro")["tax_rate_id"], None)

    def test_a_rate_the_database_cannot_give_means_unknown_and_never_untaxed(self):
        for zip_ in ("44101", "44001", "44301"):                  # no county rate row / a rate with no Stripe id / an inactive rate
            self.setp(RYAN, "business", zip_=zip_)
            c = self.ctx("sub_creator")
            self.assertEqual((c["tax_rate_id"], c["tax_unknown"]), (None, True), zip_)
            self.assertEqual(self.ctx("pack_starter")["tax_unknown"], False, "a pack does not need a rate")

    def test_every_old_key_of_the_context_is_still_there(self):
        keys = set(self.ctx("pack_starter"))
        self.assertTrue({"stripe_price_id", "mode", "customer_id", "email", "has_plan", "live_ok", "buying_open", "is_admin"} <= keys)
        self.assertEqual(self.ctx("pack_starter")["stripe_price_id"], "price_Starter1")
        self.assertEqual(self.ctx("sub_creator")["mode"], "subscription")
        self.assertIsNone(self.ctx("pack_nothing")["stripe_price_id"])
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select public.stripe_checkout_context(%s, 'pack_starter')", RYAN)

    # ---- undo and the check step
    def test_the_rollback_puts_the_old_context_back_and_step_71_says_so_before_and_after(self):
        rows = self.run_sql(S72).fetchall()
        self.assertEqual(len(rows), 6)
        self.assertTrue(all(r[1] is True for r in rows), rows)
        self.run_sql(RB.read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select to_regclass('public.account_tax_profile')"), None)
        self.assertEqual(self.admin("select to_regclass('public.tax_rates')"), None)
        self.assertEqual(self.admin("select to_regprocedure('public.my_tax_profile()')"), None)
        keys = set(self.ctx("sub_creator"))
        self.assertFalse({"tax_profile", "tax_rate_id", "tax_county", "tax_unknown"} & keys)
        self.assertEqual(self.ctx("sub_creator")["mode"], "subscription")
        rows = self.run_sql(S72).fetchall()
        self.assertEqual([r[1] for r in rows], [False, False, False, False, False, True], rows)
        self.assertEqual(self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and strpos(p.proname, 'tax_profile') > 0"), 0,
                         "no function of the migration is left behind, the renamed gate originals included (RENDERER 22:15)")
        self.run_sql(MIG.read_text(encoding="utf-8"))                                      # an undo followed by the migration again must work
        rows = self.run_sql(S72).fetchall()
        self.assertTrue(all(r[1] is True for r in rows), rows)

    # ---- live steps 69 and 70
    def vals(self, mapping):
        return re.sub(r"vals jsonb := '\{.*?\}';", "vals jsonb := '" + json.dumps(mapping) + "';", P69[2], flags=re.S)

    GOOD = {"pack_starter": "price_LiveS1", "pack_maker": "price_LiveM1", "sub_creator": "price_LiveC1", "sub_pro": "price_LiveP1"}

    def test_step_69_part_1_is_read_only_and_part_2_refuses_what_it_should(self):
        self.assertFalse(re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", re.sub(r"--[^\n]*", "", P69[1]), re.I))
        row = self.run_sql(P69[1]).fetchone()
        self.assertEqual(row[:2], (False, False))
        with self.assertRaises(psycopg.Error) as cm:                                         # the placeholders
            self.run_sql(self.vals({k: "price_REPLACE_ME" for k in self.GOOD}))
        self.assertIn("no real live price id", str(cm.exception))
        for bad, word in (({**self.GOOD, "pack_maker": "price_REPLACE_ME"}, "no real live price id"),
                          ({**self.GOOD, "pack_maker": "not-an-id"}, "no real live price id"),
                          ({**self.GOOD, "pack_maker": "price_Starter1"}, "still the old"),
                          ({**self.GOOD, "pack_maker": "price_LiveS1"}, "same price id"),
                          ({k: v for k, v in self.GOOD.items() if k != "sub_pro"}, "not the active price codes")):
            with self.assertRaises(psycopg.Error, msg=str(bad)) as cm:
                self.run_sql(self.vals(bad))
            self.assertIn(word, str(cm.exception))
        self.assertEqual(self.admin("select count(*) from public.stripe_prices where starts_with(stripe_price_id, 'price_Live')"), 0, "nothing changed")
        self.admin("update public.stripe_settings set buying_open = true returning 1")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(self.vals(self.GOOD))
        self.assertIn("already open", str(cm.exception))

    def test_step_69_part_2_swaps_clears_and_sets_live_ok_but_never_opens_buying(self):
        self.run_sql(self.vals(self.GOOD))
        ids = dict(self.run_sql("select price_code, stripe_price_id from public.stripe_prices").fetchall())
        self.assertEqual(ids, self.GOOD)
        saved = dict(self.run_sql("select price_code, stripe_price_id from ryagram_private.stripe_prices_test_ids").fetchall())
        self.assertEqual(saved["pack_starter"], "price_Starter1")
        self.assertEqual(self.admin("select count(*) from public.stripe_customers"), 0)
        self.assertEqual(self.admin("select live_ok from public.stripe_settings where id"), True)
        self.assertEqual(self.admin("select buying_open from public.stripe_settings where id"), False)
        for who in ("anon", RYAN, "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select count(*) from ryagram_private.stripe_prices_test_ids")
        with self.assertRaises(psycopg.Error) as cm:                                         # a second switch is refused once a live event exists
            self.admin("insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_L0', 'charge.refunded', true, 'applied') returning 1")
            self.run_sql(self.vals({k: v + "x" for k, v in self.GOOD.items()}))
        self.assertIn("not the first switch", str(cm.exception))

    def test_step_69_part_4_refuses_until_everything_is_true_then_opens(self):
        self.run_sql(self.vals(self.GOOD))
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P69[4])
        self.assertIn("test purchase and its refund", str(cm.exception))
        self.admin("insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_L1', 'checkout.session.completed', true, 'applied') returning 1")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P69[4])
        self.assertIn("test purchase and its refund", str(cm.exception), "a purchase without a refund is not enough")
        self.admin("insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_L2', 'charge.refunded', true, 'applied') returning 1")
        self.assertEqual(self.run_sql(P69[3]).fetchone(), (1, 1, True, False))
        self.admin("update public.ohio_county_rate set rate_code = 'oh_a' where county in ('Lorain', 'Summit') returning 1")     # one good rate left, so each case below is the ONLY thing wrong
        self.admin("delete from public.tax_rates where code in ('oh_b', 'oh_c') returning 1")
        self.admin("update public.tax_rates set stripe_tax_rate_id = null where code = 'oh_a' returning 1")     # an active rate without its Stripe id
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P69[4])
        self.assertIn("Ohio rates are not loaded", str(cm.exception))
        self.admin("update public.tax_rates set stripe_tax_rate_id = 'txr_OhioA1' where code = 'oh_a' returning 1")
        self.admin("update public.tax_rates set active = false where code = 'oh_a' returning 1")               # a county pointing at an inactive rate
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P69[4])
        self.assertIn("Ohio rates are not loaded", str(cm.exception))
        self.admin("update public.tax_rates set active = true where code = 'oh_a' returning 1")
        self.run_sql("create table pg_temp.zips_hold as select * from public.ohio_zip_county")
        self.run_sql("delete from public.ohio_zip_county")                                      # no Ohio ZIPs loaded
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P69[4])
        self.assertIn("Ohio rates are not loaded", str(cm.exception))
        self.run_sql("insert into public.ohio_zip_county select * from pg_temp.zips_hold")
        self.run_sql(P69[4])
        self.assertEqual(self.admin("select buying_open from public.stripe_settings where id"), True)

    def test_step_69_part_4_refuses_a_test_price_id_left_in_place(self):
        self.run_sql(self.vals(self.GOOD))
        self.admin("insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_L1', 'checkout.session.completed', true, 'applied'), ('evt_L2', 'charge.refunded', true, 'applied') returning 1")
        self.admin("delete from public.ohio_county_rate where rate_code in ('oh_b', 'oh_c') returning 1")
        self.admin("delete from public.tax_rates where code in ('oh_b', 'oh_c') returning 1")
        self.admin("update public.stripe_prices set stripe_price_id = 'price_Starter1' where price_code = 'pack_starter' returning 1")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P69[4])
        self.assertIn("still the test one", str(cm.exception))

    def test_step_70_closes_buying_and_restores_the_test_ids_but_never_after_a_live_payment(self):
        self.run_sql(self.vals(self.GOOD))
        self.admin("update public.stripe_settings set buying_open = true returning 1")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P70[2])
        self.assertIn("still open", str(cm.exception))
        self.assertEqual(self.run_sql(P70[1]).fetchone(), (False, True))
        self.run_sql(P70[2])
        ids = dict(self.run_sql("select price_code, stripe_price_id from public.stripe_prices").fetchall())
        self.assertEqual(ids["pack_starter"], "price_Starter1")
        self.assertEqual(self.admin("select live_ok from public.stripe_settings where id"), False)
        # a live payment exists: going back is refused
        self.run_sql(self.vals(self.GOOD))
        self.admin("insert into public.stripe_events (event_id, type, livemode, outcome) values ('evt_L1', 'checkout.session.completed', true, 'applied') returning 1")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P70[2])
        self.assertIn("real payment exists", str(cm.exception))
        self.assertEqual(self.admin("select live_ok from public.stripe_settings where id"), True)

    def test_step_70_part_2_needs_the_saved_ids(self):
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P70[2])
        self.assertIn("never saved", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
