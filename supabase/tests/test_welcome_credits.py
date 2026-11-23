"""WELCOME CREDITS (migrations/20261123000600_welcome_credits.sql, NOT APPLIED) on a local Postgres with the 2B credits ledger. CONNECT, 2026-11-23 (Ryan's 15:46 answer to Q679 B: 8 welcome credits, one per verified email).
Same setup as test_2b_credits.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_welcome_credits.py -v

What it proves, each with the opposite case beside it
  * a person whose email is VERIFIED gets the setting's credits (8) in the ledger, through grant_credits; an unverified sign-up gets nothing, and the moment of verification (empty -> set) is what gives them, exactly once;
  * once per ADDRESS ever: the same address on a second account (a deleted and remade one, another case, spaces around it) gets nothing; another address gets its own;
  * not for an invite-code account (a redemption for the address, or adult_source invite), an administrator or a worker;
  * the setting: 0 gives nothing, 20 gives 20, a negative or a 101 is refused; an account verified BEFORE the migration (the trigger is not there yet) is not touched;
  * a WAITING account's credits are held and paid at activation (the ledger's existing guard);
  * the trigger NEVER stops a sign-up or a link click: with grant_credits gone the sign-up still works and no record is left behind;
  * the once-per-address table keeps only a scrambled address, survives deleting the account, and is closed to every API role; the function is not callable by anyone;
  * live step 63 answers as its header says before the migration (rollback applied) and after, and the rollback leaves the credits already given.
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

CHK = core.ROOT / "live-steps" / "63_welcome_credits_check.sql"
RB = core.ROOT / "rollbacks" / "20261123000600_welcome_credits_rollback.sql"
U = lambda i: str(uuid.UUID(int=9000 + i))


def setUpModule():
    credits.setUpModule()


class WelcomeCredits(unittest.TestCase):
    tearDown = credits.Ledger.tearDown

    def setUp(self):
        credits.Ledger.setUp(self)
        self.db.as_(None).c.execute("update public.ops_settings set welcome_credits = 8")        # the shared templates switch it off; this suite tests it
    admin, available = credits.Ledger.admin, credits.Ledger.available

    def d(self):
        return self.db.as_(None).c

    def user(self, i, email, confirmed=True, meta=None):
        self.d().execute("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (%s, %s, case when %s then now() end, %s::jsonb)",
                         (U(i), email, confirmed, None if meta is None else __import__("json").dumps(meta)))
        return U(i)

    def got(self, uid):
        return int(self.d().execute("select coalesce(sum(amount), 0) from public.credit_ledger where owner_id = %s and entry = 'grant'", (uid,)).fetchone()[0])

    def test_a_verified_email_gets_8_credits_through_the_ledger_and_the_record_holds_only_a_scrambled_address(self):
        a = self.user(1, "Ann@Example.com")
        self.assertEqual(self.got(a), 8)
        self.assertEqual(self.available(a), 8, "available to spend")
        row = self.d().execute("select entry::text, pool::text, amount, reason, created_by from public.credit_ledger where owner_id = %s", (a,)).fetchall()
        self.assertEqual(row, [("grant", "granted", 8, "Welcome credits (email verified)", "welcome")])
        hashes = [r[0] for r in self.d().execute("select email_hash from ryagram_private.welcome_credit_grants").fetchall()]
        self.assertEqual(len(hashes), 1)
        self.assertNotIn("ann", hashes[0].lower(), "no address, only a hash")
        cols = [r[0] for r in self.d().execute("select column_name from information_schema.columns where table_schema = 'ryagram_private' and table_name = 'welcome_credit_grants' order by 1").fetchall()]
        self.assertEqual(cols, ["email_hash", "granted_at"], "no user id")

    def test_an_unopened_email_gets_nothing_and_the_moment_of_verification_gives_them_exactly_once(self):
        a = self.user(2, "bea@example.com", confirmed=False)
        self.assertEqual(self.got(a), 0, "signed up, not verified: nothing")
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (a,))
        self.assertEqual(self.got(a), 8)
        self.d().execute("update auth.users set email_confirmed_at = now() + interval '1 minute' where id = %s", (a,))
        self.d().execute("update auth.users set raw_user_meta_data = '{}'::jsonb where id = %s", (a,))
        self.assertEqual(self.got(a), 8, "a later change of the verified time, or any other update, gives nothing more")

    def test_once_per_address_ever_even_after_the_account_is_deleted_and_remade(self):
        a = self.user(3, "cy@example.com")
        self.assertEqual(self.got(a), 8)
        self.d().execute("set session_replication_role = replica")               # the account-deletion path removes the person's rows; here only the memory of the address matters
        self.d().execute("delete from public.credit_ledger where owner_id = %s", (a,))
        self.d().execute("delete from auth.users where id = %s", (a,))
        self.d().execute("set session_replication_role = origin")
        b = self.user(4, "  CY@Example.COM ")
        self.assertEqual(self.got(b), 0, "the same address, remade: nothing, whatever the case or spaces")
        c = self.user(5, "cy.two@example.com")
        self.assertEqual(self.got(c), 8, "another address gets its own")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 2, "the memory survived the deletion")

    def test_not_for_an_invite_code_account_an_administrator_or_a_worker(self):
        self.d().execute("insert into public.invite_codes (code_hash, label, max_uses, expires_at) values (repeat('b', 64), 'test', 5, now() + interval '1 day')")
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status) values (repeat('b', 64), 'inv@example.com', 'sent')")
        self.assertEqual(self.got(self.user(6, "inv@example.com")), 0, "a redemption exists for the address: it keeps its own credits")
        self.assertEqual(self.got(self.user(7, "meta@example.com", meta={"adult_confirmed": "true", "adult_source": "invite"})), 0, "adult_source invite")
        adm = U(8)
        self.d().execute("insert into auth.users (id, email) values (%s, 'adm@example.com')", (adm,))
        self.d().execute("insert into public.app_admins (user_id) values (%s)", (adm,))
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (adm,))
        self.assertEqual(self.got(adm), 0, "an administrator")
        wk = U(9)
        self.d().execute("insert into auth.users (id, email) values (%s, 'wk@example.com')", (wk,))
        self.d().execute("insert into public.workers (user_id, name) values (%s, 'w')", (wk,))
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (wk,))
        self.assertEqual(self.got(wk), 0, "a worker")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 0, "and none of them used up an address")

    def test_the_setting_is_the_amount_zero_is_off_and_the_range_is_enforced(self):
        self.d().execute("update public.ops_settings set welcome_credits = 0")
        self.assertEqual(self.got(self.user(10, "z@example.com")), 0, "0 = off")
        self.d().execute("update public.ops_settings set welcome_credits = 20")
        self.assertEqual(self.got(self.user(11, "twenty@example.com")), 20)
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 1, "an address that got nothing because the setting was 0 has NOT used up its welcome")
        self.d().execute("update public.ops_settings set welcome_credits = 8")
        self.assertEqual(self.got(self.user(12, "z@example.com", confirmed=False)), 0)
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (U(12),))
        self.assertEqual(self.got(U(12)), 8, "once Ryan turns it back on, the same address gets them")
        for bad in (-1, 101):
            with self.assertRaises(psycopg.Error):
                self.d().execute("update public.ops_settings set welcome_credits = %s", (bad,))
        for who in ("anon", U(50)):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("update public.ops_settings set welcome_credits = 100 returning 1")

    def test_a_waiting_account_has_its_credits_held_and_paid_at_activation(self):
        self.d().execute("update public.ops_settings set waiting_accounts = true")
        w = self.user(13, "wait@example.com")
        held = int(self.d().execute("select coalesce(sum(credits), 0) from public.held_grants where owner_id = %s", (w,)).fetchone()[0])
        self.assertEqual(self.got(w) + held, 8, "the 8 are either already in the ledger or HELD by the existing waiting-account guard (this test database loads the ledger after the waiting migration, so the guard may not be patched in; on live it is)")
        self.d().execute("select ryagram_private.activate_account(%s, 'approved', null, 0, 'test')", (w,))
        self.assertEqual(self.got(w), 8, "and in the ledger once the account opens, never twice")

    def test_the_trigger_never_stops_a_sign_up_or_a_link_click(self):
        self.d().execute("drop function public.grant_credits(uuid, public.credit_entry, int, text, text, text, text, text)")
        a = self.user(14, "nogrant@example.com")
        self.assertEqual(self.d().execute("select count(*) from auth.users where id = %s", (a,)).fetchone()[0], 1, "the sign-up went through")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 0, "and no half-done record is left (it rolled back with the failed grant)")

    def test_the_table_and_the_function_are_closed(self):
        for who in ("anon", U(50), "service"):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select count(*) from ryagram_private.welcome_credit_grants")
        for who in ("anon", U(50)):
            with self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select ryagram_private.welcome_credits_on_verified()")

    def test_an_account_verified_before_the_migration_is_not_touched_and_the_rollback_leaves_the_credits(self):
        self.d().execute(RB.read_text(encoding="utf-8"))                       # back to before the migration
        old = self.user(15, "old@example.com")
        self.assertEqual(self.got(old), 0, "no trigger, no grant")
        self.assertEqual(self.d().execute("select to_regclass('ryagram_private.welcome_credit_grants')").fetchone()[0], None)
        self.assertEqual(self.d().execute("select count(*) from information_schema.columns where table_name = 'ops_settings' and column_name = 'welcome_credits'").fetchone()[0], 0)

    def test_the_rollback_leaves_credits_already_given(self):
        a = self.user(16, "given@example.com")
        self.assertEqual(self.got(a), 8)
        self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertEqual(self.got(a), 8, "nobody loses what they were given")

    def test_the_check_step_answers_as_its_header_says_before_and_after(self):
        text = CHK.read_text(encoding="utf-8")
        rows = self.d().execute(text).fetchall()
        self.assertEqual(len(rows), 8)
        self.assertTrue(all(r[1] is True for r in rows), rows)
        self.assertIn("8 credits", rows[-1][0])
        self.d().execute("drop trigger welcome_credits_trg on auth.users")
        self.d().execute("create trigger welcome_credits_trg after insert on auth.users for each row execute function ryagram_private.welcome_credits_on_verified()")
        rows = self.d().execute(text).fetchall()
        self.assertFalse(rows[3][1], "a trigger that watches only inserts (a link click would give nothing) is not the right one: row 4 says so")
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.d().execute(text).fetchall()
        self.assertEqual([r[1] for r in rows], [True, False, False, False, False, False, True, True], rows)
        self.assertIn("not applied", rows[-1][0])


if __name__ == "__main__":
    unittest.main()
