"""WHERE A COMPILATION STANDS, FOR THE PERSON'S AI (migrations/20261127000400_connect_compilation_status.sql, NOT APPLIED) on a local Postgres. CONNECT 2026-11-27. WRITTEN, NOT RUN (one Postgres at a time across the sessions).

Same setup as test_compilation_requests.py (its helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_compilation_status.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * an account the department is not open for is refused in words (22023) and nothing is read; an invited tester (local_compute) or an administrator is let in; BUILDER's ryagram_private.compilations_on, when it exists, ADDS to that
  * the token's own person only: a project that is not theirs, or does not exist, answers null; a token that is not valid is refused; the function takes no owner argument
  * an own project with no request answers {request: null, run: null}; a saved request comes back exactly as saved with its hash
  * the newest report is shown, with `current` true only when it was made for the request as saved now; a report row never shows more than seven fields (no path, no transcript)
  * until compilation_runs exists `run` is null (the guard), and nothing is written by any call
  * only the connector login can run it; the request table stays closed to the connector login; the migration adds one function and ends with the gate; the after-check is all true; the rollback removes exactly this function
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
REQ = {"schema": "ryagram.compilation-request/0", "phrase": "invented phrase", "search": "every", "folders": ["Invented Folder"], "song": False, "clean_cuts": False, "rules": [], "texts": [], "note": ""}
# the stand-in for BUILDER's table (only when the template does not have it yet): the nine columns the function reads, nothing else of BUILDER's design
RUNS = """create table if not exists public.compilation_runs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects (id) on delete cascade, request_sha256 text not null,
  state text not null, matches int, clips int, film_seconds numeric, error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())"""


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

    def run_sql(self, sql, *args):
        """Anything that is not a SELECT (DDL, inserts): as the owner, no result expected."""
        self.db.c.execute("reset role")
        self.db.c.execute(sql, args or None)

    def get(self, access, project):
        return self.runner().one("select connect_compilation_get(%s, %s)", h(access), project)

    def open_for(self, who):
        self.run_sql("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", who)

    def test_a_closed_account_is_refused_in_words_and_an_invited_tester_or_an_administrator_is_let_in(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        self.runner()
        err = self.fails("select connect_compilation_get(%s, %s)", h(a), p, code="22023")
        self.assertIn("Compilations are not open for this account yet.", str(err))
        self.open_for(ALICE)
        self.assertEqual(self.get(a, p), {"request": None, "sha256": None, "updated_at": None, "run": None})

    def test_builders_function_adds_to_the_older_rule_and_never_takes_it_away(self):
        _, b, _ = self.connect(BOB)
        p = self.project_for(b)
        self.runner()
        self.fails("select connect_compilation_get(%s, %s)", h(b), p, code="22023")
        self.run_sql("create function ryagram_private.compilations_on(p uuid) returns boolean language sql as $$ select p = %s::uuid $$" % ("'" + BOB + "'"))
        self.assertIsNone(self.get(b, p)["request"], "the person with the account switch gets in")
        _, a, _ = self.connect(ALICE)
        pa = self.project_for(a)
        self.runner()
        self.fails("select connect_compilation_get(%s, %s)", h(a), pa, code="22023")
        self.open_for(ALICE)
        self.assertIsNone(self.get(a, pa)["request"], "an invited tester keeps the way in that is live today")

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
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        sha1 = self.save(a, p, REQ)
        self.run_sql(RUNS)
        self.run_sql("insert into public.compilation_runs (project_id, request_sha256, state, matches, clips, film_seconds, created_at) values (%s, %s, 'done', 9, 9, 61.5, now() - interval '2 hours')", p, sha1)
        self.run_sql("insert into public.compilation_runs (project_id, request_sha256, state, matches, created_at) values (%s, %s, 'matching', 4, now() - interval '1 hour')", p, sha1)
        run = self.get(a, p)["run"]
        self.assertEqual(run["state"], "matching")
        self.assertEqual(run["matches"], 4)
        self.assertIs(run["current"], True)
        self.assertEqual(set(run), {"state", "matches", "clips", "film_seconds", "error_code", "updated_at", "current"}, "seven fields and nothing else")
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

    def test_a_token_that_is_not_valid_is_refused_and_the_function_takes_no_owner(self):
        self.runner()
        self.fails("select connect_compilation_get(%s, %s)", "0" * 64, "00000000-0000-4000-8000-000000000009")
        self.assertEqual(self.admin("select pronargs from pg_proc where oid = to_regprocedure('public.connect_compilation_get(text, uuid)')"), 2)

    def test_only_the_connector_login_can_run_it_and_the_request_table_stays_closed_to_it(self):
        self.open_for(ALICE)
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        for who in (ALICE, "anon"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select public.connect_compilation_get(%s, %s)", h(a), p)
        self.assertFalse(self.admin("select has_table_privilege('connect_runner', 'public.compilation_requests', 'select, insert, update, delete')"))

    def test_the_migration_adds_one_function_and_ends_with_the_gate(self):
        sql = MIG.read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        self.assertEqual(len([ln for ln in lines if ln.startswith("create ")]), 1)
        self.assertTrue(self.admin("select prosecdef from pg_proc where oid = to_regprocedure('public.connect_compilation_get(text, uuid)')"))

    def test_the_after_check_is_all_true_and_the_rollback_removes_exactly_this_function(self):
        rows = self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(len(rows), 7)
        self.assertTrue(all(ok for _, ok in rows), rows)
        before = self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')")
        self.run_sql(RB.read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regprocedure('public.connect_compilation_get(text, uuid)')"))
        self.assertEqual(self.admin("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')"), before - 1)
        self.assertIsNotNone(self.admin("select to_regprocedure('public.connect_set_compilation_request(text, uuid, jsonb)')"), "the request writer is untouched")
        self.run_sql(RB.read_text(encoding="utf-8"))                                                       # a second undo: nothing to do, no error
        self.run_sql(MIG.read_text(encoding="utf-8"))                                                      # and the migration puts it back
        self.assertTrue(all(ok for _, ok in self.db.as_(None).c.execute(CHECK.read_text(encoding="utf-8")).fetchall()))


if __name__ == "__main__":
    unittest.main()
