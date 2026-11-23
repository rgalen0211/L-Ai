"""QUEUE CAP PER OWNER (migrations/20261123000200) and BLOCKED STORY VIEWS (migrations/20261123000300) on a local Postgres with the
2B ledger and PIPE-1 orders. BUILDER, 2026-11-23 (CC1 rulings 09:21, 09:24, 09:42, 09:54, 10:00).

Run from the repo root with TEMP/TMP on D: (about 1 GB a run; kill the pgserver it leaves by PID):
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_queue_cap_blocked_views.py -v

What it proves, each with the opposite case beside it
  QUEUE CAP
  * with 2 jobs QUEUED a third contact sheet or preview is refused with the plain words and errcode PTQUE; nothing is inserted
  * a claimed or running job does not count: once the worker takes one, the next submit is accepted
  * another owner is not affected by someone else's 2 queued; a full film (submit_job with auto_render on) is not capped
  * orders are NOT capped (CC1 10:00): a new render order is accepted while the owner has 2 queued
  * the number is ops_settings.queue_cap_per_owner (default 2, 1 to 50); two tabs at the same moment cannot both pass (two real
    connections; the must-fail without the lock lets the second through)
  * public.submit_job is pipe1's own function, untouched (grants, waiting-account gate); pipe1's ryagram_private.submit_job_for is
    renamed untouched to submit_job_for_base (its text is still what the pipe1 fault runner plants into), and nobody can call either
    private function; the AI connector (connect_submit_job -> submit_job) meets both checks
  * the worker path is never refused: an order advancing inside the worker's own report call (sheet done -> preview stage) queues
    its next job even when the owner already has 2 queued, and the order is not failed (with the p_stage_id guard planted out,
    jobs_advance_order catches the refusal and ends the order as failed/advance_error: the must-fail proves it)
  BLOCKED VIEWS
  * a contact sheet and a preview of a story with a blocked (dataset, view) clip are refused with the plain words and errcode PTVEW
  * the same dataset in an unblocked view passes; a story with one blocked clip among good ones is refused
  * a NEW order with a blocked story is refused; a full film is not checked here
  * the seed equals tools/data/engine-catalog-block-list-1123.json (the ONE committed copy, WEB's gen-catalog reads it too; ENGINE's
    final v2, 58 pairs), pair for pair
  ROLLBACKS: 000300's undo keeps the cap and lets the blocked pair through; 000200's undo refuses to run while 000300 is applied, and
  after both, three queued jobs are accepted again, submit_job_for and order_submit are pipe1's own functions again.
  MUST-FAIL: each scenario is run once more on a database where its guard is planted out, and must FAIL there.
"""
import json
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

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
CAP_WORDS = "You have 2 films waiting. You can start another when one is done."
VIEW_WORDS = "This film is not available yet. Please pick another view."
RB300 = core.ROOT / "rollbacks" / "20261123000300_blocked_story_views_rollback.sql"
RB200 = core.ROOT / "rollbacks" / "20261123000200_queue_cap_per_owner_rollback.sql"
BLOCK_JSON = core.ROOT.parent / "tools" / "data" / "engine-catalog-block-list-1123.json"
SUBMIT = "public.submit_job(uuid, public.job_type, jsonb, uuid, uuid)"                   # pipe1's, never touched
SIG8 = "(uuid, uuid, public.job_type, jsonb, uuid, uuid, public.job_state, uuid)"
WRAPPER = "ryagram_private.submit_job_for" + SIG8
BASE = "ryagram_private.submit_job_for_base" + SIG8
PIPE1_LINE = "  if p_job_type = 'final_render' and not (select auto_render from public.ops_settings where id) then"   # in public.submit_job
PIPE1_FOR_LINE = "    raise exception 'A % job for this version is already in progress.', p_job_type using errcode = '42501';"   # in submit_job_for


def setUpModule():
    credits.setUpModule()
    core.setUpModule()          # the connector test below runs on test_connect's own database (core.Base)


