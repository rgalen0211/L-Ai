"""Must-fail proof for supabase/tests/test_launch_funnel.py: each mutant breaks ONE rule of the launch funnel by day (migration 20261127000200_launch_funnel.sql) in a scratch copy and the SQL tests must then FAIL.
BUILDER 2026-11-27 (FACES 08:51: a committed runner, so a reviewer can rerun the planted faults). Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/launch_funnel_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261127000200_launch_funnel.sql"
W.TEST = "supabase/tests/test_launch_funnel.py"
W.SCRATCH = W.ROOT / ".mut_launch_funnel"
W.RUN_TMP = W.base.BASE_TEMP / f"launch_funnel-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ('administrators counted', 'where not exists (select 1 from public.app_admins a where a.user_id = u.id)', 'where true'),
    ('sign-up asks shown for days not kept', 'case when ds.d >= today - 1 then coalesce(', 'case when true then coalesce('),
    ('a declined film counted as approved', "and s.state <> 'declined'", 'and true'),
    ('delivered read from the finished job, not the delivery', 'least((select min(d.created_at) from public.render_deliveries d where d.owner_id = p.id),', "least((select min(jj.ended_at) from public.jobs jj where jj.owner_id = p.id and jj.job_type = 'final_render' and jj.state = 'complete'),"),
    ('an unfinished direct final counted as delivered', "where j.owner_id = p.id and j.job_type = 'final_render' and j.state = 'complete' and j.stage_id is null)) as delivered", "where j.owner_id = p.id and j.job_type = 'final_render' and j.stage_id is null)) as delivered"),
    ('any signed-in person may read it', 'declare me uuid := ryagram_private.require_admin();           -- an admin acts', 'declare me uuid := ryagram_private.require_signed_in();           -- an admin acts'),
    ('an auto_render order film is never approved', "                    or (s.admin_decided_at is null and s.state in ('queued', 'running', 'complete')))) as approved,", '                    )) as approved,'),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
