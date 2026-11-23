"""Must-fail proof for supabase/tests/test_welcome_repair.py (the welcome repair, live step 66): each mutant breaks ONE thing in a scratch copy of the supabase folder and the tests must then FAIL.
A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. One runner at a time, alone (it starts a Postgres per run). Run from the repo root with TEMP on D::
    pgvenv/Scripts/python tests/connect_welcome_repair_mutants.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("TEMP", ".")) / "mut-welcomerepair"
S = "supabase/live-steps/66_welcome_credits_repair.sql"
MUTANTS = [
    ("the repair runs while the lever is 0", S, "  if n <= 0 then\n    raise exception 'Not run: the welcome lever is 0. Put it back (update public.ops_settings set welcome_credits = 8) and run this again.';\n  end if;\n", ""),
    ("part 2 uses a different window than part 1", S, "     where (u.email_confirmed_at > now() - interval '48 hours'", "     where (u.email_confirmed_at > now() - interval '72 hours'"),
    ("a signed-in unconfirmed account is not paid", S, "            or (u.email_confirmed_at is null and u.last_sign_in_at > now() - interval '48 hours'))\n       and btrim", "            )\n       and btrim"),
    ("an unconfirmed account that never signed in is paid", S, "            or (u.email_confirmed_at is null and u.last_sign_in_at > now() - interval '48 hours'))\n       and btrim", "            or (u.email_confirmed_at is null))\n       and btrim"),
    ("an invite-code account is paid", S, "       and not exists (select 1 from public.invite_redemptions q where q.email = lower(btrim(u.email)))\n", ""),
    ("an administrator is paid", S, "       and not exists (select 1 from public.app_admins a where a.user_id = u.id)\n       and not exists (select 1 from public.invite_redemptions q", "       and not exists (select 1 from public.invite_redemptions q"),
    ("a worker is paid", S, "       and not exists (select 1 from public.workers x where x.user_id = u.id)\n       and not exists (select 1 from public.app_admins a where a.user_id = u.id)\n       and not exists (select 1 from public.invite_redemptions q", "       and not exists (select 1 from public.app_admins a where a.user_id = u.id)\n       and not exists (select 1 from public.invite_redemptions q"),
    ("the address is not recorded (a second run pays again)", S, "    insert into ryagram_private.welcome_credit_grants (email_hash) values (eh) on conflict (email_hash) do nothing;\n    if found then", "    if true then"),
    ("an address that already has its record is paid again", S, "values (eh) on conflict (email_hash) do nothing;\n    if found then", "values (eh) on conflict (email_hash) do update set granted_at = now();\n    if true then"),
    ("the credits are given with another created_by", S, "'Welcome credits (email verified)', 'welcome-repair'", "'Welcome credits (email verified)', 'welcome'"),
    ("part 1 counts everyone in the window, recorded or not", S, "   and not exists (select 1 from ryagram_private.welcome_credit_grants g\n                    where g.email_hash = encode(sha256(convert_to('ryagram-welcome:' || lower(btrim(u.email)), 'UTF8')), 'hex'));", "   and true;"),
]


def fresh():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", ignore=shutil.ignore_patterns("__pycache__"))


def run():
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    r = subprocess.run([sys.executable, "-B", "-m", "unittest", "supabase/tests/test_welcome_repair.py"], cwd=SCRATCH, capture_output=True, text=True, env=env, timeout=900)
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
