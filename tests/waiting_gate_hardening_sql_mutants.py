"""Must-fail proof for supabase/tests/test_waiting_gate_hardening.py: each mutant breaks ONE part of the hardening file in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/waiting_gate_hardening_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
Dropped: writing the guess under the caller's raw (null) address instead of 'unknown' makes the insert fail on the column's not-null rule, so the suite ERRORS rather than failing an assertion, which the runner (rightly) does not count as a catch.
Every lock and its ORDER has a mutant now (CC1 05:12 after GEO's cross-review): the order of the locks in invite_claim is proved by a deterministic three-connection case that deadlocks if the claim takes its row lock before the account lock.
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

_TEXT = (W.ROOT / W.MIG).read_text(encoding="utf-8").replace("\r\n", "\n")


def line_containing(fragment, after=None):
    """the whole line (with its newline) holding `fragment`, searched after the text `after` when given; each must exist exactly once in that stretch"""
    start = _TEXT.index(after) if after else 0
    i = _TEXT.index(fragment, start)
    a = _TEXT.rfind("\n", 0, i) + 1
    b = _TEXT.index("\n", i) + 1
    return _TEXT[a:b]


HOLD_LOCK = line_containing("takes turns with activate_account for this account")
HOLD_CHECK = "  if ryagram_private.account_active(p_owner) then return false; end if;\n"
ACT_LOCK = line_containing("takes turns with hold_grant for this account")
JOIN_LOCK = line_containing("count-then-write takes turns, so callers at the same moment")
CLAIM_ACCOUNT_LOCK = line_containing("the SAME order as activate_account and hold_grant")
CLAIM_GUESS_LOCK = line_containing("the guess count and the guess record take turns", after="create or replace function public.invite_claim(")
RESERVE_GUESS_LOCK = line_containing("the same lock as invite_claim; this one takes no account lock", after="create or replace function public.invite_reserve(")

W.MUTANTS[:] = [
    ("a grant does not take the account's lock", HOLD_LOCK, ""),
    ("an approval does not take the account's lock", ACT_LOCK, ""),
    ("a grant that waited does not look again", HOLD_CHECK + "  insert into public.held_grants", "  insert into public.held_grants"),
    ("a grant looks BEFORE it takes the lock, not after", HOLD_LOCK + HOLD_CHECK, HOLD_CHECK + HOLD_LOCK),
    ("the join does not take its turn", JOIN_LOCK, ""),
    ("an invite claim does not take the guess lock", CLAIM_GUESS_LOCK, ""),
    ("an invite reservation does not take the guess lock", RESERVE_GUESS_LOCK, ""),
    ("an invite claim takes its row lock before the account lock (the account lock is not taken first)", CLAIM_ACCOUNT_LOCK, ""),
    ("an invite claim with no address is counted under no name", "(select count(*) from public.invite_attempts where ip_hash = ip and at > now() - interval '1 hour') >= 10\n     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then\n    return jsonb_build_object('ok', false, 'reason', 'throttled');\n  end if;\n  select * into c from public.invite_codes where code_hash = ryagram_private.invite_hash(p_code) for update;\n  if not found or c.disabled or c.expires_at <= now() or c.uses >= c.max_uses\n     or length(ryagram_private.invite_normal(p_code)) not between 8 and 16 then\n    insert into public.invite_attempts (ip_hash) values (ip);\n    return jsonb_build_object('ok', false, 'reason', 'invalid');\n  end if;\n  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;\n  insert into public.invite_redemptions (code_hash, email, user_id, status)",
     "(select count(*) from public.invite_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 10\n     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then\n    return jsonb_build_object('ok', false, 'reason', 'throttled');\n  end if;\n  select * into c from public.invite_codes where code_hash = ryagram_private.invite_hash(p_code) for update;\n  if not found or c.disabled or c.expires_at <= now() or c.uses >= c.max_uses\n     or length(ryagram_private.invite_normal(p_code)) not between 8 and 16 then\n    insert into public.invite_attempts (ip_hash) values (ip);\n    return jsonb_build_object('ok', false, 'reason', 'invalid');\n  end if;\n  update public.invite_codes set uses = uses + 1 where code_hash = c.code_hash;\n  insert into public.invite_redemptions (code_hash, email, user_id, status)"),
    ("an invite reservation with no address is counted under no name", "(select count(*) from public.invite_attempts where ip_hash = ip and at > now() - interval '1 hour') >= 10\n     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then\n    return jsonb_build_object('ok', false, 'reason', 'throttled');\n  end if;\n  if coalesce(p_email, '')",
     "(select count(*) from public.invite_attempts where ip_hash = p_ip_hash and at > now() - interval '1 hour') >= 10\n     or (select count(*) from public.invite_attempts where at > now() - interval '1 hour') >= 300 then\n    return jsonb_build_object('ok', false, 'reason', 'throttled');\n  end if;\n  if coalesce(p_email, '')"),
    ("the waiting-list check is not applied", "select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)", "select 1;                       -- every migration after the gate ends with this line (a test fails otherwise)"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
