"""Must-fail proof for supabase/tests/test_editor_link.py: each mutant breaks ONE rule of the editor-link migration in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/editor_link_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
Dropped as EQUIVALENT: the form check on the hash (a hash of the wrong form can never equal a real one) and the null guards (coalesce already turns null into false).
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261105000200_editor_link_check.sql"
W.TEST = "supabase/tests/test_editor_link.py"
W.SCRATCH = W.ROOT / ".mut_elink"
W.RUN_TMP = W.base.BASE_TEMP / f"elink-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("the connector switch is not asked", "    and ryagram_private.connect_on()\n", "\n"),
    ("the owner's hash is not compared", "         and ryagram_private.editor_link_owner_hash(p.owner_id) = p_owner_hash\n", "\n"),
    ("a person who may not connect still counts", "         and ryagram_private.connect_person_ok(p.owner_id)\n", "\n"),
    ("a revoked grant still counts", "g.owner_id = p.owner_id and g.revoked_at is null and 'edit'", "g.owner_id = p.owner_id and 'edit'"),
    ("the edit scope is not required", " and 'edit' = any (g.scopes)))", "))"),
    ("a grant is not required at all", "         and exists (select 1 from public.connect_grants g where g.owner_id = p.owner_id and g.revoked_at is null and 'edit' = any (g.scopes))),\n", "),\n"),
    ("the project is not matched", "       where p.id = p_project\n", "       where true\n"),
    ("the hash uses another prefix", "convert_to('ryagram-editor-link:' ||", "convert_to('ryagram:' ||"),
    ("the hash is cut to a different length", "'hex'), 1, 32)", "'hex'), 1, 31)"),
    ("anon may call it", "grant execute on function public.editor_link_check(uuid, text) to service_role;", "grant execute on function public.editor_link_check(uuid, text) to service_role, anon;"),
    ("the connector's role may call it", "grant execute on function public.editor_link_check(uuid, text) to service_role;", "grant execute on function public.editor_link_check(uuid, text) to service_role, connect_runner;"),
    ("the helper is callable by the service role", "revoke execute on function ryagram_private.editor_link_owner_hash(uuid) from public, anon, authenticated, service_role;", "revoke execute on function ryagram_private.editor_link_owner_hash(uuid) from public, anon, authenticated;"),
    ("the waiting-list check is not applied", "select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)", "select 1;                       -- every migration after the gate ends with this line (a test fails otherwise)"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
