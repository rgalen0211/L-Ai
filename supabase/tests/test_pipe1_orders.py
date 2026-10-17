"""PIPE-1 render orders (migrations/20261017000500 + 20261017000600; JOB-CONTRACT-v1, frozen 2026-10-17, sha256 eedfe74a...)
on a local Postgres with the 2B credits ledger, driven through the WORKER's own functions (claim_next_job, report_state,
register_artifact, retry_job) -- contract section 8A, the SQL half (the real PC worker against this SQL is
Ryagram tests/worker_orders.py).

Every scenario asserts the ledger per job: exactly one hold for a paid job, at most one capture, a release exactly when it
did not complete, the balance change = the captured quotes. MUST-FAILs (section 8): each planted fault is built into its
own database and the scenario that guards it must FAIL there.

Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_pipe1_orders.py -v
"""
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
MAP_PRICE = 8                                     # credit_prices 2026-09 final_map
GRANT = 100


def story(name="t", view="map"):
    s = json.loads(credits.story(view))
    s["name"] = name
    return json.dumps(s)


def setUpModule():
    credits.setUpModule()


def regrant_upload_policies(db):
    """The harness applies phase-2b/credits_ledger.sql AFTER every migration, and its 'revoke execute on all functions in
    schema ryagram_private' also takes away 20261004000200's grants that the storage upload policy calls -- so a worker
    upload fails here. Put them back as that migration left them (the live order of application is CC1's to confirm)."""
    db.as_(None).c.execute("grant execute on function ryagram_private.upload_slot_ok(text), "
                           "ryagram_private.worker_may_read_upload(text) to authenticated")


