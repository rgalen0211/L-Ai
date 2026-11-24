"""WHOLE-QUEUE CEILING (migrations/20261124000100) on a local Postgres with the 2B ledger, PIPE-1 orders and the per-person queue cap.
BUILDER, 2026-11-24 (CONNECT 09:31 item B; Ryan's Tuesday order: Wednesday is fully public, no first-wave cap).

Run from the repo root with TEMP/TMP on D: (about 1 GB a run; kill the pgserver it leaves by PID):
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_queue_ceiling.py -v

What it proves, each with the opposite case beside it
  * OFF by default: the column is empty, and with it empty nothing is refused beyond the per-person cap
  * with ops_settings.queue_ceiling = 3 and 3 house jobs queued (any owners), a NEW contact sheet or preview is refused with the plain
    words and errcode PTQUE; nothing is inserted; a person at their own cap still reads the per-person sentence (it is checked first)
  * a claimed or running job does not count: once the worker takes one, the next submit is accepted
  * a NEW order is refused while the line is full (it would queue its free sheet at once); a repeat of an existing key is not
  * the worker path is never refused: an open order moving to its next stage inside the worker's report call queues its job even
    when the line is full, and the order is not failed
  * two people at the same moment cannot both take the last place (two real connections; must-fail without the global lock)
  * the number is 1 to 100000 or empty; 0 is refused (0 must never quietly mean 'shut')
  * the two checks are 20261123000200's text plus one call; the migration refuses to run over a hand-changed check, and changes nothing
  * nobody can call the new private function
  ROLLBACK: puts both checks back byte for byte (prosrc equal to 20261123000200's), drops the function and the column; then the
  20261123000300 and 000200 undos still run in order; and the migration applies forward again.
  MUST-FAIL: each scenario is run once more on a database where its guard is planted out, and must FAIL there.
"""
import sys
import threading
import time
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402
import test_pipe1_orders as p1  # noqa: E402
import test_queue_cap_blocked_views as qc  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
CEIL_WORDS = "The render queue is full right now. Please try again in a while."
CAP_WORDS = qc.CAP_WORDS
MIG = core.ROOT / "migrations" / "20261124000100_queue_ceiling.sql"
MIG200 = core.ROOT / "migrations" / "20261123000200_queue_cap_per_owner.sql"
RB = core.ROOT / "rollbacks" / "20261124000100_queue_ceiling_rollback.sql"
SHEET = "select id from submit_job(%s, 'contact_sheet', '{}')"
PREVIEW = "select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')"


def setUpModule():
    credits.setUpModule()


def original_body(name):
    """The body (prosrc) of a check exactly as 20261123000200 wrote it."""
    t = MIG200.read_text(encoding="utf-8").replace("\r\n", "\n")
    i = t.index("create function ryagram_private." + name)
    a = t.index("$$", i) + 2
    return t[a:t.index("$$", a)]


