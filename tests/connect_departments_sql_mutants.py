"""Must-fail proof for supabase/tests/test_connect_departments.py: each mutant breaks ONE rule of migrations/20261113000200_connect_departments.sql in a scratch copy and the SQL tests must FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/connect_departments_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261113000200_connect_departments.sql"
W.TEST = "supabase/tests/test_connect_departments.py"
W.SCRATCH = W.ROOT / ".mut_dept"
W.RUN_TMP = W.base.BASE_TEMP / f"dept-mut-{os.getpid()}"

SIG = "public.connect_my_departments(text)"
W.MUTANTS[:] = [
    ("the person is not resolved from the token (anyone's token answers for nobody)", "declare me uuid := ryagram_private.connect_actor(p_token_hash, 'read');", "declare me uuid := null;"),
    ("the local-compute rule is skipped (the raw table is read)", "from ryagram_private.departments_for(me) x);", "from (select d.id, d.label, d.status, d.sort from public.departments d) x);"),
    ("the site's order is not kept", "order by x.sort, x.id)", "order by x.id)"),
    ("an extra key leaks (the sort number)", "'status', x.status)", "'status', x.status, 'sort', x.sort)"),
    ("any signed-in person can run it", "grant execute on function " + SIG + " to connect_runner;", "grant execute on function " + SIG + " to connect_runner, authenticated;"),
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
    ("it is not security definer", "language plpgsql security definer set search_path = '' as $$", "language plpgsql set search_path = '' as $$"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
