"""Must-fail proof for supabase/tests/test_waiting_gate_hardening.py: each mutant breaks ONE part of the hardening file in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/waiting_gate_hardening_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
Dropped: writing the guess under the caller's raw (null) address instead of 'unknown' makes the insert fail on the column's not-null rule, so the suite ERRORS rather than failing an assertion, which the runner (rightly) does not count as a catch.
Not mutated, because no test can see it (and why): the lock on the guess count in invite_claim (the same race as the join's, which has its own mutant and test; here the work inside is the same shape and the overall 300 an hour
stays the backstop), and the order of the two locks in invite_claim (the account lock before the row lock): a deadlock needs two sessions to reach two waits in the same instant, which no test can arrange on purpose; the
order is a reasoning fix, written in the file's header.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261106000100_waiting_gate_hardening.sql"
W.TEST = "supabase/tests/test_waiting_gate_hardening.py"
W.SCRATCH = W.ROOT / ".mut_gatehard"
W.RUN_TMP = W.base.BASE_TEMP / f"gatehard-mut-{os.getpid()}"

HOLD_LOCK = "  perform pg_advisory_xact_lock(hashtextextended('ryagram-account:' || coalesce(p_owner::text, ''), 0));      -- takes turns with activate_account for this account\n"
ACT_LOCK = "  perform pg_advisory_xact_lock(hashtextextended('ryagram-account:' || coalesce(p_user::text, ''), 0));       -- takes turns with hold_grant for this account\n"
JOIN_LOCK = "  perform pg_advisory_xact_lock(hashtextextended('ryagram-join', 0));                                          -- count-then-write takes turns, so callers at the same moment cannot pass the limit together\n"

W.MUTANTS[:] = [
    ("a grant does not take the account's lock", HOLD_LOCK, ""),
    ("an approval does not take the account's lock", ACT_LOCK, ""),
    ("a grant that waited does not look again", "  if ryagram_private.account_active(p_owner) then return false; end if;\n  insert into public.held_grants", "  insert into public.held_grants"),
    ("the join does not take its turn", JOIN_LOCK, ""),
    ("an invite claim with no address is counted under no name", "(select count(*) from public.invite_attempts where ip_hash = ip and at > now() - interval '1 hour') >= 10", "(select count(*) from public.invite_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 10"),
    ("the waiting-list check is not applied", "select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)", "select 1;                       -- every migration after the gate ends with this line (a test fails otherwise)"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
