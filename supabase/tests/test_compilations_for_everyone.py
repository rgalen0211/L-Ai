"""COMPILATIONS FOR EVERY USER, THE SERVER HALF (migrations/20261127000300_compilations_for_everyone.sql, NOT APPLIED) on a local Postgres with every migration and the 2B ledger. BUILDER 2026-11-27.
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -m unittest supabase/tests/test_compilations_for_everyone.py -v

What it proves, each with the opposite case beside it
  * THE SWITCH: off for everyone by default; on for an account named in the per-account switch list, or for everyone once the department is opened (live step 82a); never for a worker; every new call refuses in words when off
  * ANY ACCOUNT WITH THE SWITCH SIGNS IN ITS COMPUTER: device_decide refused a non-tester before and now lets a compilations account approve; an account with neither is still refused; a tester still can;
    such a computer claims no house job and no other person's job; a hand-changed device_decide is refused in words and nothing changes
  * THE SITE'S OWN WRITE: the person's own project only; the connector's schema; a file, a path or a link anywhere in it is refused; 32 KB; 60 saves an hour; the same row the connector writes and the app reads
  * WHAT THE PC REPORTS: only through the computer's token, only for the project's CURRENT request; planning -> matching -> building -> done in one row; one active build per account; 30 builds a day;
    a finished run cannot be reported first; the table holds no path, no transcript and no video column; the page reads only its own runs
  * CREDITS: none: the whole flow writes no credit ledger row
  * live step 81 says PASS after the migration and STOP before it; the rollback puts device_decide back to the live text
"""
import hashlib
import json
import re
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
THIRD = "55555555-5555-5555-5555-555555555555"
MIG = core.ROOT / "migrations" / "20261127000300_compilations_for_everyone.sql"
RB = core.ROOT / "rollbacks" / "20261127000300_compilations_for_everyone_rollback.sql"
STEP = core.ROOT / "live-steps" / "81_compilations_check.sql"
REQ = {"schema": "ryagram.compilation-request/0", "phrase": "great news", "search": "every", "mode": "phrase", "folders": ["Holiday 2025"], "note": "short ones first"}
setUpModule = credits.setUpModule


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


