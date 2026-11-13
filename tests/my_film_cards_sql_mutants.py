"""Must-fail proof for the site's own film look card (supabase/tests/test_my_film_cards.py): each mutant breaks ONE rule of migrations/20261113000500_my_film_cards.sql (or its rollback) in a scratch copy and the SQL tests must FAIL.
Run from the repo root with the pgserver venv and TEMP on D:
    pgvenv/Scripts/python tests/my_film_cards_sql_mutants.py [--check-targets] [mutant name ...]
Reuses the runner of tests/waiting_sql_mutants.py (own temp per run, the pgserver folder deleted before the next mutant, CAUGHT only on an assertion failure, baseline first). ONE runner at a time in a tree.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waiting_sql_mutants as W  # noqa: E402

M = "supabase/migrations/20261113000500_my_film_cards.sql"
R = "supabase/rollbacks/20261113000500_my_film_cards_rollback.sql"
W.MIG = M
W.TEST = "supabase/tests/test_my_film_cards.py"
W.SCRATCH = W.ROOT / ".mut_mycard"
W.RUN_TMP = W.base.BASE_TEMP / f"mycard-mut-{os.getpid()}"

OWN = "where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;\n  if not found then\n    raise exception"
OWN_GET = "where ver.project_id = p_project and ver.owner_id = me and p.owner_id = me and p.archived_at is null order by ver.number desc limit 1;\n  if not found then return null; end if;"

W.MUTANTS[:] = [
    ("the ask takes another person's film", OWN, OWN.replace("ver.owner_id = me and p.owner_id = me and ", "")),
    ("the read shows another person's film", OWN_GET, OWN_GET.replace("ver.owner_id = me and p.owner_id = me and ", "")),
    ("the ask takes an archived film", OWN, OWN.replace(" and p.archived_at is null", "")),
    ("the read shows an archived film", OWN_GET, OWN_GET.replace(" and p.archived_at is null", "")),
    ("the ask takes no lock", "  perform pg_advisory_xact_lock(hashtextextended('film_card:' || me::text, 0));\n", ""),
    ("the ask takes a different lock from the connector's", "hashtextextended('film_card:' || me::text, 0)", "hashtextextended('my_film_card:' || me::text, 0)"),
    ("asking again for the same story is not said to be a repeat", "      return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', true);", "      return jsonb_build_object('id', same.id, 'state', same.state, 'repeat', false);"),
    ("any failure is tried again, not only an engine error", "if same.state = 'failed' and same.fail_code = 'engine_error' and same.finished_at", "if same.state = 'failed' and same.finished_at"),
    ("an engine failure is tried again at once", "and same.finished_at < now() - interval '10 minutes' then", "then"),
    ("six open at once", "if waiting >= 5 then", "if waiting >= 6 then"),
    ("a claimed request is not counted as open", "where owner_id = me and state in ('asked', 'claimed');", "where owner_id = me and state in ('asked');"),
    ("101 a day", "if today >= 100 then", "if today >= 101 then"),
    ("a day is 48 hours", "asked_at > now() - interval '24 hours';", "asked_at > now() - interval '48 hours';"),
    ("the ask counts every person's requests", "select count(*) into waiting from public.film_card_requests where owner_id = me and", "select count(*) into waiting from public.film_card_requests where true and"),
    ("a card of an older story is not called stale", "'stale', ok.story_sha256 <> cur,", "'stale', false,"),
    ("the card of the current story is not preferred", "order by (story_sha256 = cur) desc, finished_at desc limit 1;", "order by finished_at desc limit 1;"),
    ("a refresh is reported for the card that is current", "case when ok.story_sha256 = cur or r.id is null then null", "case when r.id is null then null"),
    ("a failed card may always be asked again", "retry := r.id is not null and r.state = 'failed' and r.fail_code = 'engine_error' and r.finished_at < now() - interval '10 minutes';", "retry := r.id is not null and r.state = 'failed';"),
    # (dropped as EQUIVALENT: "the read shows the card of any story to another person" removes owner_id = me from the card lookup. The project was already found as the caller's own just before, a project has one owner and a request row
    # carries its project's owner, so no other person's row can match; the guard that matters is the project check above, and it has its own faults.)
    ("the migration forgets the waiting-list gate", "select ryagram_private.gate_apply();                       -- a waiting-list account is refused here like everywhere else\n", ""),
    # (dropped as EQUIVALENT: "the functions are left runnable by everyone" removes this migration's own revoke. The waiting-list gate at the end (gate_apply) revokes public and anon from every gated function, so the revoke is a
    # second lock; the grants test and the after-check read the result, and the fault that removes the gate is caught.)
    ("the functions are not granted to a signed-in session", "to authenticated;\n\nselect ryagram", "to service_role;\n\nselect ryagram"),
    ("the person is taken from the caller's own words", "me uuid := ryagram_private.require_signed_in();\n  v public.versions;", "me uuid := auth.uid();\n  v public.versions;"),
    ("the rollback leaves the ask in place", [(R, "drop function if exists public.my_film_card_ask(uuid);\n", "")]),
    ("the rollback leaves the read in place", [(R, "drop function if exists public.my_film_card_get(uuid);\n", "")]),
    ("the rollback also removes the connector's read", [(R, "drop function if exists public.my_film_card_get(uuid);\n", "drop function if exists public.my_film_card_get(uuid);\ndrop function if exists public.connect_film_card_get(text, uuid);\n")]),
]

if __name__ == "__main__":
    if "--check-targets" in sys.argv:
        b = W.targets_bad()
        print("targets ok" if not b else f"BAD TARGETS: {b}")
        sys.exit(1 if b else 0)
    sys.exit(W.run([a for a in sys.argv[1:] if not a.startswith("--")] or None))
