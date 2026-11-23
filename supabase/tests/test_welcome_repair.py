"""LIVE STEP 66: the welcome-credits repair (CONNECT 2026-11-23; CC1 18:02, GAMES 18:02). On a local Postgres with the 2B ledger and migration 20261123000600. Run from the repo root with TEMP/TMP/TMPDIR on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_welcome_repair.py -v

What it proves, each with the opposite case beside it
  * with the lever at 0 people who confirm get nothing and are NOT recorded; after the lever goes back to 8 the repair pays exactly them (and not a worker, an administrator, an invite-code account, or someone confirmed longer ago than the window);
  * it records the address it pays, so a SECOND run pays nobody and a person who already had their credits is not paid again;
  * it REFUSES, changing nothing, while the lever is 0; any error undoes the WHOLE block (no half-paid state);
  * parts 1 and 3 are read-only (no write words), part 2 is the only write; the credits are given through grant_credits with created_by 'welcome-repair'.
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_welcome_credits as wc  # noqa: E402

STEP = (core.ROOT / "live-steps" / "66_welcome_credits_repair.sql").read_text(encoding="utf-8")
PARTS = {int(m.group(1)): m.group(2) for m in re.finditer(r"-- PART (\d) [^\n]*\n(.*?)(?=\n-- PART \d |\Z)", STEP, re.S)}


def setUpModule():
    wc.setUpModule()


class WelcomeRepair(wc.WelcomeCredits):
    # the shared fixtures and helpers (user, got, d) come from the welcome tests; only the repair's own tests run here
    def setUp(self):
        super().setUp()
        self.d().execute("alter table auth.users add column if not exists last_sign_in_at timestamptz")   # real Supabase has it; the test stub does not

    def run_part(self, n):
        cur = self.d().execute(PARTS[n])
        return cur.fetchall() if cur.description else None

    def lever(self, n):
        self.d().execute("update public.ops_settings set welcome_credits = %s", (n,))

    def test_the_repair_pays_exactly_the_people_who_confirmed_while_the_lever_was_0_and_only_once(self):
        self.lever(0)
        a, b = self.user(20, "gap1@example.com"), self.user(21, "gap2@example.com")
        self.assertEqual((self.got(a), self.got(b)), (0, 0), "nothing at 0")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 0, "and nothing recorded")
        self.d().execute("insert into public.invite_codes (code_hash, label, max_uses, expires_at) values (repeat('c', 64), 'test', 5, now() + interval '1 day')")
        self.d().execute("insert into public.invite_redemptions (code_hash, email, status) values (repeat('c', 64), 'inv2@example.com', 'sent')")
        inv = self.user(22, "inv2@example.com")
        adm = U = self.user(23, "adm2@example.com", confirmed=False)
        self.d().execute("insert into public.app_admins (user_id) values (%s)", (adm,))
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (adm,))
        wk = self.user(24, "wk2@example.com", confirmed=False)
        self.d().execute("insert into public.workers (user_id, name) values (%s, 'w')", (wk,))
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (wk,))
        old = self.user(25, "old2@example.com")
        self.d().execute("update auth.users set email_confirmed_at = now() - interval '3 days' where id = %s", (old,))
        self.lever(8)
        before = self.run_part(1)
        self.assertEqual(before[0][0], 2, "part 1: exactly the two who confirmed in the gap")
        self.assertEqual(before[0][1], 8, "and the lever now")
        self.run_part(2)
        self.assertEqual((self.got(a), self.got(b)), (8, 8))
        for who in (inv, adm, wk, old):
            self.assertEqual(self.got(who), 0, "invite-code, administrator, worker and a person outside the window are not paid")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 2, "the two addresses are recorded")
        self.assertEqual(self.d().execute("select count(*) from public.credit_ledger where created_by = 'welcome-repair' and reason = 'Welcome credits (email verified)'").fetchone()[0], 2)
        self.assertEqual(self.run_part(3)[0][0], 2)
        self.assertEqual(self.run_part(1)[0][0], 0, "nobody left to pay")
        self.run_part(2)                                                                    # a second run
        self.assertEqual((self.got(a), self.got(b)), (8, 8), "never paid twice")
        self.assertEqual(self.run_part(3)[0][0], 2)

    def test_a_signed_in_account_whose_email_is_still_unconfirmed_is_paid_once_and_opening_the_first_email_later_pays_nothing_more(self):
        # GAMES 18:06 / CC1 18:07: a stranger who came back by the reset link and never opened the first email (hosted behaviour unproven)
        self.d().execute("alter table auth.users add column if not exists last_sign_in_at timestamptz")
        a = self.user(40, "reset1@example.com", confirmed=False)
        b = self.user(41, "never@example.com", confirmed=False)
        c = self.user(42, "longago@example.com", confirmed=False)
        self.d().execute("update auth.users set last_sign_in_at = now() where id = %s", (a,))
        self.d().execute("update auth.users set last_sign_in_at = now() - interval '3 days' where id = %s", (c,))
        self.assertEqual(self.run_part(1)[0][0], 1, "part 1 counts only the signed-in unconfirmed one (not never-signed-in, not outside the window)")
        self.run_part(2)
        self.assertEqual((self.got(a), self.got(b), self.got(c)), (8, 0, 0))
        self.run_part(2)
        self.assertEqual(self.got(a), 8, "a second run pays nobody")
        self.d().execute("update auth.users set email_confirmed_at = now() where id = %s", (a,))
        self.assertEqual(self.got(a), 8, "opening the first email later pays nothing more: the address has its record")

    def test_capitals_and_spaces_in_the_address_are_the_same_address_as_the_trigger_sees_it(self):
        self.lever(0)
        a = self.user(50, "  Cap.Name@Example.COM ")
        self.lever(8)
        self.run_part(2)
        self.assertEqual(self.got(a), 8)
        self.lever(8)
        b = self.user(51, "cap.name@example.com")
        self.assertEqual(self.got(b), 0, "the same address in other case/spacing was recorded by the repair under the trigger's key, so the trigger pays nothing")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 1)

    def test_an_account_with_an_open_deletion_request_is_not_paid(self):
        self.lever(0)
        gone = self.user(60, "leaving@example.com")
        stay = self.user(61, "staying@example.com")
        self.d().execute("insert into public.account_deletion_requests (owner_id, email, reason) values (%s, 'leaving@example.com', 'test')", (gone,))
        self.lever(8)
        self.assertEqual(self.run_part(1)[0][0], 1, "part 1 counts only the one who stays")
        self.run_part(2)
        self.assertEqual((self.got(gone), self.got(stay)), (0, 8))
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 1, "and the address of the one who left is not recorded")

    def test_someone_who_already_had_their_credits_is_not_paid_again(self):
        a = self.user(30, "fine@example.com")
        self.assertEqual(self.got(a), 8)
        self.assertEqual(self.run_part(1)[0][0], 0)
        self.run_part(2)
        self.assertEqual(self.got(a), 8)

    def test_it_refuses_while_the_lever_is_0_and_changes_nothing(self):
        self.lever(0)
        a = self.user(31, "zero@example.com")
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute(PARTS[2])
        self.assertIn("the welcome lever is 0", str(cm.exception))
        self.assertEqual(self.got(a), 0)
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 0)

    def test_an_error_undoes_the_whole_block(self):
        self.lever(0)
        a, b = self.user(32, "half1@example.com"), self.user(33, "half2@example.com")
        self.lever(8)
        self.d().execute("create or replace function public.grant_credits(p_owner uuid, p_entry public.credit_entry, p_credits int, p_reason text, p_created_by text, p_stripe_event_id text default null, p_period_key text default null, p_price_code text default null) "
                         "returns bigint language plpgsql as $$ begin if p_owner = %s::uuid then raise exception 'planted'; end if; insert into public.credit_ledger (owner_id, entry, pool, amount, reason, created_by) values (p_owner, p_entry, 'granted', p_credits, p_reason, p_created_by); return 1; end $$" % ("'" + b + "'",))
        with self.assertRaises(psycopg.Error):
            self.d().execute(PARTS[2])
        self.assertEqual((self.got(a), self.got(b)), (0, 0), "the first person was not left paid")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.welcome_credit_grants").fetchone()[0], 0, "and no record is left behind")

    def test_parts_1_and_3_are_read_only_and_only_part_2_writes_through_grant_credits(self):
        self.assertEqual(sorted(PARTS), [1, 2, 3])
        write = re.compile(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", re.I)
        for n in (1, 3):
            code = re.sub(r"--[^\n]*", "", PARTS[n])
            self.assertFalse(write.search(code), f"part {n}")
        self.assertIn("public.grant_credits(", PARTS[2])
        self.assertIn("'welcome-repair'", PARTS[2])
        self.assertIn("on conflict (email_hash) do nothing", PARTS[2])
        for n in (1, 2):                                                                    # the window is written twice in each part (confirmed, and signed in but unconfirmed): every one must say 48, in both parts
            self.assertEqual(PARTS[n].count("interval '48 hours'"), 2, f"part {n}")
            self.assertEqual(len(re.findall(r"interval '\d+ hours'", PARTS[n])), 2, f"part {n}: another window written")


# the inherited tests belong to test_welcome_credits.py: only the repair's own run here
for _n in [n for n in dir(wc.WelcomeCredits) if n.startswith("test_")]:
    setattr(WelcomeRepair, _n, None)
for _n in ("test_the_repair_pays_exactly_the_people_who_confirmed_while_the_lever_was_0_and_only_once", "test_someone_who_already_had_their_credits_is_not_paid_again",
           "test_it_refuses_while_the_lever_is_0_and_changes_nothing", "test_an_error_undoes_the_whole_block", "test_parts_1_and_3_are_read_only_and_only_part_2_writes_through_grant_credits"):
    pass

if __name__ == "__main__":
    unittest.main()
