"""Must-fail proof for supabase/tests/test_connect_cimd.py: each mutant breaks ONE rule of the client-ID-metadata migration (20261110000100_connect_cimd.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/cimd_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261110000100_connect_cimd.sql"
W.TEST = "supabase/tests/test_connect_cimd.py"
W.SCRATCH = W.ROOT / ".mut_cimd"
W.RUN_TMP = W.base.BASE_TEMP / f"cimd-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("the master switch is not looked at", "  if not ryagram_private.connect_on() then raise exception 'unavailable: AI connections are switched off right now' using errcode = 'PT400'; end if;\n", ""),
    ("an address that is not on the allowlist is accepted (any https address becomes a client)", "  select a.label into lbl from public.connect_cimd_allowlist a where a.enabled and a.client_id_url = p_client_id;\n  if not found then raise exception 'invalid_client' using errcode = 'PT400'; end if;\n", "  lbl := 'Anything';\n"),
    ("a switched-off allowlist row still works", "where a.enabled and a.client_id_url = p_client_id", "where a.client_id_url = p_client_id"),
    ("the allowlist matches by prefix, not exactly", "where a.enabled and a.client_id_url = p_client_id", "where a.enabled and p_client_id like a.client_id_url || '%'"),
    ("the redirect list may be empty", "  if p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 5 then", "  if false then"),
    ("any number of return addresses is accepted", "cardinality(p_redirect_uris) not between 1 and 5", "cardinality(p_redirect_uris) not between 0 and 500"),
    ("a return address need not be on Ryan's list (a document can widen where codes go)", "    if not ryagram_private.connect_uri_ok(uri) then", "    if false then"),
    ("the stored name comes from the caller, not the allowlist's label", "values (p_client_id, lbl, p_redirect_uris)", "values (p_client_id, p_client_id, p_redirect_uris)"),
    ("a second call does not refresh the purge clock", "name = excluded.name, created_at = now();", "name = excluded.name;"),
    ("a second call does not update the return addresses", "on conflict (client_id) do update set redirect_uris = excluded.redirect_uris,", "on conflict (client_id) do update set"),
    ("a signed-in person may call it", "grant execute on function public.connect_cimd_client(text, text[]) to connect_runner;", "grant execute on function public.connect_cimd_client(text, text[]) to connect_runner, authenticated;"),
    ("a visitor may read the allowlist", "revoke all on public.connect_cimd_allowlist from public, anon, authenticated;", "grant select on public.connect_cimd_allowlist to anon;"),
    ("the allowlist is not row-secured", "alter table public.connect_cimd_allowlist enable row level security;\n", ""),
    ("the allowlist accepts a plain http address", "check (client_id_url ~ '^https://", "check (client_id_url ~ '^https?://"),
    ("the seed lists another address too", "values ('https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude (claude.ai)');", "values ('https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude (claude.ai)'), ('https://evil.example/doc', 'Evil');"),
    ("the waiting-list gate is not applied after it", "select ryagram_private.gate_apply();", "select 1;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
