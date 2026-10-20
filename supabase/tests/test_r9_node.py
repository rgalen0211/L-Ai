"""r9 M3 DRAFT (supabase/r9-drafts/r9_node_draft.sql) on a local Postgres, with the credits ledger: the tester flag, where a
job runs, the house worker's claim and the render node. The draft is NEVER applied to live; this suite is how it is reviewed.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_r9_node.py -v

The MUST-FAILS of proposals/R9-REAL-PRODUCT-PLAN.md section 9, items 1 to 4, come first in each class.
"""
import hashlib
import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

import pgserver
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

ROOT = core.ROOT
LEDGER = ROOT / "phase-2b" / "credits_ledger.sql"
DRAFT = Path(os.environ.get("R9_DRAFT_SQL") or ROOT / "r9-drafts" / "r9_node_draft.sql")   # a mutant copy, for the must-fail probe
RYAN, OTHER, WORKER, WORKER2 = core.RYAN, core.OTHER, core.WORKER, core.WORKER2
SAM, BOB, ADMIN = (str(uuid.UUID(int=i)) for i in (201, 202, 203))
_server = None
_count = 0


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def story(*views):
    return json.dumps({"schema": 1, "engine": "sequence", "name": "t",
                       "sequence": {"clips": [{"kind": "render", "view": v, "dataset": "test_standard"} for v in views]}})


