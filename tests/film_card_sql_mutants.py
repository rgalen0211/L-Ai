"""Must-fail proof for supabase/tests/test_film_card_requests.py: each mutant breaks ONE rule of the film-card migration (20261109000100_film_cards.sql) in a scratch copy and the SQL tests must then FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/film_card_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

W.MIG = "supabase/migrations/20261109000100_film_cards.sql"
W.TEST = "supabase/tests/test_film_card_requests.py"
W.SCRATCH = W.ROOT / ".mut_card"
W.RUN_TMP = W.base.BASE_TEMP / f"card-mut-{os.getpid()}"

OWN_ASK = "select ver.* into v from public.versions ver join public.projects p on p.id = ver.project_id\n    where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;\n  if not found then\n    raise exception"
OWN_GET = "select ver.story_sha256 into cur from public.versions ver join public.projects p on p.id = ver.project_id\n    where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;\n  if not found then return null; end if;"

W.MUTANTS[:] = [
    ("two asks in flight together are not made to take turns (the limits and the repeat check can both be passed)", "  perform pg_advisory_xact_lock(hashtextextended('film_card:' || me::text, 0));\n", ""),
    ("one lock for everybody: another person's ask waits behind this one", "hashtextextended('film_card:' || me::text, 0)", "hashtextextended('film_card:', 0)"),
    ("a film that is not yours can be asked about", OWN_ASK, OWN_ASK.replace(" and ver.owner_id = me and p.owner_id = me", "")),
    ("a film that is not yours can be read", OWN_GET, OWN_GET.replace(" and ver.owner_id = me and p.owner_id = me", "")),
    ("an archived film can be asked about", OWN_ASK, OWN_ASK.replace(" and p.archived_at is null", "")),
    ("asking again stores a second request", [
        (W.MIG, "create unique index film_card_requests_one_per_story on", "create index film_card_requests_one_per_story on"),
        (W.MIG, "      return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);                    -- asking again for the same saved film is one request, not two", "      null;"),
    ]),
    ("no cap on open requests", "  if waiting >= 5 then", "  if false then"),
    ("no cap per day", "  if today >= 100 then", "  if false then"),
    ("the daily count is everyone's, not the person's", "select count(*) into today from public.film_card_requests where owner_id = me and asked_at > now() - interval '24 hours';", "select count(*) into today from public.film_card_requests where asked_at > now() - interval '24 hours';"),
    ("an ask keeps old rows", "begin\n  perform ryagram_private.film_card_sweep();\n  select ver.* into v", "begin\n  select ver.* into v"),
    ("a read keeps old rows", "begin\n  perform ryagram_private.film_card_sweep();\n  select ver.story_sha256 into cur", "begin\n  select ver.story_sha256 into cur"),
    ("the sweep keeps finished rows too long", "or (state in ('answered', 'failed') and finished_at < now() - interval '30 days')\n$$;", "or (state in ('answered', 'failed') and finished_at < now() - interval '300 days')\n$$;"),
    ("the sweep keeps unanswered rows too long", "as $$\n  delete from public.film_card_requests where (state in ('asked', 'claimed') and asked_at < now() - interval '7 days')", "as $$\n  delete from public.film_card_requests where (state in ('asked', 'claimed') and asked_at < now() - interval '70 days')"),
    ("the purge deletes too little", "finished_at < now() - interval '30 days') returning 1)", "finished_at < now() - interval '300 days') returning 1)"),
    ("a visitor may run the purge", "grant execute on function public.film_card_purge() to service_role;", "grant execute on function public.film_card_purge() to service_role, anon;"),
    ("the table is open to a signed-in person", "revoke all on public.film_card_requests from public, anon, authenticated, service_role, connect_runner;", "grant all on public.film_card_requests to authenticated;"),
    ("an engine error is retried at once", "same.finished_at < now() - interval '10 minutes'", "same.finished_at < now() + interval '10 minutes'"),
    ("any failure is retried", "if same.state = 'failed' and same.fail_code = 'engine_error' and same.finished_at", "if same.state = 'failed' and same.finished_at"),
    ("a stale card is not called stale", "'stale', ok.story_sha256 <> cur,", "'stale', false,"),
    ("the refresh request is never reported", "'refresh', case when ok.story_sha256 = cur or r.id is null then null else jsonb_build_object('state', r.state, 'fail_code', r.fail_code) end,", "'refresh', null,"),
    ("the oldest card is shown, not the newest", "order by (story_sha256 = cur) desc, finished_at desc limit 1;", "order by finished_at asc limit 1;"),
    ("a claim does not mark the request claimed", "  update public.film_card_requests set state = 'claimed', claimed_at = now() where id = g.id;\n  return query", "  return query"),
    ("an abandoned claim never comes back", " or (state = 'claimed' and claimed_at < now() - interval '10 minutes')", ""),
    ("claims-off is ignored", "  if not ctl.claims_enabled then return; end if;\n  select * into g", "  select * into g"),
    ("anyone signed in can claim (no worker check)", "declare w public.workers := ryagram_private.require_worker(); ctl public.control; g public.film_card_requests; v public.versions;", "declare ctl public.control; g public.film_card_requests; v public.versions;"),
    ("the claim hands out the wrong story", "return query select g.id, g.project_id, g.version_id, g.story_sha256, v.story_spec, v.dataset_id;", "return query select g.id, g.project_id, g.version_id, g.story_sha256, '{}'::jsonb, v.dataset_id;"),
    ("a card for another story is stored", "  if p_card #>> '{basis,story_sha256}' is distinct from g.story_sha256 then", "  if false then"),
    ("a card of another schema is stored", " or p_card -> 'schema' is distinct from '1'::jsonb", ""),
    ("a card with no look is stored", " or jsonb_typeof(p_card -> 'look') is distinct from 'object'", ""),
    ("a card with no picture is stored", " or jsonb_typeof(p_card #> '{frame,svg}') is distinct from 'string'", ""),
    ("a card of any size is stored", "octet_length(p_card::text) > 262144 or", "octet_length(p_card::text) > 262144000 or"),
    ("a card can be written to a request nobody claimed", "select * into g from public.film_card_requests where id = p_id and state = 'claimed';", "select * into g from public.film_card_requests where id = p_id;"),
    ("any failure code is accepted", "  if p_code is null or p_code not in ('story_not_found', 'view_not_supported', 'engine_error', 'card_rejected') then", "  if false then"),
    ("a failure can be recorded for a request nobody claimed", "finished_at = now() where id = p_id and state = 'claimed';", "finished_at = now() where id = p_id;"),
    ("the waiting-list check is not applied to the worker functions", "select ryagram_private.gate_apply();                       -- the worker functions", "select 1;                       -- the worker functions"),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
