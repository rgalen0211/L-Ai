"""QUEUE ORDER BY WHEN A JOB JOINED THE LINE (migrations/20261125000100) on a local Postgres with the 2B ledger and PIPE-1 orders. BUILDER 2026-11-25
(GAMES 11-24 09:31 (2); CC1 11-25 12:04: branch only, ready if strangers hit it).

Run from the repo root with TEMP/TMP on D: (kill the pgserver it leaves by PID):
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_queue_order_joined_line.py -v

  * APPROVAL: a full film asked for an hour ago and approved NOW joins the END of the line: a stranger who read 'Number 2' still reads 2,
    and the render PC claims the two sheets queued before the approval first (must-fail without the trigger: the film jumps ahead)
  * RETRY: a job put back in line after its worker went silent keeps its place: the next claim takes it again before a later job
    (must-fail with the trigger firing on every -> queued: the retried job goes to the back)
  * queue_position and the claim order are the same rule (the number a stranger reads = the order the PC takes)
  * the backfill keeps today's order for every waiting job (joined_line_at = created_at)
  * the guard refuses a hand-changed claim_next_job in words and changes nothing; a second run changes nothing
  * the rollback puts the three ordering clauses back (created_at) and drops the column, trigger and index
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402
import test_pipe1_orders as p1  # noqa: E402
import test_queue_cap_blocked_views as qc  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
MIG = core.ROOT / "migrations" / "20261125000100_queue_order_joined_line.sql"
RB = core.ROOT / "rollbacks" / "20261125000100_queue_order_joined_line_rollback.sql"
FNS = ("public.claim_next_job()", "public.node_claim(text)", "public.queue_position(uuid)")


def setUpModule():
    credits.setUpModule()


class QueueOrder(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)
        self.admin("update ops_settings set auto_render = false returning 1")
    admin, version, submit, grant = credits.Ledger.admin, credits.Ledger.version, credits.Ledger.submit, credits.Ledger.grant
    order, claim, stage_job, stages = p1.Orders.order, p1.Orders.claim, p1.Orders.stage_job, p1.Orders.stages
    make_ryan_admin, work_through_preview, work = p1.Orders.make_ryan_admin, p1.Orders.work_through_preview, p1.Orders.work
    ddl, must_fail = qc.QueueCapBlockedViews.ddl, qc.QueueCapBlockedViews.must_fail

    def ago(self, job, minutes):
        self.admin("update jobs set created_at = now() - make_interval(mins => %s), joined_line_at = now() - make_interval(mins => %s), "
                   "queued_at = now() - make_interval(mins => %s) where id = %s returning 1", minutes, minutes, minutes, job)

    def place(self, who, job):
        return self.db.as_(who).one("select queue_position(%s)", job)

    def body(self, fn):
        return self.admin("select prosrc from pg_proc where oid = to_regprocedure(%s)", fn)

    # ---------------------------------------------------------------- scenarios (each also runs on a planted fault)
    def scenario_approval_joins_the_end(self):
        self.make_ryan_admin()
        self.grant(100, who=OTHER)
        oid = self.order("order-line-1", want="final")
        self.work_through_preview(oid)
        final = self.stage_job(oid, "final_render")
        self.assertEqual(self.admin("select state::text from jobs where id = %s", final), "awaiting_approval")
        self.ago(final, 60)                                                  # asked for an hour ago
        s1, s2 = self.submit(self.version(), "contact_sheet"), self.submit(self.version(), "contact_sheet")
        self.ago(s1, 30)
        self.ago(s2, 20)
        self.assertEqual(self.place(RYAN, s2), 2, "before the approval: Number 2 in line")
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true)", sid)
        self.assertEqual(self.admin("select state::text from jobs where id = %s", final), "queued")
        self.assertEqual(self.place(RYAN, s2), 2, "after Ryan approves an older full film, the stranger still reads Number 2")
        self.assertEqual(self.place(OTHER, final), 3, "the approved film is at the END of the line")
        self.assertEqual([self.claim(), self.claim_after(), self.claim_after()], [s1, s2, final], "the PC claims in the same order")

    def claim_after(self):
        # the worker can hold one job at a time: finish the one it holds, then claim the next
        held = self.admin("select id from jobs where state = 'claimed' limit 1")
        if held:
            self.admin("update jobs set state = 'complete', ended_at = now() where id = %s returning 1", held)
        return self.claim()

    def scenario_retry_keeps_its_place(self):
        r, later = self.submit(self.version(), "contact_sheet"), self.submit(self.version(), "contact_sheet")
        self.ago(r, 40)
        self.ago(later, 30)
        self.assertEqual(self.claim(), r)
        self.admin("update jobs set lease_expires_at = now() - interval '1 minute' where id = %s returning 1", r)   # its worker went silent
        again = self.claim()                                                 # the claim puts it back in line, then claims the oldest
        self.assertEqual(self.admin("select attempt from jobs where id = %s", r), 2, "it was put back once")
        self.assertEqual(again, r, "the retried job keeps its place and is taken again before the later job")

    def scenario_retry_job_keeps_its_place(self):
        # the worker's own call after a machine fault (retry_job; it resets queued_at)
        r, later = self.submit(self.version(), "contact_sheet"), self.submit(self.version(), "contact_sheet")
        self.ago(r, 40)
        self.ago(later, 30)
        self.assertEqual(self.claim(), r)
        w = self.db.as_(core.WORKER)
        w.one("select report_state(%s, 'running')", r)
        self.assertEqual(w.one("select retry_job(%s, 'crash', 'segfault')", r), "queued")
        self.assertEqual(self.claim(), r, "after retry_job the job keeps its place")

    def scenario_reaper_keeps_its_place(self):
        # ops_tick's reaper (ryagram_private.reap_lost_leases), with no worker polling
        r, later = self.submit(self.version(), "contact_sheet"), self.submit(self.version(), "contact_sheet")
        self.ago(r, 40)
        self.ago(later, 30)
        self.assertEqual(self.claim(), r)
        self.admin("update jobs set lease_expires_at = now() - interval '5 minutes' where id = %s returning 1", r)
        self.assertEqual(self.admin("select ryagram_private.reap_lost_leases()"), 1)
        self.assertEqual(self.admin("select state::text || '/' || attempt from jobs where id = %s", r), "queued/2")
        self.assertEqual(self.claim(), r, "after the reaper the job keeps its place")

    def scenario_bundle_still_jumps_after_an_approval(self):
        # GAMES 12:23: an old film Ryan approves just now has waited 0 minutes IN LINE, so a film bundle queued a moment later still goes first
        self.admin("update control set disabled_job_types = '{}' where id returning 1")
        self.make_ryan_admin()
        self.grant(100, who=OTHER)
        oid = self.order("order-line-b", want="final")
        self.work_through_preview(oid)
        final = self.stage_job(oid, "final_render")
        self.ago(final, 60)
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true)", sid)
        status, bundle = self.db.as_(RYAN).one("select status, job_id from request_film_bundle(%s, '0:10')", self.version())
        self.assertEqual(status, "building")
        self.assertEqual(self.claim(), bundle, "the bundle goes first: the approved film joined the line less than 2 minutes ago")

    def approved_old_film(self, key, asked_min=180):
        """a full film asked for long ago and approved by Ryan NOW: it has waited 0 minutes in line"""
        self.make_ryan_admin()
        self.grant(100, who=OTHER)
        oid = self.order(key, want="final")
        self.work_through_preview(oid)
        final = self.stage_job(oid, "final_render")
        self.ago(final, asked_min)
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true)", sid)
        return final

    def scenario_timeout_measures_the_wait_in_line(self):
        # CC1 14:3x: the render PC silent for the whole timeout fails only jobs that WAITED longer than it
        final = self.approved_old_film("order-line-t")
        sheet = self.submit(self.version(), "contact_sheet")
        self.ago(sheet, 70)
        self.admin("update public.workers set last_seen_at = now() - interval '2 hours' returning 1")
        self.assertEqual(self.admin("select ryagram_private.expire_stale_queue()"), 1, "only the sheet that waited 70 minutes")
        self.assertEqual(self.admin("select state::text, error_code from jobs where id = %s", sheet), ("failed", "queue_timeout"))
        self.assertEqual(self.admin("select state::text from jobs where id = %s", final), "queued", "the film Ryan approved minutes ago is not failed as 'waited an hour'")

    def scenario_ops_oldest_wait_is_the_wait_in_line(self):
        self.approved_old_film("order-line-o")
        sheet = self.submit(self.version(), "contact_sheet")
        self.ago(sheet, 20)
        self.assertEqual(self.db.as_(RYAN).one("select (admin_ops() ->> 'oldest_queued_min')::int"), 20,
                         "the Ops page's oldest wait is the longest wait IN LINE, not the film asked for 3 hours ago")

    # ---------------------------------------------------------------- tests
    def test_the_queue_timeout_measures_the_wait_in_line(self):
        self.scenario_timeout_measures_the_wait_in_line()

    def test_the_ops_oldest_wait_is_the_wait_in_line(self):
        self.scenario_ops_oldest_wait_is_the_wait_in_line()

    def test_must_fail_with_the_queue_timeout_left_on_created_at(self):
        self.must_fail("do $p$ begin execute replace(pg_get_functiondef(to_regprocedure('ryagram_private.expire_stale_queue()')), "
                       "'and j.joined_line_at < now()', 'and j.created_at < now()'); end $p$", self.scenario_timeout_measures_the_wait_in_line)

    def test_must_fail_with_the_ops_oldest_wait_left_on_created_at(self):
        self.must_fail("do $p$ begin execute replace(pg_get_functiondef(to_regprocedure('ryagram_private.admin_ops_base()')), "
                       "'min(joined_line_at)) / 60)', 'min(created_at)) / 60)'); end $p$", self.scenario_ops_oldest_wait_is_the_wait_in_line)

    def test_retry_job_keeps_its_place(self):
        self.scenario_retry_job_keeps_its_place()

    def test_the_reaper_keeps_its_place(self):
        self.scenario_reaper_keeps_its_place()

    def test_a_bundle_still_jumps_after_ryan_approves_an_old_film(self):
        self.scenario_bundle_still_jumps_after_an_approval()

    def test_an_approved_older_full_film_joins_the_end_of_the_line(self):
        self.scenario_approval_joins_the_end()

    def test_a_retried_job_keeps_its_place(self):
        self.scenario_retry_keeps_its_place()

    def test_the_backfill_keeps_todays_order(self):
        self.assertEqual(self.admin("select count(*) from jobs where joined_line_at is distinct from created_at"), 0)
        self.assertEqual(self.admin("select column_default from information_schema.columns where table_name = 'jobs' and column_name = 'joined_line_at'"), "now()")
        self.assertEqual(self.admin("select is_nullable from information_schema.columns where table_name = 'jobs' and column_name = 'joined_line_at'"), "NO")

    def test_the_three_functions_read_joined_line_at(self):
        self.assertIn("joined_line_at, id\n    for update skip locked", self.body(FNS[0]).replace("\r", ""))
        self.assertIn("and o.joined_line_at < now() - interval '2 minutes') then 0 else 1 end", self.body(FNS[0]), "the 2-minute guard reads the line too")
        self.assertNotIn("o.created_at", self.body(FNS[0]), "no created_at left in the claim's ordering")
        self.assertIn("order by joined_line_at, id for update skip locked limit 1;", self.body(FNS[1]))
        self.assertIn("(q.joined_line_at, q.id) < (j.joined_line_at, j.id)", self.body(FNS[2]))
        for fn in FNS:
            self.assertNotIn("created_at, id", self.body(fn).replace("(q.created_at", "").replace("\r", ""), fn)
        self.assertIn("film_bundle", self.body(FNS[0]), "the film-bundle-first rule of 20261113000400 is kept")
        self.assertIn("perform ryagram_private.require_active();", self.body(FNS[2]), "the waiting-account gate line is kept")

    def test_a_second_run_changes_nothing(self):
        before = {fn: self.body(fn) for fn in FNS}
        self.ddl(MIG.read_text(encoding="utf-8"))
        self.assertEqual({fn: self.body(fn) for fn in FNS}, before)

    def test_a_hand_changed_claim_is_refused_and_nothing_changes(self):
        self.ddl(RB.read_text(encoding="utf-8"))
        drifted = self.admin("select replace(pg_get_functiondef(to_regprocedure('public.claim_next_job()')), 'end, created_at, id', 'end, created_at desc, id')")
        self.assertIn("created_at desc", drifted)
        self.ddl(drifted)
        before = {fn: self.body(fn) for fn in FNS}
        with self.assertRaises(psycopg.Error) as cm:
            self.ddl(MIG.read_text(encoding="utf-8"))
        self.assertIn("is not the one this change expects", str(cm.exception))
        self.db.c.execute("rollback")
        self.assertEqual({fn: self.body(fn) for fn in FNS}, before, "nothing was changed")
        self.assertIsNone(self.admin("select column_name from information_schema.columns where table_name = 'jobs' and column_name = 'joined_line_at'"))

    def test_rollback_puts_the_order_back_and_forward_again(self):
        self.ddl(RB.read_text(encoding="utf-8"))
        self.assertIn("end, created_at, id\n    for update skip locked", self.body(FNS[0]).replace("\r", ""))
        self.assertIn("order by created_at, id for update skip locked limit 1;", self.body(FNS[1]))
        self.assertIn("(q.created_at, q.id) < (j.created_at, j.id)", self.body(FNS[2]))
        self.assertIsNone(self.admin("select column_name from information_schema.columns where table_name = 'jobs' and column_name = 'joined_line_at'"))
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.jobs_joined_line()')"))
        self.ddl(MIG.read_text(encoding="utf-8"))
        self.test_the_three_functions_read_joined_line_at()

    def test_nobody_can_call_the_trigger_function(self):
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, 'ryagram_private.jobs_joined_line()', 'execute')", role), role)

    # ---------------------------------------------------------------- MUST-FAIL
    def test_must_fail_without_the_trigger(self):
        self.must_fail("drop trigger jobs_joined_line on public.jobs", self.scenario_approval_joins_the_end)

    def test_must_fail_with_the_trigger_on_every_requeue(self):
        self.must_fail("create or replace function ryagram_private.jobs_joined_line() returns trigger language plpgsql set search_path = '' as $$ "
                       "begin if new.state = 'queued' and old.state is distinct from 'queued' then new.joined_line_at := now(); end if; return new; end $$",
                       self.scenario_retry_keeps_its_place)

    EVERY_REQUEUE = ("create or replace function ryagram_private.jobs_joined_line() returns trigger language plpgsql set search_path = '' as $$ "
                     "begin if new.state = 'queued' and old.state is distinct from 'queued' then new.joined_line_at := now(); end if; return new; end $$")

    def test_must_fail_retry_job_with_the_trigger_on_every_requeue(self):
        self.must_fail(self.EVERY_REQUEUE, self.scenario_retry_job_keeps_its_place)

    def test_must_fail_reaper_with_the_trigger_on_every_requeue(self):
        self.must_fail(self.EVERY_REQUEUE, self.scenario_reaper_keeps_its_place)

    def test_must_fail_with_the_2_minute_guard_left_on_created_at(self):
        # the tempting half-fix: only the tie order moved, the starvation guard still reads created_at
        self.must_fail("do $p$ begin execute replace(pg_get_functiondef(to_regprocedure('public.claim_next_job()')), "
                       "'and o.joined_line_at < now()', 'and o.created_at < now()'); end $p$", self.scenario_bundle_still_jumps_after_an_approval)


if __name__ == "__main__":
    unittest.main()
