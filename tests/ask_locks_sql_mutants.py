"""Must-fail proof for supabase/tests/test_ask_locks.py: each mutant breaks ONE rule of the ask-lock migration (20261109000300_ask_locks.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/ask_locks_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
The migration is GENERATED (supabase/tests/build_ask_locks_migration.py), so the texts a mutant breaks are taken from the same builder: whole function statements and the md5 lines of the drift check.
The rollback file is not mutated here (the runner patches one file); its two directions and its own drift check are proved by the tests that run it.
"""
import importlib.util
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

_spec = importlib.util.spec_from_file_location("build_ask_locks", W.ROOT / "supabase" / "tests" / "build_ask_locks_migration.py")
BL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(BL)
P = {p["name"]: p for p in BL.pieces()}
CREATE = lambda s: s.replace("create function ", "create or replace function ", 1)

W.MIG = "supabase/migrations/20261109000300_ask_locks.sql"
W.TEST = "supabase/tests/test_ask_locks.py"
W.SCRATCH = W.ROOT / ".mut_ask_locks"
W.RUN_TMP = W.base.BASE_TEMP / f"ask-locks-mut-{os.getpid()}"

M = []
for name, p in P.items():
    nw = CREATE(p["new"])
    M.append((f"{name} is written WITHOUT the lock", nw, CREATE(p["old"])))
    M.append((f"the drift check of {name} is removed (a drifted live function is replaced silently)", f"  if cur <> '{p['old_md5']}' then\n", "  if false then\n"))
    M.append((f"{name} is not left alone when it already has the lock", f"  if cur = '{p['new_md5']}' then raise notice '{name}: nothing to do (already in the wanted state).'; return; end if;\n", ""))
    M.append((f"{name} is created when it is not on the database", f"  if cur is null then raise notice '{name} is not on this database: skipped.'; return; end if;\n", ""))
# one lock for everybody: the place ask's own key is the same for every person
M.append(("one lock for everybody: another person's ask waits behind this one", CREATE(P["connect_geo_ask"]["new"]),
          CREATE(P["connect_geo_ask"]["new"]).replace("hashtextextended('geo:' || me::text, 0)", "hashtextextended('geo:', 0)")))
M.append(("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"))
W.MUTANTS[:] = M

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
