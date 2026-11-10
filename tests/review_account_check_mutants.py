"""Must-fail proof for supabase/tests/test_review_account_check.py: each mutant breaks ONE rule of the review-account check (supabase/connect-live/07_review_account_check.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/review_account_check_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/connect-live/07_review_account_check.sql"
W.TEST = "supabase/tests/test_review_account_check.py"
W.SCRATCH = W.ROOT / ".mut_review"
W.RUN_TMP = W.base.BASE_TEMP / f"review-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("an administrator passes", r"select not exists (select 1 from public.app_admins where user_id = $1)", r"select exists (select 1 from public.app_admins where user_id = $1) or true"),
    ("a worker passes", r"select not exists (select 1 from public.workers where user_id = $1)", r"select true"),
    ("a waiting account passes", r"select ryagram_private.account_active($1)", r"select true"),
    ("a switched-off invite passes", r"from public.connect_access where user_id = $1 and enabled)", r"from public.connect_access where user_id = $1)"),
    ("the connector's own check is not asked", r"select ryagram_private.connect_person_ok($1)", r"select true"),
    ("the master switch is not looked at", r"select (select connections_enabled from public.connect_flags where id)", r"select true"),
    ("an empty story counts as a saved story", r"and v.story_spec <> ''{}''::jsonb)", r")"),
    ("an archived film counts", r"where p.owner_id = $1 and p.archived_at is null and", r"where p.owner_id = $1 and"),
    ("a sheet that did not finish counts", r"job_type = ''contact_sheet'' and state = ''complete'')", r"job_type = ''contact_sheet'')"),
    ("a sheet counts as a preview", r"job_type = ''preview'' and state = ''complete'')", r"job_type = ''contact_sheet'' and state = ''complete'')"),
    ("a track list that is not shared counts", r"mode = ''compilation'' and ai_visible)", r"mode = ''compilation'')"),
    ("a running job does not matter", r"state in (''queued'', ''claimed'', ''running'', ''validating'', ''uploading''))", r"state in (''queued''))"),
    ("a queued job does not matter", r"state in (''queued'', ''claimed'', ''running'', ''validating'', ''uploading''))", r"state in (''claimed'', ''running'', ''validating'', ''uploading''))"),
    ("an optional gate counts as required", "if g.required then failed := failed + 1; end if;", "failed := failed + 1;"),
    ("a required gate does not count", "if g.required then failed := failed + 1; end if;", "null;"),
    ("a part of the window not applied is a FAIL", "exception when undefined_table or undefined_function or undefined_column then\n      r := null;", "exception when undefined_table or undefined_function or undefined_column then\n      r := false;"),
    ("a missing account carries on", "  if cnt <> 1 then", "  if cnt > 1 then"),
    ("the result says pass whatever failed", "case when failed = 0 then 'ALL REQUIRED GATES PASS' else failed || ' REQUIRED GATE(S) FAIL' end", "'ALL REQUIRED GATES PASS'"),
    ("the email is echoed", "'Fix the email and run again.';", "'Fix the email ' || p_email || ' and run again.';"),
    ("the throw-away function is kept in the database", "create or replace function pg_temp.review_account_check(", "create or replace function public.review_account_check("),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
