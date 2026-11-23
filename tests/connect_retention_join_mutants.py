"""Must-fail proof for the two CONNECT tests in supabase/tests/test_retention_purge.py (the join and invite-guess records are really purged, migration 20261123000400): each mutant breaks ONE thing in a scratch copy of the supabase
folder and the tests must then FAIL. A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. One runner at a time, alone (it starts a Postgres per run). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python tests/connect_retention_join_mutants.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("TEMP", ".")) / "mut-retentionjoin"
M = "supabase/migrations/20261123000400_retention_join_attempts.sql"
R = "supabase/rollbacks/20261123000400_retention_join_attempts_rollback.sql"
MUTANTS = [
    ("the join attempts are not deleted", M, "  delete from public.join_attempts where at < now() - interval '2 days';\n", ""),
    ("the join attempts are kept a day too long (3 days)", M, "delete from public.join_attempts where at < now() - interval '2 days';", "delete from public.join_attempts where at < now() - interval '3 days';"),
    ("the join attempts are deleted too early (1 day)", M, "delete from public.join_attempts where at < now() - interval '2 days';", "delete from public.join_attempts where at < now() - interval '1 day';"),
    ("the invite guesses are not deleted", M, "  delete from public.invite_attempts where at < now() - interval '1 day';\n", ""),
    ("the answer no longer says how many join attempts went", M, "'join_attempts', join_tries,", "'join_attempts', 0,"),
    ("the purge no longer runs only once a day", M, "  if (select last_run_on from public.retention_runs) = today then\n    return jsonb_build_object('skipped', true);\n  end if;\n", ""),
    ("the older retention undo no longer refuses while the newer purge is applied", "supabase/rollbacks/20261121000400_retention_outbox_support_rollback.sql", "like '%join_attempts%' then", "like '%no_such_text%' then"),
    ("the rollback keeps the new deletes", R, "  update public.retention_runs set last_run_on = today;", "  delete from public.join_attempts where at < now() - interval '2 days';\n  update public.retention_runs set last_run_on = today;"),
]


def fresh():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", ignore=shutil.ignore_patterns("__pycache__"))


def run():
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", "-m", "unittest", "-k", "CONNECT_", "supabase/tests/test_retention_purge.py"], cwd=SCRATCH, capture_output=True, text=True, env=env, timeout=900)
    return r.returncode, (r.stdout + r.stderr)[-500:]


fresh()
rc, tail = run()
if rc:
    print("BASELINE FAILS (nothing proved)\n" + tail)
    shutil.rmtree(SCRATCH, ignore_errors=True)
    sys.exit(2)
print("baseline passes")
missed = 0
for name, rel, old, new in MUTANTS:
    fresh()
    p = SCRATCH / rel
    t = p.read_text(encoding="utf-8").replace("\r\n", "\n")
    n = t.count(old)
    if n != 1:
        print(f"BROKEN MUTANT (text found {n} times, need 1): {name}")
        missed += 1
        continue
    p.write_text(t.replace(old, new), encoding="utf-8")
    rc, _ = run()
    print(("caught  " if rc else "MISSED  ") + name)
    missed += 0 if rc else 1
shutil.rmtree(SCRATCH, ignore_errors=True)
print(f"{missed} mutant(s) not caught" if missed else f"all {len(MUTANTS)} mutants caught")
sys.exit(1 if missed else 0)
