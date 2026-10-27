"""Credit shapes for the five datasets WEB found unpriced (20261017000800_dataset_shapes.sql, phase-2b seed).

  * fresh build (stub, migrations, phase-2b ledger): each of the five has a 'standard' row and a full film quotes at
    the standard price instead of being refused;
  * live order (the ledger applied BEFORE the five were in its seed, then 000800, run twice): the rows arrive, once;
  * no ledger at all (the 2A-only suites): 000800 is a no-op, not an error;
  * must-fail: with one row removed, that dataset's full-film quote is refused again.

Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_dataset_shapes.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

FIVE = ("bps_county_unit_share_1", "bps_county_unit_share_2to4", "bps_county_unit_share_5plus", "bps_us_unit_mix",
        "fhwa_hm212")
FIX = core.ROOT / "migrations" / "20261017000800_dataset_shapes.sql"
# Q291 (2026-10-27): the state income index, priced the same way by its own migration.
INCOME = "bea_sainc1_state_income_index"
FIX_INCOME = core.ROOT / "migrations" / "20261027000700_bea_income_shape.sql"


def setUpModule():
    credits.setUpModule()


class Shapes(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, grant = credits.Ledger.admin, credits.Ledger.grant
    version = credits.Ledger.version

    def quote(self, dataset):
        vid = self.version("line", dataset=dataset)
        return self.db.as_(credits.RYAN).one("select price_code, credits from credit_quote(%s, 'final_render')", vid)

    def test_fresh_build_prices_all_five_as_standard(self):
        self.grant(100)
        standard = self.quote("test_standard")
        for d in FIVE:
            with self.subTest(dataset=d):
                self.assertEqual(self.admin("select shape from credit_dataset_shapes where dataset = %s", d), "standard")
                self.assertEqual(self.quote(d), standard)

    def test_live_order_then_the_migration_twice(self):
        self.admin("delete from credit_dataset_shapes where dataset = any(%s) returning 1", list(FIVE))  # as live was
        self.assertEqual(self.admin("select count(*) from credit_dataset_shapes where dataset = any(%s)", list(FIVE)), 0)
        for _ in range(2):
            self.db.as_(None).c.execute(FIX.read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select count(*) from credit_dataset_shapes where dataset = any(%s) "
                                    "and shape = 'standard'", list(FIVE)), 5)

    def test_must_fail_a_missing_row_is_refused_again(self):
        self.grant(100)
        self.admin("delete from credit_dataset_shapes where dataset = 'fhwa_hm212' returning 1")
        with self.assertRaises(psycopg.Error):
            self.quote("fhwa_hm212")

    def test_income_index_fresh_live_order_and_must_fail(self):
        self.grant(100)
        standard = self.quote("test_standard")
        self.assertEqual(self.admin("select shape from credit_dataset_shapes where dataset = %s", INCOME), "standard")
        self.assertEqual(self.quote(INCOME), standard)
        self.admin("delete from credit_dataset_shapes where dataset = %s returning 1", INCOME)   # as live is today
        with self.assertRaises(psycopg.Error):
            self.quote(INCOME)                                                                 # must-fail: refused
        for _ in range(2):
            self.db.as_(None).c.execute(FIX_INCOME.read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select count(*) from credit_dataset_shapes where dataset = %s and shape = 'standard'",
                                    INCOME), 1)
        self.assertEqual(self.quote(INCOME), standard)


class NoLedger(unittest.TestCase):
    def test_the_migration_is_a_no_op_without_the_ledger(self):
        with psycopg.connect(credits._server.get_uri(), autocommit=True) as c:
            c.execute("drop database if exists shapes_noledger")
            c.execute("create database shapes_noledger template tmpl2b")
        with psycopg.connect(credits._server.get_uri(database="shapes_noledger"), autocommit=True) as c:
            c.execute("drop table public.credit_dataset_shapes cascade")
            c.execute(FIX.read_text(encoding="utf-8"))           # must not raise
            c.execute(FIX_INCOME.read_text(encoding="utf-8"))    # must not raise
            self.assertIsNone(c.execute("select to_regclass('public.credit_dataset_shapes')").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
