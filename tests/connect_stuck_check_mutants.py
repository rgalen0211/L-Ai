"""Must-fail proof for the two stuck-redemption tests in supabase/tests/test_join_open.py (live step 53, what the repair line may list): each mutant breaks ONE thing in a scratch copy of the supabase folder and the tests must then FAIL.
A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. One runner at a time, alone (it starts a Postgres per run). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python tests/connect_stuck_check_mutants.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("TEMP", ".")) / "mut-stuckcheck"
F = "supabase/live-steps/53_stuck_invite_redemptions_check.sql"
MUTANTS = [
    ("lists every pending row of an email, not only the newest", F, "select distinct on (r.email) r.id, r.email, r.created_at", "select r.id, r.email, r.created_at"),
    ("lists the OLDEST pending row of an email", F, "order by r.email, r.created_at desc, r.id desc", "order by r.email, r.created_at asc, r.id asc"),
    ("lists an email that already has a sent redemption", F, "     and not exists (select 1 from public.invite_redemptions s where s.email = r.email and s.status = 'sent')\n", ""),
    ("lists an account that existed before the redemption", F, " and u.created_at >= n.created_at", ""),
    ("lists a redemption younger than 10 minutes", F, "  from stuck k where k.created_at < now() - interval '10 minutes';", "  from stuck k;"),
    ("lists a redemption that was released", F, "   where r.status = 'pending'\n", "   where r.status in ('pending', 'released')\n"),
    ("the count row counts something else", F, "  from stuck where created_at < now() - interval '10 minutes'\nunion all", "  from stuck\nunion all"),
]


def fresh():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", ignore=shutil.ignore_patterns("__pycache__"))


def run():
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", "-m", "unittest", "-k", "stuck_redemption", "supabase/tests/test_join_open.py"], cwd=SCRATCH, capture_output=True, text=True, env=env, timeout=900)
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
