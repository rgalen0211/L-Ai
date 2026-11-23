"""A STRANGER NEVER LOSES A FREE PREVIEW TO THE MACHINE'S FAULT (migrations/20261123000100_free_preview_machine_faults.sql, NOT APPLIED) on a local Postgres with the 2B credits ledger.
CONNECT, 2026-11-23 (CC1's ruling 08:11 on WORKER's audit). Same setup as test_2b_credits.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_free_preview_machine_faults.py -v

What it proves, each with the opposite case beside it
  * a failed free preview that ended in engine_unsupported or limit_exceeded is not counted, so a person at the allowance (6 used) gets the next preview FREE again, and the quote says free;
  * everything else still counts: a story the engine refused (schema_rejected), a timeout, a failed check (gate_failed), a bad dataset, a finished preview, a cancelled one, an unknown code;
  * an infrastructure failure is still not counted, as before; the 15 in 24 hours rule skips the machine's faults the same way;
  * the error CLASS of every code is untouched (the worker's contract and the page's words rest on it);
  * the migration over the old function changes it, run twice changes nothing more, does nothing (no error) when the ledger is not applied, and its rollback puts the old rule back;
  * the check step (live step 51) answers as its header says before and after.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN = core.RYAN
MIG = core.ROOT / "migrations" / "20261123000100_free_preview_machine_faults.sql"
RB = core.ROOT / "rollbacks" / "20261123000100_free_preview_machine_faults_rollback.sql"
CHK = core.ROOT / "live-steps" / "51_free_preview_machine_faults_check.sql"
NOT_COUNTED = ("engine_unsupported", "limit_exceeded", "crash", "start_failed", "worker_lost", "worker_error", "upload_failed", "no_receipt", "no_commit", "no_output")
COUNTED = ("schema_rejected", "engine_refused", "dataset_not_allowed", "ladder_missing", "timeout", "gate_failed", "something_new")


def setUpModule():
    credits.setUpModule()


class FreePreviewMachineFaults(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, grant, submit, version = credits.Ledger.admin, credits.Ledger.grant, credits.Ledger.submit, credits.Ledger.version

    def used(self, project=None):
        return self.admin("select ryagram_private.free_previews_used(%s, %s, null)", RYAN, project)

    def fail(self, job, code):
        """what report_state does to a job the worker reports failed with this code: the code is stored and the class comes from error_class_for"""
        self.admin("update jobs set state = 'failed', error_code = %s, error_class = ryagram_private.error_class_for(%s), ended_at = now() where id = %s returning 1", code, code, job)

    def done(self, job):
        self.admin("update jobs set state = 'complete', ended_at = now(), engine_commit = coalesce(engine_commit, 'abc1234') where id = %s returning 1", job)

    def previews(self, vid, n):
        jobs = []
        for _ in range(n):
            job = self.submit(vid, "preview")
            self.done(job)                                   # one preview at a time per version: each is finished before the next
            jobs.append(job)
        return jobs

    def project_of(self, vid):
        return self.admin("select project_id from versions where id = %s", vid)

    def test_a_machine_fault_gives_the_free_preview_back_and_a_person_at_the_allowance_previews_free_again(self):
        vid = self.version()
        jobs = self.previews(vid, 6)
        for j in jobs:
            self.done(j)
        self.assertEqual(self.used(), 6)
        self.fail(jobs[0], "limit_exceeded")
        self.assertEqual(self.used(), 5, "a limit on the machine does not use up a free preview of the project")
        self.assertEqual(self.used(self.project_of(vid)), 5)
        self.assertEqual(self.admin("select ryagram_private.free_previews_used(%s, null, now() - interval '24 hours')", RYAN), 6, "but it still counts in the 15 a day (GAMES: one story cannot queue machine time without end)")
        nxt = self.submit(vid, "preview")
        self.assertTrue(self.admin("select free_preview from jobs where id = %s", nxt), "the next preview is free again")
        self.assertEqual(self.admin("select price_code from jobs where id = %s", nxt), "preview_free")
        self.assertEqual(self.admin("select credits_quoted from jobs where id = %s", nxt), 0)
        self.fail(nxt, "engine_unsupported")
        self.assertEqual(self.used(), 5, "and the same for the machine's own setup")
        again = self.submit(vid, "preview")
        self.assertTrue(self.admin("select free_preview from jobs where id = %s", again))

    def test_every_code_counts_or_not_as_the_rule_says_and_no_class_moved(self):
        classes = {}
        for code in (*NOT_COUNTED, *COUNTED):
            job = self.submit(self.version(), "preview")                                   # one project each: the 6-a-project rule stays out of the way
            self.fail(job, code)
            classes[code] = self.admin("select error_class::text from jobs where id = %s", job)
            self.admin("update jobs set created_at = created_at - interval '2 days' where id = %s returning 1", job)      # and so does the 15-in-24-hours one
        self.assertEqual(self.used(), len(COUNTED), "only the codes that are the person's (or unknown) count: " + str(classes))
        # the class of every code is what it always was: the contract the worker and the page rest on
        self.assertEqual(classes["engine_unsupported"], "invalid_input")
        self.assertEqual(classes["limit_exceeded"], "limit")
        self.assertEqual(classes["schema_rejected"], "invalid_input")
        self.assertEqual(classes["timeout"], "timeout")
        self.assertEqual(classes["gate_failed"], "gate")
        self.assertEqual(classes["crash"], "infrastructure")
        self.assertEqual(classes["something_new"], "unknown")

    def test_a_finished_cancelled_or_still_running_preview_counts(self):
        vid = self.version()
        a, b, c = self.previews(vid, 3)
        self.done(a)
        self.admin("update jobs set state = 'cancelled', error_class = 'cancelled', error_code = 'cancelled', ended_at = now() where id = %s returning 1", b)
        self.assertEqual(self.used(), 3)
        # a failure code that is the machine's but on a job that did not FAIL (cancelled with a stray code) is still counted: only a failed preview is skipped
        self.admin("update jobs set error_code = 'limit_exceeded' where id = %s returning 1", b)
        self.assertEqual(self.used(), 3)
        self.fail(c, "limit_exceeded")
        self.assertEqual(self.used(), 2)

    def test_the_15_in_24_hours_rule_skips_the_machines_faults_too(self):
        self.grant(100)
        jobs = []
        for _ in range(3):                                   # three projects, five previews each = 15 free in the day
            vid = self.version()
            for _ in range(5):
                job = self.submit(vid, "preview")
                self.done(job)
                jobs.append(job)
        self.assertEqual(self.admin("select ryagram_private.free_previews_used(%s, null, now() - interval '24 hours')", RYAN), 15)
        v4 = self.version()
        self.assertFalse(self.admin("select free_preview from jobs where id = %s", self.submit(v4, "preview")), "the 16th in a day is not free")
        self.fail(jobs[0], "engine_unsupported")
        v5 = self.version()
        self.assertTrue(self.admin("select free_preview from jobs where id = %s", self.submit(v5, "preview")), "after an unsupported setup one is free again")
        self.fail(jobs[1], "limit_exceeded")
        v6 = self.version()
        self.assertFalse(self.admin("select free_preview from jobs where id = %s", self.submit(v6, "preview")), "a limit still counts in the 15 a day: no new free one")

    def apply(self, path):
        self.db.as_(None).c.execute(path.read_text(encoding="utf-8"))

    def test_the_migration_changes_the_old_function_runs_twice_and_the_rollback_puts_the_old_rule_back(self):
        vid = self.version()
        j1, j2, j3 = self.previews(vid, 3)
        self.fail(j1, "limit_exceeded"); self.fail(j2, "engine_unsupported"); self.fail(j3, "crash")
        self.assertEqual(self.used(), 0)
        self.apply(RB)                                       # the old function, as the ledger had it before 11-23
        self.assertEqual(self.used(), 2, "the old rule: only the infrastructure failure was skipped")
        self.apply(MIG)
        self.assertEqual(self.used(), 0)
        self.apply(MIG)                                      # run twice: nothing more happens, no error
        self.assertEqual(self.used(), 0)
        self.apply(RB)
        self.assertEqual(self.used(), 2)
        self.apply(RB)
        self.assertEqual(self.used(), 2)

    def test_without_the_credits_ledger_the_migration_and_its_rollback_do_nothing_and_do_not_fail(self):
        self.db.as_(None).c.execute("drop function ryagram_private.free_previews_used(uuid, uuid, timestamptz)")
        self.apply(MIG)
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')"), "it does not make a function the ledger owns")
        self.apply(RB)
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.free_previews_used(uuid,uuid,timestamptz)')"))

    def test_the_migration_keeps_who_may_run_the_function(self):
        sig = "ryagram_private.free_previews_used(uuid,uuid,timestamptz)"
        before = [self.admin("select has_function_privilege(%s, to_regprocedure(%s), 'execute')", who, sig) for who in ("anon", "authenticated", "service_role", "postgres")]
        self.apply(RB); self.apply(MIG)
        after = [self.admin("select has_function_privilege(%s, to_regprocedure(%s), 'execute')", who, sig) for who in ("anon", "authenticated", "service_role", "postgres")]
        self.assertEqual(before, after, "create or replace keeps the owner and the grants")

    def test_the_check_step_answers_as_its_header_says_before_and_after(self):
        text = CHK.read_text(encoding="utf-8")
        rows = self.db.as_(None).c.execute(text).fetchall()
        self.assertEqual(len(rows), 5)
        self.assertTrue(all(r[1] is True for r in rows), rows)                  # the ledger file already carries the rule: a fresh database is "after"
        self.apply(RB)
        rows = self.db.as_(None).c.execute(text).fetchall()
        self.assertEqual([r[1] for r in rows], [True, False, False, True, rows[4][1]], rows)
        self.apply(MIG)
        rows = self.db.as_(None).c.execute(text).fetchall()
        self.assertTrue(all(r[1] is True for r in rows), rows)
        self.db.as_(None).c.execute("drop function ryagram_private.free_previews_used(uuid, uuid, timestamptz)")
        rows = self.db.as_(None).c.execute(text).fetchall()
        self.assertEqual([r[1] for r in rows], [False] * 5, "no ledger: every row false, never an error")


if __name__ == "__main__":
    unittest.main()
