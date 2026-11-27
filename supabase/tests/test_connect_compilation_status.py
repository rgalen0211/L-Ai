"""THE COMPILATIONS DEPARTMENT FOR THE PERSON'S AI (migrations/20261127000400_connect_compilation_status.sql, NOT APPLIED) on a local Postgres. CONNECT 2026-11-27. WRITTEN, NOT RUN (one Postgres at a time across the sessions).

Same setup as test_compilation_requests.py (its helpers are borrowed, the OAuth dance included), except that nobody starts as an invited tester here. Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_compilation_status.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * THE GATE, on BOTH the reader (connect_compilation_get) and the AI's writer (connect_set_compilation_request): an account Compilations are not open for is refused in words (42501, 'Compilations are not open for this account yet.')
    and nothing is read or written; an invited tester (local_compute), an administrator, or BUILDER's ryagram_private.compilations_on (when it exists) is let in; a read-only or invalid token is still refused first, by the token's own rules
  * the writer keeps its signature, its answer, its grants (the connector login only) and every other behaviour: someone else's project looks absent, a wrong-schema or oversize request is refused (22023), the hash is the SHA-256, a second save replaces
  * the token's own person only: a project that is not theirs, or does not exist, answers null; a token that is not valid is refused; the reader takes no owner argument
  * an own project with no request answers {request: null, run: null}; a saved request comes back exactly as saved with its hash
  * the newest report (by started_at) is shown, with `current` true only when it was made for the request as saved now; a report row shows exactly BUILDER's ten fields (no path, no transcript); another person's report is never shown
  * until compilation_runs exists `run` is null (the guard), and nothing is written by any read
  * the gate helper is callable by nobody directly; the migration adds the helper and the reader, replaces the writer, and ends with the gate; the after-check is all true; the rollback puts the writer back exactly and removes the two new functions
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_compilation_requests as tcr  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

MIG = core.ROOT / "migrations" / "20261127000400_connect_compilation_status.sql"
RB = core.ROOT / "rollbacks" / "20261127000400_connect_compilation_status_rollback.sql"
CHECK = core.ROOT / "live-steps" / "66_connect_compilation_status_check.sql"
OLD = core.ROOT / "migrations" / "20261026000300_compilation_requests.sql"
REQ = {"schema": "ryagram.compilation-request/0", "phrase": "invented phrase", "search": "every", "folders": ["Invented Folder"], "song": False, "clean_cuts": False, "rules": [], "texts": [], "note": ""}
CLOSED = "Compilations are not open for this account yet."
# the stand-in for BUILDER's table (only when the template does not have it yet): his final column list (id bigint, owner_id, project_id, request_sha256, state, matches, clips, film_seconds, error_code, started_at, updated_at, ended_at)
RUNS = """create table if not exists public.compilation_runs (
  id bigint generated always as identity primary key, owner_id uuid not null, project_id uuid not null references public.projects (id) on delete cascade, request_sha256 text not null,
  state text not null, matches int, clips int, film_seconds numeric, error_code text, started_at timestamptz not null default now(), updated_at timestamptz not null default now(), ended_at timestamptz)"""
WRITE = "select connect_set_compilation_request(%s, %s, %s::jsonb)"


class ConnectCompilationStatus(core.Base):
    setUp = tcr.CompilationRequests.setUp
    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect
    fails = tc.Connect.fails
    admin = tcr.CompilationRequests.admin
    project_for = tcr.CompilationRequests.project_for
    save = tcr.CompilationRequests.save

    def open_accounts(self):                 # the older tests open Alice and Bob; here nobody starts as an invited tester
        pass

    def run_sql(self, sql, *args):
        """Anything that is not a SELECT (DDL, inserts): as the owner, no result expected."""
        self.db.c.execute("reset role")
        self.db.c.execute(sql, args or None)

    def get(self, access, project):
        return self.runner().one("select connect_compilation_get(%s, %s)", h(access), project)

    def open_for(self, who):
        self.run_sql("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", who)

    def stand_in_switch(self, who):
        """BUILDER's ryagram_private.compilations_on, as a stand-in that says yes for one person only."""
        self.run_sql("create or replace function ryagram_private.compilations_on(p uuid) returns boolean language sql as $$ select p = '%s'::uuid $$" % who)

    # ---------------------------------------------------------------------------------------------- the gate, on the reader
    def test_a_closed_account_is_refused_in_words_and_an_invited_tester_or_an_administrator_is_let_in(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        err = self.fails("select connect_compilation_get(%s, %s)", h(a), p, code="42501")
        self.assertIn(CLOSED, str(err))
        self.open_for(ALICE)
        self.assertEqual(self.get(a, p), {"request": None, "sha256": None, "updated_at": None, "run": None})

    def test_builders_function_adds_to_the_older_rule_and_never_takes_it_away(self):
        _, b, _ = self.connect(BOB)
        p = self.project_for(b)
        self.runner()
        self.fails("select connect_compilation_get(%s, %s)", h(b), p, code="42501")
        self.stand_in_switch(BOB)
        self.assertIsNone(self.get(b, p)["request"], "the person with the account switch gets in")
        _, a, _ = self.connect(ALICE)
        self.runner()
        self.fails("select connect_compilation_get(%s, %s)", h(a), "00000000-0000-4000-8000-000000000009", code="42501")
        self.open_for(ALICE)
        self.assertIsNone(self.get(a, "00000000-0000-4000-8000-000000000009"), "an invited tester keeps the way in that is live today")

    # ---------------------------------------------------------------------------------------------- the gate, on the AI's writer
    def test_the_writer_refuses_a_stranger_in_words_and_writes_nothing(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        self.runner()
        err = self.fails(WRITE, h(a), p, json.dumps(REQ), code="42501")
        self.assertIn(CLOSED, str(err))
        self.assertEqual(self.admin("select count(*) from public.compilation_requests"), 0)

    def test_the_writer_lets_in_an_invited_tester_an_administrator_and_the_account_switch(self):
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        pa, pb = self.project_for(a), self.project_for(b)
        self.open_for(ALICE)                                                       # an invited tester
        self.assertRegex(self.save(a, pa, REQ), r"^[0-9a-f]{64}$")
        self.runner()
        self.fails(WRITE, h(b), pb, json.dumps(REQ), code="42501")                 # Bob is still a stranger
        self.stand_in_switch(BOB)                                                  # BUILDER's switch says yes for Bob
        self.assertRegex(self.save(b, pb, REQ), r"^[0-9a-f]{64}$")
        self.assertEqual(self.admin("select count(*) from public.compilation_requests"), 2)

    def test_the_gate_lets_in_an_administrator_and_not_a_nobody(self):
        # an administrator's connection needs its own invitation to have a token at all (connect_actor), so this proves the gate itself, which both functions call
        self.assertTrue(self.admin("select ryagram_private.connect_compilations_open(%s)", tc.ADMIN))
        self.assertFalse(self.admin("select ryagram_private.connect_compilations_open(%s)", tc.NOBODY))

    def test_the_token_is_checked_before_the_gate_and_the_writer_keeps_its_other_behaviour(self):
        self.open_for(ALICE)
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)                                                # Bob is a stranger, Alice a tester
        p = self.project_for(a)
        self.runner()
        self.fails(WRITE, "0" * 64, p, json.dumps(REQ), code="PT401")              # an invalid token: the token's own refusal, not the gate's
        sha1 = self.save(a, p, REQ)
        sha2 = self.save(a, p, dict(REQ, phrase="another invented phrase"))
        self.assertNotEqual(sha1, sha2)
        self.assertEqual(self.admin("select count(*) from public.compilation_requests"), 1, "a second save replaces")
        self.runner()
        self.fails(WRITE, h(a), p, json.dumps({"schema": "wrong"}), code="22023")
        self.fails(WRITE, h(a), p, json.dumps(dict(REQ, note="x" * 40000)), code="22023")
        self.assertIsNone(self.runner().one(WRITE, h(a), "00000000-0000-4000-8000-000000000009", json.dumps(REQ)), "a project that does not exist looks absent")
        self.assertEqual(self.admin("select request ->> 'phrase' from public.compilation_requests where project_id = %s", p), "another invented phrase")

    def test_the_writer_keeps_its_signature_answer_and_grants(self):
        sig = "public.connect_set_compilation_request(text, uuid, jsonb)"
        self.assertEqual(self.admin("select pg_get_function_arguments(%s::regprocedure)", sig), "p_token_hash text, p_project uuid, p_request jsonb")
        self.assertEqual(self.admin("select pg_get_function_result(%s::regprocedure)", sig), "text")
        self.assertTrue(self.admin("select prosecdef from pg_proc where oid = %s::regprocedure", sig))
        self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", sig))
        for role in ("authenticated", "anon", "service_role", "node_runner"):
            self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, sig), role)
        self.assertFalse(self.admin("select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where p.oid = %s::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE')", sig), "not the public")

    def test_the_writer_is_the_live_definition_plus_only_the_gate_check(self):
        import re
        def body(text):
            return re.search(r"create (?:or replace )?function public\.connect_set_compilation_request.*?end \$\$;", text.replace("\r\n", "\n"), re.S).group(0)
        gate = "  if not ryagram_private.connect_compilations_open(me) then\n    raise exception 'Compilations are not open for this account yet.' using errcode = '42501';\n  end if;\n"
        live = body(OLD.read_text(encoding="utf-8")).replace("create function", "create or replace function")
        self.assertEqual(body(MIG.read_text(encoding="utf-8")).replace(gate, ""), live)
        self.assertEqual(body(RB.read_text(encoding="utf-8")), live, "the rollback restores today's definition exactly")

    # ---------------------------------------------------------------------------------------------- the reader's answers
    def test_a_saved_request_comes_back_exactly_and_with_its_hash_and_no_report_is_null(self):
        self.open_for(ALICE)
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        sha = self.save(a, p, REQ)
        got = self.get(a, p)
        self.assertEqual(got["request"], REQ)
        self.assertEqual(got["sha256"], sha)
        self.assertIsNotNone(got["updated_at"])
        self.assertIsNone(got["run"])

    def test_the_newest_report_is_shown_and_current_says_whether_it_is_for_the_request_as_saved_now(self):
        self.open_for(ALICE)
        self.open_for(BOB)
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        p = self.project_for(a)
        sha1 = self.save(a, p, REQ)
        self.run_sql(RUNS)
        self.run_sql("insert into public.compilation_runs (owner_id, project_id, request_sha256, state, matches, clips, film_seconds, started_at, ended_at) values (%s, %s, %s, 'done', 9, 9, 61.5, now() - interval '2 hours', now() - interval '1 hour 50 minutes')", ALICE, p, sha1)
        self.run_sql("insert into public.compilation_runs (owner_id, project_id, request_sha256, state, matches, started_at) values (%s, %s, %s, 'matching', 4, now() - interval '1 hour')", ALICE, p, sha1)
        run = self.get(a, p)["run"]
        self.assertEqual(run["state"], "matching")
        self.assertEqual(run["matches"], 4)
        self.assertIs(run["current"], True)
        self.assertEqual(set(run), {"id", "state", "matches", "clips", "film_seconds", "error_code", "started_at", "updated_at", "ended_at", "current"}, "BUILDER's ten fields and nothing else")
        self.run_sql("insert into public.compilation_runs (owner_id, project_id, request_sha256, state, matches, started_at) values (%s, %s, %s, 'building', 1, now())", BOB, p, sha1)      # a row filed under another owner is never shown
        self.assertEqual(self.get(a, p)["run"]["state"], "matching")
        self.save(a, p, dict(REQ, phrase="another invented phrase"))
        self.assertIs(self.get(a, p)["run"]["current"], False, "the request was changed after that report")

    def test_someone_elses_project_and_a_missing_one_look_absent_and_nothing_is_written(self):
        self.open_for(ALICE)
        self.open_for(BOB)
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        p = self.project_for(a)
        self.save(a, p, REQ)
        before = self.admin("select count(*) from public.compilation_requests")
        self.assertIsNone(self.get(b, p))
        self.assertIsNone(self.get(b, "00000000-0000-4000-8000-000000000009"))
        self.assertEqual(self.admin("select count(*) from public.compilation_requests"), before)

    def test_a_token_that_is_not_valid_is_refused_and_the_reader_takes_no_owner(self):
        self.runner()
        self.fails("select connect_compilation_get(%s, %s)", "0" * 64, "00000000-0000-4000-8000-000000000009")
        self.assertEqual(self.admin("select pronargs from pg_proc where oid = to_regprocedure('public.connect_compilation_get(text, uuid)')"), 2)

    def test_only_the_connector_login_can_run_the_reader_and_nobody_can_run_the_gate_helper(self):
        self.open_for(ALICE)
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select public.connect_compilation_get(%s, %s)", h(a), p)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error, msg="helper " + who):
                self.db.as_(who).one("select ryagram_private.connect_compilations_open(%s)", ALICE)
        self.runner()
        with self.assertRaises(psycopg.Error, msg="helper, connector login"):
            self.db.one("select ryagram_private.connect_compilations_open(%s)", ALICE)
        self.assertFalse(self.admin("select has_table_privilege('connect_runner', 'public.compilation_requests', 'select, insert, update, delete')"))

    # ---------------------------------------------------------------------------------------------- the migration, the check, the rollback
    def test_the_migration_adds_the_helper_and_the_reader_replaces_the_writer_and_ends_with_the_gate(self):
        sql = MIG.read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        self.assertEqual(len([ln for ln in lines if ln.startswith("create function")]), 2)
        self.assertEqual(len([ln for ln in lines if ln.startswith("create or replace function")]), 1)
        self.assertTrue(self.admin("select prosecdef from pg_proc where oid = to_regprocedure('public.connect_compilation_get(text, uuid)')"))

    def test_the_after_check_is_all_true_and_the_rollback_restores_the_writer_and_removes_the_two_new_functions(self):
        rows = self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(len(rows), 10)
        self.assertTrue(all(ok for _, ok in rows), rows)
        before = self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')")
        self.run_sql(RB.read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regprocedure('public.connect_compilation_get(text, uuid)')"))
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.connect_compilations_open(uuid)')"))
        self.assertEqual(self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')"), before - 2)
        self.assertNotIn("connect_compilations_open", self.admin("select prosrc from pg_proc where oid = to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)')"), "the writer is as it was")
        _, a, _ = self.connect(ALICE)                                              # and a stranger can write again, as before the migration
        self.assertRegex(self.save(a, self.project_for(a), REQ), r"^[0-9a-f]{64}$")
        self.run_sql(RB.read_text(encoding="utf-8"))                                                       # a second undo: nothing to do, no error
        self.run_sql(MIG.read_text(encoding="utf-8"))                                                      # and the migration puts it back
        self.assertTrue(all(ok for _, ok in self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()))


if __name__ == "__main__":
    unittest.main()
