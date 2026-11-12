"""Must-fail proof for supabase/tests/test_geo_questions.py: each mutant breaks ONE rule of the geo-question-shapes migration in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/geo_questions_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261104000400_geo_questions.sql"
W.TEST = "supabase/tests/test_geo_questions.py"
W.SCRATCH = W.ROOT / ".mut_geoq"
W.RUN_TMP = W.base.BASE_TEMP / f"geoq-mut-{os.getpid()}"

M5 = "supabase/migrations/20261104000500_forecast_requests.sql"
M4 = W.MIG
GATE = "select ryagram_private.gate_apply();                       -- the replaced"
NOGATE = GATE.replace("select ryagram_private.gate_apply();", "select 1;")
# 000500 REDEFINES the read, the new claim and the answer (and the shape/field constraint) from 000400, so those rules are mutated there, where the live definition is; the ask and the old claim are still 000400's
SIG = "public.connect_geo_ask_shape(text, text, double precision, double precision, double precision, double precision, text, text)"
NEWCLAIM = "declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;\nbegin\n  select * into ctl from public.control where id;\n  if not ctl.claims_enabled then return; end if;\n  select r.* into g from public.geo_requests r\n    where r.shape not in"

W.MUTANTS[:] = [
    ("the first point is not rounded", "else round(p_lat::numeric, 4)::double precision end;", "else p_lat end;"),
    ("the second point is not rounded", "round(p_lat_b::numeric, 4)::double precision end;", "p_lat_b end;"),
    ("the same question is stored twice", "  if found then\n    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);\n  end if;\n", ""),
    ("a different town counts as the same question", " and town is not distinct from (case when p_shape = 'where_to_go' then tw end)", ""),
    ("a different category counts as the same question", "category is not distinct from (case when p_shape = 'compare_sites' then null else p_category end) and ", ""),
    ("no cap on open questions", "  if waiting >= 5 then", "  if false then"),
    ("no cap per day", "  if today >= 100 then", "  if false then"),
    ("an unknown shape is accepted by the function", "  if p_shape is null or p_shape not in ('compare_sites', 'verdict', 'where_to_go') then", "  if false then"),
    ("a verdict without a category is accepted by the function", "  if p_shape in ('verdict', 'where_to_go') and (p_category is null or p_category !~ '^[a-z][a-z0-9_]{1,30}$') then", "  if false then"),
    ("a bad town is accepted by the function", "  if p_shape = 'where_to_go' and tw is not null and tw !~ '^[A-Za-z][A-Za-z .''-]{0,39}$' then", "  if false then"),
    ("a second place that is missing is accepted by the function", "  if p_shape = 'compare_sites' and (p_lat_b is null", "  if false and (p_lat_b is null"),
    ("the table accepts any fields for any shape", [(M5, "add constraint geo_requests_shape_fields check (", "add constraint geo_requests_shape_fields check (true or ")]),
    ("an ask keeps old rows", "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  if p_shape is null", "begin\n  if p_shape is null"),
    ("anyone's request can be read with a token", [(M5, "select * into g from public.geo_requests where id = p_id and owner_id = me;", "select * into g from public.geo_requests where id = p_id;")]),
    ("a read hides the second place", [(M5, "'lat_b', g.lat_b, 'lon_b', g.lon_b,", "'lat_b', null, 'lon_b', null,")]),
    ("a read hides the shape", [(M5, "'state', g.state, 'shape', g.shape,", "'state', g.state, 'shape', 'within_minutes',")]),
    ("a read keeps old rows", [(M5, "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  select * into g", "begin\n  select * into g")]),
    ("the old claim hands out the new shapes", "    where shape = 'within_minutes' and (state = 'asked'", "    where (state = 'asked'"),
    ("the new claim hands out the old shape", [(M5, "    where r.shape not in ('within_minutes', 'forecast') and (r.state", "    where r.shape <> 'forecast' and (r.state")]),
    ("a new claim does not mark the request claimed", [(M5, "  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;\n  return query select g.id, g.shape,", "  return query select g.id, g.shape,")]),
    ("an abandoned new claim never comes back", [(M5, "where r.shape not in ('within_minutes', 'forecast') and (r.state = 'asked' or (r.state = 'claimed' and r.claimed_at < now() - interval '10 minutes'))", "where r.shape not in ('within_minutes', 'forecast') and (r.state = 'asked')")]),
    ("claims-off is ignored by the new claim", [(M5, NEWCLAIM, NEWCLAIM.replace("  if not ctl.claims_enabled then return; end if;\n", ""))]),
    ("anyone signed in can run the new claim (no worker check)", [(M5, NEWCLAIM, NEWCLAIM.replace("w public.workers := ryagram_private.require_worker(); ", ""))]),
    ("an answer for the other kind of question is stored", [(M5, "  if (case g.shape when 'within_minutes' then 'ryagram.drive-estimate/0' when 'forecast' then 'ryagram.forecast-answer/0' else 'ryagram.geo-ask/0' end) is distinct from p_answer ->> 'schema' then", "  if false then")]),
    ("an answer of any schema is stored", [(M5, " or p_answer ->> 'schema' not in ('ryagram.drive-estimate/0', 'ryagram.geo-ask/0', 'ryagram.forecast-answer/0')", "")]),
    ("an answer can be written to a request nobody claimed", [(M5, "where id = p_id and state = 'claimed' for update;", "where id = p_id for update;")]),
    ("the waiting-list check is not applied to the new and replaced functions", [(M4, GATE, NOGATE), (M5, GATE, NOGATE)]),
    ("a signed-in person may run the shape ask directly", "grant execute on function " + SIG + " to connect_runner;", "grant execute on function " + SIG + " to connect_runner, authenticated;"),
]

# The ask-locks migration (20261109000300) replaces the ask function(s) and refuses a drifted one, so the BODY mutants are made in that migration (tests/ask_locks_retarget.py).
from ask_locks_retarget import retarget  # noqa: E402
retarget(W, "connect_geo_ask_shape")

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
