"""WAITING accounts (migrations/20261104000100_waiting_accounts.sql) on a local Postgres, with the credits ledger applied AFTER the migrations (the real order).

Same setup as test_2a_core.py. Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_waiting_accounts.py -v

What this proves: while the switch (ops_settings.waiting_accounts) is OFF nothing changes; while it is ON a WAITING account is refused by EVERY function and table a signed-in
person can reach (except the named few), cannot write its own status, cannot hold credits, cannot be connected to an AI, and leaves WAITING only through an invite code or
Ryan's approval, once. A function or table added later without the gate is FOUND by ungated() below (and the planted-fault test proves the finder can see one).
"""
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
ALICE, WAIT, WAIT2, ADMIN, WORKERU, OTHER = (str(uuid.UUID(int=i)) for i in (201, 202, 203, 204, 205, 206))
WORDS = "waiting list"
# the same list as ryagram_private.gate_apply(): functions a WAITING person may still run (kept apart on purpose: a change to one without the other fails a test)
ALLOWED = {"funnel_anon", "record_visit", "report_film_page", "service_status", "submit_support", "funnel_attach_source", "funnel_return_visit",
           "is_app_admin", "current_engine_commit", "film_request_cost", "my_access", "account_gate_ok", "connect_consent_check"}
OPEN_TABLES = {"account_settings", "account_deletion_requests", "ryagram_waitlist", "account_status"}
WAIT_MIG = next(m for m in core.MIGRATIONS if m.name.startswith("20261104000100_waiting_accounts"))
PRE = [m for m in core.MIGRATIONS if m.name < WAIT_MIG.name]               # everything before the waiting-accounts file
POST = [m for m in core.MIGRATIONS if m.name > WAIT_MIG.name]              # the files after it (the join table)
_server = None
_count = 0


