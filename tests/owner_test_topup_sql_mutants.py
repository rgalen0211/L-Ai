"""Must-fail proof for supabase/tests/test_owner_test_topup.py: each mutant breaks ONE rule of the owner-only test credit top-up (migration 20261127000100_owner_test_topup.sql) in a scratch copy and the SQL tests must then FAIL.
BUILDER 2026-11-27 (FACES 08:51: a committed runner, so a reviewer can rerun the planted faults). Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/owner_test_topup_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261127000100_owner_test_topup.sql"
W.TEST = "supabase/tests/test_owner_test_topup.py"
W.SCRATCH = W.ROOT / ".mut_owner_test_topup"
W.RUN_TMP = W.base.BASE_TEMP / f"owner_test_topup-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ('no owner list (any account)', 'from ryagram_private.test_topup_accounts a join auth.users u on u.id = a.user_id', 'from auth.users u join auth.users a on a.id = u.id'),
    ('no day limit', 'if recent + p_credits > 200 then', 'if recent + p_credits > 200000 then'),
    ('undo ignores what is spent', 'back := least(t.credits, left_over);', 'back := t.credits;'),
    ('any signed-in person may top up', 'declare me uuid := ryagram_private.require_admin();           -- an admin acts', 'declare me uuid := ryagram_private.require_signed_in();           -- an admin acts'),
    ('undo twice', 'if t.undone_at is not null then', 'if false then'),
    ('top-up of 500', 'if p_credits is null or p_credits not between 1 and 100 then', 'if p_credits is null or p_credits not between 1 and 1000 then'),
    ('a note of blanks only is accepted', "  if p_note is null or char_length(btrim(p_note, E' \\t\\r\\n')) not between 3 and 200 then\n    raise exception 'Say what the credits are for", "  if p_note is null or char_length(p_note) not between 3 and 200 then\n    raise exception 'Say what the credits are for"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
