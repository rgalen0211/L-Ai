"""Must-fail proof for supabase/tests/test_department_switches.py: each mutant breaks ONE rule of the top bar per account (department switches) (migration 20261127000250_department_switches.sql) in a scratch copy and the SQL tests must then FAIL.
BUILDER 2026-11-27 (FACES 08:51: a committed runner, so a reviewer can rerun the planted faults). Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/dept_switches_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261127000250_department_switches.sql"
W.TEST = "supabase/tests/test_department_switches.py"
W.SCRATCH = W.ROOT / ".mut_dept_switches"
W.RUN_TMP = W.base.BASE_TEMP / f"dept_switches-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ('Perfect City reads the wrong switch name', "when 'geo_intelligence' then 'perfectCity' end", "when 'geo_intelligence' then 'geoIntelligence' end"),
    ('a worker counts', '     and not exists (select 1 from public.workers w where w.user_id = p_owner)', '     and true'),
    ('the bar is not changed', '    execute replace(def, o, nw);', '    null;'),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
