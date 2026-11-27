"""Must-fail proof for supabase/tests/test_compilations_for_everyone.py: each mutant breaks ONE rule of compilations for every user (migration 20261127000300_compilations_for_everyone.sql) in a scratch copy and the SQL tests must then FAIL.
BUILDER 2026-11-27 (FACES 08:51: a committed runner, so a reviewer can rerun the planted faults). Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/compilations_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261127000300_compilations_for_everyone.sql"
W.TEST = "supabase/tests/test_compilations_for_everyone.py"
W.SCRATCH = W.ROOT / ".mut_compilations"
W.RUN_TMP = W.base.BASE_TEMP / f"compilations-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ('the switch always on', "     and (ryagram_private.department_switch_on(p_person, 'compilations')", '     and (true'),
    ('a worker counts as a person', '     and not exists (select 1 from public.workers w where w.user_id = p_person)', '     and true'),
    ('opened for everyone without dropping the tester rule', "d.status = 'working' and not d.needs_local_compute))", "d.status = 'working'))"),
    ('a file key in the request let through', '  if t ~* \'"([a-z_]*path[a-z_]*|urls?', '  if false and t ~* \'"([a-z_]*path[a-z_]*|urls?'),
    ('a path or link value let through', "  if v ~* '(", "  if false and v ~* '("),
    ('two builds at once', "    raise exception 'Another compilation is still being made on your computer. Let it finish or cancel it first.' using errcode = '55000';", '    null;'),
    ('an old request may report', 'where r.project_id = p_project and r.owner_id = me and p.owner_id = me and r.request_sha256 = p_request_sha256) then', 'where r.project_id = p_project and r.owner_id = me and p.owner_id = me) then'),
    ('device_decide not widened', "or ryagram_private.compilations_on(me)) then';", "or false) then';"),
    ('3000 builds a day', '    if started >= 30 then', '    if started >= 3000 then'),
    ('invisible characters are not removed first', "  v := regexp_replace(v, '[\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff]', '', 'g');", '  v := v;'),
    ('a silent build is never closed as stale', "and updated_at < now() - interval '2 hours';", "and updated_at < now() - interval '2000 hours';"),
    ('a song request accepted', "  if coalesce((p ->> 'song')::boolean, false) then", '  if false then'),
    ('the closed list of reasons removed', '  if p_error_code is not null and p_error_code <> all (codes) then', '  if false then'),
    ('a new build may start at matching', "    if p_state <> 'planning' then", '    if false then'),
    ('a run may move backwards', "  if array_position(array['planning', 'matching', 'building'], p_state) < array_position(array['planning', 'matching', 'building'], run.state) then", '  if false then'),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
