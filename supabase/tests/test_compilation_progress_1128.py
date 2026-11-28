"""COMPILATION PROGRESS, COUNTS ONLY (migrations/20261128000100_compilation_progress.sql, NOT APPLIED) on a local Postgres with every migration and the 2B ledger. BUILDER 2026-11-27.
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -m unittest supabase/tests/test_compilation_progress_1128.py -v

What it proves, each with the opposite case beside it
  * the 11-argument report keeps the three numbers while a build runs; the page's read gives them back; the 8-argument report (the node deployed 11-27) still works and keeps them in the same state
  * ONE SET: given = all three replaced; not given = kept in the same state, cleared on a new state; done, failed, cancelled and a stale close clear them
  * ranges: step_total 0 to 1000, step_done 0 to step_total and only with it, percent 0 to 100; an end state that carries them is refused; every refusal is in words and changes nothing
  * the table itself refuses numbers on an ended build, whoever writes it
  * live step 85 says STOP before and PASS after, step 81 still PASS after; the rollback puts both functions back exactly as 000300 wrote them, and an apply, undo, apply round trip works
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_compilations_for_everyone as comp  # noqa: E402

OTHER = core.OTHER
MIG = core.ROOT / "migrations" / "20261128000100_compilation_progress.sql"
RB = core.ROOT / "rollbacks" / "20261128000100_compilation_progress_rollback.sql"
STEP85 = core.ROOT / "live-steps" / "85_compilation_progress_check.sql"
STEP81 = core.ROOT / "live-steps" / "81_compilations_check.sql"
setUpModule = comp.setUpModule


class Progress(comp.Compilations):
    def go(self):
        self.switch_on(OTHER)
        tok = self.sign_in(OTHER)
        pid = self.project()
        sha = self.put(pid)
        return tok, pid, sha

    def rep(self, token, pid, sha, state, step_done=None, step_total=None, percent=None, **kw):
        return self.runner().one("select node_compilation_report(%s::text, %s::uuid, %s::text, %s::text, %s::int, %s::int, %s::numeric, %s::text, %s::int, %s::int, %s::int)",
                                 comp.h(token), pid, sha, state, kw.get("matches"), kw.get("clips"), kw.get("film_seconds"), kw.get("error"), step_done, step_total, percent)

    def row(self, run_id):
        return self.db.as_(None).c.execute("select step_done, step_total, percent from public.compilation_runs where id = %s", (run_id,)).fetchone()

    def page(self, pid):
        return self.db.as_(OTHER).one("select my_compilation_get(%s)", pid)["run"]

    def step(self, path):
        return self.db.as_(None).c.execute(path.read_text(encoding="utf-8")).fetchall()

    # the two 000300 tests of its exact shape are inherited and undo this file first (Compilations.undo_progress)
    def test_the_runs_table_has_exactly_the_three_new_whole_number_columns(self):
        cols = {r[0]: r[1] for r in self.d().execute("select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs'").fetchall()}
        self.assertEqual(set(cols), {"id", "owner_id", "project_id", "request_sha256", "state", "matches", "clips", "film_seconds", "error_code", "started_at", "updated_at", "ended_at",
                                     "step_done", "step_total", "percent"})
        self.assertEqual({cols[k] for k in ("step_done", "step_total", "percent")}, {"integer"})

    def test_numbers_kept_while_running_and_read_back_by_the_page(self):
        tok, pid, sha = self.go()
        rid = self.rep(tok, pid, sha, "planning", 2, 3, 45)
        self.assertEqual(self.row(rid), (2, 3, 45))
        run = self.page(pid)
        self.assertEqual((run["step_done"], run["step_total"], run["percent"]), (2, 3, 45))
        self.assertEqual(self.report(tok, pid, sha, "planning"), rid, "the 8-argument report (deployed node) is a heartbeat")
        self.assertEqual(self.row(rid), (2, 3, 45), "kept in the same state when none are given")
        self.assertEqual(self.rep(tok, pid, sha, "matching"), rid)
        self.assertEqual(self.row(rid), (None, None, None), "cleared on a new state")
        self.rep(tok, pid, sha, "matching", percent=60)
        self.assertEqual(self.row(rid), (None, None, 60), "one set: percent alone replaces all three")
        self.rep(tok, pid, sha, "building", 3, 4, 80)
        self.assertEqual(self.row(rid), (3, 4, 80))
        self.report(tok, pid, sha, "done", clips=4)
        self.assertEqual(self.row(rid), (None, None, None), "done clears them")
        run = self.page(pid)
        self.assertEqual((run["state"], run["step_done"], run["step_total"], run["percent"]), ("done", None, None, None))

    def test_failed_cancelled_and_stale_clear_them(self):
        tok, pid, sha = self.go()
        rid = self.rep(tok, pid, sha, "planning", 1, 2, 10)
        self.report(tok, pid, sha, "failed", error="crash")
        self.assertEqual(self.row(rid), (None, None, None))
        rid = self.rep(tok, pid, sha, "planning", 1, 2, 10)
        self.report(tok, pid, sha, "cancelled")
        self.assertEqual(self.row(rid), (None, None, None))
        rid = self.rep(tok, pid, sha, "planning", 1, 2, 10)
        self.d().execute("update public.compilation_runs set updated_at = now() - interval '3 hours' where id = %s", (rid,))
        run = self.page(pid)
        self.assertEqual((run["state"], run["error_code"], run["percent"]), ("failed", "stale", None), "the page's stale close clears them")
        rid = self.rep(tok, pid, sha, "planning", 1, 2, 10)
        self.d().execute("update public.compilation_runs set updated_at = now() - interval '3 hours' where id = %s", (rid,))
        rid2 = self.rep(tok, pid, sha, "planning", 0, 5, 0)
        self.assertNotEqual(rid2, rid)
        self.assertEqual(self.row(rid), (None, None, None), "the report's stale close clears them too")
        self.assertEqual(self.row(rid2), (0, 5, 0))

    def test_ranges_and_end_states_are_refused_in_words_and_change_nothing(self):
        tok, pid, sha = self.go()
        rid = self.rep(tok, pid, sha, "planning", 1, 3, 20)
        cases = [((None, None, 101), "The percent is a whole number from 0 to 100."), ((None, None, -1), "The percent is a whole number from 0 to 100."),
                 ((None, 1001, None), "The step total is a whole number from 0 to 1000."), ((None, -1, None), "The step total is a whole number from 0 to 1000."),
                 ((1, None, None), "The step done is a whole number from 0 to the step total, sent with it."),
                 ((4, 3, None), "The step done is a whole number from 0 to the step total, sent with it."),
                 ((-1, 3, None), "The step done is a whole number from 0 to the step total, sent with it.")]
        for (sd, st, pc), words in cases:
            self.assertEqual(self.refused(self.rep, tok, pid, sha, "planning", sd, st, pc, code="22023"), words, (sd, st, pc))
        for state, kw in (("done", {}), ("failed", {"error": "crash"}), ("cancelled", {})):
            self.assertEqual(self.refused(self.rep, tok, pid, sha, state, None, None, 100, code="22023", **kw), "Progress is only sent while a build is running.", state)
        self.assertEqual(self.row(rid), (1, 3, 20), "nothing changed")
        self.assertEqual(self.admin("select state from public.compilation_runs where id = %s", rid), "planning")
        self.assertEqual(self.rep(tok, pid, sha, "planning", 1000, 1000, 100), rid, "the top of each range")

    def test_the_table_refuses_numbers_on_an_ended_build_whoever_writes_it(self):
        tok, pid, sha = self.go()
        rid = self.rep(tok, pid, sha, "planning", 1, 3, 20)
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.d().execute("update public.compilation_runs set state = 'done' where id = %s", (rid,))

    def test_only_the_node_role_reaches_the_11_argument_report(self):
        for role in ("authenticated", "anon", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, 'public.node_compilation_report(text,uuid,text,text,int,int,numeric,text,int,int,int)', 'execute')", role), role)
        self.assertTrue(self.admin("select has_function_privilege('node_runner', 'public.node_compilation_report(text,uuid,text,text,int,int,numeric,text,int,int,int)', 'execute')"))
        self.assertTrue(self.admin("select has_function_privilege('node_runner', 'public.node_compilation_report(text,uuid,text,text,int,int,numeric,text)', 'execute')"))

    def test_steps_85_and_81_pass_after_and_the_undo_round_trips_exactly(self):
        self.assertEqual(self.step(STEP85)[0][1].split(":")[0], "PASS")
        self.assertEqual(self.step(STEP81)[0][1].split(":")[0], "PASS", "step 81 (this branch) still PASS after the progress change")
        defs = lambda: self.admin("select string_agg(p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)), ' | ' order by p.oid::regprocedure::text) "
                                  "from pg_proc p where p.proname in ('node_compilation_report', 'my_compilation_get')")
        after = defs()
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.step(STEP85)
        self.assertEqual(rows[0][1].split(":")[0], "STOP")
        self.assertFalse(any(ok for n, _, ok in rows if n != 1), "every row of 85 is false after the undo")
        self.assertEqual(self.step(STEP81)[0][1].split(":")[0], "PASS", "step 81 still PASS after the undo (000300 as applied)")
        self.assertEqual(self.admin("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs'"), 12)
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = 'node_compilation_report'"), 1)
        self.assertEqual(self.admin("select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'node_compilation_report'"), "plpgsql")
        tok, pid, sha = self.go()
        rid = self.report(tok, pid, sha, "planning")
        self.assertIsInstance(rid, int, "the 000300 report works after the undo")
        self.assertNotIn("step_done", self.page(pid))
        self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertEqual(defs(), after, "apply, undo, apply gives the same functions")
        self.assertEqual(self.step(STEP85)[0][1].split(":")[0], "PASS")

    def test_undo_restores_the_000300_text_exactly(self):
        # the database built by setUpModule from 000300 alone is the reference: the rollback's two functions are that file's text, copied
        rb = RB.read_text(encoding="utf-8")
        mig300 = (core.ROOT / "migrations" / "20261127000300_compilations_for_everyone.sql").read_text(encoding="utf-8")
        for start in ("function public.my_compilation_get(p_project uuid) returns jsonb", "function public.node_compilation_report(p_access_hash text, p_project uuid, p_request_sha256 text, p_state text,"):
            a = mig300[mig300.index("create " + start):]
            a = a[:a.index("end $$;") + 7]
            b = rb[rb.index("create or replace " + start):]
            b = b[:b.index("end $$;") + 7]
            self.assertEqual(b.replace("create or replace ", "create ", 1), a, start)


if __name__ == "__main__":
    unittest.main()
