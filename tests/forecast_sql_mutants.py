"""Must-fail proof for supabase/tests/test_forecast_requests.py: each mutant breaks ONE rule of the forecast-requests migration in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/forecast_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261104000500_forecast_requests.sql"
W.TEST = "supabase/tests/test_forecast_requests.py"
W.SCRATCH = W.ROOT / ".mut_fc"
W.RUN_TMP = W.base.BASE_TEMP / f"fc-mut-{os.getpid()}"

SIG = "public.connect_forecast_ask(text, jsonb, int, text, int[], text)"
FCLAIM = "declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.geo_requests;\nbegin\n  select * into ctl from public.control where id;\n  if not ctl.claims_enabled then return; end if;\n  select r.* into g from public.geo_requests r\n    where r.shape = 'forecast'"

W.MUTANTS[:] = [
    ("the series length is not checked by the function", "  if p_series is null or (case when jsonb_typeof(p_series) <> 'array'", "  if false and (case when jsonb_typeof(p_series) <> 'array'"),
    ("the pairs are not checked by the function", "  if exists (select 1 from jsonb_array_elements(p_series) e\n              where case", "  if false and exists (select 1 from jsonb_array_elements(p_series) e\n              where case"),
    ("years that do not go forward are accepted by the function", "where s.prev is not null and s.y <= s.prev", "where false"),
    ("the years ahead are not checked by the function", "  if p_horizon is null or p_horizon not between 1 and 10 then", "  if false then"),
    ("any method is accepted by the function", "  if p_method is not null and p_method not in ('linear', 'log', 'moving_average') then", "  if false then"),
    ("the breaks are not checked by the function", "  if brk is not null and (cardinality(brk) > 5", "  if false and (cardinality(brk) > 5"),
    ("the unit is not checked by the function", "  if un is not null and un !~ '^[A-Za-z%$ ./-]{1,30}$' then", "  if false then"),
    ("the same request is stored twice", "  if found then\n    return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);\n  end if;\n", ""),
    ("a different horizon counts as the same request", "series = p_series and horizon = p_horizon and", "series = p_series and"),
    ("no cap on open requests", "  if waiting >= 5 then", "  if false then"),
    ("no cap per day", "  if today >= 100 then", "  if false then"),
    ("an ask keeps old rows", "begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n  if p_series is null", "begin\n  if p_series is null"),
    ("the table accepts any fields for a forecast", "add constraint geo_requests_forecast_fields check (", "add constraint geo_requests_forecast_fields check (true or "),
    ("anyone's request can be read with a token", "select * into g from public.geo_requests where id = p_id and owner_id = me;", "select * into g from public.geo_requests where id = p_id;"),
    ("a read hides the years ahead", "'horizon', g.horizon, 'method'", "'horizon', null, 'method'"),
    ("the question claim hands out forecasts", "where r.shape not in ('within_minutes', 'forecast') and", "where r.shape <> 'within_minutes' and"),
    ("the forecast claim hands out other requests", "    where r.shape = 'forecast' and (r.state", "    where (r.state"),
    ("a forecast claim does not mark the request claimed", "  update public.geo_requests set state = 'claimed', claimed_at = now() where id = g.id;\n  return query select g.id, g.series,", "  return query select g.id, g.series,"),
    ("an abandoned forecast claim never comes back", "where r.shape = 'forecast' and (r.state = 'asked' or (r.state = 'claimed' and r.claimed_at < now() - interval '10 minutes'))", "where r.shape = 'forecast' and (r.state = 'asked')"),
    ("claims-off is ignored by the forecast claim", FCLAIM, FCLAIM.replace("  if not ctl.claims_enabled then return; end if;\n", "")),
    ("anyone signed in can run the forecast claim (no worker check)", FCLAIM, FCLAIM.replace("w public.workers := ryagram_private.require_worker(); ", "")),
    ("an answer for the other kind of request is stored", "  if (case g.shape when 'within_minutes' then 'ryagram.drive-estimate/0' when 'forecast' then 'ryagram.forecast-answer/0' else 'ryagram.geo-ask/0' end) is distinct from p_answer ->> 'schema' then", "  if false then"),
    ("an answer of any schema is stored", " or p_answer ->> 'schema' not in ('ryagram.drive-estimate/0', 'ryagram.geo-ask/0', 'ryagram.forecast-answer/0')", ""),
    ("an answer can be written to a request nobody claimed", "where id = p_id and state = 'claimed' for update;", "where id = p_id for update;"),
    ("the waiting-list check is not applied to the new and replaced functions", "select ryagram_private.gate_apply();                       -- the replaced", "select 1;                       -- the replaced"),
    ("a signed-in person may run the forecast ask directly", "grant execute on function " + SIG + " to connect_runner;", "grant execute on function " + SIG + " to connect_runner, authenticated;"),
]

# The ask-locks migration (20261109000300) replaces the ask function(s) and refuses a drifted one, so the BODY mutants are made in that migration (tests/ask_locks_retarget.py).
from ask_locks_retarget import retarget  # noqa: E402
retarget(W, "connect_forecast_ask")

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
