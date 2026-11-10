"""Must-fail proof for supabase/tests/test_county_requests.py: each mutant breaks ONE rule of the county-request migration (20261109000200_county_requests.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/county_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261109000200_county_requests.sql"
W.TEST = "supabase/tests/test_county_requests.py"
W.SCRATCH = W.ROOT / ".mut_county"
W.RUN_TMP = W.base.BASE_TEMP / f"county-mut-{os.getpid()}"

W.MUTANTS[:] = [
    ("two asks in flight together are not made to take turns (the limits and the repeat check can both be passed)", "  perform pg_advisory_xact_lock(hashtextextended('county:' || me::text, 0));\n", ""),
    ("one lock for everybody: another person's ask waits behind this one", "hashtextextended('county:' || me::text, 0)", "hashtextextended('county:', 0)"),
    ("any shape is accepted", "  if p_shape is null or p_shape not in ('profile', 'compare') then", "  if false then"),
    ("a county code need not be five digits", "or c !~ '^[0-9]{5}$')", "or false)"),
    ("a county may be listed twice", "     and (select count(distinct c) from unnest(p_counties) c) = cardinality(p_counties)\n", ""),
    ("any number of counties is accepted", "cardinality(p_counties) between 1 and 3", "cardinality(p_counties) between 1 and 50"),
    ("the table holds a comparison of five counties", "cardinality(p_counties) between 1 and 3", "cardinality(p_counties) between 1 and 5"),
    ("a fourth county is refused without saying why", "  if cardinality(p_counties) > 3 then", "  if cardinality(p_counties) > 300 then"),
    ("the cap's words do not say why", "More would make the answer longer than this connection can carry; ", ""),
    ("a profile may name two counties and a comparison one", "  if (p_shape = 'profile' and cardinality(p_counties) <> 1) or (p_shape = 'compare' and cardinality(p_counties) < 2) then", "  if false then"),
    ("any kind is accepted", "  if p_kind is distinct from 'limited_service' then", "  if false then"),
    ("any rule is accepted", "  if p_rule is not null and p_rule not in ('per_10k_low_first', 'per_10k_high_first', 'count_high_first') then", "  if false then"),
    ("a profile may carry a rule or a year", "  if p_shape = 'profile' and (p_rule is not null or p_year is not null) then", "  if false then"),
    ("any year is accepted, with or without a rule", "  if p_year is not null and (p_year not between 1998 and 2024 or p_rule is null) then", "  if false then"),
    ("the order of the counties is not part of the question", "where owner_id = me and shape = p_shape and counties = p_counties and kind = p_kind", "where owner_id = me and shape = p_shape and kind = p_kind"),
    ("the rule is not part of the question", " and rule is not distinct from p_rule and year is not distinct from p_year\n      and state <> 'failed'", " and year is not distinct from p_year\n      and state <> 'failed'"),
    ("the same question is one request for ever", " and state <> 'failed' and asked_at > now() - interval '10 minutes'", " and state <> 'failed'"),
    ("no cap on open requests", "  if waiting >= 5 then", "  if false then"),
    ("no cap per day", "  if today >= 100 then", "  if false then"),
    ("the daily count is everyone's, not the person's", "select count(*) into today from public.county_requests where owner_id = me and asked_at > now() - interval '24 hours';", "select count(*) into today from public.county_requests where asked_at > now() - interval '24 hours';"),
    ("an ask keeps old rows", "  delete from public.county_requests where asked_at < now() - interval '7 days';\n  if p_shape is null", "  if p_shape is null"),
    ("a read keeps old rows", "begin\n  delete from public.county_requests where asked_at < now() - interval '7 days';\n  select * into c", "begin\n  select * into c"),
    ("the purge deletes nothing", "with d as (delete from public.county_requests where asked_at < now() - interval '7 days' returning 1)", "with d as (delete from public.county_requests where asked_at < now() - interval '7 days' and false returning 1)"),
    ("a visitor may run the purge", "grant execute on function public.county_purge() to service_role;", "grant execute on function public.county_purge() to service_role, anon;"),
    ("anyone's request can be read with a token", "select * into c from public.county_requests where id = p_id and owner_id = me;", "select * into c from public.county_requests where id = p_id;"),
    ("the table is open to a signed-in person", "revoke all on public.county_requests from public, anon, authenticated, service_role, connect_runner;", "grant all on public.county_requests to authenticated;"),
    ("a claim does not mark the request claimed", "  update public.county_requests set state = 'claimed', claimed_at = now() where id = c.id;\n  return query", "  return query"),
    ("an abandoned claim never comes back", " or (state = 'claimed' and claimed_at < now() - interval '10 minutes')", ""),
    ("claims-off is ignored", "  if not ctl.claims_enabled then return; end if;\n  select * into c", "  select * into c"),
    ("anyone signed in can claim (no worker check)", "declare w public.workers := ryagram_private.require_worker(); ctl public.control; c public.county_requests;", "declare ctl public.control; c public.county_requests;"),
    ("an answer of any schema is stored", "\n     or p_answer ->> 'schema' is distinct from (case when c.shape = 'profile' then 'ryagram.geo-county-profile/0' else 'ryagram.geo-compare-counties/0' end) then", " then"),
    ("an answer of any size is stored", "or octet_length(p_answer::text) > 65536\n", "or octet_length(p_answer::text) > 65536000\n"),
    ("an answer can be written to a request nobody claimed", "where id = p_id and state = 'claimed' for update;", "where id = p_id for update;"),
    ("any failure code is accepted", "  if p_code is null or p_code not in ('request_rejected', 'county_not_held', 'engine_error', 'answer_rejected') then", "  if false then"),
    ("a failure can be recorded for a request nobody claimed", "finished_at = now() where id = p_id and state = 'claimed';", "finished_at = now() where id = p_id;"),
    ("the waiting-list check is not applied to the worker functions", "select ryagram_private.gate_apply();                       -- the worker functions", "select 1;                       -- the worker functions"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
