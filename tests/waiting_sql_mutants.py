"""Must-fail proof for supabase/tests/test_waiting_accounts.py: each mutant breaks ONE rule of the waiting-accounts migration in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/waiting_sql_mutants.py          every mutant
    pgvenv/Scripts/python tests/waiting_sql_mutants.py --check-targets      fast, no database: every target text is in the migration exactly once
Same rules as tests/connect_sql_mutants.py (which this reuses): own temp per run, the pgserver folder is stopped and deleted before the next mutant, CAUGHT only on an ASSERTION
failure (an error or a broken migration is NOT caught), the unmutated copy must pass first. ONE runner at a time in a tree.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import connect_sql_mutants as base  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".mut_wait"
MIG = "supabase/migrations/20261104000100_waiting_accounts.sql"
TEST = "supabase/tests/test_waiting_accounts.py"
RUN_TMP = base.BASE_TEMP / f"wait-mut-{os.getpid()}"

MUTANTS = [
    ("a waiting row counts as active", "else exists (select 1 from public.account_status s where s.user_id = p_user and s.status = 'active')", "else exists (select 1 from public.account_status s where s.user_id = p_user)"),
    ("an account with no row is open even with the switch on", "or (not ryagram_private.waiting_on() and not exists (select 1 from public.account_status s where s.user_id = p_user))", "or not exists (select 1 from public.account_status s where s.user_id = p_user)"),
    ("the switch being off opens waiting rows", "or (not ryagram_private.waiting_on() and not exists (select 1 from public.account_status s where s.user_id = p_user))", "or not ryagram_private.waiting_on()"),
    ("an admin does not count as active", "                or exists (select 1 from public.app_admins a where a.user_id = p_user)\n", ""),
    ("a worker does not count as active", "                or exists (select 1 from public.workers w where w.user_id = p_user)\n", ""),
    ("a waiting account is paid credits straight into the ledger", ", p_price_code) then return null; end if;", ", p_price_code) then null; end if;"),
    ("hold_grant never holds", "  if ryagram_private.account_active(p_owner) then return false; end if;", "  if true then return false; end if;"),
    ("held credits are never paid when the account opens", "      perform public.grant_credits(h.owner_id, h.entry::public.credit_entry, h.credits, h.reason, h.created_by, h.stripe_event_id, h.period_key, h.price_code);\n", ""),
    ("held credits stay held after they are paid", "      delete from public.held_grants where id = h.id;\n", ""),
    ("an unconfirmed address can be approved", "  if exists (select 1 from auth.users where id = p_user and email_confirmed_at is null) then", "  if false then"),
    ("the gate check does nothing", "if auth.uid() is not null and not ryagram_private.account_active(auth.uid()) then", "if false then"),
    ("a new account is never recorded waiting", "case when ryagram_private.waiting_on() then 'waiting' else 'active' end, case when", "'active', case when"),
    ("the backfill is missing", "insert into public.account_status (user_id, status, source) select u.id, 'active', 'backfill' from auth.users u on conflict (user_id) do nothing;", "select 1;"),
    ("activation pays twice (no already-active stop)", "  if was = 'active' then return false; end if;\n", ""),
    ("activation writes no audit row", "  insert into public.account_status_audit (user_id, from_status, to_status, source, by_user, reason) values (p_user, was, 'active', p_source, p_by, left(p_note, 300));\n", ""),
    ("a claimed code is not used up", "  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;\n  insert into public.invite_redemptions (code_hash, email, user_id, status)",
     "  insert into public.invite_redemptions (code_hash, email, user_id, status)"),
    ("claim guesses are not counted", "    insert into public.invite_attempts (ip_hash) values (left(coalesce(p_ip_hash, 'unknown'), 64));\n    return jsonb_build_object('ok', false, 'reason', 'invalid');\n  end if;\n  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;\n  insert into public.invite_redemptions (code_hash, email, user_id, status)",
     "    return jsonb_build_object('ok', false, 'reason', 'invalid');\n  end if;\n  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;\n  insert into public.invite_redemptions (code_hash, email, user_id, status)"),
    ("an invited tester is not activated by invite_sent", "  perform ryagram_private.activate_account(p_user, 'invite', null, 0, 'invite:' || p_redemption);\n", ""),
    ("one table is skipped by the row policies", "       and pc.tablename <> all (open_tables)\n", "       and pc.tablename <> all (open_tables) and pc.tablename <> 'projects'\n"),
    ("one function is skipped by the function guard", "       and p.proname <> all (allowed) and", "       and p.proname <> all (allowed || array['create_version']) and"),
    ("the SQL-function wrapper has a guard in name only", "begin perform ryagram_private.require_active(); %s end $w$", "begin perform 1; /* perform ryagram_private.require_active(); */ %s end $w$"),
    ("the connector ignores the waiting list", "and ryagram_private.account_active(p_owner)');", "');"),
    ("the consent page has no waiting words", "Your account is on the waiting list, so it cannot be connected to an AI yet. We will email you when your access opens.", "Not enabled."),
    ("anyone signed in may approve", "declare me uuid := ryagram_private.require_admin(); c int; flipped boolean; mail text;", "declare me uuid := auth.uid(); c int; flipped boolean; mail text;"),
    ("my_access always says active", "case when ryagram_private.account_active(me) then 'active' else 'waiting' end,", "'active',"),
    ("a visitor may ask account_is_active", "grant execute on function public.account_is_active(uuid) to service_role;", "grant execute on function public.account_is_active(uuid) to service_role, anon;"),
    ("a signed-in person may call invite_claim", "grant execute on function public.invite_claim(uuid, text, text) to service_role;", "grant execute on function public.invite_claim(uuid, text, text) to service_role, authenticated;"),
    ("a person may write their own status", "grant select on public.account_status to authenticated;", "grant select, update on public.account_status to authenticated;\ncreate policy zz_self on public.account_status for update to authenticated using (user_id = auth.uid()) with check (true);"),
    ("the status trigger is not security definer", "create function ryagram_private.account_status_new() returns trigger\nlanguage plpgsql security definer set search_path = '' as $$",
     "create function ryagram_private.account_status_new() returns trigger\nlanguage plpgsql set search_path = '' as $$"),
]


def one_run(label, mutate=None):
    if base.free_gb(base.BASE_TEMP) < base.MIN_FREE_GB:
        raise base.HarnessError(f"only {base.free_gb(base.BASE_TEMP):.1f} GB free on the temp drive; stopping")
    RUN_TMP.mkdir(parents=True, exist_ok=True)
    left = base.pg_dirs(RUN_TMP) + base.pg_dirs(RUN_TMP / "t")
    if left:
        raise base.HarnessError(f"a pgserver folder was left behind before {label}: {[p.name for p in left]}")
    shutil.rmtree(SCRATCH, ignore_errors=True)
    (SCRATCH / "supabase").mkdir(parents=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", dirs_exist_ok=True)
    (SCRATCH / "tests").mkdir(exist_ok=True)
    for rel, old, new in (mutate or []):
        path = SCRATCH / rel
        text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if text.count(old) != 1:
            return "broken", 0, 0
        path.write_text(text.replace(old, new, 1), encoding="utf-8")
    mut_tmp = RUN_TMP / "t"
    mut_tmp.mkdir(exist_ok=True)
    env = dict(os.environ, TEMP=str(mut_tmp), TMP=str(mut_tmp), TMPDIR=str(mut_tmp), PYTHONDONTWRITEBYTECODE="1")
    proc = subprocess.Popen([sys.executable, "-u", "-B", "-m", "unittest", TEST], cwd=SCRATCH, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        out, _ = proc.communicate(timeout=1800)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True) if os.name == "nt" else proc.kill()
        out, _ = proc.communicate()
        out += "\nTIMEOUT\n"
    verdict = base.classify(out, proc.returncode)
    try:
        n = len(base.pg_dirs(mut_tmp))
        if n > 1:
            raise base.HarnessError(f"{label}: {n} pgserver folders in one mutant's temp")
    finally:
        base.remove_pg_folders(mut_tmp)
        shutil.rmtree(SCRATCH, ignore_errors=True)
    return verdict


def edits_of(m):
    """A mutant is (name, old, new) in the migration MIG, or (name, [(migration path, old, new), ...]) when the rule's final definition is in a later migration, or in several."""
    return m[1] if isinstance(m[1], list) else [(MIG, m[1], m[2])]


