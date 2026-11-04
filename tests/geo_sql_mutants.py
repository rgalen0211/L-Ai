"""Must-fail proof for supabase/tests/test_geo_requests.py: each mutant breaks ONE rule of the geo-requests migration in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/geo_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261104000300_geo_requests.sql"
W.TEST = "supabase/tests/test_geo_requests.py"
W.SCRATCH = W.ROOT / ".mut_geo"
W.RUN_TMP = W.base.BASE_TEMP / f"geo-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("the point is not rounded", "la := round(p_lat::numeric, 4)::double precision;", "la := p_lat;"),
    ("the same question is stored twice", "  if found then\n    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);                      -- asking the same thing again is one request, not two\n  end if;\n", ""),
    ("no cap on open questions", "  if waiting >= 5 then", "  if false then"),
    ("no cap per day", "  if today >= 100 then", "  if false then"),
    ("an ask keeps old rows", "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  if p_lat is null", "begin\n  if p_lat is null"),
    ("a read keeps old rows", "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  select * into g", "begin\n  select * into g"),
    ("the purge deletes nothing", "with d as (delete from public.geo_requests where asked_at < now() - interval '7 days' returning 1)", "with d as (delete from public.geo_requests where asked_at < now() - interval '7 days' and false returning 1)"),
    ("anyone's request can be read with a token", "select * into g from public.geo_requests where id = p_id and owner_id = me;", "select * into g from public.geo_requests where id = p_id;"),
    ("the categories are not checked", "  if not ryagram_private.geo_categories_ok(cats) then", "  if false then"),
    ("minutes are not checked", "  if p_minutes is null or p_minutes not between 1 and 60 then", "  if false then"),
    ("a claim does not mark the request claimed", "  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;\n", ""),
    ("an abandoned claim never comes back", " or (state = 'claimed' and claimed_at < now() - interval '10 minutes')", ""),
    ("claims-off is ignored", "  if not ctl.claims_enabled then return; end if;\n  select * into g", "  select * into g"),
    ("anyone signed in can claim (no worker check)", "declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;", "declare ctl public.control; g public.geo_requests;"),
    ("an answer of any schema is stored", " or p_answer ->> 'schema' is distinct from 'ryagram.drive-estimate/0'", ""),
    ("an answer can be written to a request nobody claimed", "fail_code = null, fail_detail = null where id = p_id and state = 'claimed';", "fail_code = null, fail_detail = null where id = p_id;"),
    ("any failure code is accepted", "  if p_code is null or p_code not in ('geo_request_rejected', 'unknown_category', 'data_not_allowed', 'engine_error', 'answer_rejected') then", "  if false then"),
    ("the waiting-list check is not applied to the new worker functions", "select ryagram_private.gate_apply();                       -- the worker functions", "select 1;                       -- the worker functions"),
    ("a visitor may run the purge", "grant execute on function public.geo_purge() to service_role;", "grant execute on function public.geo_purge() to service_role, anon;"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