class Orders(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)
        regrant_upload_policies(self.db)
    admin, denied, grant = credits.Ledger.admin, credits.Ledger.denied, credits.Ledger.grant

    # ---------------------------------------------------------------- helpers
    def make_ryan_admin(self):
        self.admin("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin("insert into public.app_admins (user_id, note) values (%s, 'test') returning 1", RYAN)

    def available(self, who=OTHER):
        return self.admin("select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s", who)

    def order(self, key, want="final", who=OTHER, st=None):
        return self.db.as_(who).one("select id from submit_render_order(%s::jsonb, %s, %s)", st or story(), key, want)

    def order_row(self, oid):
        return self.admin("select state::text, error_code from render_orders where id = %s", oid)

    def stages(self, oid):
        return dict(self.db.as_(None).all("select stage::text, state::text from render_stages where order_id = %s", oid))

    def stage_job(self, oid, stage):
        return self.admin("select job_id from render_stages where order_id = %s and stage = %s", oid, stage)

    def claim(self):
        return self.db.as_(WORKER).one("select id from claim_next_job()")

    def work(self, job, kinds):
        return core.Core.run_job(self, job, kinds)

    def work_through_preview(self, oid):
        """The worker takes the sheet and the preview, as it would."""
        sheet = self.claim()
        self.assertEqual(sheet, self.stage_job(oid, "contact_sheet"))
        self.work(sheet, ["contact_sheet"])
        prev = self.claim()
        self.assertEqual(prev, self.stage_job(oid, "preview"))
        self.work(prev, ["preview"])

    def ledger(self, job):
        """(holds, captures, releases, refunds) for one job."""
        return self.admin("select count(*) filter (where entry = 'hold'), count(*) filter (where entry = 'capture'), "
                          "count(*) filter (where entry = 'release'), count(*) filter (where entry = 'refund') "
                          "from credit_ledger where job_id = %s", job)

    def assert_ledger_rules(self, who=OTHER):
        """Contract 8 ledger assertions, for every job of the owner."""
        captured = 0
        for job, state, quoted in self.db.as_(None).all(
                "select id, state::text, coalesce(credits_quoted, 0) from jobs where owner_id = %s", who):
            holds, caps, rels, _ = self.ledger(job)
            self.assertEqual(holds, 1 if quoted > 0 else 0, f"{job} {state}: one hold for a paid job")
            self.assertLessEqual(caps, 1, f"{job}: at most one capture")
            self.assertEqual(rels, 1 if quoted > 0 and state in ("failed", "cancelled", "editorial_action_required") else 0,
                             f"{job} {state}: a release exactly when it did not complete")
            if caps:
                captured += quoted
        self.assertEqual(GRANT - self.available(who), captured, "balance change = captured quotes")

    # ---------------------------------------------------------------- scenarios (also run on the MUST-FAIL databases)
    def scenario_full_run_twice(self):
        """Run 1: auto_render OFF -> held while waiting -> approved -> delivered. Run 2: same key = same order, nothing new;
        a new key runs again and is charged once more."""
        self.make_ryan_admin()
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-run-0001")
        self.assertEqual(self.stages(oid)["validate"], "complete")
        self.work_through_preview(oid)
        final = self.stage_job(oid, "final_render")
        self.assertEqual(self.order_row(oid), ("awaiting_approval", None))
        self.assertEqual(self.admin("select state::text from jobs where id = %s", final), "awaiting_approval")
        self.assertIsNone(self.claim(), "the worker never sees a final waiting for Ryan")
        self.assertEqual(self.ledger(final)[:3], (1, 0, 0), "its credits are HELD while it waits")
        self.assertEqual(self.available(), GRANT - MAP_PRICE)
        queue = self.db.as_(RYAN).all("select stage_id, credits_held from admin_render_queue()")
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0][1], MAP_PRICE)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true, 'ok')", queue[0][0])
        self.assertEqual(self.claim(), final)
        self.work(final, ["final_video", "thumbnail", "receipt"])
        self.assertEqual(self.order_row(oid), ("delivered", None))
        st = self.db.as_(OTHER).one("select render_order_status(%s)", oid)
        self.assertEqual(st["delivery"]["label"], "AI-assisted")
        self.assertTrue(st["delivery"]["link"].startswith("https://uselai.com/app/#/delivery/"))
        self.assertEqual(self.admin("select visibility, (expires_at - created_at) between interval '29 days 23 hours' and interval '30 days 1 hour' "
                                    "from render_deliveries where order_id = %s", oid), ("private", True))
        self.assert_ledger_rules()
        # Run 2: the same key returns the same order; no job, no ledger row
        jobs, rows = self.admin("select count(*) from jobs"), self.admin("select count(*) from credit_ledger")
        self.assertEqual(self.order("film-run-0001"), oid)
        self.assertEqual((self.admin("select count(*) from jobs"), self.admin("select count(*) from credit_ledger")), (jobs, rows))
        # a NEW key runs again and is charged once more
        oid2 = self.order("film-run-0002")
        self.work_through_preview(oid2)
        sid2 = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid2)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true)", sid2)
        f2 = self.claim()
        self.work(f2, ["final_video", "thumbnail", "receipt"])
        self.assertEqual(self.order_row(oid2), ("delivered", None))
        self.assertEqual(self.available(), GRANT - 2 * MAP_PRICE)
        self.assertEqual(self.admin("select count(*) from render_orders where owner_id = %s", OTHER), 2)
        self.assert_ledger_rules()

    def scenario_decline_releases(self):
        self.make_ryan_admin()
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-decl-0001")
        self.work_through_preview(oid)
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.assertEqual(self.available(), GRANT - MAP_PRICE)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, false, 'not this one')", sid)
        self.assertEqual(self.order_row(oid), ("declined", "declined"))
        self.assertEqual(self.available(), GRANT, "released in full on decline")
        self.assert_ledger_rules()

    def scenario_expiry_releases(self):
        self.make_ryan_admin()
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-expi-0001")
        self.work_through_preview(oid)
        self.admin("update render_stages set awaiting_since = now() - interval '8 days' where order_id = %s and stage = 'final_render' returning 1", oid)
        out = self.db.as_("service").one("select render_orders_tick()")
        self.assertEqual(out["approvals_expired"], 1)
        self.assertEqual(self.order_row(oid), ("expired", "approval_expired"))
        self.assertEqual(self.available(), GRANT, "released in full after 7 days")
        self.assert_ledger_rules()

    def scenario_retry_once(self):
        """A crash on attempt 1 is retried; a crash on attempt 2 is the end: failed, released, balance restored."""
        self.make_ryan_admin()
        self.grant(GRANT, who=OTHER)
        self.admin("update ops_settings set auto_render = true returning 1")
        oid = self.order("film-retr-0001")
        self.work_through_preview(oid)
        final = self.stage_job(oid, "final_render")
        w = self.db.as_(WORKER)
        self.assertEqual(self.claim(), final)
        w.one("select report_state(%s, 'running')", final)
        self.assertEqual(w.one("select retry_job(%s, 'crash')", final), "queued")
        self.assertEqual(self.claim(), final)
        w.one("select report_state(%s, 'running')", final)
        self.assertEqual(w.one("select retry_job(%s, 'crash')", final), "failed")
        self.assertIsNone(self.claim(), "no third attempt")
        self.assertEqual(self.admin("select state::text, attempt from jobs where id = %s", final), ("failed", 2))
        self.assertEqual(self.order_row(oid), ("failed", "crash"))
        self.assertEqual(self.available(), GRANT)
        self.assert_ledger_rules()

    # ---------------------------------------------------------------- the scenarios as tests
    def test_full_run_twice(self):
        self.scenario_full_run_twice()

    def test_decline_releases(self):
        self.scenario_decline_releases()

    def test_expiry_releases(self):
        self.scenario_expiry_releases()

    def test_retry_once(self):
        self.scenario_retry_once()

    # ---------------------------------------------------------------- more rules
    def test_owner_cancel_while_waiting_releases(self):
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-canc-0001")
        self.work_through_preview(oid)
        self.assertEqual(self.available(), GRANT - MAP_PRICE)
        self.db.as_(OTHER).one("select state from cancel_render_order(%s)", oid)
        self.assertEqual(self.order_row(oid), ("cancelled", "cancelled"))
        self.assertEqual(self.available(), GRANT)
        self.assert_ledger_rules()

    def test_auto_render_on_does_not_wait(self):
        self.grant(GRANT, who=OTHER)
        self.admin("update ops_settings set auto_render = true returning 1")
        oid = self.order("film-auto-0001")
        self.work_through_preview(oid)
        final = self.claim()
        self.assertEqual(final, self.stage_job(oid, "final_render"))
        self.work(final, ["final_video", "thumbnail", "receipt"])
        self.assertEqual(self.order_row(oid), ("delivered", None))
        self.assert_ledger_rules()

    def test_cap_at_queue_holds_nothing(self):
        self.grant(GRANT, who=OTHER)
        self.admin("insert into user_caps (owner_id, credits_per_day, updated_by) values (%s, 5, %s) returning 1", OTHER, RYAN)
        oid = self.order("film-cap0-0001")
        self.work_through_preview(oid)
        self.assertEqual(self.stages(oid)["final_render"], "capped")
        self.assertEqual(self.order_row(oid), ("failed", "daily_cap"))
        self.assertIsNone(self.stage_job(oid, "final_render"))
        self.assertEqual(self.available(), GRANT, "nothing held over the cap")
        self.assert_ledger_rules()

    def test_cap_at_approval_refuses_and_keeps_holding(self):
        self.make_ryan_admin()
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-cap1-0001")
        self.work_through_preview(oid)
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select admin_set_user_cap(%s, 4)", OTHER)
        with self.assertRaises(psycopg.Error) as e:
            self.db.as_(RYAN).one("select state from admin_render_decide(%s, true)", sid)
        self.assertIn("daily_cap", str(e.exception))
        self.assertEqual(self.stages(oid)["final_render"], "awaiting_approval")
        self.assertEqual(self.available(), GRANT - MAP_PRICE, "still held")
        self.db.as_(RYAN).one("select admin_set_user_cap(%s, null)", OTHER)          # back to the default 20
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true)", sid)
        self.assertEqual(self.claim(), self.stage_job(oid, "final_render"))

    def test_not_enough_credits(self):
        self.grant(3, who=OTHER)
        oid = self.order("film-poor-0001")
        self.work_through_preview(oid)
        self.assertEqual(self.order_row(oid), ("failed", "insufficient_credits"))
        self.assertIsNone(self.stage_job(oid, "final_render"))
        self.assertEqual(self.available(), 3)

    def test_preview_order_ends_previewed(self):
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-prev-0001", want="preview")
        self.work_through_preview(oid)
        self.assertEqual(self.order_row(oid), ("previewed", None))
        self.assertIsNone(self.claim())

    def test_key_rules(self):
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-keys-0001")
        with self.assertRaises(psycopg.Error) as e:
            self.order("film-keys-0001", st=story("another"))
        self.assertIn("key_reused", str(e.exception))
        bad = self.order("film-keys-0002", st='{"schema": 2}')
        self.assertEqual(self.order_row(bad), ("failed", "invalid_story"))
        self.assertEqual(self.order("film-keys-0002", st='{"schema": 2}'), bad, "a failed order's key is spent: same order back")
        self.denied(OTHER, "select id from submit_render_order('{}'::jsonb, 'short', 'final')")
        self.assertNotEqual(oid, bad)

    def test_source_is_set_by_the_server(self):
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-srce-0001")
        self.assertEqual(self.admin("select source::text from render_orders where id = %s", oid), "app")
        # no caller-supplied source anywhere
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = 'submit_render_order' and 'p_source' = any(proargnames)"), 0)
        # CONNECT's wrapper path: the internal function with 'connect'
        cid = self.admin("select id from ryagram_private.order_submit(%s, %s::jsonb, 'film-srce-0002', 'final', null, 'connect')", OTHER, story())
        self.assertEqual(self.admin("select source::text from render_orders where id = %s", cid), "connect")
        # an app-session function refuses a CONNECT OAuth token (it carries client_id)
        d = self.db.as_(OTHER)
        d.c.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": OTHER, "client_id": "chatgpt"}),))
        for sql in ("select id from submit_render_order(%s::jsonb, 'film-srce-0003', 'final')",
                    "select render_order_status(%s)", "select id from cancel_render_order(%s)"):
            with self.subTest(sql=sql):
                with self.assertRaises(psycopg.Error):
                    d.one(sql, story() if "submit" in sql else oid)
        d.c.execute("select set_config('request.jwt.claims', '', false)")

    def test_request_final_adopts_a_finished_sheet_and_preview(self):
        self.grant(GRANT, who=OTHER)
        vid = credits.Ledger.version(self, "map", who=OTHER)
        sheet = credits.Ledger.submit(self, vid, "contact_sheet", who=OTHER)
        self.assertEqual(self.claim(), sheet)
        self.work(sheet, ["contact_sheet"])
        prev = credits.Ledger.submit(self, vid, "preview", who=OTHER)
        self.assertEqual(self.claim(), prev)
        self.work(prev, ["preview"])
        oid = self.db.as_(OTHER).one("select id from request_final_render(%s, 'film-adopt-001')", prev)
        self.assertEqual(self.order_row(oid), ("awaiting_approval", None))
        self.assertEqual(self.available(), GRANT - MAP_PRICE)
        self.assertEqual(self.db.as_(OTHER).one("select id from request_final_render(%s, 'film-adopt-001')", prev), oid)
        self.denied(OTHER, "select id from request_final_render(%s, 'film-adopt-002')", prev)   # one request per preview

    def test_delivery_object_owner_only_and_expiry_deletes(self):
        self.grant(GRANT, who=OTHER)
        self.admin("update ops_settings set auto_render = true returning 1")
        oid = self.order("film-dlvr-0001")
        self.work_through_preview(oid)
        self.work(self.claim(), ["final_video", "thumbnail", "receipt"])
        did = self.admin("select id from render_deliveries where order_id = %s", oid)
        svc = self.db.as_("service")
        self.assertTrue(svc.one("select delivery_object_for(%s, %s)", OTHER, did).startswith(OTHER))
        self.denied("service", "select delivery_object_for(%s, %s)", RYAN, did)                 # not the owner
        self.denied(OTHER, "select delivery_object_for(%s, %s)", OTHER, did)                    # not callable by a person
        self.admin("update render_deliveries set expires_at = now() - interval '1 minute' where id = %s returning 1", did)
        out = svc.one("select render_orders_tick()")
        self.assertEqual(len(out["delete_objects"]), 1)
        self.assertEqual(self.order_row(oid), ("expired", "delivery_expired"))
        self.denied("service", "select delivery_object_for(%s, %s)", OTHER, did)

    def test_admin_functions_refuse_non_admins_and_connect_tokens(self):
        self.make_ryan_admin()
        for sql in ("select admin_set_auto_render(true)", "select count(*) from admin_render_queue()",
                    "select count(*) from admin_user_caps()"):
            with self.subTest(sql=sql):
                self.denied(OTHER, sql)
        d = self.db.as_(RYAN)
        d.c.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": RYAN, "client_id": "claude"}),))
        with self.assertRaises(psycopg.Error):
            d.one("select admin_set_auto_render(true)")
        d.c.execute("select set_config('request.jwt.claims', '', false)")
        self.assertTrue(self.db.as_(RYAN).one("select admin_set_auto_render(true)"))
        self.assertIn("orders", self.db.as_(RYAN).one("select admin_ops()"))

    def test_worker_disk_floor_note_and_lease_unchanged(self):
        # the lease is still 2 minutes (contract 4: unchanged)
        self.grant(GRANT, who=OTHER)
        oid = self.order("film-leas-0001")
        sheet = self.claim()
        self.assertEqual(sheet, self.stage_job(oid, "contact_sheet"))
        secs = self.admin("select extract(epoch from lease_expires_at - claimed_at) from jobs where id = %s", sheet)
        self.assertAlmostEqual(float(secs), 120, delta=2)


