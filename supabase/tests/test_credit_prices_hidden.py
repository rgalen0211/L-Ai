"""CREDIT PRICES HIDDEN FROM THE API (migrations/20261123000800_credit_prices_hide_money.sql, NOT APPLIED) and live step 67, on a local Postgres. CONNECT, 2026-11-24 (GAMES 18:47 LOW, CC1 18:54, Ryan: prices stay hidden while buying is closed).
The migration runs AFTER the phase-2b ledger and Stripe files, as it does live (the table-wide grant it narrows is made there). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_credit_prices_hidden.py -v

What it proves, each with the opposite case beside it
  * a signed-in person still reads every column of credit_prices except price_cents (the page's film-cost line selects credits, so it keeps working) and the rows themselves; price_cents, and a select of every column, are refused; anonymous callers read nothing;
  * granting price_cents back (what live step 69 part 4 does) shows it again, and revoking it (step 70 part 3) hides it again;
  * the rollback puts the table-wide read back; live step 67 says so before and after.
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as ledger  # noqa: E402

ROOT = core.ROOT
MIG = ROOT / "migrations" / "20261123000800_credit_prices_hide_money.sql"
LATER = ROOT / "migrations" / "20261123000900_checkout_tax_profile.sql"
RB = ROOT / "rollbacks" / "20261123000800_credit_prices_hide_money_rollback.sql"
S67 = (ROOT / "live-steps" / "67_credit_prices_hidden_check.sql").read_text(encoding="utf-8")
RYAN = core.RYAN
_server = None
_count = 0


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-pricehide-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmplph")
        c.execute("create database tmplph")
    with psycopg.connect(_server.get_uri(database="tmplph"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in [p for p in core.MIGRATIONS if p.name not in (MIG.name, LATER.name)]:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute(ledger.LEDGER.read_text(encoding="utf-8"))
        c.execute((ROOT / "phase-2b" / "stripe_test_mode.sql").read_text(encoding="utf-8"))
        c.execute((ROOT / "phase-2b" / "stripe_refunds_disputes.sql").read_text(encoding="utf-8"))
        c.execute(MIG.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s, 'ryan@x')", (RYAN,))


class PricesHidden(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"ph{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template tmplph")
        self.db = core.Db(_server.get_uri(database=self.name))

    def tearDown(self):
        self.db.c.close()

    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def test_a_signed_in_person_reads_everything_but_the_money(self):
        rows = self.db.as_(RYAN).c.execute("select price_version, code, credits, monthly, effective_from from public.credit_prices").fetchall()
        self.assertGreaterEqual(len(rows), 5, "the rows are still visible, with their credits")
        self.assertIn(("pack_starter", 10), [(r[1], r[2]) for r in rows])
        self.assertGreaterEqual(self.db.as_(RYAN).one("select count(*) from public.credit_prices"), 5)
        for sql in ("select price_cents from public.credit_prices", "select * from public.credit_prices",
                    "select code from public.credit_prices where price_cents > 0"):
            with self.assertRaises(psycopg.Error, msg=sql):
                self.db.as_(RYAN).one(sql)

    def test_anonymous_callers_read_nothing(self):
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select count(*) from public.credit_prices")

    def test_granting_price_cents_back_shows_it_and_revoking_hides_it_again(self):
        self.db.as_(None).c.execute("grant select (price_cents) on public.credit_prices to authenticated")
        self.assertIn(1200, [r[0] for r in self.db.as_(RYAN).c.execute("select price_cents from public.credit_prices").fetchall()])
        self.db.as_(None).c.execute("revoke select (price_cents) on public.credit_prices from authenticated")
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select price_cents from public.credit_prices")

    def test_the_rollback_puts_the_table_wide_read_back_and_step_67_says_so_before_and_after(self):
        rows = self.db.as_(None).c.execute(S67).fetchall()
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(r[1] is True for r in rows), rows)
        self.db.as_(None).c.execute(RB.read_text(encoding="utf-8"))
        self.assertIn(1200, [r[0] for r in self.db.as_(RYAN).c.execute("select price_cents from public.credit_prices").fetchall()])
        rows = self.db.as_(None).c.execute(S67).fetchall()
        self.assertEqual([r[1] for r in rows], [True, False, True, True], rows)


if __name__ == "__main__":
    unittest.main()
