"""Must-fail proof for the CLOSING draft (supabase/connect-drafts/20261110000300_waitlist_close_direct_insert.sql) against supabase/tests/test_waitlist_join.py: each mutant breaks ONE rule of it in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/waitlist_close_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/connect-drafts/20261110000300_waitlist_close_direct_insert.sql"
W.TEST = "supabase/tests/test_waitlist_join.py"
W.SCRATCH = W.ROOT / ".mut_waitlist_close"
W.RUN_TMP = W.base.BASE_TEMP / f"waitlist-close-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("the insert policy is left in place", 'drop policy if exists "Visitors can join the waitlist" on public.ryagram_waitlist;', "select 1;"),
    ("the insert grant is left in place", "revoke insert on table public.ryagram_waitlist from anon, authenticated;", "select 1;"),
    ("only visitors are shut out, not signed-in people", "revoke insert on table public.ryagram_waitlist from anon, authenticated;", "revoke insert on table public.ryagram_waitlist from anon;"),
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