# ---------------------------------------------------------------- MUST-FAILs (contract 8)

MIGRATION = core.ROOT / "migrations" / "20261017000600_pipe1_orders.sql"
MUTANTS = {
    # name: (file, [(before, after), ...], the scenario that must catch it) -- each fault planted IN FULL, as the contract
    # names it, so the scenario's own assertion catches it (an SQL error during setup does not count; see below)
    "idempotency_key_not_unique": (MIGRATION, [
        ("  unique (owner_id, idempotency_key)                -- a key is spent for good, whatever happens to its order\n);",
         "  check (true)\n);"),
        ("    return o;                                          -- whatever its state: no new rows, no new holds\n  end if;",
         "  end if;\n  if false then return o; end if;"),
        # the stage rows' own unique (owner_id, '<key>:<stage>') is a second barrier: planted out too (found 2026-10-17)
        ("  unique (order_id, stage), unique (owner_id, idempotency_key)", "  unique (order_id, stage)")], "scenario_full_run_twice"),
    "attempts_back_to_three": (MIGRATION, [
        ("check (attempt between 1 and 2) not valid;", "check (attempt between 1 and 3) not valid;"),
        ("      state = case when j.attempt < 2 then", "      state = case when j.attempt < 3 then"),
        ("      attempt = least(j.attempt + 1, 2),", "      attempt = least(j.attempt + 1, 3),"),
        ("      ended_at = case when j.attempt >= 2 then now() end,", "      ended_at = case when j.attempt >= 3 then now() end,"),
        ("      queued_at = case when j.attempt < 2 then now() else j.queued_at end", "      queued_at = case when j.attempt < 3 then now() else j.queued_at end")],
        "scenario_retry_once"),
    "release_trigger_dropped": (credits.LEDGER, [
        ("create trigger jobs_settle after update of state on public.jobs\n  for each row execute function ryagram_private.jobs_settle();",
         "")], "scenario_decline_releases"),
    "hold_at_queue_removed": (credits.LEDGER, [
        ("  if coalesce(need, 0) = 0 then\n    return null;\n  end if;",
         "  if coalesce(need, 0) = 0 or new.state = 'awaiting_approval' then\n    return null;\n  end if;")], "scenario_full_run_twice"),
    "expiry_skipped": (MIGRATION, [
        ("awaiting_since < now() - make_interval(days => n_days)", "awaiting_since < now() - make_interval(days => n_days) and false")],
        "scenario_expiry_releases"),
}


