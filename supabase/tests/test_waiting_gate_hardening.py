"""The waiting gate sweep (CONNECT, 2026-11-06; Claude's 02:24 night note): what migrations/20261106000100_waiting_gate_hardening.sql fixes, and the scenarios the sweep walked that were already right.
    pgvenv/Scripts/python -m unittest supabase/tests/test_waiting_gate_hardening.py -v
It borrows the database of test_waiting_accounts.py (the same live order, the same helpers) and its one server; every test has its own database made from a template.

FIXED (each test fails on the gate as it was on main, and passes with the hardening file):
  * a grant that arrives while an approval is open is paid, not stranded in held_grants for an account that is already active (two connections, real locks)
  * two join calls at the same moment cannot both pass a limit (two connections, real locks)
  * an invite claim with no caller address is still limited per caller
ALREADY RIGHT (walked, kept as tests): a double join; an expired, disabled and used-up invite; a waiting account that is invited later (both ways in, and neither pays twice); live steps 20 and 21 run twice;
the rollback restores the four functions byte for byte.
"""
import sys
import threading
import time
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_waiting_accounts as wa  # noqa: E402
import test_2a_core as core  # noqa: E402

setUpModule = wa.setUpModule        # the same server, the same template databases

ALICE, WAIT, WAIT2, ADMIN = wa.ALICE, wa.WAIT, wa.WAIT2, wa.ADMIN
FOUR = ["ryagram_private.hold_grant(uuid,text,integer,text,text,text,text,text)", "ryagram_private.activate_account(uuid,text,uuid,integer,text)",
        "public.join_reserve(text,text)", "public.invite_claim(uuid,text,text)"]
HARDEN = next(m for m in core.MIGRATIONS if m.name.startswith("20261106000100_waiting_gate_hardening"))
ROLLBACK = core.ROOT / "rollbacks" / "20261106000100_waiting_gate_hardening_rollback.sql"


