"""The undo of phase-2b/stripe_refunds_disputes.sql (LAUNCH-LIVE-STEPS P3 / F6) on a local Postgres, GEO 2026-11-22.

rollbacks/phase-2b_stripe_refunds_disputes_rollback.sql must put the database back EXACTLY as stripe_test_mode.sql left it:
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

    def test_GEO_must_fail_an_undo_that_leaves_one_body_new_is_seen(self):
        # MUST-FAIL: the rollback without its stripe_checkout_context statement leaves the new body (with buying_open), and
        # without the column drop would also leave the column; this test's comparison must notice either
        rb = text(ROLLBACK).replace("\r\n", "\n")
        start = rb.index("create or replace function public.stripe_checkout_context(")
        end = rb.index("$$;", rb.index("$$", start) + 2) + 3
        partial = rb[:start] + rb[end:]
        partial = partial.replace("alter table public.stripe_settings drop column buying_open;", "")
        self.assertTrue(diff(fresh(), fresh(text(DISPUTES), partial)), "a partial undo went unnoticed")

    def test_GEO_must_fail_an_undo_that_keeps_the_dispute_helper_is_seen(self):
        rb = text(ROLLBACK).replace("drop function ryagram_private.stripe_dispute(text, text, jsonb);", "")
        self.assertTrue(diff(fresh(), fresh(text(DISPUTES), rb)), "a left-over stripe_dispute went unnoticed")


if __name__ == "__main__":
    unittest.main()
