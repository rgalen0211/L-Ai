"""Must-fail proof for supabase/tests/test_connect_job_progress_detail.py: each mutant breaks ONE rule of 20261112000100_connect_job_progress_detail.sql in a scratch copy and the SQL tests must then FAIL.
The first two are the ones CC1 asked for (07:46): a planted fault that leaks ANOTHER account's job through the new field must be caught.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/connect_job_progress_detail_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261112000100_connect_job_progress_detail.sql"
W.TEST = "supabase/tests/test_connect_job_progress_detail.py"
W.SCRATCH = W.ROOT / ".mut_jobdetail"
W.RUN_TMP = W.base.BASE_TEMP / f"jobdetail-mut-{os.getpid()}"

KEY = ", 'progress_detail', j.progress_detail);"
W.MUTANTS[:] = [
    # another account's job through the new field
    ("the owner check is dropped: any token reads any job and its progress", "where id = p_job and owner_id = me;", "where id = p_job;"),
    ("another account's job answers its progress instead of null", "if not found then return null; end if;",
     "if not found then return jsonb_build_object('progress_detail', (select x.progress_detail from public.jobs x where x.id = p_job)); end if;"),
    # the scope, the role and the settings
    ("it no longer needs the read scope", "connect_actor(p_token_hash, 'read')", "connect_actor(p_token_hash, 'write')"),
    ("signed-in people may call it directly", "select ryagram_private.gate_apply();", "grant execute on function public.connect_job(text, uuid) to authenticated;\nselect ryagram_private.gate_apply();"),
    ("it runs as the caller, not as the definer", "language plpgsql security definer set search_path = '' as $$", "language plpgsql security invoker set search_path = '' as $$"),
    ("its search path is no longer empty", "language plpgsql security definer set search_path = '' as $$", "language plpgsql security definer set search_path = public as $$"),
    # the field itself, and nothing else
    ("the field is not returned", KEY, ");"),
    ("the field is returned under another name", KEY, ", 'detail', j.progress_detail);"),
    ("the field is returned as text", KEY, ", 'progress_detail', j.progress_detail::text);"),
    ("another key is dropped on the way", "'progress', j.progress, 'note', j.progress_note,", "'progress', j.progress,"),
    # the gate
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
