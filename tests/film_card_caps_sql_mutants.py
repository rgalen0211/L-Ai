"""Must-fail proof for the film card caps (supabase/tests/test_film_card_requests.py, its caps tests): each mutant breaks ONE rule of migrations/20261113000100_film_card_caps.sql (or its rollback) in a scratch copy and the SQL tests must FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/film_card_caps_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

M = "supabase/migrations/20261113000100_film_card_caps.sql"
R = "supabase/rollbacks/20261113000100_film_card_caps_rollback.sql"
W.MIG = M
W.TEST = "supabase/tests/test_film_card_requests.py"
W.SCRATCH = W.ROOT / ".mut_cap"
W.RUN_TMP = W.base.BASE_TEMP / f"cap-mut-{os.getpid()}"

TRIM_TAIL = "order by finished_at desc limit 20);';\n  n_cap"
TRIM_ALL = "where owner_id = g.owner_id and state = ''answered'' and id not in (select id from public.film_card_requests where owner_id = g.owner_id and state = ''answered'' " + TRIM_TAIL

W.MUTANTS[:] = [
    ("the column check stays at 262144", "add constraint film_card_requests_answer_check check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 320000));",
     "add constraint film_card_requests_answer_check check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 262144));"),
    ("the column check is raised far too high", "octet_length(answer::text) <= 320000));", "octet_length(answer::text) <= 320000000));"),
    ("the function keeps the old cap", "'octet_length(p_card::text) > 320000'), anchor", "'octet_length(p_card::text) > 262144'), anchor"),
    ("the function's cap is far too high", "'octet_length(p_card::text) > 320000'), anchor", "'octet_length(p_card::text) > 320000000'), anchor"),
    ("a card is stored with no trim of the older ones", "anchor || trim_line);", "anchor);"),
    ("the trim keeps 21 cards", TRIM_TAIL, "order by finished_at desc limit 21);';\n  n_cap"),
    ("the trim deletes other people's cards as well", TRIM_ALL, TRIM_ALL.replace("where owner_id = g.owner_id and state = ''answered'' and id not in", "where state = ''answered'' and id not in", 1)),
    ("the trim also deletes a person's failed requests", TRIM_ALL, TRIM_ALL.replace("and state = ''answered'' and id not in", "and id not in", 1)),
    ("a drifted function is replaced anyway", " or n_cap <> 1 or n_anchor <> 1 or position('limit 20' in def) > 0 then", " then"),
    ("running the migration a second time is not a no-op", "if def like '%octet_length(p_card::text) > 320000%' and position(trim_line in def) > 0 then raise notice", "if false then raise notice"),
    ("the rollback leaves the trim in the function", [(R, "replace(replace(def, trim_line, ''), 'octet_length(p_card::text) > 320000'", "replace(replace(def, trim_line, trim_line), 'octet_length(p_card::text) > 320000'")]),
    ("the rollback leaves the new cap in the function", [(R, "'octet_length(p_card::text) > 262144');\n  execute neu;", "'octet_length(p_card::text) > 320000');\n  execute neu;")]),
    ("the rollback does not delete the cards that no longer fit (the old check then refuses to come back)", [(R, "delete from public.film_card_requests where answer is not null and octet_length(answer::text) > 262144;", "select 1;")]),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