class QueueCeiling(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)
        self.admin("update ops_settings set auto_render = false returning 1")
        self.admin("update ops_settings set queue_cap_per_owner = 2 returning 1")      # the live default (the shared templates raise it to 50)
    admin, version, submit = credits.Ledger.admin, credits.Ledger.version, credits.Ledger.submit
    order, claim, stage_job = p1.Orders.order, p1.Orders.claim, p1.Orders.stage_job
    work, ddl, refused = qc.QueueCapBlockedViews.work, qc.QueueCapBlockedViews.ddl, qc.QueueCapBlockedViews.refused
    must_fail = qc.QueueCapBlockedViews.must_fail

    def ceiling(self, n):
        self.admin("update ops_settings set queue_ceiling = %s returning 1", n)

    def line(self):
        return self.admin("select count(*) from jobs where state = 'queued' and run_on = 'house'")

    def body(self, name):
        return self.admin(f"select prosrc from pg_proc where oid = to_regprocedure('ryagram_private.{name}(uuid)')")

    # ---------------------------------------------------------------- scenarios (each also runs against a planted fault)
    def scenario_full_line_refuses(self):
        self.ceiling(3)
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER)
        self.assertEqual(self.line(), 3)
        v = self.version(who=OTHER)
        self.refused(OTHER, SHEET, v, words=CEIL_WORDS, code="PTQUE")
        self.refused(OTHER, PREVIEW, v, words=CEIL_WORDS, code="PTQUE")
        self.assertEqual(self.line(), 3, "a refused submit inserts nothing")

    def scenario_new_order_refused_when_full(self):
        self.ceiling(2)
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(), "contact_sheet")
        self.refused(OTHER, "select id from submit_render_order(%s::jsonb, %s, %s)", p1.story(), "orderkey-c1", "preview",
                     words=CEIL_WORDS, code="PTQUE")
        self.assertEqual(self.admin("select count(*) from render_orders where owner_id = %s", OTHER), 0, "the refused order left nothing")
        self.assertEqual(self.line(), 2)

    def scenario_worker_path_never_refused(self):
        oid = self.order("orderkey-w1", want="preview", who=OTHER)
        sheet = self.claim()
        self.assertEqual(sheet, self.stage_job(oid, "contact_sheet"))
        self.submit(self.version(), "contact_sheet")
        self.ceiling(1)                                                         # the line is now full
        self.assertEqual(self.work(sheet, ["contact_sheet"]), "complete", "the worker's report call must not fail")
        self.assertNotEqual(self.admin("select state::text from render_orders where id = %s", oid), "failed", "the order is not ended")
        self.assertIsNotNone(self.stage_job(oid, "preview"), "the order queued its preview inside the worker's call")
        self.assertEqual(self.line(), 2)

    def scenario_two_people_at_once(self):
        """Ceiling 2, one job queued. RYAN submits inside an open transaction (the last place); OTHER submits at the same moment and
        must WAIT for it (the global lock), then be refused. Without the lock OTHER counts 1 and a third job slips in."""
        self.ceiling(2)
        self.submit(self.version(), "contact_sheet")
        v1, v2 = self.version(), self.version(who=OTHER)
        tab1 = psycopg.connect(credits._server.get_uri(database=self.name))     # not autocommit: its submit stays open
        try:
            tab1.execute("select set_config('request.jwt.claim.sub', %s, false)", (RYAN,))
            tab1.execute("set role authenticated")
            tab1.execute(SHEET, (v1,))
            out = {}

            def tab2():
                c = psycopg.connect(credits._server.get_uri(database=self.name), autocommit=True)
                try:
                    c.execute("select set_config('request.jwt.claim.sub', %s, false)", (OTHER,))
                    c.execute("set role authenticated")
                    c.execute(SHEET, (v2,))
                    out["result"] = "accepted"
                except psycopg.Error as e:
                    out["result"] = e.sqlstate
                finally:
                    c.close()
            t = threading.Thread(target=tab2)
            t.start()
            time.sleep(1.5)
            waited = t.is_alive()
            tab1.commit()
            t.join(30)
        finally:
            tab1.close()
        self.assertTrue(waited, "the second person waited for the first one's open submit")
        self.assertEqual(out.get("result"), "PTQUE", "the second person is refused once the first one's job is in")
        self.assertEqual(self.line(), 2)

    # ---------------------------------------------------------------- tests
    def test_off_by_default(self):
        self.assertIsNone(self.admin("select queue_ceiling from ops_settings where id"))
        self.assertIsNone(self.admin("select column_default from information_schema.columns where table_name = 'ops_settings' "
                                     "and column_name = 'queue_ceiling'"))
        for who in (RYAN, OTHER):
            self.submit(self.version(who=who), "contact_sheet", who=who)
            self.submit(self.version(who=who), "contact_sheet", who=who)
        self.assertEqual(self.line(), 4, "empty = off: only the per-person cap applies")
        self.refused(RYAN, SHEET, self.version(), words=CAP_WORDS, code="PTQUE")

    def test_a_full_line_refuses_a_new_sheet_or_preview(self):
        self.scenario_full_line_refuses()

    def test_the_per_person_sentence_comes_first(self):
        self.ceiling(2)
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(), "contact_sheet")
        self.refused(RYAN, SHEET, self.version(), words=CAP_WORDS, code="PTQUE")

    def test_a_claimed_job_does_not_count(self):
        self.ceiling(2)
        first = self.submit(self.version(), "contact_sheet")
        self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER)
        self.assertEqual(self.claim(), first)
        self.assertIsNotNone(self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER))
        self.assertEqual(self.line(), 2)

    def test_a_new_order_is_refused_and_a_repeat_key_is_not(self):
        oid = self.order("orderkey-r1", want="preview", who=OTHER)               # queues its sheet stage: line 1
        self.ceiling(1)
        self.assertEqual(self.order("orderkey-r1", want="preview", who=OTHER), oid, "a repeated key is never refused")
        self.refused(OTHER, "select id from submit_render_order(%s::jsonb, %s, %s)", p1.story(), "orderkey-r2", "preview",
                     words=CEIL_WORDS, code="PTQUE")
        self.ceiling(None)
        self.assertIsNotNone(self.order("orderkey-r2", want="preview", who=OTHER), "set back to empty: accepted")

    def test_new_order_refused_when_full(self):
        self.scenario_new_order_refused_when_full()

    def test_worker_path_is_never_refused(self):
        self.scenario_worker_path_never_refused()

    def test_two_people_cannot_both_take_the_last_place(self):
        self.scenario_two_people_at_once()

    def test_the_number_is_the_setting(self):
        self.ceiling(4)
        for who in (RYAN, OTHER):
            self.submit(self.version(who=who), "contact_sheet", who=who)
            self.submit(self.version(who=who), "contact_sheet", who=who)
        self.admin("update ops_settings set queue_cap_per_owner = 5 returning 1")
        self.refused(RYAN, SHEET, self.version(), words=CEIL_WORDS, code="PTQUE")
        for bad in (0, -1, 100001):
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.admin("update ops_settings set queue_ceiling = %s returning 1", bad)
            self.db.c.execute("rollback") if self.db.c.info.transaction_status else None

    def test_the_checks_are_the_old_text_plus_one_call(self):
        for name in ("queue_cap_check", "order_cap_check"):
            old, new = original_body(name), self.body(name)
            self.assertNotIn("queue_ceiling_check", old)
            self.assertEqual(new.replace("\r", "").count("perform ryagram_private.queue_ceiling_check();"), 1, name)
            kept = "\n".join(line for line in new.replace("\r", "").split("\n") if "queue_ceiling_check" not in line)
            self.assertEqual(kept, old, f"{name}: everything else is 20261123000200's text")
        self.assertNotIn("function ryagram_private.submit_job_for", MIG.read_text(encoding="utf-8"), "no wrapper is touched")
        self.assertNotIn("function public.submit_job", MIG.read_text(encoding="utf-8"))
        self.assertNotIn("order_submit", MIG.read_text(encoding="utf-8").split("begin;", 1)[1])

    def test_nobody_can_call_the_new_function(self):
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, 'ryagram_private.queue_ceiling_check()', 'execute')", role), role)
            for name in ("queue_cap_check", "order_cap_check"):
                self.assertFalse(self.admin(f"select has_function_privilege(%s, 'ryagram_private.{name}(uuid)', 'execute')", role), role)

    def test_a_hand_changed_check_is_refused_and_nothing_changes(self):
        self.ddl(RB.read_text(encoding="utf-8"))
        self.ddl("create or replace function ryagram_private.queue_cap_check(p_owner uuid) returns void "
                 "language plpgsql set search_path = '' as $$ begin null; end $$")              # as if someone had changed it by hand
        before = self.body("queue_cap_check")
        with self.assertRaises(psycopg.Error) as cm:
            self.ddl(MIG.read_text(encoding="utf-8"))
        self.assertIn("is not the one this change expects", str(cm.exception))
        self.db.c.execute("rollback")
        self.assertEqual(self.body("queue_cap_check"), before, "nothing was changed")
        self.assertIsNone(self.admin("select column_name from information_schema.columns where table_name = 'ops_settings' "
                                     "and column_name = 'queue_ceiling'"))

    def test_rollback_is_exact_then_the_older_undos_still_run_and_forward_again(self):
        self.ceiling(1)
        self.ddl(RB.read_text(encoding="utf-8"))
        for name in ("queue_cap_check", "order_cap_check"):
            self.assertEqual(self.body(name).replace("\r", ""), original_body(name), f"{name} is 20261123000200's text again")
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.queue_ceiling_check()')"))
        self.assertIsNone(self.admin("select column_name from information_schema.columns where table_name = 'ops_settings' "
                                     "and column_name = 'queue_ceiling'"))
        self.submit(self.version(), "contact_sheet")
        self.assertIsNotNone(self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER), "undone: no ceiling")
        self.ddl(MIG.read_text(encoding="utf-8"))                                  # forward again over the restored checks
        self.assertIsNone(self.admin("select queue_ceiling from ops_settings where id"))
        self.ddl(RB.read_text(encoding="utf-8"))
        self.ddl(qc.RB300.read_text(encoding="utf-8"))
        self.ddl(qc.RB200.read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.queue_cap_check(uuid)')"))

    def test_rollback_after_the_cap_was_undone_drops_only_its_own(self):
        self.ddl(qc.RB300.read_text(encoding="utf-8"))
        self.ddl(qc.RB200.read_text(encoding="utf-8"))                             # the older undo first (it does not know this file)
        self.ddl(RB.read_text(encoding="utf-8"))
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.queue_cap_check(uuid)')"), "not brought back")
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.queue_ceiling_check()')"))

    # ---------------------------------------------------------------- MUST-FAIL: each guard planted out, its scenario must fail
    def test_must_fail_without_the_ceiling(self):
        self.must_fail("create or replace function ryagram_private.queue_ceiling_check() returns void "
                       "language plpgsql set search_path = '' as $$ begin null; end $$", self.scenario_full_line_refuses)

    def test_must_fail_without_the_ceiling_on_new_orders(self):
        self.must_fail("create or replace function ryagram_private.order_cap_check(p_owner uuid) returns void "
                       "language plpgsql set search_path = '' as $$ begin null; end $$", self.scenario_new_order_refused_when_full)

    def test_must_fail_with_the_ceiling_on_order_stages_too(self):
        # the tempting wrong rule: check the ceiling for every new job in submit_job_for, order stages included
        self.must_fail("create or replace function ryagram_private.submit_job_for(p_owner uuid, p_version_id uuid, p_job_type public.job_type, "
                       "p_params jsonb default '{}'::jsonb, p_sheet_job_id uuid default null, p_preview_job_id uuid default null, "
                       "p_state public.job_state default 'queued', p_stage_id uuid default null) returns public.jobs "
                       "language plpgsql security definer set search_path = '' as $$ begin "
                       "perform ryagram_private.queue_ceiling_check(); "
                       "return ryagram_private.submit_job_for_base(p_owner, p_version_id, p_job_type, p_params, p_sheet_job_id, "
                       "p_preview_job_id, p_state, p_stage_id); end $$",
                       self.scenario_worker_path_never_refused)
        oid = self.admin("select id from render_orders where idempotency_key = 'orderkey-w1'")
        self.assertEqual(self.admin("select state::text || '/' || error_code from render_orders where id = %s", oid), "failed/advance_error",
                         "the planted ceiling ended the stranger's order: the harm this placement avoids")

    def test_must_fail_without_the_global_lock(self):
        self.must_fail("create or replace function ryagram_private.queue_ceiling_check() returns void "
                       "language plpgsql set search_path = '' as $$ "
                       "declare ceiling int := (select s.queue_ceiling from public.ops_settings s where s.id); begin "
                       "if ceiling is not null and (select count(*) from public.jobs j where j.state = 'queued' and j.run_on = 'house' "
                       "and j.job_type in ('contact_sheet', 'preview', 'final_render')) >= ceiling then "
                       "raise exception 'The render queue is full right now. Please try again in a while.' using errcode = 'PTQUE'; "
                       "end if; end $$", self.scenario_two_people_at_once)


if __name__ == "__main__":
    unittest.main()