class QueueCapBlockedViews(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)
        self.admin("update ops_settings set auto_render = false returning 1")
    admin, denied, grant, version, submit, settle = (credits.Ledger.admin, credits.Ledger.denied, credits.Ledger.grant,
                                                     credits.Ledger.version, credits.Ledger.submit, credits.Ledger.settle)
    order, claim, stages, stage_job = p1.Orders.order, p1.Orders.claim, p1.Orders.stages, p1.Orders.stage_job

    def work(self, job, kinds):
        return core.Core.run_job(self, job, kinds)

    def ddl(self, sql):
        self.db.as_(None).c.execute(sql)

    def refused(self, who, sql, *args, words, code):
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(who).one(sql, *args)
        self.assertEqual(cm.exception.sqlstate, code, str(cm.exception))
        self.assertIn(words, str(cm.exception))

    def queued(self, who=RYAN):
        return self.admin("select count(*) from jobs where owner_id = %s and state = 'queued'", who)

    def blocked_version(self, *views, dataset="bps_county_permits", who=RYAN):
        return self.version(*views, dataset=dataset, who=who)

    # ---------------------------------------------------------------- scenarios (each also runs against a planted fault)
    def scenario_third_is_refused(self):
        v1, v2, v3 = self.version(), self.version(), self.version()
        self.submit(v1, "contact_sheet")
        self.submit(v2, "contact_sheet")
        self.assertEqual(self.queued(), 2)
        self.refused(RYAN, "select id from submit_job(%s, 'contact_sheet', '{}')", v3, words=CAP_WORDS, code="PTQUE")
        self.refused(RYAN, "select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", v3, words=CAP_WORDS, code="PTQUE")
        self.assertEqual(self.queued(), 2, "a refused submit inserts nothing")

    def scenario_worker_path_never_refused(self):
        oid = self.order("orderkey-1", want="preview", who=OTHER)
        sheet = self.claim()
        self.assertEqual(sheet, self.stage_job(oid, "contact_sheet"))
        a, b = self.version(who=OTHER), self.version(who=OTHER)
        self.submit(a, "contact_sheet", who=OTHER)
        self.submit(b, "contact_sheet", who=OTHER)
        self.assertEqual(self.queued(OTHER), 2)
        self.assertEqual(self.work(sheet, ["contact_sheet"]), "complete", "the worker's report call must not fail")
        self.assertNotEqual(self.admin("select state::text from render_orders where id = %s", oid), "failed", "the order is not ended")
        self.assertIsNotNone(self.stage_job(oid, "preview"), "the order queued its preview inside the worker's call")
        self.assertEqual(self.queued(OTHER), 3)

    def scenario_two_tabs_at_once(self):
        """Tab 1 submits inside an open transaction (not yet committed); tab 2 submits at the same moment. Tab 2 must WAIT for tab 1
        (the per-owner lock), then see its job and be refused. Without the lock, tab 2 counts 1 and a third job slips in."""
        v1, v2, v3 = self.version(), self.version(), self.version()
        self.submit(v1, "contact_sheet")
        tab1 = psycopg.connect(credits._server.get_uri(database=self.name))           # not autocommit: its submit stays open
        try:
            tab1.execute("select set_config('request.jwt.claim.sub', %s, false)", (RYAN,))
            tab1.execute("set role authenticated")
            tab1.execute("select id from submit_job(%s, 'contact_sheet', '{}')", (v2,))
            out = {}

            def tab2():
                c = psycopg.connect(credits._server.get_uri(database=self.name), autocommit=True)
                try:
                    c.execute("select set_config('request.jwt.claim.sub', %s, false)", (RYAN,))
                    c.execute("set role authenticated")
                    c.execute("select id from submit_job(%s, 'contact_sheet', '{}')", (v3,))
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
        self.assertTrue(waited, "tab 2 waited for tab 1's open submit")
        self.assertEqual(out.get("result"), "PTQUE", "tab 2 is refused once tab 1's job is in")
        self.assertEqual(self.queued(), 2)

    def scenario_blocked_pair_refused(self):
        vid = self.blocked_version("map")
        self.refused(RYAN, "select id from submit_job(%s, 'contact_sheet', '{}')", vid, words=VIEW_WORDS, code="PTVEW")
        self.refused(RYAN, "select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid, words=VIEW_WORDS, code="PTVEW")
        mixed = self.version("line", "bars", dataset="bls_state_unemployment")             # one good clip, one blocked
        self.refused(RYAN, "select id from submit_job(%s, 'contact_sheet', '{}')", mixed, words=VIEW_WORDS, code="PTVEW")
        self.assertEqual(self.queued(), 0)

    # ---------------------------------------------------------------- QUEUE CAP
    def test_third_queued_job_is_refused_in_plain_words(self):
        self.scenario_third_is_refused()

    def test_running_does_not_count(self):
        v1, v2, v3 = self.version(), self.version(), self.version()
        first = self.submit(v1, "contact_sheet")
        self.submit(v2, "contact_sheet")
        self.assertEqual(self.claim(), first)                       # the worker takes the oldest: claimed, no longer queued
        self.assertEqual(self.queued(), 1)
        self.assertIsNotNone(self.submit(v3, "contact_sheet"))
        self.assertEqual(self.queued(), 2)

    def test_another_owner_is_not_affected(self):
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(), "contact_sheet")
        self.assertIsNotNone(self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER))

    def test_a_finished_or_failed_job_frees_a_place(self):
        v1, v2, v3 = self.version(), self.version(), self.version()
        a = self.submit(v1, "contact_sheet")
        self.submit(v2, "contact_sheet")
        self.settle(a, "failed")
        self.assertIsNotNone(self.submit(v3, "contact_sheet"))

    def test_orders_are_not_capped(self):
        self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER)
        self.submit(self.version(who=OTHER), "contact_sheet", who=OTHER)
        self.assertEqual(self.queued(OTHER), 2)
        oid = self.order("orderkey-a", want="preview", who=OTHER)                 # CC1 10:00: an order is not one of the person's own new jobs
        self.assertIsNotNone(oid)
        self.assertEqual(self.order("orderkey-a", want="preview", who=OTHER), oid, "an idempotent retry returns the same order")
        self.assertEqual(self.queued(OTHER), 3)

    def test_a_full_film_is_not_capped(self):
        self.admin("update ops_settings set auto_render = true returning 1")
        self.grant(100)
        vid = self.version()
        sheet = self.submit(vid, "contact_sheet"); self.settle(sheet, "complete")
        prev = self.submit(vid, "preview"); self.settle(prev, "complete")
        self.submit(self.version(), "contact_sheet")
        self.submit(self.version(), "contact_sheet")
        self.assertIsNotNone(self.submit(vid, "final_render", sheet, prev), "only contact sheets and previews are capped")

    def test_pipe1_is_untouched_and_the_base_out_of_reach(self):
        pipe1 = (core.ROOT / "migrations" / "20261017000600_pipe1_orders.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
        base = self.admin("select prosrc from pg_proc where oid = %s::regprocedure", BASE)
        self.assertIn(PIPE1_FOR_LINE, base, "the base runs pipe1's own submit_job_for text")
        self.assertIn(PIPE1_FOR_LINE, pipe1)
        wrapper = self.admin("select prosrc from pg_proc where oid = %s::regprocedure", WRAPPER)
        self.assertNotIn(PIPE1_FOR_LINE, wrapper, "the wrapper does not copy the body")
        sub = self.admin("select prosrc from pg_proc where oid = %s::regprocedure", SUBMIT)
        self.assertIn(PIPE1_LINE, sub, "public.submit_job is pipe1's own function, untouched")
        self.assertIn("require_active", sub, "with the waiting-account gate still in it")
        for later in ("20261123000200_queue_cap_per_owner.sql", "20261123000300_blocked_story_views.sql"):
            text = (core.ROOT / "migrations" / later).read_text(encoding="utf-8")
            self.assertNotIn(PIPE1_LINE, text, later)
            self.assertNotIn(PIPE1_FOR_LINE, text, later)
            self.assertNotIn("function public.submit_job(", text, f"{later} must not touch public.submit_job")
        for fn in (BASE, WRAPPER):
            for role in ("anon", "authenticated", "service_role"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), f"{role} {fn}")
        self.assertTrue(self.admin("select has_function_privilege('authenticated', %s, 'execute')", SUBMIT))
        self.assertFalse(self.admin("select has_function_privilege('anon', %s, 'execute')", SUBMIT))

    def test_worker_path_is_never_refused(self):
        self.scenario_worker_path_never_refused()

    def test_two_tabs_at_the_same_moment_cannot_both_pass(self):
        self.scenario_two_tabs_at_once()

    def test_the_number_is_the_setting(self):
        self.admin("update ops_settings set queue_cap_per_owner = 3 returning 1")
        for _ in range(3):
            self.submit(self.version(), "contact_sheet")
        self.refused(RYAN, "select id from submit_job(%s, 'contact_sheet', '{}')", self.version(),
                     words="You have 3 films waiting. You can start another when one is done.", code="PTQUE")
        self.assertEqual(self.admin("select column_default from information_schema.columns where table_name = 'ops_settings' "
                                    "and column_name = 'queue_cap_per_owner'"), "2")
        with self.assertRaises(psycopg.Error):                                      # 1 to 50 only
            self.admin("update ops_settings set queue_cap_per_owner = 0 returning 1")

    def test_a_full_film_waiting_for_approval_does_not_count(self):
        self.grant(100)
        vid = self.version()
        sheet = self.submit(vid, "contact_sheet"); self.settle(sheet, "complete")
        prev = self.submit(vid, "preview"); self.settle(prev, "complete")
        self.db.as_(RYAN).one("select * from request_final_render(%s, %s)", prev, "finalkey-1")
        self.assertEqual(self.admin("select count(*) from jobs where owner_id = %s and state = 'awaiting_approval'", RYAN), 1)
        self.submit(self.version(), "contact_sheet")
        self.assertIsNotNone(self.submit(self.version(), "contact_sheet"), "the final awaiting approval is not one of the 2")

    def test_the_wrapper_carries_both_checks(self):
        src = self.admin("select prosrc from pg_proc where oid = %s::regprocedure", WRAPPER)
        self.assertIn("queue_cap_check", src)
        self.assertIn("blocked_view_check", src)
        self.assertIn("p_stage_id is null", src, "only a person's own new job (no order stage)")

    def test_nobody_can_call_the_new_private_functions(self):
        for fn in ("ryagram_private.queue_cap_check(uuid)", "ryagram_private.blocked_view_check(jsonb)",
                   "ryagram_private.blocked_view_in(jsonb)",
                   "ryagram_private.order_submit(uuid, jsonb, text, public.order_want, text, public.order_source)"):
            for role in ("anon", "authenticated", "service_role"):
                self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, fn), f"{role} {fn}")

    # ---------------------------------------------------------------- BLOCKED VIEWS
    def test_blocked_pair_is_refused_for_sheet_and_preview(self):
        self.scenario_blocked_pair_refused()

    def test_same_dataset_in_an_unblocked_view_passes(self):
        self.assertIsNotNone(self.submit(self.blocked_version("line"), "contact_sheet"))
        self.assertIsNotNone(self.submit(self.version("line", dataset="bls_state_unemployment"), "contact_sheet"))

    def test_new_order_with_a_blocked_story_is_refused(self):
        st = credits.story("map", dataset="bps_county_permits")
        self.refused(OTHER, "select id from submit_render_order(%s::jsonb, %s, %s)", st, "orderkey-c", "preview",
                     words=VIEW_WORDS, code="PTVEW")
        self.assertEqual(self.admin("select count(*) from render_orders"), 0)

    def test_a_full_film_is_not_checked_here(self):
        self.admin("update ops_settings set auto_render = true returning 1")
        self.ddl("delete from ryagram_private.blocked_story_views where dataset = 'bps_county_permits' and view = 'map'")
        self.grant(100)
        vid = self.blocked_version("map")
        sheet = self.submit(vid, "contact_sheet"); self.settle(sheet, "complete")
        prev = self.submit(vid, "preview"); self.settle(prev, "complete")
        self.ddl("insert into ryagram_private.blocked_story_views (dataset, view) values ('bps_county_permits', 'map')")
        self.assertIsNotNone(self.submit(vid, "final_render", sheet, prev), "a full film of a finished sheet and preview is not refused")

    def test_the_seed_equals_the_json(self):
        want = json.loads(BLOCK_JSON.read_text(encoding="utf-8"))
        want_pairs = sorted((d, v) for d, views in want.items() for v in views)
        got = sorted(self.db.as_(None).all("select dataset, view from ryagram_private.blocked_story_views"))
        self.assertEqual(got, want_pairs)
        self.assertEqual(len(got), 58, "ENGINE's final v2 (ENGINE 09:55, sha256 c5a11028...)")

    # ---------------------------------------------------------------- ROLLBACKS
    def test_rollbacks_in_order(self):
        with self.assertRaises(psycopg.Error) as cm:                              # 000200's undo first is refused
            self.ddl(RB200.read_text(encoding="utf-8"))
        self.assertIn("Undo 20261123000300 first", str(cm.exception))
        self.db.c.execute("rollback")                                             # the file's own begin is left aborted: end it
        self.assertIsNotNone(self.admin("select to_regprocedure('ryagram_private.order_submit_base(uuid, jsonb, text, public.order_want, text, public.order_source)')"),
                             "the refused undo changed nothing")
        self.ddl(RB300.read_text(encoding="utf-8"))
        self.assertIsNotNone(self.submit(self.blocked_version("map"), "contact_sheet"), "000300 undone: the blocked pair passes")
        self.submit(self.version(), "contact_sheet")
        self.refused(RYAN, "select id from submit_job(%s, 'contact_sheet', '{}')", self.version(), words=CAP_WORDS, code="PTQUE")
        self.ddl(RB200.read_text(encoding="utf-8"))
        self.assertIsNotNone(self.submit(self.version(), "contact_sheet"), "both undone: a third queued job is accepted")
        self.assertEqual(self.queued(), 3)
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.order_submit_base(uuid, jsonb, text, public.order_want, text, public.order_source)')"))
        self.assertIsNone(self.admin("select to_regprocedure(%s)", BASE), "pipe1's function is submit_job_for again")
        src = self.admin("select prosrc from pg_proc where oid = %s::regprocedure", WRAPPER)
        self.assertNotIn("queue_cap_check", src)
        self.assertIn(PIPE1_FOR_LINE, src, "it is pipe1's own body")
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, WRAPPER), role)
        self.assertIn(PIPE1_LINE, self.admin("select prosrc from pg_proc where oid = %s::regprocedure", SUBMIT), "public.submit_job never changed")
        self.assertIsNone(self.admin("select column_name from information_schema.columns where table_name = 'ops_settings' "
                                     "and column_name = 'queue_cap_per_owner'"))

    # ---------------------------------------------------------------- MUST-FAIL: each guard planted out, its scenario must fail
    def must_fail(self, plant_sql, scenario, want_code=None):
        """The scenario must FAIL on the planted database: by an assertion, or (want_code) by exactly that database error, so a
        scenario that merely crashes for another reason does not count as a catch."""
        self.ddl(plant_sql)
        if want_code is None:
            with self.assertRaises(AssertionError):
                scenario()
        else:
            with self.assertRaises(psycopg.Error) as cm:
                scenario()
            self.assertEqual(cm.exception.sqlstate, want_code, str(cm.exception))

    def test_must_fail_without_the_cap(self):
        self.must_fail("create or replace function ryagram_private.queue_cap_check(p_owner uuid) returns void "
                       "language plpgsql set search_path = '' as $$ begin null; end $$", self.scenario_third_is_refused)

    def test_must_fail_with_the_cap_on_order_stages_too(self):
        # the tempting wrong rule: cap every new job in submit_job_for, order stages included (the p_stage_id guard dropped),
        # where an order advances inside the worker's report call
        self.must_fail("create or replace function ryagram_private.submit_job_for(p_owner uuid, p_version_id uuid, p_job_type public.job_type, "
                       "p_params jsonb default '{}'::jsonb, p_sheet_job_id uuid default null, p_preview_job_id uuid default null, "
                       "p_state public.job_state default 'queued', p_stage_id uuid default null) returns public.jobs "
                       "language plpgsql security definer set search_path = '' as $$ begin "
                       "if p_job_type in ('contact_sheet', 'preview') then perform ryagram_private.queue_cap_check(p_owner); end if; "
                       "return ryagram_private.submit_job_for_base(p_owner, p_version_id, p_job_type, p_params, p_sheet_job_id, "
                       "p_preview_job_id, p_state, p_stage_id); end $$",
                       self.scenario_worker_path_never_refused)
        oid = self.admin("select id from render_orders where idempotency_key = 'orderkey-1'")
        self.assertEqual(self.admin("select state::text || '/' || error_code from render_orders where id = %s", oid), "failed/advance_error",
                         "the planted cap ended the stranger's order: the harm this placement avoids")

    def test_must_fail_without_the_lock(self):
        self.must_fail("create or replace function ryagram_private.queue_cap_check(p_owner uuid) returns void "
                       "language plpgsql set search_path = '' as $$ begin "
                       "if (select count(*) from public.jobs j where j.owner_id = p_owner and j.state = 'queued' and j.run_on = 'house' "
                       "and j.job_type in ('contact_sheet', 'preview', 'final_render')) >= 2 then "
                       "raise exception 'You have 2 films waiting. You can start another when one is done.' using errcode = 'PTQUE'; "
                       "end if; end $$", self.scenario_two_tabs_at_once)

    def test_must_fail_without_the_blocked_list(self):
        self.must_fail("delete from ryagram_private.blocked_story_views", self.scenario_blocked_pair_refused)