class Hardening(unittest.TestCase):
    # the helpers of the waiting tests (they use that module's server and counter)
    setUp = wa.Wait.setUp
    tearDown = wa.Wait.tearDown
    owner = wa.Wait.owner
    one = wa.Wait.one
    switch = wa.Wait.switch
    user = wa.Wait.user
    status = wa.Wait.status
    credits = wa.Wait.credits
    admin = wa.Wait.admin
    code = wa.Wait.code
    live = wa.Wait.live

    def uri(self):
        return wa._server.get_uri(database=self.name)

    def held(self, uid):
        return self.owner("select count(*), coalesce(sum(credits), 0) from public.held_grants where owner_id = %s", uid).fetchone()

    # ------------------------------------------------------------------------------------------------ FIXED: a grant that races an approval
    def test_a_grant_that_arrives_while_an_approval_is_open_is_paid_and_not_stranded(self):
        self.user(WAIT, "w@x")
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            a.execute("select ryagram_private.activate_account(%s, 'approved', null, 0, 'race')", (WAIT,))      # the approval has read the held grants and is NOT committed yet
            result = {}

            def grant():
                with psycopg.connect(self.uri(), autocommit=True) as b:
                    b.execute("set statement_timeout = '20s'")
                    result["r"] = b.execute("select public.grant_credits(%s, 'grant', 7, 'race', 'admin:test', 'evt_race')", (WAIT,)).fetchone()[0]
            t = threading.Thread(target=grant)
            t.start()
            time.sleep(1.5)                                  # with the lock the grant is still waiting for the approval; without it, it has already filed itself as "held"
            a.commit()
            t.join(30)
            self.assertFalse(t.is_alive(), "the grant finished")
        finally:
            a.close()
        self.assertEqual(self.status(WAIT), "active")
        self.assertEqual(self.held(WAIT), (0, 0), "nothing is left held for an account that is already active")
        self.assertEqual(self.credits(WAIT), 7, "the grant was paid")

    def test_a_grant_filed_first_is_paid_by_the_approval_that_follows(self):
        self.user(WAIT, "w@x")
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            a.execute("select public.grant_credits(%s, 'grant', 4, 'first', 'admin:test', 'evt_first')", (WAIT,))     # filed as held, not committed
            result = {}

            def approve():
                with psycopg.connect(self.uri(), autocommit=True) as b:
                    b.execute("set statement_timeout = '20s'")
                    result["r"] = b.execute("select ryagram_private.activate_account(%s, 'approved', null, 0, 'then')", (WAIT,)).fetchone()[0]
            t = threading.Thread(target=approve)
            t.start()
            time.sleep(1.5)
            a.commit()
            t.join(30)
            self.assertFalse(t.is_alive())
        finally:
            a.close()
        self.assertTrue(result["r"])
        self.assertEqual(self.held(WAIT), (0, 0))
        self.assertEqual(self.credits(WAIT), 4)

    def test_an_invite_claim_and_an_approval_at_the_same_moment_do_not_deadlock_and_open_the_account_once(self):
        self.admin()
        self.user(WAIT, "w@x")
        code = self.code(credits=9)
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            a.execute("select public.invite_claim(%s, %s, 'ip')", (WAIT, code))                                      # opens the account, not committed
            out = {}

            def approve():
                with psycopg.connect(self.uri(), autocommit=True) as b:
                    b.execute("set statement_timeout = '20s'")
                    b.execute("select set_config('request.jwt.claim.sub', %s, false)", (ADMIN,))
                    b.execute("set role authenticated")
                    out["r"] = b.execute("select public.admin_approve_waiting(%s, 'both')", (WAIT,)).fetchone()[0]
            t = threading.Thread(target=approve)
            t.start()
            time.sleep(1.5)
            a.commit()
            t.join(30)
            self.assertFalse(t.is_alive(), "no deadlock: the approval finished")
        finally:
            a.close()
        self.assertEqual(out["r"]["flipped"], False, "the account was already opened by the code, so the approval changes nothing")
        self.assertEqual(self.credits(WAIT), 9, "the code's credits once, and no welcome credits on top")
        self.assertEqual(self.owner("select count(*) from public.account_status_audit where user_id = %s and to_status = 'active'", WAIT).fetchone()[0], 1)

    # ------------------------------------------------------------------------------------------------ FIXED: the join limit under concurrency
    def test_two_joins_at_the_same_moment_cannot_both_pass_the_limit(self):
        self.switch()
        for i in range(4):                                   # the caller is at 4 of its 5 an hour
            self.assertTrue(self.one("service", "select public.join_reserve(%s, 'iphash')", f"p{i}@x.co")["ok"])
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            self.assertTrue(a.execute("select public.join_reserve('p9@x.co', 'iphash')").fetchone()[0]["ok"])      # the 5th, not committed yet
            result = {}

            def second():
                with psycopg.connect(self.uri(), autocommit=True) as b:
                    b.execute("set statement_timeout = '20s'")
                    result["r"] = b.execute("select public.join_reserve('p8@x.co', 'iphash')").fetchone()[0]
            t = threading.Thread(target=second)
            t.start()
            time.sleep(1.5)
            a.commit()
            t.join(30)
            self.assertFalse(t.is_alive())
        finally:
            a.close()
        self.assertEqual(result["r"], {"ok": False, "reason": "throttled"}, "the second caller waited its turn, saw five, and was stopped")
        self.assertEqual(self.owner("select count(*) from public.join_attempts").fetchone()[0], 5)

    # ------------------------------------------------------------------------------------------------ FIXED: no address, still limited
    def test_an_invite_claim_with_no_caller_address_is_still_limited_per_caller(self):
        self.user(WAIT, "w@x")
        for _ in range(10):
            self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', null)", WAIT)["reason"], "invalid")
        self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', null)", WAIT)["reason"], "throttled",
                         "the 11th try from callers with no address is stopped by the per-caller limit, not only by the overall 300 an hour")

    # ------------------------------------------------------------------------------------------------ ALREADY RIGHT: walked, kept
    def test_a_double_join_counts_the_same_address_whatever_its_case_or_spaces_and_the_third_a_day_is_the_last(self):
        self.switch()
        for k, variant in enumerate(("Dup@x.co", " dup@x.co ", "DUP@X.CO")):
            self.assertTrue(self.one("service", "select public.join_reserve(%s, %s)", variant, f"ipA{k}")["ok"])
        self.assertEqual(self.one("service", "select public.join_reserve('dup@x.co', 'ipZ')")["reason"], "throttled", "a fourth try for the same address in a day, from anywhere, is stopped")
        self.assertEqual(self.owner("select count(distinct email_hash) from public.join_attempts").fetchone()[0], 1, "the three spellings are one address")

    def test_an_expired_a_disabled_and_a_used_up_invite_are_all_just_invalid_and_cost_nothing(self):
        self.user(WAIT, "w@x")
        c1, c2, c3 = self.code(), self.code(), self.code()
        self.owner("update public.invite_codes set expires_at = now() - interval '1 minute' where code_hash = ryagram_private.invite_hash(%s)", c1)
        self.owner("update public.invite_codes set disabled = true where code_hash = ryagram_private.invite_hash(%s)", c2)
        self.owner("update public.invite_codes set uses = max_uses where code_hash = ryagram_private.invite_hash(%s)", c3)
        for c in (c1, c2, c3):
            self.assertEqual(self.one("service", "select public.invite_claim(%s, %s, 'ip')", WAIT, c), {"ok": False, "reason": "invalid"})
        self.assertEqual(self.status(WAIT), "waiting")
        self.assertEqual(self.credits(WAIT), 0)
        self.assertEqual(self.owner("select coalesce(sum(uses), 0) from public.invite_codes").fetchone()[0], 1, "only the used-up code's own use; nothing was added")

    def test_a_waiting_account_that_is_invited_later_opens_once_from_either_way_in_and_is_never_paid_twice(self):
        self.admin()
        self.user(WAIT, "w@x.co")
        self.user(WAIT2, "w2@x.co")
        # way 1: the invite email path (invite_sent) for an account that is already waiting
        self.switch()
        code = self.code(credits=12, uses=2)
        r = self.one("service", "select public.invite_reserve(%s, 'w@x.co', 'ip')", code)
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)                  # a replay of the same redemption
        self.assertEqual((self.status(WAIT), self.credits(WAIT)), ("active", 12), "opened and paid once; the replay adds nothing")
        # way 2: the other waiting account types the same code
        out = self.one("service", "select public.invite_claim(%s, %s, 'ip')", WAIT2, code)
        self.assertTrue(out["ok"] and out["activated"])
        self.assertEqual(self.credits(WAIT2), 12)
        # an account that is already open does not use up a use
        uses = self.owner("select uses from public.invite_codes").fetchone()[0]
        self.assertEqual(self.one("service", "select public.invite_claim(%s, %s, 'ip')", WAIT2, code), {"ok": True, "already": True})
        self.assertEqual(self.owner("select uses from public.invite_codes").fetchone()[0], uses)

    def test_live_step_20_and_21_run_twice_change_nothing_the_second_time(self):
        self.user(WAIT, "w@x", switch_on=False)
        for name in ("20_waiting_accounts_switch_on.sql", "20_waiting_accounts_switch_on.sql"):
            cur = self.owner(self.live(name)); cur.nextset(); row = cur.fetchone()
            self.assertEqual(row[0], True)
        on_twice = row
        for name in ("21_waiting_accounts_switch_off.sql", "21_waiting_accounts_switch_off.sql"):
            cur = self.owner(self.live(name)); cur.nextset(); row = cur.fetchone()
            self.assertEqual(row[0], False)
        self.assertEqual(row, (False, 0))
        self.assertEqual(on_twice[0], True)
        self.assertEqual(self.status(WAIT), "active", "nobody was locked out or let in by running the files twice")

    # ------------------------------------------------------------------------------------------------ the file itself
    def test_the_hardening_replaces_four_functions_and_ends_with_the_gate_like_every_migration_after_it(self):
        sql = HARDEN.read_text(encoding="utf-8")
        self.assertEqual(sql.count("create or replace function"), 4)
        self.assertEqual(sorted(l.split("(")[0].split()[-1] for l in sql.splitlines() if l.startswith("create or replace function")),
                         ["public.invite_claim", "public.join_reserve", "ryagram_private.activate_account", "ryagram_private.hold_grant"])
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        self.assertNotIn("grant execute", sql.lower().replace("-- ", "#"), "no grant is changed")

    def test_the_rollback_puts_the_four_functions_back_exactly_as_they_were_before_the_file(self):
        def defs(db):
            return [db.execute("select md5(pg_get_functiondef(%s::regprocedure))", (f,)).fetchone()[0] for f in FOUR]
        after = defs(self.db.as_(None).c)
        with psycopg.connect(wa._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name}old template tmplpre")
        with psycopg.connect(wa._server.get_uri(database=self.name + "old"), autocommit=True) as c:
            for m in [wa.WAIT_MIG, *[p for p in wa.POST if p != HARDEN]]:
                c.execute(m.read_text(encoding="utf-8"))
            before = defs(c)
        self.assertNotEqual(before, after, "the file really changed the four")
        self.owner(ROLLBACK.read_text(encoding="utf-8"))
        self.assertEqual(defs(self.db.c), before, "the rollback restored all four")
        acl = self.owner("select count(*) from pg_proc p, aclexplode(p.proacl) x where p.oid = 'public.invite_claim(uuid,text,text)'::regprocedure and x.grantee = (select oid from pg_roles where rolname = 'service_role')").fetchone()[0]
        self.assertEqual(acl, 1, "the grants stayed")


if __name__ == "__main__":
    unittest.main()