def setUpModule():
    global _server
    _server = pgserver.get_server(tempfile.mkdtemp(prefix="ryagram-pg-r9-"), cleanup_mode="stop")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmplr9")
        c.execute("drop database if exists tmplr9base")
        c.execute("create database tmplr9base")
    with psycopg.connect(_server.get_uri(database="tmplr9base"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in [*core.MIGRATIONS, LEDGER]:
            c.execute(path.read_text(encoding="utf-8"))
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database tmplr9 template tmplr9base")
    with psycopg.connect(_server.get_uri(database="tmplr9"), autocommit=True) as c:
        c.execute(DRAFT.read_text(encoding="utf-8"))
        c.execute("insert into auth.users (id, email) values (%s,'ryan@x'),(%s,'other@x'),(%s,'worker@x'),(%s,'worker2@x'),"
                  "(%s,'sam@x'),(%s,'bob@x'),(%s,'admin@x')", (RYAN, OTHER, WORKER, WORKER2, SAM, BOB, ADMIN))
        c.execute("insert into public.workers (user_id, name) values (%s, 'ryan-pc'), (%s, 'spare')", (WORKER, WORKER2))
        c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        c.execute("update public.ops_settings set auto_render = true, default_credits_per_day = 100000")
        c.execute("insert into public.credit_dataset_shapes (dataset, shape, noted_by) values ('test_standard', 'standard', 'test')")


def tearDownModule():
    if _server:
        _server.cleanup()


class R9(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database r9t{_count} template tmplr9")
        self.db = core.Db(_server.get_uri(database=f"r9t{_count}"))
        self.n = 0

    def tearDown(self):
        self.db.c.close()

    # -- helpers ------------------------------------------------------------------------------------------------
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def denied(self, who, sql, *args):
        with self.assertRaises(psycopg.Error):
            self.db.as_(who).one(sql, *args)

    def runner(self):
        self.db.c.execute("reset role")
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
        self.db.c.execute("set role node_runner")
        return self.db

    def runner_denied(self, sql, *args):
        with self.assertRaises(psycopg.Error):
            self.runner().one(sql, *args)

    def make_tester(self, who=SAM, on=True):
        return self.db.as_(ADMIN).one("select admin_set_local_compute(%s, %s, 'r9 tester')", who, on)

    def grant(self, n, who):
        self.db.as_("service").one("select grant_credits(%s, 'grant', %s, 'test grant', 'admin:test', null, null, null)", who, n)

    def version(self, who, *views):
        d = self.db.as_(who)
        pid = d.one("insert into projects (title) values ('p') returning id")
        vid = d.one("select id from create_version(%s)", pid)
        d.one("update versions set story_spec = %s::jsonb where id = %s returning id", story(*(views or ("map",))), vid)
        return vid

    def submit(self, who, vid, kind, *ladder):
        params = '{"window_s": [0, 10]}' if kind == "preview" else "{}"
        if ladder:
            return self.db.as_(who).one("select id from submit_job(%s, %s, %s, %s, %s)", vid, kind, params, *ladder)
        return self.db.as_(who).one("select id from submit_job(%s, %s, %s)", vid, kind, params)

    def settle(self, job):
        self.admin("update jobs set state = 'complete', ended_at = now(), engine_commit = 'abc1234' where id = %s returning 1", job)

    def final(self, who):
        vid = self.version(who, "paired")
        sheet = self.submit(who, vid, "contact_sheet"); self.settle(sheet)
        prev = self.submit(who, vid, "preview"); self.settle(prev)
        return self.submit(who, vid, "final_render", sheet, prev)

    def node(self, who=SAM, name="Sam-PC"):
        """The device-code sign-in: the node asks, the person approves in the app, the node exchanges ONCE. Returns the token."""
        self.n += 1
        code, user_code, token = f"dev{self.n}-{uuid.uuid4().hex}", "ABCD-EF" + "23456789"[self.n % 8] + "H", f"tok{self.n}-{uuid.uuid4().hex}"
        self.runner().one("select node_device_begin(%s, %s, %s)", h(code), user_code, name)
        self.db.as_(who).one("select device_decide(%s, true)", user_code)
        self.runner().one("select node_device_exchange(%s, %s)", h(code), h(token))
        return token

    def claim_node(self, token):
        return self.runner().one("select id from node_claim(%s)", h(token))

    def claim_house(self, worker=WORKER):
        return self.db.as_(worker).one("select id from claim_next_job()")


class Flag(R9):
    # MUST-FAIL 1: the flag is the server's, set by an admin only, every change audited
    def test_a_person_cannot_set_their_own_flag(self):
        self.denied(SAM, "insert into account_settings (owner_id, local_compute) values (%s, true) returning 1", SAM)
        self.db.as_(SAM).one("insert into account_settings (upload_retention) values ('keep') returning 1")
        self.denied(SAM, "update account_settings set local_compute = true where owner_id = %s returning 1", SAM)
        self.assertFalse(self.admin("select local_compute from account_settings where owner_id = %s", SAM))

    def test_a_non_admin_cannot_set_any_flag(self):
        for who in (SAM, BOB, RYAN):
            self.denied(who, "select admin_set_local_compute(%s, true, 'please')", SAM)
        self.runner_denied("select admin_set_local_compute(%s, true, 'please')", SAM)
        self.assertEqual(self.admin("select count(*) from local_compute_audit"), 0)

    def test_every_change_leaves_an_audit_row(self):
        self.make_tester(SAM, True)
        self.make_tester(SAM, False)
        self.assertEqual(self.admin("select array_agg(turned_on order by id) from local_compute_audit where user_id = %s", SAM),
                         [True, False])
        self.assertEqual(self.admin("select set_by from local_compute_audit limit 1"), uuid.UUID(ADMIN))

    def test_a_worker_account_cannot_be_a_tester(self):
        self.denied(ADMIN, "select admin_set_local_compute(%s, true, 'no')", WORKER)

    def test_the_audit_is_not_readable_from_the_api(self):
        self.make_tester()
        for who in (SAM, "anon"):
            self.denied(who, "select count(*) from local_compute_audit")


class Place(R9):
    # MUST-FAIL 2: a job's place is fixed when it is ordered; a local job is never charged
    def test_a_testers_final_costs_nothing_and_holds_nothing(self):
        self.make_tester()
        self.grant(100, SAM)
        job = self.final(SAM)
        self.assertEqual(self.admin("select run_on::text, credits_quoted, hold_id from jobs where id = %s", job), ("owner_local", 0, None))
        self.assertEqual(self.admin("select count(*) from credit_ledger where job_id = %s", job), 0)
        self.assertEqual(self.admin("select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s", SAM), 100)

    def test_control_the_same_final_costs_ten_in_the_house(self):
        self.grant(100, BOB)
        job = self.final(BOB)
        self.assertEqual(self.admin("select run_on::text, credits_quoted from jobs where id = %s", job), ("house", 10))
        self.assertEqual(self.admin("select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s", BOB), 90)

    def test_a_house_job_cannot_become_local_after_its_hold(self):
        self.grant(100, BOB)
        job = self.final(BOB)
        self.make_tester(BOB)                                   # the flag turned on AFTER the order changes nothing
        self.assertEqual(self.admin("select run_on::text from jobs where id = %s", job), "house")
        with self.assertRaises(psycopg.Error):
            self.admin("update jobs set run_on = 'owner_local' where id = %s returning 1", job)
        self.assertEqual(self.admin("select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s", BOB), 90)

    def test_a_local_job_cannot_be_moved_to_the_house(self):
        # isolates the place rule: a FREE local job moved to the house would not trip the 'never charged' check
        self.make_tester()
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        with self.assertRaises(psycopg.Error):
            self.admin("update jobs set run_on = 'house' where id = %s returning 1", job)
        self.assertEqual(self.admin("select run_on::text from jobs where id = %s", job), "owner_local")

    def test_a_local_job_cannot_be_charged_later(self):
        self.make_tester()
        job = self.final(SAM)
        with self.assertRaises(psycopg.Error):
            self.admin("update jobs set credits_quoted = 5 where id = %s returning 1", job)

    def test_the_client_cannot_choose_the_place(self):
        vid = self.version(BOB)
        self.denied(BOB, "insert into jobs (owner_id, project_id, version_id, job_type, story, run_on) "
                         "select %s, project_id, id, 'contact_sheet', story_spec, 'owner_local' from versions where id = %s returning 1",
                    BOB, vid)


class House(R9):
    # MUST-FAIL 3: the house worker never takes a tester's job; a lost local job goes back to its owner only
    def test_house_skips_a_local_job_queued_first(self):
        self.make_tester()
        local = self.submit(SAM, self.version(SAM), "contact_sheet")
        house = self.submit(BOB, self.version(BOB), "contact_sheet")
        self.assertEqual(self.claim_house(), house)
        self.assertIsNone(self.claim_house(WORKER2))
        self.assertEqual(self.admin("select state::text from jobs where id = %s", local), "queued")

    def test_a_lost_local_job_requeues_to_its_owner_only(self):
        self.make_tester()
        tok = self.node()
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        self.assertEqual(self.claim_node(tok), job)
        self.admin("update jobs set lease_expires_at = now() - interval '1 minute' where id = %s returning 1", job)
        self.assertIsNone(self.claim_house())              # the house reaps it, and does not take it
        self.assertEqual(self.admin("select state::text, run_on::text, attempt from jobs where id = %s", job), ("queued", "owner_local", 2))
        self.assertEqual(self.claim_node(tok), job)

    def test_the_house_claim_refuses_inside_a_node_call(self):
        self.make_tester()
        tok = self.node()
        self.db.c.execute("reset role")
        self.db.c.execute("set role node_runner")
        with self.assertRaises(psycopg.Error):
            with self.db.c.transaction():
                self.db.c.execute("select node_claim(%s)", (h(tok),))
                self.db.c.execute("select ryagram_private.in_node_tx()")   # node_runner may not even look
        self.db.c.execute("reset role")
        with self.assertRaises(psycopg.Error):
            with self.db.c.transaction():
                self.db.c.execute("select ryagram_private.node_actor(%s)", (h(tok),))
                self.db.c.execute("select * from public.claim_next_job()")


class Node(R9):
    # MUST-FAIL 4: a node acts only for its own person, on that person's local jobs
    def test_a_node_cannot_claim_another_persons_job(self):
        self.make_tester(SAM); self.make_tester(BOB)
        sams = self.submit(SAM, self.version(SAM), "contact_sheet")
        bob_tok = self.node(BOB, "Bob-PC")
        self.assertIsNone(self.claim_node(bob_tok))
        self.assertEqual(self.admin("select state::text from jobs where id = %s", sams), "queued")

    def test_a_node_cannot_claim_a_house_job(self):
        self.make_tester(SAM)
        house = self.submit(BOB, self.version(BOB), "contact_sheet")
        self.assertIsNone(self.claim_node(self.node()))
        self.assertEqual(self.admin("select state::text from jobs where id = %s", house), "queued")

    def test_a_node_cannot_act_on_a_job_it_does_not_hold(self):
        self.make_tester(SAM); self.make_tester(BOB)
        sam_tok, bob_tok = self.node(SAM), self.node(BOB, "Bob-PC")
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        self.assertEqual(self.claim_node(sam_tok), job)
        self.runner_denied("select node_register_artifact(%s, %s, 'contact_sheet', 100, %s)", h(bob_tok), job, "a" * 64)
        self.runner_denied("select node_heartbeat(%s, %s, 0.5)", h(bob_tok), job)
        self.runner_denied("select state from node_report_state(%s, %s, 'running')", h(bob_tok), job)

    def test_a_worker_login_cannot_use_the_node_api(self):
        self.denied(WORKER, "select id from node_claim(%s)", h("anything"))
        self.denied(WORKER, "select device_decide('ABCD-EF99', true)")
        self.runner().one("select node_device_begin(%s, 'WKWK-WKWK', 'Worker-PC')", h("wcode"))
        self.denied(WORKER, "select device_decide('WKWK-WKWK', true)")

    def test_a_node_without_the_flag_cannot_claim(self):
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        tok = self.node()
        self.runner_denied("select id from node_claim(%s)", h(tok))
        self.assertEqual(self.admin("select run_on::text from jobs where id = %s", job), "house")

    def test_the_runner_has_no_table_access(self):
        for t in ("jobs", "node_tokens", "device_codes", "account_settings", "local_compute_audit", "ryagram_private.node_tx"):
            self.runner_denied(f"select count(*) from {t}")

    def test_a_removed_or_expired_computer_is_refused(self):
        self.make_tester()
        tok = self.node()
        tid = self.db.as_(SAM).one("select id from my_computers()")
        self.assertTrue(self.db.as_(SAM).one("select remove_computer(%s)", tid))
        self.runner_denied("select id from node_claim(%s)", h(tok))
        tok2 = self.node(SAM, "Sam-PC2")
        self.admin("update node_tokens set expires_at = now() - interval '1 second' where token_hash = %s returning 1", h(tok2))
        self.runner_denied("select id from node_claim(%s)", h(tok2))

    def exchange(self, code, token):
        return self.runner().one("select node_device_exchange(%s, %s) ->> 'state'", h(code), h(token))

    def allow_poll(self, code):
        self.admin("update device_codes set next_poll_at = now() where device_hash = %s returning 1", h(code))

    def test_a_device_code_is_exchanged_once(self):
        self.runner().one("select node_device_begin(%s, 'XYZW-QRST', 'Sam-PC')", h("c1"))
        self.assertEqual(self.exchange("c1", "t1"), "authorization_pending")                 # not approved yet
        self.assertEqual(self.exchange("c1", "t1"), "slow_down")                             # polled too fast
        self.db.as_(SAM).one("select device_decide('XYZW-QRST', true)")
        self.allow_poll("c1")
        self.assertEqual(self.exchange("c1", "t1"), "ok")
        self.allow_poll("c1")
        self.assertEqual(self.exchange("c1", "t2"), "expired_token")                         # replay
        self.assertEqual(self.admin("select count(*) from node_tokens"), 1)

    def test_a_denied_code_can_never_be_approved_and_looking_never_approves(self):
        self.runner().one("select node_device_begin(%s, 'DENY-DENY', 'Odd-PC')", h("d1"))
        self.assertEqual(self.db.as_(SAM).one("select device_request_check('deny-deny') ->> 'computer_name'"), "Odd-PC")
        self.assertEqual(self.exchange("d1", "t1"), "authorization_pending")                # looking approved nothing
        self.db.as_(SAM).one("select device_decide('DENY-DENY', false)")
        self.denied(SAM, "select device_decide('DENY-DENY', true)")
        self.allow_poll("d1")
        try:
            got = self.exchange("d1", "t1")
        except psycopg.Error as e:                           # a raise is not the promised answer either
            got = f"error {e.sqlstate}"
        self.assertEqual(got, "access_denied")
        self.assertEqual(self.admin("select count(*) from node_tokens"), 0)

    def test_a_code_with_look_alike_characters_is_refused(self):
        for bad in ("AB0D-EFGH", "ABOD-EFGH", "AB1D-EFGH", "ABID-EFGH", "ABLD-EFGH"):
            self.runner_denied("select node_device_begin(%s, %s, 'X')", h(bad), bad)

    # CC1 13:48, the device page's promises enforced in SQL
    def test_deciding_an_expired_or_used_code_is_refused(self):
        self.runner().one("select node_device_begin(%s, 'EXPD-EXPD', 'X')", h("e1"))
        self.admin("update device_codes set expires_at = now() - interval '1 second' where user_code = 'EXPD-EXPD' returning 1")
        self.denied(SAM, "select device_decide('EXPD-EXPD', true)")
        self.assertEqual(self.db.as_(SAM).one("select device_request_check('EXPD-EXPD') ->> 'state'"), "expired")
        self.node()                                          # approves and exchanges code number 1
        used = self.admin("select user_code from device_codes where state = 'used' limit 1")
        self.denied(SAM, "select device_decide(%s, true)", used)
        self.assertEqual(self.db.as_(SAM).one("select device_request_check(%s) ->> 'state'", used), "used")
        self.assertEqual(self.db.as_(SAM).one("select device_request_check('ZZZZ-ZZZZ') ->> 'state'"), "unknown")

    def test_checking_a_code_changes_nothing(self):
        self.runner().one("select node_device_begin(%s, 'KMKM-KMKM', 'X')", h("l1"))
        before = self.admin("select row_to_json(d)::text from device_codes d where user_code = 'KMKM-KMKM'")
        for _ in range(3):
            self.db.as_(SAM).one("select device_request_check('KMKM-KMKM')")
        self.assertEqual(self.admin("select row_to_json(d)::text from device_codes d where user_code = 'KMKM-KMKM'"), before)

    def test_deciding_needs_an_app_session(self):
        self.runner().one("select node_device_begin(%s, 'APPS-APPS', 'X')", h("a1"))
        self.db.as_(SAM)
        self.db.c.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": SAM, "client_id": "some-ai"}),))
        with self.assertRaises(psycopg.Error):
            self.db.one("select device_decide('APPS-APPS', true)")
        self.runner_denied("select device_decide('APPS-APPS', true)")       # a node cannot approve itself

    def test_the_node_role_reaches_no_credits_orders_or_ledger(self):
        for t in ("credit_ledger", "render_orders", "projects", "versions", "artifacts"):
            self.runner_denied(f"select count(*) from {t}")
        self.runner_denied("select grant_credits(%s, 'grant', 5, 'x', 'me', null, null, null)", SAM)
        self.runner_denied("select submit_job(gen_random_uuid(), 'contact_sheet', '{}')")

    def test_a_token_lives_thirty_days(self):
        self.make_tester()
        tok = self.node()
        days = self.admin("select extract(day from expires_at - created_at) from node_tokens where token_hash = %s", h(tok))
        self.assertEqual(int(days), 30)

    def test_the_usage_readout_is_admin_only_and_counts_local_outputs(self):
        self.denied(SAM, "select admin_storage_usage()")
        self.runner_denied("select admin_storage_usage()")
        u = self.db.as_(ADMIN).one("select admin_storage_usage()")
        self.assertGreater(u["database_bytes"], 0)
        self.assertEqual(u["local_jobs_outputs_bytes"], 0)

    # the positive path: the worker's own state machine, run by a node
    def test_a_node_runs_its_own_job_to_complete(self):
        self.make_tester()
        tok = self.node()
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        self.assertEqual(self.claim_node(tok), job)
        r = self.runner()
        self.assertIs(r.one("select node_heartbeat(%s, %s, 0.1)", h(tok), job), False)   # false = no cancel asked
        self.assertEqual(float(self.admin("select progress from jobs where id = %s", job)), 0.1)
        r = self.runner()
        for st in ("running", "validating", "uploading"):
            r.one("select state from node_report_state(%s, %s, %s, p_engine_commit => 'abc1234', p_engine_dirty => false)",
                  h(tok), job, st)
        path = r.one("select node_register_artifact(%s, %s, 'contact_sheet', 100, %s)", h(tok), job, "a" * 64)
        self.assertIn(SAM, path)
        self.admin("insert into storage.objects (bucket_id, name, metadata) values ('ryagram-artifacts', %s, "
                   "jsonb_build_object('size', 100, 'mimetype', 'image/png')) returning name", path)
        self.admin("update jobs set worker_user_id = worker_user_id where id = %s returning 1", job)
        self.assertEqual(self.admin("select worker_id, worker_user_id from jobs where id = %s", job), ("node", uuid.UUID(SAM)))

class Review1411(R9):
    # MED-1: the node role's WHOLE reach, from the catalogs
    NODE_FNS = sorted(["public.node_account(text)", "public.node_claim(text)", "public.node_device_begin(text,text,text)",
                       "public.node_device_exchange(text,text)", "public.node_heartbeat(text,uuid,numeric,text,jsonb)",
                       "public.node_register_artifact(text,uuid,artifact_kind,bigint,text,numeric,integer,integer)",
                       "public.node_report_state(text,uuid,job_state,text,text,text,boolean)",
                       "public.node_retry(text,uuid,text,text)", "public.node_signout(text)"])

    def callable_by_runner(self):
        rows = self.db.as_(None).all("""select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where p.prokind in ('f', 'p') and has_schema_privilege('node_runner', n.oid, 'USAGE')
                      and has_function_privilege('node_runner', p.oid, 'EXECUTE')
                      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
                      and n.nspname not in ('pg_catalog', 'information_schema')""")
        return sorted((r[0] if "." in r[0].split("(")[0] else "public." + r[0]).replace(" ", "") for r in rows)

    def test_node_runner_can_call_exactly_the_node_functions(self):
        self.assertEqual(self.callable_by_runner(), self.NODE_FNS)
        usage = [r[0] for r in self.db.as_(None).all("select nspname from pg_namespace n where has_schema_privilege('node_runner', n.oid, "
                                                    "'USAGE') and left(nspname, 3) <> 'pg_' and nspname <> 'information_schema'")]
        self.assertEqual(usage, ["public"])

    def test_must_fail_one_more_grant_is_seen(self):
        self.db.as_(None).c.execute("grant execute on function public.my_computers() to node_runner")
        self.assertNotEqual(self.callable_by_runner(), self.NODE_FNS)

    # MED-2: the two copies of live functions must not drift from the live text
    def defs(self, db, fn):
        with psycopg.connect(_server.get_uri(database=db), autocommit=True) as c:
            return c.execute("select pg_get_functiondef(%s::regprocedure)", (fn,)).fetchone()[0]

    def test_the_copied_functions_equal_live_minus_the_marked_lines(self):
        for fn in ("public.claim_next_job()", "ryagram_private.require_worker()"):
            live, draft = self.defs("tmplr9base", fn), self.defs("tmplr9", fn)
            stripped = "\n".join(l for l in draft.split("\n") if not l.rstrip().endswith("-- WORKER r9"))
            self.assertNotEqual(live, draft, fn)
            self.assertEqual(stripped, live, f"{fn}: the draft's copy has drifted from the live function")

    # MED-3: unauthenticated spam has a backstop, and old rows are swept
    def test_codes_stop_at_500_waiting(self):
        self.admin("insert into device_codes (device_hash, user_code, computer_name) select md5(i::text) || md5(i::text || 'x'), "
                   "'K' || lpad(to_hex(i), 3, 'A') || '-ZZZZ', 'x' from generate_series(1, 500) i "
                   "where lpad(to_hex(i), 3, 'A') ~ '^[A-HJKMNP-Z2-9]{3}$' returning 1")
        n = self.admin("select count(*) from device_codes")
        self.admin("insert into device_codes (device_hash, user_code, computer_name) select md5(i::text || 'y') || md5(i::text || 'z'), "
                   "'P' || lpad(to_hex(i), 3, 'A') || '-ZZZZ', 'x' from generate_series(1, 4095) i "
                   "where lpad(to_hex(i), 3, 'A') ~ '^[A-HJKMNP-Z2-9]{3}$' limit %s returning 1", 500 - n)
        self.assertEqual(self.admin("select count(*) from device_codes"), 500)
        self.runner_denied("select node_device_begin(%s, 'NEWW-NEWW', 'X')", h("over"))

    def test_the_sweep_clears_old_codes_and_finished_node_rows(self):
        self.make_tester()
        tok = self.node()
        for _ in range(3):
            self.claim_node(tok)
        self.admin("update device_codes set expires_at = now() - interval '2 days' returning 1")
        self.runner().one("select node_device_begin(%s, 'SWPS-SWPS', 'X')", h("sweep"))   # begin runs the sweep
        self.assertEqual(self.admin("select count(*) from device_codes"), 1)
        self.assertEqual(self.admin("select count(*) from ryagram_private.node_tx"), 0)

    # MED-4: the computer learns WHICH account it joined (masked)
    def test_the_exchange_and_account_show_the_masked_account(self):
        self.make_tester()
        self.runner().one("select node_device_begin(%s, 'WHWH-WHWH', 'Sam-PC')", h("w1"))
        self.db.as_(SAM).one("select device_decide('WHWH-WHWH', true)")
        got = self.runner().one("select node_device_exchange(%s, %s)", h("w1"), h("wt"))
        self.assertEqual((got["state"], got["account"]["email"], got["account"]["computer_name"], got["account"]["local_compute"]),
                         ("ok", "s***@x", "Sam-PC", True))
        acc = self.runner().one("select node_account(%s)", h("wt"))["account"]
        self.assertEqual((acc["email"], acc["computer_name"]), ("s***@x", "Sam-PC"))

    def test_signout_ends_this_computer_only(self):
        self.make_tester()
        a, b = self.node(SAM, "A"), self.node(SAM, "B")
        self.runner().one("select node_signout(%s)", h(a))
        self.runner_denied("select node_account(%s)", h(a))
        self.assertEqual(self.runner().one("select node_account(%s) -> 'account' ->> 'computer_name'", h(b)), "B")

    # LOW-5: switching the flag off cancels that person's waiting local jobs, in words
    def test_flag_off_cancels_waiting_local_jobs(self):
        self.make_tester()
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        self.make_tester(SAM, False)
        st, detail = self.admin("select state::text, error_detail from jobs where id = %s", job)
        self.assertEqual(st, "cancelled")
        self.assertIn("switched off", detail)

    # LOW-6: a computer name cannot carry control or direction-changing characters
    def test_the_computer_name_is_cleaned(self):
        self.runner().one("select node_device_begin(%s, 'NAME-NAME', %s)", h("n1"), "Sam\u202e-PC\u0007\u200b")
        self.assertEqual(self.admin("select computer_name from device_codes where user_code = 'NAME-NAME'"), "Sam-PC")

    # LOW-7: the job names the computer that claimed it, and only that computer may report on it
    def test_another_computer_of_the_same_person_cannot_report(self):
        self.make_tester()
        a, b = self.node(SAM, "A"), self.node(SAM, "B")
        job = self.claim_node(a)
        self.assertIsNone(job)                             # nothing queued yet
        job = self.submit(SAM, self.version(SAM), "contact_sheet")
        self.assertEqual(self.claim_node(a), job)
        tid = self.admin("select id from node_tokens where token_hash = %s", h(a))
        self.assertEqual(self.admin("select node_token_id from jobs where id = %s", job), tid)
        self.runner_denied("select node_heartbeat(%s, %s, 0.5)", h(b), job)
        self.assertIs(self.runner().one("select node_heartbeat(%s, %s, 0.5)", h(a), job), False)


if __name__ == "__main__":
    unittest.main()
