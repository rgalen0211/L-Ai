"""The waiting gate sweep (CONNECT, 2026-11-06; Claude's 02:24 night note, CC1 05:12 and GEO's cross-review): what migrations/20261106000100_waiting_gate_hardening.sql fixes, and the scenarios the sweep walked that were already right.
    pgvenv/Scripts/python -m unittest supabase/tests/test_waiting_gate_hardening.py -v
It borrows the database of test_waiting_accounts.py (the same live order, the same helpers) and its one server; every test has its own database made from a template.

FIXED (each test fails on the gate as it was on main, and passes with the hardening file):
  * a grant that arrives while an approval is open is paid, not stranded in held_grants for an account that is already active (real locks, several connections)
  * two join calls at the same moment cannot both pass a limit; neither can two invite claims or two invite reservations
  * an invite claim or reservation with no caller address is still limited per caller (one shared bucket for all callers with no address)
  * the account-locking functions take their locks in one order, so an invite claim and an approval cannot deadlock
THE RACE TESTS DO NOT SLEEP: each waits, by polling pg_stat_activity, until the second connection is REALLY blocked on a lock (or has finished, which is the bug), then lets the first one go.
ALREADY RIGHT (walked, kept as tests): a double join; an expired, disabled and used-up invite; a waiting account that is invited later; live steps 20 and 21 run twice; the rollback restores the five functions byte for byte.
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
FIVE = ["ryagram_private.hold_grant(uuid,text,integer,text,text,text,text,text)", "ryagram_private.activate_account(uuid,text,uuid,integer,text)",
        "public.join_reserve(text,text)", "public.invite_claim(uuid,text,text)", "public.invite_reserve(text,text,text)"]
HARDEN = next(m for m in core.MIGRATIONS if m.name.startswith("20261106000100_waiting_gate_hardening"))
ROLLBACK = core.ROOT / "rollbacks" / "20261106000100_waiting_gate_hardening_rollback.sql"
INVITE_LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('ryagram-invite-claim', 0))"


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

    # ---- the race helpers: a second connection runs one statement in a thread; we wait until it is REALLY blocked on a lock (or has finished), never for a guessed time
    def start(self, sql, args=(), setup=()):
        box = {"ready": threading.Event()}

        def work():
            try:
                with psycopg.connect(self.uri(), autocommit=True) as b:
                    b.execute("set statement_timeout = '40s'")
                    for s in setup:
                        b.execute(s)
                    box["pid"] = b.execute("select pg_backend_pid()").fetchone()[0]
                    box["ready"].set()
                    box["result"] = b.execute(sql, args).fetchone()[0]
            except Exception as e:                                 # a deadlock or a timeout shows up here, and the test reads it
                box["error"] = e
            finally:
                box["ready"].set()
        box["thread"] = threading.Thread(target=work)
        box["thread"].start()
        box["ready"].wait(15)
        return box

    def settle(self, box, timeout=15):
        """True when the thread's statement is waiting on a lock; False when it already finished (nothing made it wait) or never got going."""
        with psycopg.connect(self.uri(), autocommit=True) as mon:
            end = time.time() + timeout
            while time.time() < end:
                if not box["thread"].is_alive():
                    return False
                row = mon.execute("select wait_event_type from pg_stat_activity where pid = %s", (box.get("pid"),)).fetchone()
                if row and row[0] == "Lock":
                    return True
                time.sleep(0.05)
        return False

    def finish(self, *boxes):
        for b in boxes:
            b["thread"].join(40)
            self.assertFalse(b["thread"].is_alive(), "a statement never finished")
            self.assertNotIn("error", b, "a statement failed: " + str(b.get("error")))

    # ------------------------------------------------------------------------------------------------ FIXED: a grant that races an approval
    def test_a_grant_that_arrives_while_an_approval_is_open_is_paid_and_not_stranded(self):
        self.user(WAIT, "w@x")
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            a.execute("select ryagram_private.activate_account(%s, 'approved', null, 0, 'race')", (WAIT,))      # the approval has read the held grants and is NOT committed yet
            g = self.start("select public.grant_credits(%s, 'grant', 7, 'race', 'admin:test', 'evt_race')", (WAIT,))
            waited = self.settle(g)
            a.commit()
        finally:
            a.close()
        self.finish(g)
        self.assertEqual(self.status(WAIT), "active")
        self.assertEqual(self.held(WAIT), (0, 0), "nothing is left held for an account that is already active")
        self.assertEqual(self.credits(WAIT), 7, "the grant was paid")
        self.assertTrue(waited, "the grant must have WAITED for the approval (the lock)")

    def test_a_grant_filed_first_is_paid_by_the_approval_that_follows(self):
        self.user(WAIT, "w@x")
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            a.execute("select public.grant_credits(%s, 'grant', 4, 'first', 'admin:test', 'evt_first')", (WAIT,))     # filed as held, not committed
            ap = self.start("select ryagram_private.activate_account(%s, 'approved', null, 0, 'then')", (WAIT,))
            waited = self.settle(ap)
            a.commit()
        finally:
            a.close()
        self.finish(ap)
        self.assertTrue(ap["result"])
        self.assertEqual(self.held(WAIT), (0, 0))
        self.assertEqual(self.credits(WAIT), 4)
        self.assertTrue(waited, "the approval waits for the grant's turn")

    def test_an_invite_claim_and_an_approval_at_the_same_moment_open_the_account_once(self):
        self.admin()
        self.user(WAIT, "w@x")
        code = self.code(credits=9)
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            a.execute("select public.invite_claim(%s, %s, 'ip')", (WAIT, code))                                      # opens the account, not committed
            ap = self.start("select public.admin_approve_waiting(%s, 'both')", (WAIT,),
                            setup=[f"select set_config('request.jwt.claim.sub', '{ADMIN}', false)", "set role authenticated"])
            waited = self.settle(ap)
            a.commit()
        finally:
            a.close()
        self.finish(ap)
        self.assertTrue(waited, "the approval waits for the claim")
        self.assertEqual(ap["result"]["flipped"], False, "the account was already opened by the code, so the approval changes nothing")
        self.assertEqual(self.credits(WAIT), 9, "the code's credits once, and no welcome credits on top")
        self.assertEqual(self.owner("select count(*) from public.account_status_audit where user_id = %s and to_status = 'active'", WAIT).fetchone()[0], 1)

    def test_the_account_locks_are_taken_in_one_order_so_a_claim_and_an_approval_cannot_deadlock(self):
        """THREE connections, built so that the wrong order deadlocks. L holds the guess lock; the claim B reaches it holding whatever it took before; the approval A then asks for the account lock; then L lets go.
        If the claim took its row lock BEFORE the account lock, A waits for B's row while B (now free to go on) asks for the account lock A holds: a deadlock, and Postgres kills one of them. With the order of the file there is none."""
        self.admin()
        self.user(WAIT, "w@x")
        code = self.code(credits=5)
        lock_holder = psycopg.connect(self.uri(), autocommit=False)
        try:
            lock_holder.execute(INVITE_LOCK_SQL)
            claim = self.start("select public.invite_claim(%s, %s, 'ip')", (WAIT, code))
            claim_waited = self.settle(claim)
            approve = self.start("select public.admin_approve_waiting(%s, 'order')", (WAIT,),
                                 setup=[f"select set_config('request.jwt.claim.sub', '{ADMIN}', false)", "set role authenticated"])
            approve_waited = self.settle(approve)
            lock_holder.commit()                                               # the claim may go on
        finally:
            lock_holder.close()
        self.finish(claim, approve)                                            # a deadlock would show here as a failed statement (40P01)
        self.assertTrue(claim_waited and approve_waited, "both waited, so the case was really built")
        self.assertEqual(claim["result"]["ok"], True)
        self.assertEqual(approve["result"]["flipped"], False)
        self.assertEqual(self.status(WAIT), "active")
        self.assertEqual(self.credits(WAIT), 5)

    # ------------------------------------------------------------------------------------------------ FIXED: the limits under concurrency
    def test_two_joins_at_the_same_moment_cannot_both_pass_the_limit(self):
        self.switch()
        for i in range(4):                                   # the caller is at 4 of its 5 an hour
            self.assertTrue(self.one("service", "select public.join_reserve(%s, 'iphash')", f"p{i}@x.co")["ok"])
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            self.assertTrue(a.execute("select public.join_reserve('p9@x.co', 'iphash')").fetchone()[0]["ok"])      # the 5th, not committed yet
            s = self.start("select public.join_reserve('p8@x.co', 'iphash')")
            waited = self.settle(s)
            a.commit()
        finally:
            a.close()
        self.finish(s)
        self.assertEqual(s["result"], {"ok": False, "reason": "throttled"}, "it waited, saw five, and was stopped")
        self.assertEqual(self.owner("select count(*) from public.join_attempts").fetchone()[0], 5)
        self.assertTrue(waited, "the second caller must wait its turn")

    def test_two_invite_claims_at_the_same_moment_cannot_both_pass_the_guess_limit(self):
        self.user(WAIT, "w@x")
        self.user(WAIT2, "w2@x")
        for _ in range(9):
            self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', 'ipR')", WAIT)["reason"], "invalid")
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            self.assertEqual(a.execute("select public.invite_claim(%s, 'RYA-AAAA-AAAA', 'ipR')", (WAIT,)).fetchone()[0]["reason"], "invalid")      # the 10th, not committed
            s = self.start("select public.invite_claim(%s, 'RYA-AAAA-AAAA', 'ipR')", (WAIT2,))
            waited = self.settle(s)
            a.commit()
        finally:
            a.close()
        self.finish(s)
        self.assertEqual(s["result"]["reason"], "throttled", "it waited, saw ten, and was stopped")
        self.assertTrue(waited, "the second claim must wait its turn")

    def test_two_invite_reservations_at_the_same_moment_cannot_both_pass_the_guess_limit(self):
        self.switch()
        for _ in range(9):
            self.assertEqual(self.one("service", "select public.invite_reserve('RYA-AAAA-AAAA', 'a@x.co', 'ipR')")["reason"], "invalid")
        a = psycopg.connect(self.uri(), autocommit=False)
        try:
            self.assertEqual(a.execute("select public.invite_reserve('RYA-AAAA-AAAA', 'a@x.co', 'ipR')").fetchone()[0]["reason"], "invalid")
            s = self.start("select public.invite_reserve('RYA-AAAA-AAAA', 'b@x.co', 'ipR')")
            waited = self.settle(s)
            a.commit()
        finally:
            a.close()
        self.finish(s)
        self.assertEqual(s["result"]["reason"], "throttled")
        self.assertTrue(waited, "the second reservation must wait its turn")

    # ------------------------------------------------------------------------------------------------ FIXED: no address, still limited (ONE shared bucket)
    def test_an_invite_claim_with_no_caller_address_is_still_limited_per_caller(self):
        self.user(WAIT, "w@x")
        for _ in range(10):
            self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', null)", WAIT)["reason"], "invalid")
        self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', null)", WAIT)["reason"], "throttled",
                         "the 11th try from callers with no address is stopped by the per-caller limit, not only by the overall 300 an hour")

    def test_an_invite_reservation_with_no_caller_address_is_still_limited_per_caller(self):
        self.switch()
        for _ in range(10):
            self.assertEqual(self.one("service", "select public.invite_reserve('RYA-AAAA-AAAA', 'a@x.co', null)")["reason"], "invalid")
        self.assertEqual(self.one("service", "select public.invite_reserve('RYA-AAAA-AAAA', 'a@x.co', null)")["reason"], "throttled")

    def test_callers_with_no_address_share_one_bucket_of_ten_an_hour_across_claims_and_reservations(self):
        """said plainly in the file and in the commit: this is the one behaviour change; the Edge Functions always pass a hashed address"""
        self.user(WAIT, "w@x")
        self.switch()
        for _ in range(5):
            self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', null)", WAIT)["reason"], "invalid")
        for _ in range(5):
            self.assertEqual(self.one("service", "select public.invite_reserve('RYA-AAAA-AAAA', 'a@x.co', null)")["reason"], "invalid")
        self.assertEqual(self.one("service", "select public.invite_reserve('RYA-AAAA-AAAA', 'a@x.co', null)")["reason"], "throttled")
        self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', null)", WAIT)["reason"], "throttled")
        self.assertEqual(self.one("service", "select public.invite_claim(%s, 'RYA-AAAA-AAAA', 'someone-else')", WAIT)["reason"], "invalid", "a caller WITH an address is not in that bucket")

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
        self.switch()
        code = self.code(credits=12, uses=2)
        r = self.one("service", "select public.invite_reserve(%s, 'w@x.co', 'ip')", code)
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)
        self.one("service", "select public.invite_sent(%s, %s)", r["redemption"], WAIT)                  # a replay of the same redemption
        self.assertEqual((self.status(WAIT), self.credits(WAIT)), ("active", 12), "opened and paid once; the replay adds nothing")
        out = self.one("service", "select public.invite_claim(%s, %s, 'ip')", WAIT2, code)
        self.assertTrue(out["ok"] and out["activated"])
        self.assertEqual(self.credits(WAIT2), 12)
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
    def test_the_hardening_replaces_five_functions_and_ends_with_the_gate_like_every_migration_after_it(self):
        sql = HARDEN.read_text(encoding="utf-8")
        self.assertEqual(sql.count("create or replace function"), 5)
        self.assertEqual(sorted(l.split("(")[0].split()[-1] for l in sql.splitlines() if l.startswith("create or replace function")),
                         ["public.invite_claim", "public.invite_reserve", "public.join_reserve", "ryagram_private.activate_account", "ryagram_private.hold_grant"])
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        self.assertNotIn("grant execute", sql.lower().replace("-- ", "#"), "no grant is changed")
        self.assertIn("share ONE per-caller bucket", sql, "the one behaviour change is said plainly in the file")

    def test_the_rollback_puts_the_five_functions_back_exactly_as_they_were_before_the_file(self):
        def defs(db):
            return [db.execute("select md5(pg_get_functiondef(%s::regprocedure))", (f,)).fetchone()[0] for f in FIVE]
        after = defs(self.db.as_(None).c)
        with psycopg.connect(wa._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {self.name}old template tmplpre")
        with psycopg.connect(wa._server.get_uri(database=self.name + "old"), autocommit=True) as c:
            for m in [wa.WAIT_MIG, *[p for p in wa.POST if p != HARDEN]]:
                c.execute(m.read_text(encoding="utf-8"))
            before = defs(c)
        self.assertEqual(len([1 for x, y in zip(before, after) if x != y]), 5, "the file really changed all five")
        self.owner(ROLLBACK.read_text(encoding="utf-8"))
        self.assertEqual(defs(self.db.c), before, "the rollback restored all five")
        for sig in ("public.invite_claim(uuid,text,text)", "public.invite_reserve(text,text,text)", "public.join_reserve(text,text)"):
            acl = self.owner("select count(*) from pg_proc p, aclexplode(p.proacl) x where p.oid = %s::regprocedure and x.grantee = (select oid from pg_roles where rolname = 'service_role')", sig).fetchone()[0]
            self.assertEqual(acl, 1, "the grants stayed on " + sig)


if __name__ == "__main__":
    unittest.main()
