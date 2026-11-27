"""MUST-FAIL CASES FOR THE COMPILATIONS SERVER CALLS (migrations/20261127000300_compilations_for_everyone.sql, NOT APPLIED). BUILDER 2026-11-27, order of 10:17.
Three rules for every new department call: (a) an account with the department switch OFF is refused, (b) another person's rows are never readable or writable,
(c) credits never go negative (compilations has no credits: nothing moves the ledger, and no balance is ever below zero).
These fill the gaps the main suite (test_compilations_for_everyone.py) leaves; its helpers are reused, its own tests are NOT re-run here.
Run from the repo root with TEMP/TMP on D:: D:/Ryagram-scratch/WEB/pgvenv2/Scripts/python -B -m unittest supabase/tests/test_compilations_must_fail_1127.py -v
"""
import json
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_compilations_for_everyone as comp  # noqa: E402  (a module, not a class: its tests are not collected here)
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, THIRD = comp.RYAN, comp.OTHER, comp.THIRD
REQ = comp.REQ
REQ3 = dict(REQ, phrase="third person words", folders=["Third folder"])
h = comp.h
setUpModule = comp.setUpModule
C = comp.Compilations


class CompilationsMustFail(unittest.TestCase):
    # the main suite's helpers, borrowed one by one (subclassing would re-run all its tests)
    setUp, tearDown, admin, d = C.setUp, C.tearDown, C.admin, C.d
    switch_on, runner, sign_in, project, put, report, refused, whoami = C.switch_on, C.runner, C.sign_in, C.project, C.put, C.report, C.refused, C.whoami

    def switch_off(self, who):
        self.d().execute("update public.account_settings set switches_on = array_remove(switches_on, 'compilations') where owner_id = %s", (who,))

    def make_tester(self, who):
        self.d().execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (who,))

    def release(self):
        self.d().execute("insert into public.app_releases (kind, file_name, size_bytes, sha256, object_key, active) values ('app', 'app-9.zip', 1000, %s, 'releases/app-9.zip', true)", ("a" * 64,))

    def download(self, who):
        return self.db.as_("service").one("select request_app_download(%s, 'app')", who)

    def get(self, pid, who=OTHER):
        return self.db.as_(who).one("select my_compilation_get(%s)", pid)

    # ------------------------------------------------------------------ (a) the switch off refuses every call
    def test_a_report_from_a_tester_computer_without_the_switch_is_refused(self):
        # a tester (local_compute) may sign in a computer without compilations; that computer must still be refused the compilation report
        self.make_tester(THIRD)
        tok = self.sign_in(THIRD)
        p3 = self.project(THIRD)
        sha = "b" * 64
        self.d().execute("insert into public.compilation_requests (project_id, owner_id, request, request_sha256) values (%s, %s, %s::jsonb, %s)", (p3, THIRD, json.dumps(REQ), sha))
        self.assertFalse(self.admin("select ryagram_private.compilations_on(%s)", THIRD), "a tester is not a compilations account")
        self.assertEqual(self.refused(self.report, tok, p3, sha, "planning", code="42501"), "Compilations are not open for this account yet.")
        self.assertEqual(self.admin("select count(*) from public.compilation_runs"), 0, "nothing written")

    def test_switching_off_after_signing_in_refuses_set_get_report_app_and_ai_answer(self):
        self.release()
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        rid = self.report(tok, pid, sha, "planning")
        self.assertEqual(self.download(OTHER)["file_name"], "app-9.zip")
        self.assertIs(self.whoami(OTHER)["desktop_app"], True)
        self.switch_off(OTHER)
        self.assertFalse(self.admin("select ryagram_private.compilations_on(%s)", OTHER))
        self.refused(self.put, pid, dict(REQ, phrase="after off"), code="42501")
        self.refused(self.get, pid, code="42501")
        self.refused(self.report, tok, pid, sha, "matching", matches=1, code="42501")
        self.refused(self.report, tok, pid, sha, "cancelled", code="42501")
        self.assertEqual(self.admin("select request_sha256 from public.compilation_requests where project_id = %s", pid), sha, "the request is unchanged")
        self.assertEqual(self.admin("select state || ':' || coalesce(matches::text, '-') from public.compilation_runs where id = %s", rid), "planning:-", "the run is unchanged")
        with self.assertRaises(psycopg.Error) as cm:
            self.download(OTHER)
        self.assertEqual(cm.exception.sqlstate, "PT403", "switched off: no desktop app")
        self.assertIs(self.whoami(OTHER)["desktop_app"], False, "switched off: the AI is told no app")
        self.refused(self.sign_in, OTHER, "PC2", code="42501")                    # switched off: no new computer

    def test_a_waiting_account_with_the_switch_is_refused_by_every_call(self):
        # the main suite checks compilations_on only; here the CALLS. No sqlstate pinned: the waiting gate or the switch may answer first, either refuses.
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        self.d().execute("insert into public.account_status (user_id, status, source) values (%s, 'waiting', 'signup') on conflict (user_id) do update set status = 'waiting'", (OTHER,))
        self.refused(self.put, pid, dict(REQ, phrase="while waiting"))
        self.refused(self.get, pid)
        self.refused(self.report, tok, pid, sha, "planning")
        self.assertEqual(self.admin("select request_sha256 from public.compilation_requests where project_id = %s", pid), sha)
        self.assertEqual(self.admin("select count(*) from public.compilation_runs"), 0)

    # ------------------------------------------------------------------ (b) another person's rows
    def test_another_persons_request_and_run_are_never_readable_or_writable(self):
        self.switch_on(OTHER); self.switch_on(THIRD)
        p3, tok3 = self.project(THIRD), self.sign_in(THIRD)
        s3 = self.put(p3, REQ3, THIRD)
        r3 = self.report(tok3, p3, s3, "planning", matches=4)
        mine, tok = self.project(), self.sign_in(OTHER)
        self.put(mine)
        # the site: read nothing, write nothing
        self.assertIsNone(self.get(p3), "THIRD's saved request and run read as nothing")
        self.refused(self.put, p3, dict(REQ, phrase="overwrite"), code="PT404")
        self.assertEqual(self.admin("select request_sha256 from public.compilation_requests where project_id = %s", p3), s3, "THIRD's request is unchanged")
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from public.compilation_requests where project_id = %s", p3), 0, "the table shows OTHER none of THIRD's rows")
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from public.compilation_runs where owner_id = %s", THIRD), 0)
        self.assertNotIn("third person words", json.dumps(self.get(mine)), "OTHER's own read carries nothing of THIRD's")
        # the computer: OTHER's token never lists, starts, moves or closes THIRD's
        got = self.runner().one("select node_compilation_requests(%s)", h(tok))
        self.assertEqual([r["project_id"] for r in got], [str(mine)], "OTHER's computer lists only OTHER's request")
        self.refused(self.report, tok, p3, s3, "planning", code="PT404")
        for late in ("matching", "building", "done", "cancelled"):
            with self.subTest(late=late):
                self.refused(self.report, tok, p3, s3, late, code="22023")
        self.refused(self.report, tok, p3, s3, "failed", error="crash", code="22023")
        self.assertEqual(self.admin("select state || ':' || matches || ':' || owner_id from public.compilation_runs where id = %s", r3), f"planning:4:{THIRD}", "THIRD's run is untouched")
        self.assertEqual(self.admin("select count(*) from public.compilation_runs where owner_id = %s", OTHER), 0, "and no run was made for OTHER on THIRD's project")
        # THIRD's busy build does not lock OTHER (the one-active rule is per account)
        self.assertTrue(self.report(tok, mine, self.admin("select request_sha256 from public.compilation_requests where project_id = %s", mine), "planning"))

    def test_another_persons_app_link_is_never_readable(self):
        self.release()
        self.switch_on(OTHER); self.switch_on(THIRD)
        self.download(OTHER)
        self.assertEqual(len(self.db.as_(OTHER).one("select my_app_downloads()")), 1)
        self.assertEqual(self.db.as_(THIRD).one("select my_app_downloads()"), [], "THIRD sees none of OTHER's download links")
        for who in (THIRD, "anon"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select request_app_download(%s, 'app')", OTHER)

    def test_a_person_cannot_ask_whether_someone_else_has_compilations(self):
        for who in (OTHER, "anon"):
            for sql in ("select ryagram_private.compilations_on(%s)", "select ryagram_private.compilation_request_problem(%s::jsonb)"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql, THIRD if "compilations_on" in sql else json.dumps(REQ))

    # ------------------------------------------------------------------ (c) credits never move and never go negative
    def balance(self, who):
        return self.admin("select coalesce(sum(amount), 0) from public.credit_ledger where owner_id = %s", who)

    def test_the_whole_flow_moves_no_credit_and_no_balance_goes_below_zero(self):
        credits.Ledger.grant(self, 5, OTHER)
        self.release()
        b_other, b_third, rows = self.balance(OTHER), self.balance(THIRD), self.admin("select count(*) from public.credit_ledger")
        self.assertEqual((b_other, b_third), (5, 0))
        self.refused(self.put, self.project(THIRD), REQ, THIRD, code="42501")   # a refused call moves nothing either
        self.switch_on(OTHER); self.switch_on(THIRD)
        for who, req in ((OTHER, REQ), (THIRD, REQ3)):                           # THIRD has 0 credits: everything still works, nothing is held
            pid, tok = self.project(who), self.sign_in(who)
            self.put(pid, req, who)
            self.put(pid, dict(req, note="again"), who)
            sha = self.admin("select request_sha256 from public.compilation_requests where project_id = %s", pid)
            for s in ("planning", "matching", "building", "done"):
                self.report(tok, pid, sha, s, matches=3)
            self.report(tok, pid, sha, "planning")
            self.report(tok, pid, sha, "failed", error="no_speech")
            self.get(pid, who)
            self.download(who)
            self.whoami(who)
        self.assertEqual((self.balance(OTHER), self.balance(THIRD)), (5, 0), "balances unchanged")
        self.assertEqual(self.admin("select count(*) from public.credit_ledger"), rows, "no ledger row written by any compilation call")
        self.assertEqual(self.admin("select count(*) from public.credit_balances where available < 0 or held <> 0"), 0, "nothing below zero, nothing held")
        for who in (OTHER, THIRD):
            self.assertEqual(self.db.as_(who).one("select coalesce(sum(held), 0) from public.credit_balances"), 0, who)


if __name__ == "__main__":
    unittest.main()