# ---------------------------------------------------------------- THROUGH THE AI CONNECTOR (GAMES 10:13)
import test_connect as tc  # noqa: E402


class ThroughTheConnector(tc.Connect):
    """An AI's make_contact_sheet is public.connect_submit_job, which calls public.submit_job as the owner: so it meets the wrapper.
    Only this one test runs here (test_connect's own tests are switched off below; they run in test_connect.py)."""

    def test_the_connector_meets_the_cap_and_the_block(self):
        _, a, _ = self.connect(tc.ALICE)
        r = self.runner()
        vids = []
        for i in range(3):
            pid = r.one("select connect_create_project(%s, %s)", tc.h(a), f"film {i}")["id"]
            vid = r.one("select connect_current_version(%s, %s)", tc.h(a), pid)
            r.one("select connect_save_story(%s, %s, %s::jsonb)", tc.h(a), vid, tc.STORY)
            vids.append(vid)
        blocked = json.dumps({"schema": 1, "engine": "sequence", "name": "b",
                              "sequence": {"clips": [{"kind": "render", "dataset": "bps_county_permits", "view": "map"}]}})
        r.one("select connect_save_story(%s, %s, %s::jsonb)", tc.h(a), vids[2], blocked)
        e = self.fails("select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", tc.h(a), vids[2], code="PTVEW")
        self.assertIn(VIEW_WORDS, str(e))
        r.one("select connect_save_story(%s, %s, %s::jsonb)", tc.h(a), vids[2], tc.STORY)
        for vid in vids[:2]:
            self.assertIsNotNone(r.one("select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", tc.h(a), vid))
        e = self.fails("select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", tc.h(a), vids[2], code="PTQUE")
        self.assertIn(CAP_WORDS, str(e))


for _name in dir(tc.Connect):
    if _name.startswith("test"):
        setattr(ThroughTheConnector, _name, None)       # not collected here


if __name__ == "__main__":
    unittest.main()
