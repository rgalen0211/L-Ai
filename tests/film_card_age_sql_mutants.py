"""Must-fail proof for the film card failed age (supabase/tests/test_film_card_requests.py, its failed-age tests): each mutant breaks ONE rule of migrations/20261119000100_film_card_failed_age.sql (or its rollback) in a scratch copy and the SQL tests must FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/film_card_age_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

M = "supabase/migrations/20261119000100_film_card_failed_age.sql"
R = "supabase/rollbacks/20261119000100_film_card_failed_age_rollback.sql"
W.MIG = M
W.TEST = "supabase/tests/test_film_card_requests.py"
W.SCRATCH = W.ROOT / ".mut_age"
W.RUN_TMP = W.base.BASE_TEMP / f"age-mut-{os.getpid()}"

TOP_NEW = "''retry'', retry, ''failed_s'', case when r.state = ''failed'' then greatest(0, floor(extract(epoch from (now() - r.finished_at)))::int) end,';"
ARR = "foreach fn in array array['public.connect_film_card_get(text, uuid)', 'public.my_film_card_get(uuid)'] loop"
REPLACE_BOTH = "neu := replace(replace(def, top_old, top_new), ref_old, ref_new);"
UNDO_BOTH = "neu := replace(replace(def, top_new, top_old), ref_new, ref_old);"

W.MUTANTS[:] = [
    ("the newest picture's answer gets no age", REPLACE_BOTH, "neu := replace(def, ref_old, ref_new);"),
    ("a failed refresh gets no age", REPLACE_BOTH, "neu := replace(def, top_old, top_new);"),
    ("the age is in minutes, not seconds", TOP_NEW, TOP_NEW.replace("(now() - r.finished_at)))::int)", "(now() - r.finished_at)) / 60)::int)")),
    ("the age can go below zero", TOP_NEW, TOP_NEW.replace("greatest(0, floor(extract(epoch from (now() - r.finished_at)))::int)", "floor(extract(epoch from (now() - r.finished_at)))::int")),
    ("the age counts from when it was asked, not from when it failed", TOP_NEW, TOP_NEW.replace("r.finished_at", "r.asked_at")),
    ("the retry flag is changed along the way", TOP_NEW, TOP_NEW.replace("''retry'', retry, ''failed_s''", "''retry'', true, ''failed_s''")),
    ("a drifted function is changed anyway", " or n_top <> 1 or n_ref <> 1 or position('failed_s' in def) > 0 then", " then"),
    ("running the migration a second time is not a no-op", "if position(top_new in def) > 0 and position(ref_new in def) > 0 then raise notice", "if false then raise notice"),
    ("the migration has no waiting-list gate at the end", "select ryagram_private.gate_apply();                       --", "select 1;                       --"),
    ("the site twin is left without the age", ARR, "foreach fn in array array['public.connect_film_card_get(text, uuid)'] loop"),
    ("the rollback leaves the age in the site twin", [(R, ARR, "foreach fn in array array['public.connect_film_card_get(text, uuid)'] loop")]),
    ("the rollback leaves the age in the newest picture's answer", [(R, UNDO_BOTH, "neu := replace(def, ref_new, ref_old);")]),
    ("the rollback leaves the age in the refresh", [(R, UNDO_BOTH, "neu := replace(def, top_new, top_old);")]),
    ("the rollback is not a no-op the second time", [(R, "if position('failed_s' in def) = 0 then raise notice", "if false then raise notice")]),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
