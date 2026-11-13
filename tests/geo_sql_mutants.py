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

M4 = "supabase/migrations/20261104000400_geo_questions.sql"
M5 = "supabase/migrations/20261104000500_forecast_requests.sql"
GATE = "select ryagram_private.gate_apply();                       -- the replaced"
NOGATE = GATE.replace("select ryagram_private.gate_apply();", "select 1;")
# 000400 and 000500 REDEFINE the read, the old claim and the answer from 000300: those rules are mutated where the LIVE definition is (the last migration that creates the function)
OLDCLAIM = "declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;\nbegin\n  select * into ctl from public.control where id;\n  if not ctl.claims_enabled then return; end if;\n  select * into g"

W.MUTANTS[:] = [
    ("the point is not rounded", "la := round(p_lat::numeric, 4)::double precision;", "la := p_lat;"),
    ("the same question is stored twice", "  if found then\n    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);                      -- asking the same thing again is one request, not two\n  end if;\n", ""),
    ("no cap on open questions", "  if waiting >= 5 then", "  if false then"),
    ("no cap per day", "  if today >= 100 then", "  if false then"),
    ("an ask keeps old rows", "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  if p_lat is null", "begin\n  if p_lat is null"),
    ("a read keeps old rows", [(M5, "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  select * into g", "begin\n  select * into g")]),
    ("the purge deletes nothing", "with d as (delete from public.geo_requests where asked_at < now() - interval '7 days' returning 1)", "with d as (delete from public.geo_requests where asked_at < now() - interval '7 days' and false returning 1)"),
    ("anyone's request can be read with a token", [(M5, "select * into g from public.geo_requests where id = p_id and owner_id = me;", "select * into g from public.geo_requests where id = p_id;")]),
    ("the categories are not checked", "  if not ryagram_private.geo_categories_ok(cats) then", "  if false then"),
    ("minutes are not checked", "  if p_minutes is null or p_minutes not between 1 and 60 then", "  if false then"),
    ("a claim does not mark the request claimed", [(M4, "  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;\n  return query select g.id, g.lat, g.lon, g.minutes, g.categories;", "  return query select g.id, g.lat, g.lon, g.minutes, g.categories;")]),
    ("an abandoned claim never comes back", [(M4, " or (state = 'claimed' and claimed_at < now() - interval '10 minutes')", "")]),
    ("claims-off is ignored", [(M4, "  if not ctl.claims_enabled then return; end if;\n  select * into g", "  select * into g")]),
    ("anyone signed in can claim (no worker check)", [(M4, OLDCLAIM, OLDCLAIM.replace("w public.workers := ryagram_private.require_worker(); ", ""))]),
    ("an answer of any schema is stored", [(M5, " or p_answer ->> 'schema' not in ('ryagram.drive-estimate/0', 'ryagram.geo-ask/0', 'ryagram.forecast-answer/0')", "")]),
    ("an answer can be written to a request nobody claimed", [(M5, "where id = p_id and state = 'claimed' for update;", "where id = p_id for update;")]),
    ("any failure code is accepted", "  if p_code is null or p_code not in ('geo_request_rejected', 'unknown_category', 'data_not_allowed', 'engine_error', 'answer_rejected') then", "  if false then"),
    ("the waiting-list check is not applied to the worker functions", [(W.MIG, "select ryagram_private.gate_apply();                       -- the worker functions", "select 1;                       -- the worker functions"),
                                                                       (M4, GATE, NOGATE), (M5, GATE, NOGATE)]),     # every later migration sweeps the earlier functions again, so the check has to come out of all three
    ("a visitor may run the purge", "grant execute on function public.geo_purge() to service_role;", "grant execute on function public.geo_purge() to service_role, anon;"),
]

# The ask-locks migration (20261109000300) replaces the ask function(s) and refuses a drifted one, so the BODY mutants are made in that migration (tests/ask_locks_retarget.py).
from ask_locks_retarget import retarget  # noqa: E402
retarget(W, "connect_geo_ask")

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
