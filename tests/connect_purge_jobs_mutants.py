"""Must-fail proof for supabase/tests/test_purge_jobs_steps.py (live steps 54 to 57, the two purge jobs): each mutant breaks ONE thing in a scratch copy of the four step files and the test must then FAIL.
A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. One runner at a time, alone (it starts a Postgres per run). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python tests/connect_purge_jobs_mutants.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("TEMP", ".")) / "mut-purgejobs"
S = "supabase/live-steps/"
F53, F54, F55, F56 = (next((ROOT / S).glob(f"{n}_*.sql")).name for n in (54, 55, 56, 57))
MUTANTS = [
    ("55 schedules without checking the secrets", S + F54, "    raise exception 'Not scheduled:", "    null; -- raise exception 'Not scheduled:"),
    ("55 lets a 31-character secret through", S + F54, "where s.name = 'cron_purge_uploads'), false)\n     or", "where s.name = 'cron_purge_uploads'), true)\n     or"),
    ("55 reads the service-role key", S + F54, "where name = 'cron_purge_uploads')),", "where name = 'service_role_key')),"),
    ("55 gives purge-partial-uploads the other job's secret", S + F54, "where name = 'cron_purge_partial')),", "where name = 'cron_purge_uploads')),"),
    ("55 runs both jobs at :00", S + F54, "'30 * * * *'", "'0 * * * *'"),
    ("55 calls the wrong function for the partial job", S + F54, "functions/v1/purge-partial-uploads'", "functions/v1/purge-uploads'"),
    ("54 no longer compares the secrets with each other", S + F53, "count(distinct s.decrypted_secret) = count(*)", "true"),
    ("54 no longer checks the length", S + F53, "bool_and(length(s.decrypted_secret) >= 32) from vault.decrypted_secrets s where s.name = 'cron_purge_uploads'", "true from vault.decrypted_secrets s where s.name = 'cron_purge_uploads'"),
    ("56 accepts a job that reads the service key", S + F55, "and j.command not like '%service_role_key%'\n", "\n"),
    ("56 does not look at the last run's status", S + F55, "= 'succeeded'), false)", "is not null), false)"),
    ("56 ignores a refused call", S + F55, "count(*) filter (where r.status_code is distinct from 200) = 0 and ", ""),
    ("56 looks at every function's calls, not only the purge ones", S + F55, "where q.url like '%/functions/v1/purge-%' and ", "where "),
    ("57 unschedules every job", S + F56, "if exists (select 1 from cron.job where jobname = 'purge-uploads') then perform cron.unschedule('purge-uploads'); end if;", "perform cron.unschedule(jobname) from cron.job;"),
    ("57 fails when a job is not there", S + F56, "if exists (select 1 from cron.job where jobname = 'purge-partial-uploads') then perform cron.unschedule('purge-partial-uploads'); end if;", "perform cron.unschedule('purge-partial-uploads');"),
]


def fresh():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    (SCRATCH / "supabase" / "tests").mkdir(parents=True)
    (SCRATCH / "supabase" / "live-steps").mkdir(parents=True)
    for n in ("test_purge_jobs_steps.py", "test_2a_core.py"):
        shutil.copy(ROOT / "supabase" / "tests" / n, SCRATCH / "supabase" / "tests" / n)
    for f in (F53, F54, F55, F56):
        shutil.copy(ROOT / S / f, SCRATCH / S / f)
    (SCRATCH / "tests").mkdir()
    shutil.copy(ROOT / "tests" / "supabase_stub.sql", SCRATCH / "tests" / "supabase_stub.sql") if (ROOT / "tests" / "supabase_stub.sql").exists() else None


def run():
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", "-m", "unittest", "supabase/tests/test_purge_jobs_steps.py"], cwd=SCRATCH, capture_output=True, text=True, env=env, timeout=600)
    return r.returncode, (r.stdout + r.stderr)[-600:]


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