class MustFail(unittest.TestCase):
    """Each planted fault is built into its own database; the scenario guarding it must FAIL there."""

    def test_each_planted_fault_is_caught(self):
        for name, (path, edits, scenario) in MUTANTS.items():
            with self.subTest(mutant=name):
                text = path.read_text(encoding="utf-8")
                for before, _after in edits:
                    self.assertEqual(text.count(before), 1, f"{name}: the planted text must match exactly once: {before[:60]}")
                db = "mut_" + name[:40]
                with psycopg.connect(credits._server.get_uri(), autocommit=True) as c:
                    c.execute(f"drop database if exists {db}")
                    c.execute(f"create database {db}")
                with psycopg.connect(credits._server.get_uri(database=db), autocommit=True) as c:
                    c.execute((core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").replace(
                        "create role anon nologin;\ncreate role authenticated nologin;\ncreate role service_role nologin bypassrls;\n", ""))
                    for p in [*core.MIGRATIONS, credits.LEDGER]:
                        t = p.read_text(encoding="utf-8")
                        if p == path:
                            for before, after in edits:
                                t = t.replace(before, after)
                        c.execute(t)
                    c.execute("insert into auth.users (id, email) values (%s,'ryan@x'),(%s,'other@x'),(%s,'worker@x'),(%s,'worker2@x')",
                              (RYAN, OTHER, WORKER, core.WORKER2))
                    c.execute("insert into public.workers (user_id, name) values (%s, 'ryan-pc'), (%s, 'spare')", (WORKER, core.WORKER2))
                    c.execute("insert into public.credit_dataset_shapes (dataset, shape, noted_by) values "
                              "('test_standard', 'standard', 'test'), ('test_path', 'path', 'test'), ('test_flows', 'flows', 'test')")
                t = Orders(scenario)
                t.db = core.Db(credits._server.get_uri(database=db))
                regrant_upload_policies(t.db)
                caught = None
                try:
                    getattr(t, scenario)()
                except AssertionError as e:          # caught by the scenario's own check: what the MUST-FAIL means
                    caught = str(e).splitlines()[0][:160]
                except psycopg.Error as e:           # an SQL error is NOT the scenario catching the fault
                    caught = None
                    self.fail(f"MUST-FAIL {name}: stopped by an SQL error, not by {scenario}'s assertion: {e}")
                finally:
                    t.db.c.close()
                    with psycopg.connect(credits._server.get_uri(), autocommit=True) as c:
                        c.execute(f"drop database {db}")
                self.assertTrue(caught, f"MUST-FAIL {name}: {scenario} passed with the fault planted")
                print(f"\n  MUST-FAIL {name}: caught by {scenario}: {caught}")
