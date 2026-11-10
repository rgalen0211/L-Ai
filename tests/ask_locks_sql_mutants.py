"""Must-fail proof for supabase/tests/test_ask_locks.py: each mutant breaks ONE rule of the ask-lock migration (20261109000300_ask_locks.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/ask_locks_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
The rollback file is not mutated here (the runner patches one file); its two directions are proved by the test that runs it both ways and compares the stored function text.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261109000300_ask_locks.sql"
W.TEST = "supabase/tests/test_ask_locks.py"
W.SCRATCH = W.ROOT / ".mut_ask_locks"
W.RUN_TMP = W.base.BASE_TEMP / f"ask-locks-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("no function is given the lock", "    execute replace(def, anchor, locked);", "    null;"),
    ("one lock for everybody: another person's ask waits behind this one", "hashtextextended(''geo:'' || me::text, 0)", "hashtextextended(''geo:'', 0)"),
    ("the forecast ask is left without the lock", "in ('connect_geo_ask', 'connect_geo_ask_shape', 'connect_forecast_ask') order by", "in ('connect_geo_ask', 'connect_geo_ask_shape') order by"),
    ("the shape ask is left without the lock", "in ('connect_geo_ask', 'connect_geo_ask_shape', 'connect_forecast_ask') order by", "in ('connect_geo_ask', 'connect_forecast_ask') order by"),
    ("the place ask is left without the lock", "in ('connect_geo_ask', 'connect_geo_ask_shape', 'connect_forecast_ask') order by", "in ('connect_geo_ask_shape', 'connect_forecast_ask') order by"),
    ("a second run is not safe (a locked function is processed again)", "    if position('pg_advisory_xact_lock' in def) > 0 then continue; end if;       -- already locked\n", ""),
    ("a function that is not as expected is changed anyway", "    if n <> 1 then\n", "    if false then\n"),
    ("the lock is taken after the old cleanup instead of first",
     "'begin' || nl || '  perform pg_advisory_xact_lock(hashtextextended(''geo:'' || me::text, 0));' || nl || '  delete from public.geo_requests where asked_at < now() - interval ''7 days'';' || nl;",
     "'begin' || nl || '  delete from public.geo_requests where asked_at < now() - interval ''7 days'';' || nl || '  perform pg_advisory_xact_lock(hashtextextended(''geo:'' || me::text, 0));' || nl;"),
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