def targets_bad():
    names = [m[0] for m in MUTANTS]
    bad = []
    for m in MUTANTS:
        for rel, old, new in edits_of(m):
            if (ROOT / rel).read_text(encoding="utf-8").replace("\r\n", "\n").count(old) != 1 or old == new:
                bad.append(m[0])
                break
    return bad + sorted({n for n in names if names.count(n) > 1})


def run(only=None):
    bad = 0
    selected = [m for m in MUTANTS if not only or m[0] in only]
    try:
        v, f, e = one_run("baseline")
        print(f"baseline (unmutated): {v}", flush=True)
        if v != "survived":
            print("BASELINE FAILED: the unmutated tests must pass first")
            return 2
        for m in selected:
            name = m[0]
            v, f, e = one_run(name, edits_of(m))
            if v == "caught":
                print(f"caught  {name}  (assertion failures: {f})", flush=True)
            elif v == "broken":
                print(f"BROKEN MUTANT (text not found exactly once): {name}", flush=True)
                bad += 1
            elif v == "errored":
                print(f"NOT CAUGHT (the tests ERRORED, they did not FAIL on an assertion; errors={e}): {name}", flush=True)
                bad += 1
            else:
                print(f"MISSED  {name}", flush=True)
                bad += 1
    except base.HarnessError as err:
        print(f"HARNESS STOPPED: {err}")
        return 3
    finally:
        if RUN_TMP.exists():
            try:
                base.remove_pg_folders(RUN_TMP)
            finally:
                shutil.rmtree(RUN_TMP, ignore_errors=True)
        shutil.rmtree(SCRATCH, ignore_errors=True)
    print(f"{bad} mutant(s) not caught" if bad else f"all {len(selected)} mutants caught")
    return 1 if bad else 0


if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