class Compilations(unittest.TestCase):
    tearDown = credits.Ledger.tearDown
    admin = credits.Ledger.admin

    def setUp(self):
        credits.Ledger.setUp(self)
        self.n = 0
        self.d().execute("insert into public.app_admins (user_id, note) values (%s, 'test')", (RYAN,))
        self.d().execute("insert into auth.users (id, email) values (%s, 'third@x')", (THIRD,))
        # compilations_on follows the top bar (departments_for), which shows departments to INVITED accounts only (CC1 09:35)
        self.d().execute("insert into public.connect_access (user_id, enabled) values (%s, true), (%s, true) on conflict do nothing", (OTHER, THIRD))

    def d(self):
        return self.db.as_(None).c

    def ledger_rows(self):
        return self.admin("select count(*) from public.credit_ledger")

    def switch_on(self, who):
        self.d().execute("insert into public.account_settings (owner_id, switches_on) values (%s, '{compilations}') "
                         "on conflict (owner_id) do update set switches_on = array_append(public.account_settings.switches_on, 'compilations')", (who,))

    def runner(self):
        self.db.c.execute("reset role")
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role node_runner")
        return self.db

    def sign_in(self, who, name="PC"):
        self.n += 1
        code, user_code, token = f"dev{self.n}-{uuid.uuid4().hex}", "ABCD-EF" + "23456789"[self.n % 8] + "H", f"tok{self.n}-{uuid.uuid4().hex}"
        self.runner().one("select node_device_begin(%s, %s, %s)", h(code), user_code, name)
        self.db.as_(who).one("select device_decide(%s, true)", user_code)
        self.runner().one("select node_device_exchange(%s, %s)", h(code), h(token))
        return token

    def project(self, who=OTHER, title="p"):
        return self.db.as_(who).one("insert into projects (title) values (%s) returning id", title)

    def put(self, pid, req=REQ, who=OTHER):
        return self.db.as_(who).one("select my_compilation_set(%s, %s::jsonb)", pid, json.dumps(req))

    def report(self, token, pid, sha, state, **kw):
        return self.runner().one("select node_compilation_report(%s::text, %s::uuid, %s::text, %s::text, %s::int, %s::int, %s::numeric, %s::text)", h(token), pid, sha, state,
                                 kw.get("matches"), kw.get("clips"), kw.get("film_seconds"), kw.get("error"))

    def refused(self, call, *args, code=None, **kw):
        with self.assertRaises(psycopg.Error) as cm:
            call(*args, **kw)
        if code:
            self.assertEqual(cm.exception.sqlstate, code, cm.exception.diag.message_primary)
        return cm.exception.diag.message_primary

    # ------------------------------------------------------------------ the switch
    def test_the_switch_is_off_by_default_on_per_account_or_for_everyone_and_never_for_a_worker(self):
        pid = self.project()
        w = self.refused(self.put, pid, code="42501")
        self.assertEqual(w, "Compilations are not open for this account yet.")
        self.switch_on(OTHER)
        self.assertRegex(self.put(pid), r"^[0-9a-f]{64}$")
        p3 = self.project(THIRD)
        self.refused(self.put, p3, REQ, THIRD, code="42501")
        self.d().execute((core.ROOT / "live-steps" / "82a_open_compilations_for_everyone.sql").read_text(encoding="utf-8"))
        self.assertRegex(self.put(p3, REQ, THIRD), r"^[0-9a-f]{64}$", "step 82a opens it for everyone")
        self.assertFalse(self.admin("select ryagram_private.compilations_on(%s)", WORKER), "never a worker")
        self.d().execute((core.ROOT / "live-steps" / "82d_close_compilations_for_everyone.sql").read_text(encoding="utf-8"))
        self.refused(self.db.as_(THIRD).one, "select my_compilation_get(%s)", p3, code="42501")

    # ------------------------------------------------------------------ signing in a computer
    def test_a_compilations_account_signs_in_its_computer_and_a_plain_account_still_cannot(self):
        self.refused(self.sign_in, OTHER, code="42501")
        self.switch_on(OTHER)
        tok = self.sign_in(OTHER)
        self.assertTrue(tok)
        self.refused(self.sign_in, THIRD, code="42501")
        self.d().execute("select admin_set_local_compute_by_email('third@x', true, 'tester') where false")   # (the tester path is r9's own test; here: unchanged text)
        self.assertIn("coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) or ryagram_private.compilations_on(me)",
                      self.admin("select prosrc from pg_proc where oid = 'public.device_decide(text, boolean)'::regprocedure"))

    def test_that_computer_claims_no_house_job_and_nobody_elses(self):
        self.switch_on(OTHER)
        tok = self.sign_in(OTHER)
        self.d().execute("update public.ops_settings set auto_render = true")
        credits.Ledger.grant(self, 50, RYAN)
        vid = credits.Ledger.version(self, "map", who=RYAN)
        credits.Ledger.submit(self, vid, "contact_sheet", who=RYAN)
        with self.assertRaises(psycopg.Error) as cm:
            self.runner().one("select id from node_claim(%s)", h(tok))
        self.assertEqual(cm.exception.sqlstate, "42501", "a computer signed in for compilations only cannot claim ANY job, house or its own")
        self.assertEqual(self.admin("select state::text from jobs where owner_id = %s", RYAN), "queued", "Ryan's sheet stays for the house worker")

    def test_a_hand_changed_device_decide_is_refused_and_nothing_changes(self):
        self.d().execute(RB.read_text(encoding="utf-8"))
        d0 = self.admin("select pg_get_functiondef('public.device_decide(text, boolean)'::regprocedure)")
        self.d().execute(d0.replace("then 'approved' else 'denied' end", "then 'approved' else 'denied' end ").replace(
            "s.owner_id = me), false) then", "s.owner_id = me), false) and true then"))
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertIn("device_decide is not the one this change expects", str(cm.exception))
        self.db.c.execute("rollback")
        self.assertIsNone(self.admin("select to_regclass('public.compilation_runs')"), "one transaction: nothing was applied")

    # ------------------------------------------------------------------ the site's own write
    def test_the_site_writes_the_same_row_the_connector_writes_and_the_app_reads(self):
        self.switch_on(OTHER)
        pid = self.project()
        sha = self.put(pid)
        self.assertEqual(self.admin("select request_sha256 from compilation_requests where project_id = %s", pid), sha)
        tok = self.sign_in(OTHER)
        got = self.runner().one("select node_compilation_requests(%s)", h(tok))
        self.assertEqual([(r["project_id"], r["sha256"]) for r in got], [(str(pid), sha)])
        g = self.db.as_(OTHER).one("select my_compilation_get(%s)", pid)
        self.assertEqual((g["sha256"], g["request"]["phrase"], g["run"]), (sha, "great news", None))
        self.assertEqual(self.put(pid, dict(REQ, phrase="other words")), self.admin("select request_sha256 from compilation_requests where project_id = %s", pid), "a save replaces")

    def test_only_the_persons_own_project_and_only_data(self):
        self.switch_on(OTHER); self.switch_on(THIRD)
        mine, theirs = self.project(), self.project(THIRD)
        self.refused(self.put, theirs, code="PT404")
        self.assertIsNone(self.db.as_(OTHER).one("select my_compilation_get(%s)", theirs), "someone else's project reads as nothing")
        bad = [{"phrase": "x"}, dict(REQ, schema="other/1"), dict(REQ, path="C:/x"), dict(REQ, folders=[{"name": "a", "url": "x"}]),
               dict(REQ, folders=["C:\\Users\\sam\\Videos"]), dict(REQ, note="see /Users/sam/clips"), dict(REQ, note="http://example.com/a.mp4"),
               dict(REQ, video="x"), dict(REQ, note="y" * 40000), dict(REQ, folders=["D:/Clips"]), dict(REQ, note="from \\\\nas\\clips")]
        for b in bad:
            with self.subTest(b=str(b)[:60]):
                self.refused(self.put, mine, b, code="22023")
        self.assertIsNone(self.admin("select request from compilation_requests where project_id = %s", mine), "nothing written")
        self.assertRegex(self.put(mine, dict(REQ, folders=["Holiday 2025", "Sam's videos"])), r"^[0-9a-f]{64}$", "plain folder names are fine")

    def test_sixty_saves_an_hour(self):
        self.switch_on(OTHER)
        pid = self.project()
        for i in range(60):
            self.put(pid, dict(REQ, note=f"n{i}"))
        self.assertIn("Too many tries", self.refused(self.put, pid, dict(REQ, note="n61"), code="PT429"))

    def test_only_signed_in_people_in_the_app(self):
        self.switch_on(OTHER)
        pid = self.project()
        for who in ("anon", "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select my_compilation_set(%s, %s::jsonb)", pid, json.dumps(REQ))
        d = self.db.as_(OTHER)
        d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % OTHER,))
        with self.assertRaises(psycopg.Error) as cm:
            d.c.execute("select my_compilation_set(%s, %s::jsonb)", (pid, json.dumps(REQ)))
        self.assertIn("connected AI", cm.exception.diag.message_primary, "an AI uses its own connector tool, not this")

    # ------------------------------------------------------------------ the PC's report
    def test_the_pc_reports_one_build_through_its_states(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        rid = self.report(tok, pid, sha, "planning")
        self.assertEqual(self.report(tok, pid, sha, "matching", matches=12, clips=40), rid)
        self.assertEqual(self.report(tok, pid, sha, "building"), rid)
        self.assertEqual(self.report(tok, pid, sha, "done", film_seconds=95.5), rid)
        run = self.db.as_(OTHER).one("select my_compilation_get(%s)", pid)["run"]
        self.assertEqual((run["id"], run["state"], run["matches"], run["clips"], float(run["film_seconds"]), run["current"]), (rid, "done", 12, 40, 95.5, True))
        self.assertIsNotNone(run["ended_at"])
        self.assertEqual(self.admin("select count(*) from compilation_runs"), 1)
        rid2 = self.report(tok, pid, sha, "planning")
        self.assertNotEqual(rid2, rid, "a new build after one ended is a new row")

    def test_the_report_is_refused_for_a_wrong_token_an_old_request_or_a_finish_first(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        self.refused(self.report, "junk", pid, sha, "planning")
        self.refused(self.report, tok, pid, "0" * 64, "planning", code="PT404")
        self.refused(self.report, tok, pid, sha, "done", code="22023")
        self.refused(self.report, tok, pid, sha, "nonsense", code="22023")
        self.put(pid, dict(REQ, phrase="changed"))
        self.refused(self.report, tok, pid, sha, "planning", code="PT404")
        self.assertEqual(self.admin("select count(*) from compilation_runs"), 0)
        for who in ("anon", OTHER, "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("select node_compilation_report(%s, %s, %s, 'planning')", h(tok), pid, sha)

    def test_one_active_build_per_account_and_thirty_a_day(self):
        self.switch_on(OTHER)
        a, b, tok = self.project(), self.project(), self.sign_in(OTHER)
        sa, sb = self.put(a), self.put(b, dict(REQ, phrase="b"))
        self.report(tok, a, sa, "planning")
        self.assertIn("Another compilation is still being made", self.refused(self.report, tok, b, sb, "planning", code="55000"))
        self.report(tok, a, sa, "cancelled")
        self.report(tok, b, sb, "planning")
        self.report(tok, b, sb, "failed", error="no_speech")
        self.assertEqual(self.admin("select error_code from compilation_runs where project_id = %s", b), "no_speech")
        self.d().execute("insert into compilation_runs (owner_id, project_id, request_sha256, state, ended_at) select %s, %s, %s, 'done', now() from generate_series(1, 28)", (OTHER, a, sa))
        self.assertIn("30 compilations", self.refused(self.report, tok, a, sa, "planning", code="PT429"))
        self.d().execute("update compilation_runs set started_at = now() - interval '25 hours'")
        self.assertTrue(self.report(tok, a, sa, "planning"), "a day later it is open again")

    def test_the_runs_hold_no_path_no_transcript_no_video_and_a_person_reads_only_their_own(self):
        cols = {r[0] for r in self.db.as_(None).all("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'compilation_runs'")}
        self.assertEqual(cols, {"id", "owner_id", "project_id", "request_sha256", "state", "matches", "clips", "film_seconds", "error_code", "started_at", "updated_at", "ended_at"})
        self.switch_on(OTHER); self.switch_on(THIRD)
        pid, tok = self.project(), self.sign_in(OTHER)
        self.report(tok, pid, self.put(pid), "planning")
        self.assertEqual(self.db.as_(THIRD).one("select count(*) from compilation_runs"), 0)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from compilation_runs"), 1)
        for who in (OTHER, "anon"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).one("insert into compilation_runs (owner_id, project_id, request_sha256, state) values (%s, %s, %s, 'done') returning 1", OTHER, pid, "a" * 64)

    def test_no_credits_anywhere(self):
        before = self.ledger_rows()
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        for s in ("planning", "matching", "building", "done"):
            self.report(tok, pid, sha, s, matches=3)
        self.assertEqual(self.ledger_rows(), before, "a compilation on the person's own PC touches no credit")
        src = MIG.read_text(encoding="utf-8")
        self.assertNotRegex("\n".join(l for l in src.splitlines() if not l.lstrip().startswith("--")), r"credit_ledger|grant_credits|adjust_credits|hold_id")

    # ------------------------------------------------------------------ the self-review's cases (BUILDER 11-27)
    def test_editing_the_request_mid_build_never_locks_the_account(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        s1 = self.put(pid)
        rid = self.report(tok, pid, s1, "planning")
        s2 = self.put(pid, dict(REQ, phrase="changed"))
        self.assertEqual(self.report(tok, pid, s1, "matching", matches=2), rid, "the running build keeps its own request")
        self.assertEqual(self.report(tok, pid, s1, "cancelled"), rid, "and can always be closed")
        self.assertNotEqual(self.report(tok, pid, s2, "planning"), rid)
        self.refused(self.report, tok, pid, s1, "planning", code="55000")          # the new build is running: an old request is refused first as 'another is running'
        self.report(tok, pid, s2, "cancelled")
        self.refused(self.report, tok, pid, s1, "planning", code="PT404")          # and with nothing running, as 'not the current request'

    def test_a_run_silent_for_two_hours_does_not_block_the_next(self):
        self.switch_on(OTHER)
        a, b, tok = self.project(), self.project(), self.sign_in(OTHER)
        sa, sb = self.put(a), self.put(b, dict(REQ, phrase="b"))
        old = self.report(tok, a, sa, "planning")
        self.d().execute("update compilation_runs set updated_at = now() - interval '3 hours' where id = %s", (old,))
        self.assertTrue(self.report(tok, b, sb, "planning"))
        self.assertEqual(self.admin("select state || ':' || error_code from compilation_runs where id = %s", old), "failed:stale")

    def test_a_run_silent_for_two_hours_reads_as_stale_with_the_computer_off_and_the_next_report_starts_a_new_build(self):
        # WORKER 11-27 MEDIUM 3: the computer is off, so no report ever comes to close it: the READ closes it, in its own transaction
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        old = self.report(tok, pid, sha, "planning")
        self.assertEqual(self.db.as_(OTHER).one("select my_compilation_get(%s)", pid)["run"]["state"], "planning", "control: a fresh build reads as running")
        self.d().execute("update compilation_runs set updated_at = now() - interval '3 hours' where id = %s", (old,))
        run = self.db.as_(OTHER).one("select my_compilation_get(%s)", pid)["run"]
        self.assertEqual((run["id"], run["state"], run["error_code"]), (old, "failed", "stale"))
        self.assertIsNotNone(run["ended_at"])
        self.assertEqual(self.admin("select state || ':' || error_code from compilation_runs where id = %s", old), "failed:stale", "closed in the table, not only in the answer")
        new = self.report(tok, pid, sha, "planning")
        self.assertNotEqual(new, old)
        self.assertEqual(self.admin("select state from compilation_runs where id = %s", new), "planning", "a later report starts a new build at planning")

    def test_the_same_state_again_is_a_heartbeat_and_a_step_back_is_refused(self):
        # FACES 11-27: the app repeats the state during a long phase (and retries a report it is not sure arrived): same run, updated_at refreshed, newer counts taken
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        rid = self.report(tok, pid, sha, "planning")
        self.assertEqual(self.report(tok, pid, sha, "planning"), rid, "planning again: the same run")
        self.assertEqual(self.report(tok, pid, sha, "matching", matches=5), rid)
        self.assertEqual(self.report(tok, pid, sha, "matching"), rid)
        self.assertEqual(self.admin("select matches from compilation_runs where id = %s", rid), 5, "a heartbeat without counts keeps them")
        self.assertEqual(self.report(tok, pid, sha, "matching", matches=9), rid)
        self.assertEqual(self.admin("select matches from compilation_runs where id = %s", rid), 9, "and takes newer ones")
        self.assertIn("already moved past", self.refused(self.report, tok, pid, sha, "planning", code="22023"))
        self.report(tok, pid, sha, "building")
        self.d().execute("update compilation_runs set updated_at = now() - interval '110 minutes' where id = %s", (rid,))
        self.assertEqual(self.report(tok, pid, sha, "building", clips=4), rid, "a building heartbeat")
        self.d().execute("update compilation_runs set updated_at = updated_at - interval '15 minutes' where id = %s", (rid,))   # 15 minutes later
        run = self.db.as_(OTHER).one("select my_compilation_get(%s)", pid)["run"]
        self.assertEqual((run["id"], run["state"], run["error_code"], run["clips"]), (rid, "building", None, 4), "the heartbeat kept a build of over 2 hours alive")
        self.assertEqual(self.admin("select count(*) from compilation_runs"), 1)
        self.assertEqual(self.report(tok, pid, sha, "done", film_seconds=60), rid, "and its final report is accepted")

    def test_a_build_that_found_matches_and_then_reports_a_folder_failure_still_counts_toward_the_thirty(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        self.d().execute("insert into compilation_runs (owner_id, project_id, request_sha256, state, error_code, matches, clips, ended_at) "
                         "select %s, %s, %s, 'failed', 'folder_empty', 12, 3, now() from generate_series(1, 30)", (OTHER, pid, sha))
        self.assertIn("30 compilations", self.refused(self.report, tok, pid, sha, "planning", code="PT429"),
                      "a modified app cannot hide finished work as a folder problem")

    def test_plans_stopped_by_a_folder_problem_do_not_use_up_the_thirty_and_two_hundred_runs_a_day_is_the_outer_cap(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        for i in range(31):                    # the person keeps fixing a folder and trying again, through the real report
            self.report(tok, pid, sha, "planning")
            self.report(tok, pid, sha, "failed", error="folder_missing")
        rid = self.report(tok, pid, sha, "planning")
        self.assertTrue(rid, "31 plans stopped by a folder problem do not block a real build")
        self.report(tok, pid, sha, "cancelled")
        self.d().execute("insert into compilation_runs (owner_id, project_id, request_sha256, state, ended_at) select %s, %s, %s, 'done', now() from generate_series(1, 29)", (OTHER, pid, sha))
        self.assertIn("30 compilations", self.refused(self.report, tok, pid, sha, "planning", code="PT429"), "30 real builds (a cancelled one counts) block the 31st")
        self.d().execute("delete from compilation_runs where state <> 'failed'")
        self.d().execute("insert into compilation_runs (owner_id, project_id, request_sha256, state, error_code, ended_at) select %s, %s, %s, 'failed', 'folder_empty', now() from generate_series(1, 168)", (OTHER, pid, sha))
        self.assertEqual(self.admin("select count(*) from compilation_runs where owner_id = %s", OTHER), 199)
        self.report(tok, pid, sha, "planning")   # the 200th run of any kind
        self.report(tok, pid, sha, "failed", error="folders_overlap")
        self.assertIn("200 builds", self.refused(self.report, tok, pid, sha, "planning", code="PT429"), "the 201st run of any kind is refused")
        self.d().execute("update compilation_runs set started_at = now() - interval '25 hours'")
        self.assertTrue(self.report(tok, pid, sha, "planning"), "a day later it is open again")

    def test_a_run_only_moves_forward(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        self.report(tok, pid, sha, "planning")
        self.report(tok, pid, sha, "building")
        self.assertIn("already moved past", self.refused(self.report, tok, pid, sha, "planning", code="22023"))
        self.report(tok, pid, sha, "done")

    def test_a_path_on_its_own_line_and_look_alike_or_encoded_paths_are_refused(self):
        self.switch_on(OTHER)
        pid = self.project()
        for note in ("my folders:\n/Users/sam/clips", "list:\t/home/sam/x", "a\nC:\\Users\\sam"):
            with self.subTest(note=note):
                self.refused(self.put, pid, dict(REQ, note=note), code="22023")
        for v in ("~/Videos", "%USERPROFILE%\\Videos", "C%3A%5CUsers", "smb://nas/clips", "C:\u200b\\Users\\sam", "C\uff1a\uff3cUsers", "x\u2215etc", "$HOME/clips", "/etc/passwd"):
            with self.subTest(v=v):
                self.refused(self.put, pid, dict(REQ, folders=[v]), code="22023")
        for k in ("filePath", "folder_path", "uri", "href", "src", "dir", "location"):
            with self.subTest(k=k):
                self.refused(self.put, pid, dict(REQ, **{k: "x"}), code="22023")
        for ok in (["Rock & Roll"], ["Sam's videos", "Holiday 2025"]):
            with self.subTest(ok=ok):
                self.assertRegex(self.put(pid, dict(REQ, folders=ok, note="a phrase about http and files, Q3/Q4 talks, an A:B ratio")), r"^[0-9a-f]{64}$")

    def test_a_compilations_only_computer_reaches_only_its_own_rows(self):
        self.switch_on(OTHER); self.switch_on(THIRD)
        tok = self.sign_in(OTHER)
        self.assertEqual(self.runner().one("select node_download_plans(%s)", h(tok)), [])
        self.assertEqual(self.runner().one("select node_footage_plans(%s)", h(tok)), [])
        self.assertIn("redeploy the node function", STEP.read_text(encoding="utf-8"))

    # ------------------------------------------------------------------ the reviews' rules (CC1 09:10, RENDERER 09:13, FACES 09:18)
    def test_a_request_keeps_the_connectors_own_rules(self):
        self.switch_on(OTHER)
        pid = self.project()
        bad = {
            "a part Ryagram does not know": dict(REQ, colour="red"),
            "That compilation request is not valid. ": dict(REQ, mode="karaoke"),
            "Songs are not open ": dict(REQ, mode="song"),
            "Give the words to look for": dict(REQ, phrase=""),
            "Give the words to look for ": dict(REQ, phrase="x" * 201),
            "How to look": dict(REQ, search="sometimes"),
            "Name 1 to 8 folders.": dict(REQ, folders=[]),
            "Name 1 to 8 folders. ": dict(REQ, folders=[f"f{i}" for i in range(9)]),        # 8 is the engine's own limit (FACES 11-27); 8 is accepted below
            "A folder is a NAME": dict(REQ, folders=["."]),
            "A folder is a NAME ": dict(REQ, folders=["Q3/Q4 talks"]),
            "A folder is a NAME  ": dict(REQ, folders=["A:B"]),
            "A folder is a NAME   ": dict(REQ, folders=["x" * 81]),
            "A folder is a NAME    ": dict(REQ, folders=[7]),
            "Songs are not open": dict(REQ, song=True),
            "That compilation request is not valid.": dict(REQ, clean_cuts="yes"),
            "The note can be at most 500": dict(REQ, note="n" * 501),
            "Clip labels": dict(REQ, clip_labels="everything"),
            "Each picture rule": dict(REQ, rules=[{"phrase": "a", "picture": "p.gif", "seconds": 2, "mode": "full"}]),
            "Each picture rule ": dict(REQ, rules=[{"phrase": "a", "picture": "p.png", "seconds": 11, "mode": "full"}]),
            "Each picture rule  ": dict(REQ, rules=[{"phrase": "a", "picture": "p.png", "seconds": "2", "mode": "full"}]),
            "At most 20 picture rules.": dict(REQ, rules=[{"phrase": "a", "picture": "p.png", "seconds": 2, "mode": "full"}] * 21),
            "Each text": dict(REQ, texts=[{"text": "t", "start_s": 0, "length_s": 31, "position": "top"}]),
            "At most 4 cards.": dict(REQ, cards=[{"text": "c", "where": "start", "seconds": 2}] * 5),
            "Each card": dict(REQ, cards=[{"text": "c", "where": "middle", "seconds": 2}]),
            "At most 12 checklist items.": dict(REQ, checklist=[{"what": "w", "folder": "Holiday 2025"}] * 13),
            "Each checklist item": dict(REQ, checklist=[{"what": "w", "folder": "Holiday 2025", "count": 21}]),
            "A checklist item names a folder that is not": dict(REQ, checklist=[{"what": "w", "folder": "Elsewhere"}]),
            "names a site in words": dict(REQ, checklist=[{"what": "the launch", "from": "www.archives.gov", "folder": "Holiday 2025"}]),
        }
        for words, req in bad.items():
            with self.subTest(words=words.strip()):
                self.assertIn(words.strip(), self.refused(self.put, pid, req, code="22023"))
        self.assertIsNone(self.admin("select request from compilation_requests where project_id = %s", pid), "nothing was written")
        good = dict(REQ, song=False, clean_cuts=True, clip_labels="file_and_time", search="words",
                    rules=[{"phrase": "a", "picture": "logo.PNG", "seconds": 0.5, "mode": "lower_third"}],
                    texts=[{"text": "Hello", "start_s": 0, "length_s": 3, "position": "bottom", "size": "large"}],
                    cards=[{"text": "The end", "where": "end", "seconds": 2}],
                    checklist=[{"what": "the 1969 launch, wide", "from": "the National Archives", "must_contain": "the rocket", "folder": "Holiday 2025", "count": 2}])
        self.assertRegex(self.put(pid, good), r"^[0-9a-f]{64}$", "the connector's full request, every part within its limits, is saved")
        page = {"schema": "ryagram.compilation-request/0", "phrase": "great news", "search": "every", "folders": ["Holiday 2025", "Interviews"],
                "song": False, "clean_cuts": False, "rules": [], "texts": [], "note": ""}   # exactly what WEB's buildRequest sends (app-compilations.js)
        self.assertRegex(self.put(pid, page), r"^[0-9a-f]{64}$", "the page's own request is saved")
        self.assertRegex(self.put(pid, dict(page, search="words", note="short ones first")), r"^[0-9a-f]{64}$")
        self.assertRegex(self.put(pid, dict(REQ, folders=[f"f{i}" for i in range(8)])), r"^[0-9a-f]{64}$", "8 folders, the engine's limit, are fine")

    # ------------------------------------------------------------------ RENDERER 10:33: hidden characters
    def test_hidden_characters_in_a_path_or_a_folder_name_are_refused_and_a_folder_name_with_an_emoji_variation_selector_is_refused_too(self):
        self.switch_on(OTHER)
        pid = self.project()
        hidden = {"tag": "\U000e0041", "variation selector": "\ufe0f", "line separator": "\u2028", "interlinear": "\ufff9"}
        for name, ch in hidden.items():
            with self.subTest(phrase=name):     # removed before the path check, so the path behind it is seen: refused
                self.refused(self.put, pid, dict(REQ, phrase="C:" + ch + "\\Users\\x"), code="22023")
                self.refused(self.put, pid, dict(REQ, phrase="C:" + ch + "/Users/x"), code="22023")
            with self.subTest(folder=name):     # a folder NAME holding a hidden character is refused outright
                self.assertIn("A folder is a NAME", self.refused(self.put, pid, dict(REQ, folders=["Clips" + ch]), code="22023"))
                self.refused(self.put, pid, dict(REQ, folders=["C:" + ch + "/Users/x"]), code="22023")
        # DECIDED (BUILDER 11-27): a folder name is matched to a real folder on the person's PC, so it carries no invisible characters at all, an emoji's
        # variation selector (U+FE0F) included: refused, in words. An emoji WITHOUT one is a plain name, and a phrase may hold either.
        self.assertIn("A folder is a NAME", self.refused(self.put, pid, dict(REQ, folders=["Holiday \u2764\ufe0f"]), code="22023"))
        self.assertIsNone(self.admin("select request from compilation_requests where project_id = %s", pid), "nothing was written")
        self.assertRegex(self.put(pid, dict(REQ, folders=["Party \U0001f389"])), r"^[0-9a-f]{64}$", "an emoji with no selector is a plain folder name")
        self.assertRegex(self.put(pid, dict(REQ, phrase="I \u2764\ufe0f it")), r"^[0-9a-f]{64}$", "a phrase may hold an emoji with its selector")

    def test_a_waiting_account_is_off(self):
        self.switch_on(OTHER)
        pid = self.project()
        self.assertRegex(self.put(pid), r"^[0-9a-f]{64}$")
        self.d().execute("insert into public.account_status (user_id, status, source) values (%s, 'waiting', 'signup') on conflict (user_id) do update set status = 'waiting'", (OTHER,))
        self.assertFalse(self.admin("select ryagram_private.compilations_on(%s)", OTHER), "a waiting account is never on")
        self.d().execute("update public.account_status set status = 'active' where user_id = %s", (OTHER,))
        self.assertTrue(self.admin("select ryagram_private.compilations_on(%s)", OTHER), "and on again once it is active")

    def test_the_report_gives_a_reason_only_for_a_failed_build_and_only_from_the_closed_list(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        self.report(tok, pid, sha, "planning")
        self.assertIn("Only a failed build has a reason", self.refused(self.report, tok, pid, sha, "matching", error="crash", code="22023"))
        self.assertIn("A failed build needs its reason", self.refused(self.report, tok, pid, sha, "failed", code="22023"))
        self.assertIn("not a reason Ryagram knows", self.refused(self.report, tok, pid, sha, "failed", error="no_speech_model", code="22023"))
        self.assertIn("set by Ryagram itself", self.refused(self.report, tok, pid, sha, "failed", error="stale", code="22023"))
        self.assertIn("matches and clips are whole numbers", self.refused(self.report, tok, pid, sha, "matching", matches=100001, code="22023"))
        self.assertIn("film length is 0 to 86400", self.refused(self.report, tok, pid, sha, "done", film_seconds=-1, code="22023"))
        for c in ("request_invalid", "song_request", "folder_not_chosen", "folder_missing", "folder_empty", "folders_overlap", "no_speech", "not_said", "edit_failed", "build_failed", "crash"):
            with self.subTest(code=c):
                self.report(tok, pid, sha, "planning")
                self.report(tok, pid, sha, "failed", error=c)
                self.assertEqual(self.admin("select error_code from compilation_runs where owner_id = %s order by id desc limit 1", OTHER), c)

    def test_a_new_build_starts_at_planning(self):
        self.switch_on(OTHER)
        pid, tok = self.project(), self.sign_in(OTHER)
        sha = self.put(pid)
        self.report(tok, pid, sha, "planning")
        self.report(tok, pid, sha, "done")
        for late in ("matching", "building"):
            with self.subTest(late=late):
                self.assertIn("There is no build running for this request: a new build starts with planning, even after one ended.", self.refused(self.report, tok, pid, sha, late, code="22023"))
        self.assertEqual(self.admin("select count(*) from compilation_runs where owner_id = %s", OTHER), 1, "a late report never starts a second run")

    # ------------------------------------------------------------------ the top bar
    def test_the_top_bar_shows_a_department_working_only_to_an_account_with_its_switch(self):
        bar = lambda who: {d["id"]: d["status"] for d in self.db.as_(who).one("select my_departments()")}
        self.assertEqual(bar(OTHER)["compilations"], "soon")
        self.assertEqual(bar(OTHER)["data_films"], "working")
        self.switch_on(OTHER)
        self.assertEqual(bar(OTHER)["compilations"], "working", "the switch makes it working for this account")
        self.assertEqual(bar(THIRD)["compilations"], "soon", "and only for this account")
        self.assertEqual((bar(OTHER)["games"], bar(OTHER)["geo_intelligence"]), ("soon", "soon"))
        self.d().execute("update public.account_settings set switches_on = '{compilations,games,perfectCity}' where owner_id = %s", (OTHER,))
        self.assertEqual((bar(OTHER)["games"], bar(OTHER)["geo_intelligence"]), ("working", "working"), "the same hook for GAMES and GEO")
        self.d().execute((core.ROOT / "live-steps" / "82a_open_compilations_for_everyone.sql").read_text(encoding="utf-8"))
        self.assertEqual(bar(THIRD)["compilations"], "working", "step 82a opens the department, and the calls, for everyone")
        self.assertRegex(self.put(self.project(THIRD), REQ, THIRD), r"^[0-9a-f]{64}$", "the bar and the calls agree")
        self.assertEqual(self.db.as_(RYAN).one("select my_departments()"), [], "an administrator account sees no departments at all (as before): walk them on a test account")

    # ------------------------------------------------------------------ CC1 09:35: the calls follow the top bar exactly
    def bar_and_call(self, who):
        bar = {d["id"]: d["status"] for d in self.db.as_(who).one("select my_departments()")}.get("compilations")
        try:
            self.db.as_(who).one("select my_compilation_get(%s)", self.project(who))
            call = "on"
        except psycopg.Error as e:
            self.db.c.execute("rollback") if self.db.c.info.transaction_status else None
            call = "refused " + e.sqlstate
        return bar, call

    def test_an_administrator_with_the_switch_is_off_and_sees_no_bar(self):
        self.switch_on(RYAN)
        self.assertEqual(self.db.as_(RYAN).one("select my_departments()"), [])
        self.assertFalse(self.admin("select ryagram_private.compilations_on(%s)", RYAN))
        self.refused(self.put, self.project(RYAN), REQ, RYAN, code="42501")

    def test_an_uninvited_account_with_the_switch_is_off(self):
        self.d().execute("delete from public.connect_access where user_id = %s", (THIRD,))
        self.switch_on(THIRD)
        self.assertFalse(self.admin("select ryagram_private.compilations_on(%s)", THIRD))
        self.refused(self.put, self.project(THIRD), REQ, THIRD, code="42501")

    def test_the_bar_and_the_calls_agree_for_an_invited_account_in_every_case(self):
        self.assertEqual(self.bar_and_call(OTHER), ("soon", "refused 42501"), "switch off")
        self.switch_on(OTHER)
        self.assertEqual(self.bar_and_call(OTHER), ("working", "on"), "switch on")
        self.assertEqual(self.bar_and_call(THIRD), ("soon", "refused 42501"), "another invited account without the switch")
        self.d().execute((core.ROOT / "live-steps" / "82a_open_compilations_for_everyone.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.bar_and_call(THIRD), ("working", "on"), "82a: opened for everyone")
        self.d().execute((core.ROOT / "live-steps" / "82d_close_compilations_for_everyone.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.bar_and_call(THIRD), ("soon", "refused 42501"), "82d: closed again")

    def test_padding_nested_keys_and_a_huge_count_are_refused(self):
        self.switch_on(OTHER)
        pid = self.project()
        cases = [dict(REQ, phrase=" " * 10 + "x" * 195), dict(REQ, folders=["a" + " " * 85]),
                 dict(REQ, rules=[{"phrase": "hi", "picture": "a.png", "seconds": 2, "mode": "full", "url": "x"}]),
                 dict(REQ, texts=[{"text": "hi", "start_s": 0, "length_s": 2, "position": "top", "colour": "red"}]),
                 dict(REQ, cards=[{"text": "hi", "where": "start", "seconds": 2, "extra": 1}]),
                 dict(REQ, folders=["Holiday 2025"], checklist=[{"what": "the launch", "folder": "Holiday 2025", "count": 1234567}]),
                 dict(REQ, folders=["Holiday 2025"], checklist=[{"what": "the launch", "folder": "Holiday 2025", "count": 1, "link": "x"}]),
                 dict(REQ, folders=["Holiday 2025"], checklist=[{"id": "../c1", "what": "the launch", "folder": "Holiday 2025", "count": 1}]),
                 dict(REQ, folders=["Holiday 2025"], checklist=[{"id": 1, "what": "the launch", "folder": "Holiday 2025", "count": 1}])]
        for c in cases:
            with self.subTest(c=str(c)[-90:]):
                self.refused(self.put, pid, c, code="22023")
        self.assertRegex(self.put(pid, dict(REQ, folders=["Holiday 2025"], checklist=[{"what": "the launch", "folder": "Holiday 2025", "count": 20}])), r"^[0-9a-f]{64}$")
        self.assertRegex(self.put(pid, dict(REQ, folders=["Holiday 2025"], checklist=[{"id": "c1", "what": "the launch", "folder": "Holiday 2025", "count": 2}])), r"^[0-9a-f]{64}$", "the AI's checklist items carry an id (CONNECT tools.ts): allowed, short and plain")

    # ------------------------------------------------------------------ CONNECT 09:46: the desktop app for a compilations account
    def test_a_compilations_account_can_be_given_the_desktop_app_and_a_plain_account_still_cannot(self):
        self.d().execute("insert into public.app_releases (kind, file_name, size_bytes, sha256, object_key, active) values ('app', 'app-9.zip', 1000, %s, 'releases/app-9.zip', true)", ("a" * 64,))
        ask = lambda who: self.db.as_("service").one("select request_app_download(%s, 'app')", who)
        with self.assertRaises(psycopg.Error) as cm:
            ask(THIRD)
        self.assertEqual(cm.exception.sqlstate, "PT403", "a plain invited account without the switch: still no app")
        self.switch_on(OTHER)
        self.assertEqual(ask(OTHER)["file_name"], "app-9.zip", "a compilations account gets the app")
        self.d().execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (THIRD,))
        self.assertEqual(ask(THIRD)["file_name"], "app-9.zip", "a tester still gets it")
        self.assertIn("or ryagram_private.compilations_on(p_owner)) then", self.admin("select prosrc from pg_proc where oid = 'public.request_app_download(uuid, text)'::regprocedure").replace(chr(13), ""))

    def test_the_rollback_puts_request_app_download_back(self):
        self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertNotIn("compilations_on", self.admin("select prosrc from pg_proc where oid = 'public.request_app_download(uuid, text)'::regprocedure"))
        self.assertNotIn("compilations_on", self.admin("select prosrc from pg_proc where oid = 'public.connect_whoami(text)'::regprocedure"), "the AI's desktop_app answer is put back too")

    # ------------------------------------------------------------------ GAMES 09:54: the AI is told the same as the download
    def whoami(self, who):
        """connect_whoami for `who` through a real connect token (client, grant and token rows written as the owner; Connect switched on)."""
        self.n += 1
        tok, cid = f"cw{self.n}-{uuid.uuid4().hex}", f"rgc_cw{self.n}{uuid.uuid4().hex[:8]}"
        self.d().execute("update public.connect_flags set connections_enabled = true")
        self.d().execute("insert into public.connect_clients (client_id, name, redirect_uris) values (%s, 'AI', array['https://x.test/cb'])", (cid,))
        self.d().execute("insert into public.connect_grants (owner_id, client_id, scopes) values (%s, %s, array['read'])", (who, cid))
        self.d().execute("insert into public.connect_tokens (family_id, owner_id, client_id, scopes, access_hash, access_expires_at, refresh_hash, refresh_expires_at) "
                         "values (gen_random_uuid(), %s, %s, array['read'], %s, now() + interval '1 hour', %s, now() + interval '1 day')", (who, cid, h(tok), h(tok + 'r')))
        return self.d().execute("select connect_whoami(%s)", (h(tok),)).fetchone()[0]

    def test_the_ai_is_told_a_compilations_account_may_have_the_desktop_app_and_a_plain_account_may_not(self):
        self.assertIs(self.whoami(THIRD)["desktop_app"], False, "a plain invited account: no app")
        self.switch_on(OTHER)
        self.assertIs(self.whoami(OTHER)["desktop_app"], True, "a compilations account: the app, as request_app_download gives it")
        self.d().execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (THIRD,))
        self.assertIs(self.whoami(THIRD)["desktop_app"], True, "a tester still has it")
        self.assertIn("or ryagram_private.compilations_on(me));", self.admin("select prosrc from pg_proc where oid = 'public.connect_whoami(text)'::regprocedure").replace(chr(13), ""))

    # ------------------------------------------------------------------ live step 81 and the rollback
    def test_step_81_pass_after_stop_before_and_the_rollback_restores_device_decide(self):
        rows = self.d().execute(STEP.read_text(encoding="utf-8")).fetchall()
        self.assertTrue(rows[0][1].startswith("PASS") and all(r[2] for r in rows), rows)
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.d().execute(STEP.read_text(encoding="utf-8")).fetchall()
        self.assertTrue(rows[0][1].startswith("STOP"), rows)
        self.assertEqual([r[2] for r in rows[1:]], [False] * (len(rows) - 1), rows)
        src = self.admin("select prosrc from pg_proc where oid = 'public.device_decide(text, boolean)'::regprocedure")
        self.assertNotIn("compilations_on", src)
        self.assertIn("department_switch_on", self.admin("select prosrc from pg_proc where oid = 'ryagram_private.departments_for(uuid)'::regprocedure"), "the top bar rule (20261127000250) stays: it is the other branch's")
        self.assertIn("if p_approve and not coalesce((select s.local_compute from public.account_settings s where s.owner_id = me), false) then", src.replace("\r", ""))
        self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertTrue(self.d().execute(STEP.read_text(encoding="utf-8")).fetchone()[1].startswith("PASS"), "forward again")

    def test_the_switches_rollback_refuses_while_compilations_is_applied(self):
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute((core.ROOT / "rollbacks" / "20261127000250_department_switches_rollback.sql").read_text(encoding="utf-8"))
        self.assertIn("Undo 20261127000300_compilations_for_everyone first", str(cm.exception))
        self.db.c.execute("rollback")
        self.assertIsNotNone(self.admin("select to_regprocedure('ryagram_private.department_switch_on(uuid,text)')"), "nothing was undone")

    def test_step_81_is_one_statement_with_no_semicolon_in_a_string_and_no_address(self):
        t = STEP.read_text(encoding="utf-8")
        code = "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("--"))
        self.assertEqual(code.strip().count(";"), 1)
        self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", code))
        self.assertNotIn("@", t)


if __name__ == "__main__":
    unittest.main()
