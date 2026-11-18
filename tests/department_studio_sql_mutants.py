"""Must-fail proof for supabase/tests/test_department_studio.py: each mutant breaks ONE rule of the Studio department row (the migration, its rollback or its after-check) in a scratch copy and the SQL tests must FAIL.
Run from the repo root with the pgserver venv and TEMP on D: (PYTHONPATH with the yaml shim for the venv):
    pgvenv/Scripts/python tests/department_studio_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

M = "supabase/migrations/20261118000100_department_studio.sql"
R = "supabase/rollbacks/20261118000100_department_studio_rollback.sql"
C = "supabase/live-steps/29_department_studio_after_check.sql"
W.MIG = M
W.TEST = "supabase/tests/test_department_studio.py"
W.SCRATCH = W.ROOT / ".mut_studio"
W.RUN_TMP = W.base.BASE_TEMP / f"studio-mut-{os.getpid()}"

ROW = "values ('studio', 'Studio', 'soon', false, 60)"
W.MUTANTS[:] = [
    ("Studio is promoted: it would open, with nothing behind it", [(M, ROW, "values ('studio', 'Studio', 'working', false, 60)")]),
    ("Studio sorts before the others, not last", [(M, ROW, "values ('studio', 'Studio', 'soon', false, 5)")]),
    ("Studio needs the local-compute flag, so it reads differently for different accounts", [(M, ROW, "values ('studio', 'Studio', 'soon', true, 60)")]),
    ("the label is not Studio", [(M, ROW, "values ('studio', 'Studios', 'soon', false, 60)")]),
    ("running the migration twice fails (no on-conflict)", [(M, " on conflict (id) do nothing;", ";")]),
    ("the waiting-list gate line is not last", [(M, "select ryagram_private.gate_apply();", "select 1;")]),
    ("a second department row rides along", [(M, ROW, ROW + ", ('studio_two', 'Studio Two', 'soon', false, 70)")]),
    ("the migration also promotes another department", [(M, "select ryagram_private.gate_apply();", "update public.departments set status = 'working' where id = 'games';\nselect ryagram_private.gate_apply();")]),
    ("the migration also drops people's interest rows", [(M, "select ryagram_private.gate_apply();", "delete from public.department_interest;\nselect ryagram_private.gate_apply();")]),
    ("the rollback deletes every department", [(R, "delete from public.departments where id = 'studio';", "delete from public.departments;")]),
    ("the rollback deletes nothing", [(R, "delete from public.departments where id = 'studio';", "delete from public.departments where id = 'nothing';")]),
    ("the rollback also deletes another department's interest rows", [(R, "delete from public.departments where id = 'studio';", "delete from public.departments where id = 'studio';\ndelete from public.department_interest;")]),
    ("the after-check does not look at the label", [(C, "d.label = 'Studio' and ", "")]),
    ("the after-check passes when the row is missing", [(C, "where d.id = 'studio'), false) as ok", "where d.id = 'studio'), true) as ok")]),
    ("the after-check drops its last check", [(C, "union all select 'nothing is wired to send anything about departments (no trigger on the two tables)',\n       not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('departments', 'department_interest') and not t.tgisinternal);",
      ";")]),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
