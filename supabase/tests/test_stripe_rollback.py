"""The undo of phase-2b/stripe_refunds_disputes.sql (LAUNCH-LIVE-STEPS P3 / F6) on a local Postgres, GEO 2026-11-22.

rollbacks/phase-2b_stripe_refunds_disputes_rollback.sql must put the database back EXACTLY as stripe_test_mode.sql left it
(with gate_apply run after it, as on live):
every function body and grant in public and ryagram_private, every column, every policy and every table grant. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_stripe_rollback.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as ledger  # noqa: E402

ROOT = core.ROOT
STRIPE = ROOT / "phase-2b" / "stripe_test_mode.sql"
DISPUTES = ROOT / "phase-2b" / "stripe_refunds_disputes.sql"
ROLLBACK = ROOT / "rollbacks" / "phase-2b_stripe_refunds_disputes_rollback.sql"
_server = None
_count = 0

SNAPSHOT = [
    # every function in the two schemas the files touch: signature, full definition, grants
    """select p.oid::regprocedure::text, pg_get_functiondef(p.oid), coalesce(p.proacl::text, '')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'ryagram_private') and p.prokind = 'f' order by 1""",
    # every column of every public table
    """select table_name, column_name, data_type, coalesce(column_default, ''), is_nullable
         from information_schema.columns where table_schema = 'public' order by 1, 2""",
    # every table and its grants
    """select c.relname, coalesce(c.relacl::text, ''), c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1""",
    # every policy
    """select tablename, policyname, cmd, coalesce(qual, ''), coalesce(with_check, '') from pg_policies where schemaname = 'public' order by 1, 2""",
]


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-striperb-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmplrb")
        c.execute("create database tmplrb")
    with psycopg.connect(_server.get_uri(database="tmplrb"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in [*core.MIGRATIONS, ledger.LEDGER, STRIPE]:
            c.execute(path.read_text(encoding="utf-8"))
        # The 'before' is live's state: every migration applied after the 2B files re-runs gate_apply, so on live the ledger and
        # Stripe tables already carry its account_gate policies and gated bodies (WORKER 13:57: without this the baseline was wrong)
        c.execute("select ryagram_private.gate_apply()")


def fresh(*texts):
    """A new database from the template (stripe_test_mode applied), then each SQL text in order. Returns its snapshot."""
    global _count
    _count += 1
    name = f"rb{_count}"
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute(f"create database {name} template tmplrb")
    with psycopg.connect(_server.get_uri(database=name), autocommit=True) as c:
        for t in texts:
            c.execute(t)
        return [c.execute(q).fetchall() for q in SNAPSHOT]


def text(path):
    return path.read_text(encoding="utf-8")


def diff(a, b):
    out = []
    for i, (x, y) in enumerate(zip(a, b)):
        out += [f"snapshot {i}: only before: {r[:2]}" for r in sorted(set(x) - set(y))]
        out += [f"snapshot {i}: only after: {r[:2]}" for r in sorted(set(y) - set(x))]
    return out


class StripeRollback(unittest.TestCase):
    def test_GEO_the_undo_puts_back_exactly_what_stripe_test_mode_left(self):
        before = fresh()
        applied = fresh(text(DISPUTES))
        self.assertTrue(diff(before, applied), "the file under undo changes nothing, so this test proves nothing")
        after = fresh(text(DISPUTES), text(ROLLBACK))
        self.assertEqual(diff(before, after), [])

    def test_GEO_after_the_undo_the_lock_can_be_applied_again(self):
        self.assertEqual(diff(fresh(text(DISPUTES)), fresh(text(DISPUTES), text(ROLLBACK), text(DISPUTES))), [])

    def test_GEO_run_where_the_forward_file_never_ran_it_stops_and_changes_nothing(self):
        # WORKER 13:57 LOW 3: the drops have no 'if exists', so the one-transaction file must stop and leave the database as it was
        global _count
        _count += 1
        name = f"rb{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name} template tmplrb")
        with psycopg.connect(_server.get_uri(database=name), autocommit=True) as c:
            before = [c.execute(q).fetchall() for q in SNAPSHOT]
            with self.assertRaises(psycopg.Error):
                c.execute(text(ROLLBACK))
            c.execute("rollback")
            self.assertEqual(diff(before, [c.execute(q).fetchall() for q in SNAPSHOT]), [])

    def test_GEO_must_fail_an_undo_missing_any_one_of_its_six_parts_is_seen(self):
        # MUST-FAIL, one part at a time (WORKER 13:57 LOW 1): each of the three restored bodies and each of the three drops,
        # left out alone, must leave a difference this test's comparison sees
        rb = text(ROLLBACK).replace("\r\n", "\n")

        def body(head):
            start = rb.index(head)
            return rb[start:rb.index("$$;", rb.index("$$", start) + 2) + 3]

        parts = {
            "stripe_apply body": body("create or replace function public.stripe_apply("),
            "stripe_refund body": body("create or replace function ryagram_private.stripe_refund("),
            "stripe_checkout_context body": body("create or replace function public.stripe_checkout_context("),
            "drop stripe_dispute": "drop function ryagram_private.stripe_dispute(text, text, jsonb);",
            "drop stripe_partial_refunds": "drop table public.stripe_partial_refunds;",
            "drop buying_open": "alter table public.stripe_settings drop column buying_open;",
        }
        before = fresh()
        for name, part in parts.items():
            with self.subTest(left_out=name):
                self.assertEqual(rb.count(part), 1)
                self.assertTrue(diff(before, fresh(text(DISPUTES), rb.replace(part, ""))), f"an undo without its {name} went unnoticed")


if __name__ == "__main__":
    unittest.main()