def setUpModule():
    global _server
    _server = pgserver.get_server(tempfile.mkdtemp(prefix="ryagram-pg-wait-"), cleanup_mode="stop")
    assert WAIT_MIG.name.startswith("20261104000100_waiting_accounts"), WAIT_MIG.name
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("drop database if exists tmplpre")
        c.execute("create database tmplpre")
    with psycopg.connect(_server.get_uri(database="tmplpre"), autocommit=True) as c:
        c.execute((ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in PRE:
            c.execute(path.read_text(encoding="utf-8"))
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database tmplw template tmplpre")
    with psycopg.connect(_server.get_uri(database="tmplw"), autocommit=True) as c:
        for path in [WAIT_MIG, *POST]:
            c.execute(path.read_text(encoding="utf-8"))
        c.execute(LEDGER.read_text(encoding="utf-8"))
        c.execute("select ryagram_private.gate_apply()")          # the ledger came AFTER the migration: this is the documented second run
        c.execute("update public.ops_settings set auto_render = true, default_credits_per_day = 100000")


def ungated(c):
    """what a signed-in person can reach with no gate and no allow-list entry: [(kind, name)] -- the finder the coverage tests (and the planted-fault test) use"""
    out = []
    for (name,) in c.execute("""select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prosrc not like '%%require_active%%' order by 1""").fetchall():
        if name not in ALLOWED:
            out.append(("function", name))
    for (t,) in c.execute("""select distinct pc.tablename from pg_policies pc where pc.schemaname in ('public', 'storage') and pc.permissive = 'PERMISSIVE'
        and ('authenticated' = any (pc.roles) or 'public' = any (pc.roles))
        and not exists (select 1 from pg_policies q where q.schemaname = pc.schemaname and q.tablename = pc.tablename and q.policyname = 'account_gate') order by 1""").fetchall():
        if t not in OPEN_TABLES:
            out.append(("table", t))
    return out


class Wait(unittest.TestCase):
    def setUp(self):
        global _count
        _count += 1
        self.name = f"w{_count}"
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name} template tmplw")
        self.db = core.Db(_server.get_uri(database=self.name))
        self.owner("insert into auth.users (id, email) values (%s,'alice@x')", ALICE)          # switch OFF: recorded as active

    def tearDown(self):
        self.db.c.close()

    # -- helpers
    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)          # no arguments: the text goes through untouched (it may contain % in a LIKE)

    def one(self, who, sql, *args):
        return self.db.as_(who).one(sql, *args)

    def switch(self, on=True):
        self.owner("update public.ops_settings set waiting_accounts = %s", on)

    def user(self, uid, email, switch_on=True):
        self.switch(switch_on)
        self.owner("insert into auth.users (id, email) values (%s, %s)", uid, email)

    def status(self, uid):
        row = self.db.as_(None).c.execute("select status from public.account_status where user_id = %s", (uid,)).fetchone()
        return row[0] if row else None

    def refused(self, who, sql, *args, others=()):
        with self.assertRaises(psycopg.Error) as cm:
            self.one(who, sql, *args)
        self.assertTrue(WORDS in str(cm.exception) or any(o in str(cm.exception) for o in others), sql + " -> " + str(cm.exception)[:200])
        return WORDS in str(cm.exception)

    def credits(self, uid):
        return self.db.as_(None).c.execute("select coalesce(sum(amount), 0) from public.credit_ledger where owner_id = %s", (uid,)).fetchone()[0]

    def admin(self):
        self.owner("insert into auth.users (id, email) values (%s,'admin@x') on conflict do nothing", ADMIN)
        self.owner("insert into public.app_admins (user_id) values (%s) on conflict do nothing", ADMIN)

    # ------------------------------------------------------------------------------------------------ the switch
    def test_switch_off_changes_nothing(self):
        self.assertEqual(self.status(ALICE), "active")
        self.owner("insert into auth.users (id, email) values (%s,'x@x')", WAIT)
        self.assertEqual(self.status(WAIT), "active", "a new account while the switch is off is recorded active")
        me = self.one(WAIT, "select public.my_access()")
        self.assertEqual((me["status"], me["gate_on"]), ("active", False))
        self.one(WAIT, "select public.my_departments()")                  # a wrapped SQL function still answers
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", WAIT)       # even a waiting ROW is ignored while the switch is off
        self.one(WAIT, "select public.my_departments()")
        self.assertEqual(self.one(WAIT, "select public.my_access()")["status"], "active")

    def test_new_account_waits_when_switch_on_and_old_accounts_stay_active(self):
        self.user(WAIT, "w@x")
        self.assertEqual(self.status(WAIT), "waiting")
        self.assertEqual(self.status(ALICE), "active")
        me = self.one(WAIT, "select public.my_access()")
        self.assertEqual((me["status"], me["gate_on"]), ("waiting", True))
        self.assertEqual(self.one(ALICE, "select public.my_access()")["status"], "active")

    def test_account_with_no_row_is_not_active_when_switch_on(self):
        self.switch()
        self.owner("insert into auth.users (id, email) values (%s,'n@x')", OTHER)
        self.owner("delete from public.account_status where user_id = %s", OTHER)
        self.assertEqual(self.one(OTHER, "select public.my_access()")["status"], "waiting")

    def test_admin_and_worker_count_as_active_whatever_the_table_says(self):
        self.admin()
        self.owner("insert into auth.users (id, email) values (%s,'wk@x')", WORKERU)
        self.owner("insert into public.workers (user_id, name) values (%s,'pc2')", WORKERU)
        self.switch()
        self.owner("update public.account_status set status = 'waiting' where user_id in (%s, %s)", ADMIN, WORKERU)
        self.assertEqual(self.one(ADMIN, "select public.my_access()")["status"], "active")
        self.assertTrue(self.db.as_(None).one("select ryagram_private.account_active(%s)", WORKERU))      # (a worker never calls my_access: workers only run jobs)

    def test_the_migration_makes_every_existing_account_active(self):
        """accounts that exist BEFORE the file runs (testers, an admin, a worker) are all active afterwards, also once the switch is on"""
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute("create database bf template tmplpre")
        with psycopg.connect(_server.get_uri(database="bf"), autocommit=True) as c:
            c.execute("insert into auth.users (id, email) values (%s,'a@x'),(%s,'b@x'),(%s,'c@x'),(%s,'d@x')", (ALICE, WAIT, ADMIN, WORKERU))
            c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
            c.execute("insert into public.workers (user_id, name) values (%s, 'pc')", (WORKERU,))
            c.execute(WAIT_MIG.read_text(encoding="utf-8"))
            c.execute("update public.ops_settings set waiting_accounts = true")
            self.assertEqual(c.execute("select count(*), count(*) filter (where status = 'active' and source = 'backfill') from public.account_status").fetchone(), (4, 4))
            self.assertEqual(c.execute("select count(*) from public.account_status s where ryagram_private.account_active(s.user_id)").fetchone()[0], 4)
            c.execute("insert into auth.users (id, email) values (%s,'new@x')", (OTHER,))
            self.assertEqual(c.execute("select status from public.account_status where user_id = %s", (OTHER,)).fetchone()[0], "waiting")

    # ------------------------------------------------------------------------------------------------ the gate
    def test_every_function_a_signed_in_person_can_run_is_gated_or_allowed(self):
        self.assertEqual(ungated(self.db.as_(None).c), [])

    def test_a_waiting_person_is_refused_by_every_gated_function(self):
        """call each one with NULL arguments: the gate is the first statement, so the only possible answer is the waiting words; an active person never gets them"""
        self.user(WAIT, "w@x")
        rows = self.db.as_(None).c.execute("""select p.proname, p.proargtypes::regtype[]::text[], p.proisstrict from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute') and p.prosrc like '%%require_active()%%' order by 1""").fetchall()
        self.assertGreater(len(rows), 60)
        skipped, said = [], 0
        for name, types, strict in rows:
            call = "select public.%s(%s)" % (name, ", ".join("null::" + t for t in types))
            if strict and types:
                skipped.append(name)
                continue
            if name.startswith("admin_"):
                continue                       # their own admin check runs first; an admin is active, and the gate line is proved present by the coverage test
            if self.refused(WAIT, call, others=("Only an admin", "Not an enabled worker", "worker account")):
                said += 1
            try:
                self.one(ALICE, call)
            except psycopg.Error as e:
                self.assertNotIn(WORDS, str(e), "an active person got the waiting words from " + name)
        self.assertLess(len(skipped), 5, skipped)
        self.assertGreater(said, 40, said)

    def test_a_waiting_person_sees_and_writes_no_rows(self):
        self.user(WAIT, "w@x")
        self.owner("insert into public.projects (owner_id, title) values (%s, 'mine')", WAIT)
        self.assertEqual(self.one(WAIT, "select count(*) from public.projects"), 0)
        with self.assertRaises(psycopg.Error):
            self.one(WAIT, "insert into public.projects (title) values ('x') returning id")
        self.owner("update public.account_status set status = 'active' where user_id = %s", WAIT)
        self.assertEqual(self.one(WAIT, "select count(*) from public.projects"), 1)

    def test_what_a_waiting_person_must_reach_stays_open(self):
        self.user(WAIT, "w@x")
        self.assertEqual(self.one(WAIT, "select count(*) from public.account_status where user_id = %s", WAIT), 1)
        self.db.as_(WAIT).c.execute("insert into public.ryagram_waitlist (email) values ('wl@example.com')")
        pol = {r[0] for r in self.db.as_(None).c.execute("select tablename from pg_policies where policyname = 'account_gate'").fetchall()}
        self.assertFalse(pol & OPEN_TABLES, pol & OPEN_TABLES)
        self.assertIn("projects", pol)
        self.assertIn("objects", pol)                                   # storage too

    def test_nobody_writes_account_status_through_the_api(self):
        self.user(WAIT, "w@x")
        self.assertEqual(self.one(WAIT, "select count(*) from public.account_status"), 1, "own row only")
        for sql in ("update public.account_status set status = 'active' where user_id = %s", "delete from public.account_status where user_id = %s",
                    "insert into public.account_status (user_id, status, source) values (%s, 'active', 'x')"):
            for who in (WAIT, ALICE, "anon"):
                with self.assertRaises(psycopg.Error, msg=f"{who}: {sql}"):
                    self.db.as_(who).c.execute(sql, (WAIT if "insert" not in sql else uuid.UUID(int=999),))
        self.assertEqual(self.status(WAIT), "waiting")
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").c.execute("select * from public.account_status")
        for fn in ("ryagram_private.activate_account(%s,'x',null,0,'x')", ):
            with self.assertRaises(psycopg.Error):
                self.one(WAIT, "select " + fn, WAIT)

    def test_no_waiting_helper_in_the_private_schema_can_be_run_by_a_signed_in_person(self):
        names = ("waiting_on", "account_active", "require_active", "require_active_owner", "account_status_new", "activate_account", "gate_apply")
        for n in names:
            for role in ("authenticated", "anon"):
                self.assertFalse(self.db.as_(None).one("select has_function_privilege(%s, p.oid, 'execute') from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'ryagram_private' and p.proname = %s", role, n), f"{role} can run {n}")

    def test_status_helpers_are_security_definer_with_a_fixed_search_path(self):
        rows = self.db.as_(None).c.execute("""select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public','ryagram_private') and p.proname in ('account_status_new','account_active','require_active','require_active_owner','waiting_on','activate_account',
              'invite_claim','account_is_active','my_access','account_gate_ok','admin_waiting_list','admin_approve_waiting','gate_apply')""").fetchall()
        self.assertEqual(len(rows), 13)
        for name, secdef, cfg in rows:
            self.assertTrue(secdef, name)
            self.assertTrue(cfg and any(x.startswith("search_path=") for x in cfg), name)

    # ------------------------------------------------------------------------------------------------ the way out of WAITING
    def test_admin_approve_flips_once_grants_welcome_credits_once_and_is_audited(self):
        self.admin()
        self.user(WAIT, "w@x")
        self.assertIn(WAIT, [str(r[0]) for r in self.db.as_(ADMIN).c.execute("select user_id from public.admin_waiting_list()").fetchall()])
        for who in (ALICE, WAIT):
            with self.assertRaises(psycopg.Error):
                self.one(who, "select public.admin_approve_waiting(%s, 'because')", WAIT)
        with self.assertRaises(psycopg.Error):
            self.one(ADMIN, "select public.admin_approve_waiting(%s, 'x')", WAIT)               # a reason is required (3+ characters)
        out = self.one(ADMIN, "select public.admin_approve_waiting(%s, 'looks fine')", WAIT)
        self.assertEqual((out["flipped"], out["email"], out["credits"]), (True, "w@x", 20))
        self.assertEqual(self.status(WAIT), "active")
        self.assertEqual(self.credits(WAIT), 20)
        again = self.one(ADMIN, "select public.admin_approve_waiting(%s, 'again')", WAIT)
        self.assertEqual((again["flipped"], again["credits"]), (False, 0))
        self.assertEqual(self.credits(WAIT), 20, "approving twice never pays twice")
        a = self.db.as_(None).c.execute("select source, by_user, from_status, to_status from public.account_status_audit where user_id = %s", (WAIT,)).fetchall()
        self.assertEqual(a, [("approved", uuid.UUID(ADMIN), "waiting", "active")])
        self.assertEqual(self.one(WAIT, "select public.my_access()")["status"], "active")

    def code(self, credits=0, uses=1):
        code = self.db.as_(None).one("select public.invite_issue('t', %s, 14)", uses)
        if credits:
            self.owner("update public.invite_codes set grant_credits = %s", credits)
        return code

    def test_invite_claim_activates_once_uses_the_code_once_and_pays_the_codes_credits(self):
        self.user(WAIT, "w@x")
        self.user(WAIT2, "w2@x")
        code = self.code(credits=15)
        out = self.one("service", "select public.invite_claim(%s, %s, 'iphash')", WAIT, code)
        self.assertEqual((out["ok"], out["activated"]), (True, True))
        self.assertEqual(self.status(WAIT), "active")
        self.assertEqual(self.credits(WAIT), 15)
        self.assertEqual(self.owner("select uses from public.invite_codes").fetchone()[0], 1)
        again = self.one("service", "select public.invite_claim(%s, %s, 'iphash')", WAIT, code)
        self.assertEqual(again, {"ok": True, "already": True})
        self.assertEqual(self.owner("select uses from public.invite_codes").fetchone()[0], 1, "an active person does not use up a second use")
        self.assertEqual(self.one("service", "select public.invite_claim(%s, %s, 'iphash')", WAIT2, code), {"ok": False, "reason": "invalid"})
        self.assertEqual(self.status(WAIT2), "waiting")
        self.assertEqual(self.credits(WAIT2), 0)

    def test_invite_claim_throttles_guessing_and_is_not_reachable_by_a_person(self):
        self.user(WAIT, "w@x")
        for _ in range(10):
            self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', 'ip1')", WAIT)["reason"], "invalid")
        self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', 'ip1')", WAIT)["reason"], "throttled")
        for who in (WAIT, ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.one(who, "select public.invite_claim(%s, 'x', 'ip')", WAIT)

    def test_a_failed_invite_email_does_not_strand_the_account(self):
        """redeem-invite: reserve a code, Auth creates the account (WAITING), the email fails, the code is released; the person later signs in (forgot-password) and claims it"""
        self.switch()
        code = self.code(credits=10)
        r = self.one("service", "select public.invite_reserve(%s, 'w@x.co', 'ip')", code)
        self.assertTrue(r["ok"])
        self.owner("insert into auth.users (id, email) values (%s, 'w@x.co')", WAIT)               # Auth made the account before the email failed
        self.one("service", "select public.invite_release(%s)", r["redemption"])               # redeem-invite releases on a 503; a retry then gets email_exists and never calls invite_sent
        self.assertEqual(self.status(WAIT), "waiting")
        self.assertEqual(self.owner("select uses from public.invite_codes").fetchone()[0], 0, "the code came back")
        out = self.one("service", "select public.invite_claim(%s, %s, 'ip')", WAIT, code)
        self.assertTrue(out["ok"] and out["activated"])
        self.assertEqual((self.status(WAIT), self.credits(WAIT)), ("active", 10))

    def test_invite_sent_makes_an_invited_tester_active_and_pays_the_codes_credits(self):
        self.switch()
        code = self.code(credits=20)
        r = self.one("service", "select public.invite_reserve(%s, 'w@x.co', 'ip')", code)
        self.owner("insert into auth.users (id, email) values (%s, 'w@x.co')", WAIT)
        self.assertEqual(self.status(WAIT), "waiting")
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)
        self.assertEqual((self.status(WAIT), self.credits(WAIT)), ("active", 20))
        self.assertEqual(self.one(WAIT, "select public.my_access()")["status"], "active")

    def test_invite_sent_activates_even_when_the_code_carries_no_credits(self):
        self.switch()
        code = self.code(credits=0)
        r = self.one("service", "select public.invite_reserve(%s, 'w@x.co', 'ip')", code)
        self.owner("insert into auth.users (id, email) values (%s, 'w@x.co')", WAIT)
        self.assertEqual(self.status(WAIT), "waiting")
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)
        self.assertEqual((self.status(WAIT), self.credits(WAIT)), ("active", 0))

    def test_invite_sent_with_the_switch_off_pays_as_before(self):
        code = self.code(credits=20)
        r = self.one("service", "select public.invite_reserve(%s, 'w@x.co', 'ip')", code)
        self.owner("insert into auth.users (id, email) values (%s, 'w@x.co')", WAIT)
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)
        self.assertEqual(self.credits(WAIT), 20)

    # ------------------------------------------------------------------------------------------------ credits, connector, service role
    def test_a_waiting_account_cannot_hold_credits(self):
        self.user(WAIT, "w@x")
        with self.assertRaises(psycopg.Error) as cm:
            self.one("service", "select public.grant_credits(%s, 'grant', 5, 'x', 'admin:test')", WAIT)
        self.assertIn(WORDS, str(cm.exception))
        self.assertEqual(self.credits(WAIT), 0)
        self.owner("update public.account_status set status = 'active' where user_id = %s", WAIT)
        self.assertTrue(self.one("service", "select public.grant_credits(%s, 'grant', 5, 'x', 'admin:test')", WAIT))
        self.assertEqual(self.credits(WAIT), 5)

    def test_a_waiting_account_cannot_be_connected_to_an_ai(self):
        self.user(WAIT, "w@x")
        self.owner("insert into public.connect_access (user_id, enabled) values (%s, true)", WAIT)
        self.assertFalse(self.db.as_(None).one("select ryagram_private.connect_person_ok(%s)", WAIT))
        self.owner("update public.account_status set status = 'active' where user_id = %s", WAIT)
        self.assertTrue(self.db.as_(None).one("select ryagram_private.connect_person_ok(%s)", WAIT))
        self.switch(False)
        self.owner("update public.account_status set status = 'waiting' where user_id = %s", WAIT)
        self.assertTrue(self.db.as_(None).one("select ryagram_private.connect_person_ok(%s)", WAIT), "switch off: as before")

    def test_the_consent_page_says_why_in_plain_words(self):
        src = self.db.as_(None).one("select prosrc from pg_proc where proname = 'connect_consent_check'")
        self.assertIn("Your account is on the waiting list, so it cannot be connected to an AI yet. We will email you when your access opens.", src)
        self.assertLess(src.index("account_active(me)"), src.index("connect_person_ok(me) then why"), "the waiting words come before the generic 'not enabled' words")

    def test_service_role_and_the_dashboard_are_unchanged(self):
        self.user(WAIT, "w@x")
        self.assertTrue(self.db.as_(None).one("select ryagram_private.account_active(null) is false"))          # no person: not 'active', but the CHECK only looks at signed-in people
        self.db.as_(None).c.execute("select ryagram_private.require_active()")                                 # the dashboard (no signed-in person) passes
        self.assertFalse(self.one("service", "select public.account_is_active(%s)", WAIT))
        self.assertTrue(self.one("service", "select public.account_is_active(%s)", ALICE))
        for who in (WAIT, ALICE, "anon"):
            with self.assertRaises(psycopg.Error):
                self.one(who, "select public.account_is_active(%s)", WAIT)

    # ------------------------------------------------------------------------------------------------ join_reserve (20261104000200_waiting_join.sql)
    def test_join_is_closed_while_the_switch_is_off(self):
        self.assertEqual(self.one("service", "select public.join_reserve('a@example.com', 'ip1')"), {"ok": False, "reason": "off"})

    def test_join_limits_per_caller_per_email_and_overall_and_counts_every_try(self):
        self.switch()
        self.assertEqual(self.one("service", "select public.join_reserve('not an email', 'ip1')"), {"ok": False, "reason": "email"})
        for i in range(5):
            self.assertTrue(self.one("service", "select public.join_reserve(%s, 'ipA')", f"p{i}@example.com")["ok"])
        self.assertEqual(self.one("service", "select public.join_reserve('p9@example.com', 'ipA')"), {"ok": False, "reason": "throttled"}, "the 6th from one caller in an hour")
        for i in range(3):
            self.assertTrue(self.one("service", "select public.join_reserve('same@example.com', %s)", f"ipB{i}")["ok"])
        self.assertEqual(self.one("service", "select public.join_reserve('SAME@example.com', 'ipC')"), {"ok": False, "reason": "throttled"}, "the 4th for one address in a day, any case")
        self.owner("insert into public.join_attempts (ip_hash, email_hash) select 'x' || g, lpad(g::text, 64, '0') from generate_series(1, 200) g")
        self.assertEqual(self.one("service", "select public.join_reserve('z@example.com', 'ipD')"), {"ok": False, "reason": "throttled"}, "200 a day overall")

    def test_join_old_attempts_are_forgotten_and_nobody_but_the_service_role_can_call_it(self):
        self.switch()
        self.owner("insert into public.join_attempts (ip_hash, email_hash, at) values ('ipA', %s, now() - interval '3 days')", "0" * 64)
        self.one("service", "select public.join_reserve('q@example.com', 'ipE')")
        self.assertEqual(self.owner("select count(*) from public.join_attempts where at < now() - interval '2 days'").fetchone()[0], 0)
        for who in ("anon", ALICE):
            with self.assertRaises(psycopg.Error):
                self.one(who, "select public.join_reserve('q@example.com', 'ipE')")
            with self.assertRaises(psycopg.Error):
                self.one(who, "select count(*) from public.join_attempts")
        self.assertEqual(len(self.owner("select email_hash from public.join_attempts where email_hash !~ '^0+$'").fetchall()[0][0]), 64, "only a hash of the address is kept")


    # ------------------------------------------------------------------------------------------------ Ryan's after-check and switch files
    def live(self, name):
        return (ROOT / "live-steps" / name).read_text(encoding="utf-8")

    def test_the_after_check_is_all_true_and_sees_a_planted_fault_and_the_switch_files_work(self):
        rows = self.owner(self.live("19_waiting_accounts_after_check.sql")).fetchall()
        self.assertEqual(len(rows), 7)
        self.assertEqual([r[0] for r in rows if r[1] is not True], [], "every ok is true on the migrated database")
        self.owner("""create function public.zz_planted() returns int language plpgsql security definer set search_path = '' as $$
begin
  return 1;
end $$;
grant execute on function public.zz_planted() to authenticated;""")
        bad = [r[0] for r in self.owner(self.live("19_waiting_accounts_after_check.sql")).fetchall() if r[1] is not True]
        self.assertEqual(len(bad), 1)
        self.assertIn("every function", bad[0])
        self.owner("select ryagram_private.gate_apply()")
        self.assertEqual([r[0] for r in self.owner(self.live("19_waiting_accounts_after_check.sql")).fetchall() if r[1] is not True], [])
        cur = self.owner(self.live("20_waiting_accounts_switch_on.sql"))
        cur.nextset()
        self.assertTrue(cur.fetchone()[0])
        self.assertEqual(self.owner("select waiting_accounts from public.ops_settings").fetchone()[0], True)
        self.assertEqual([r[0] for r in self.owner(self.live("19_waiting_accounts_after_check.sql")).fetchall() if r[1] is not True], ["the switch is OFF right now (INFO: false here means it is already ON; both are fine, just know which)"])
        self.owner(self.live("21_waiting_accounts_switch_off.sql"))
        self.assertEqual(self.owner("select waiting_accounts from public.ops_settings").fetchone()[0], False)

    # ------------------------------------------------------------------------------------------------ the finder can see a fault (must-fail) and the re-run fixes it
    def test_the_coverage_finder_sees_a_planted_ungated_function_and_table_and_gate_apply_fixes_both(self):
        self.assertEqual(ungated(self.db.as_(None).c), [])
        self.owner("""create function public.zz_planted() returns int language plpgsql security definer set search_path = '' as $$
begin
  return 1;
end $$;
                      grant execute on function public.zz_planted() to authenticated;
                      create table public.zz_planted_t (id int, owner_id uuid default auth.uid());
                      alter table public.zz_planted_t enable row level security;
                      grant select on public.zz_planted_t to authenticated;
                      create policy zz_read on public.zz_planted_t for select to authenticated using (owner_id = auth.uid());""")
        self.assertEqual(ungated(self.db.as_(None).c), [("function", "zz_planted"), ("table", "zz_planted_t")])
        self.owner("select ryagram_private.gate_apply()")
        self.assertEqual(ungated(self.db.as_(None).c), [])
        self.user(WAIT, "w@x")
        self.refused(WAIT, "select public.zz_planted()")
        self.owner("select ryagram_private.gate_apply()")                                                       # idempotent: a second run changes nothing
        self.assertEqual(ungated(self.db.as_(None).c), [])


if __name__ == "__main__":
    unittest.main()
