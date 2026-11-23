"""Must-fail proof for supabase/tests/test_welcome_credits.py (welcome credits, migration 20261123000600 + live step 63): each mutant breaks ONE thing in a scratch copy of the supabase folder and the tests must then FAIL.
A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. One runner at a time, alone (it starts a Postgres per run). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python tests/connect_welcome_credits_mutants.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("TEMP", ".")) / "mut-welcome"
M = "supabase/migrations/20261123000600_welcome_credits.sql"
R = "supabase/rollbacks/20261123000600_welcome_credits_rollback.sql"
C = "supabase/live-steps/63_welcome_credits_check.sql"
MUTANTS = [
    ("a second account of the same address gets the credits again", M, "    if not found then return new; end if;                                                               -- this address has had its welcome credits already, whichever account it was\n", ""),
    ("the address is not lower-cased before it is scrambled", M, "mail := lower(btrim(new.email));", "mail := btrim(new.email);"),
    ("an unverified sign-up gets credits", M, "    if new.email_confirmed_at is null or btrim(coalesce(new.email, '')) = '' then return new; end if;\n", ""),
    ("the setting is ignored (always 8)", M, "n := coalesce((select o.welcome_credits from public.ops_settings o limit 1), 0);", "n := 8;"),
    ("an invite-code account is given 8 more", M, " or exists (select 1 from public.invite_redemptions r where r.email = mail)", ""),
    ("an account marked adult_source invite is given 8 more", M, "coalesce(new.raw_user_meta_data ->> 'adult_source', '') = 'invite' or ", ""),
    ("an administrator is given credits", M, " or exists (select 1 from public.app_admins a where a.user_id = new.id)", ""),
    ("a worker is given credits", M, "exists (select 1 from public.workers w where w.user_id = new.id) or ", ""),
    ("an error can stop a sign-up", M, "    raise warning 'welcome credits not granted: %', sqlstate;                                           -- never a failed sign-up or link click", "    raise;"),
    ("the once-per-address table keeps the user id", M, "  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),\n", "  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),\n  user_id uuid,\n"),
    ("the table is open to the service role", M, "revoke all on ryagram_private.welcome_credit_grants from public, anon, authenticated, service_role;", "revoke all on ryagram_private.welcome_credit_grants from public, anon, authenticated;\ngrant select on ryagram_private.welcome_credit_grants to service_role;"),
    ("the amount can be negative", M, " check (welcome_credits between 0 and 100)", ""),
    ("the trigger only watches inserts", M, "after insert or update of email_confirmed_at on auth.users", "after insert on auth.users"),
    ("the rollback keeps the table", R, "drop table ryagram_private.welcome_credit_grants;\n", ""),
    ("the check no longer looks at the trigger", C, "and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE OF email_confirmed_at%'", ""),
]


def fresh():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", ignore=shutil.ignore_patterns("__pycache__"))


def run():
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", "-m", "unittest", "supabase/tests/test_welcome_credits.py"], cwd=SCRATCH, capture_output=True, text=True, env=env, timeout=900)
    return r.returncode, (r.stdout + r.stderr)[-500:]


fresh()
rc, tail = run()
if rc:
    print("BASELINE FAILS (nothing proved)\n" + tail)
    shutil.rmtree(SCRATCH, ignore_errors=True)
    sys.exit(2)
print("baseline passes", flush=True)
missed = 0
for name, rel, old, new in MUTANTS:
    fresh()
    p = SCRATCH / rel
    t = p.read_text(encoding="utf-8").replace("\r\n", "\n")
    n = t.count(old)
    if n != 1:
        print(f"BROKEN MUTANT (text found {n} times, need 1): {name}", flush=True)
        missed += 1
        continue
    p.write_text(t.replace(old, new), encoding="utf-8")
    rc, _ = run()
    print(("caught  " if rc else "MISSED  ") + name, flush=True)
    missed += 0 if rc else 1
shutil.rmtree(SCRATCH, ignore_errors=True)
print(f"{missed} mutant(s) not caught" if missed else f"all {len(MUTANTS)} mutants caught")
sys.exit(1 if missed else 0)
