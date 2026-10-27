"""'Invite someone' (migrations/20261017000200_invite_someone.sql): Ryan invites a friend by name before the public form is live. The code is shown once,
carries the welcome credits, redeems exactly once, and the code row (it holds the name) is removed 12 months after use or expiry.

Same setup as test_creator_flow.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_invite_someone.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2b_credits as credits  # noqa: E402
import test_creator_flow as flow  # noqa: E402

RYAN, OTHER = flow.RYAN, flow.OTHER
setUpModule = flow.setUpModule


class InviteSomeone(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, denied = credits.Ledger.admin, credits.Ledger.denied
    make_ryan_admin, ryan, svc, balance = flow.CreatorFlow.make_ryan_admin, flow.CreatorFlow.ryan, flow.CreatorFlow.svc, flow.CreatorFlow.balance

    def invite(self, name="Maya Ortiz", credits=None):
        return self.ryan().one("select admin_invite_person(%s, %s)", name, credits)

    def test_a_code_with_the_welcome_credits_is_made_and_shown_once_labelled_with_the_name(self):
        self.make_ryan_admin()
        code = self.invite("  Maya   Ortiz ")
        self.assertRegex(code, r"^RYA-[A-Z2-9]{4}-[A-Z2-9]{4}$")
        row = self.admin("select label, max_uses, grant_credits, expires_at > now() + interval '29 days', expires_at < now() + interval '31 days' from public.invite_codes")
        self.assertEqual(tuple(row), ("invite: Maya Ortiz", 1, 20, True, True))               # name tidied, single use, the default 20 welcome credits, 30 days
        self.assertEqual(self.admin("select count(*) from public.invite_codes where code_hash = %s", code), 0)      # only a hash is stored
        self.assertEqual(self.admin("select count(*) from public.invite_codes"), 1)
        self.assertNotEqual(self.invite("Sam Lee", 35), code)                                   # another call is another code, never the same one shown twice
        self.assertEqual(self.admin("select grant_credits from public.invite_codes where label = 'invite: Sam Lee'"), 35)
        self.assertEqual(self.admin("select count(*) from public.creator_applications"), 0)     # it needs no application

    def test_the_code_redeems_once_and_grants_exactly_the_credits_once(self):
        self.make_ryan_admin()
        code = self.invite("Maya Ortiz")
        newbie = str(uuid.uuid4())
        self.admin("insert into auth.users (id, email) values (%s, 'maya@example.com') returning 1", newbie)
        r = self.svc().one("select invite_reserve(%s, 'maya@example.com', 'iphash')", code)
        self.assertTrue(r["ok"])
        self.svc().one("select invite_sent(%s, %s)", r["redemption"], newbie)
        self.svc().one("select invite_sent(%s, %s)", r["redemption"], newbie)                  # a repeat changes nothing
        self.assertEqual(self.balance(newbie), 20)
        again = self.svc().one("select invite_reserve(%s, 'other@example.com', 'iphash2')", code)
        self.assertFalse(again["ok"])                                                           # single use: a second person cannot use it

    def test_only_ryan_can_make_one_and_bad_input_is_refused(self):
        self.make_ryan_admin()
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_invite_person('Maya')")
        self.assertEqual(self.admin("select count(*) from public.invite_codes"), 0)
        for bad in ("select admin_invite_person('')", "select admin_invite_person('   ')", "select admin_invite_person(null)", "select admin_invite_person(repeat('x', 101))",
                    "select admin_invite_person('Maya', -1)", "select admin_invite_person('Maya', 1001)"):
            with self.assertRaises(psycopg.Error, msg=bad):
                self.ryan().one(bad)
        self.assertEqual(self.admin("select count(*) from public.invite_codes"), 0)

    def test_retention_a_person_invite_goes_12_months_after_use_or_expiry_and_never_earlier(self):
        self.make_ryan_admin()
        used_old, used_recent = self.invite("Used Old"), self.invite("Used Recent")
        self.invite("Unused Old")
        self.invite("Unused Valid")
        self.admin("select public.invite_issue('creator #77 Someone', 1, 30)")
        self.admin("select public.invite_issue('Beta wave 1', 1, 14)")
        for code, who, months in ((used_old, "u1", 13), (used_recent, "u2", 11)):
            r = self.svc().one("select invite_reserve(%s, %s, 'iphash')", code, f"{who}@example.com")
            self.admin("update public.invite_redemptions set created_at = now() - make_interval(months => %s) where id = %s returning 1", months, r["redemption"])
        for label in ("Unused Old", "Used Old", "Used Recent"):               # all three expired 13 months ago; only USE keeps the two used ones' clocks apart
            self.admin("update public.invite_codes set expires_at = now() - interval '13 months' where label = %s returning 1", f"invite: {label}")
        r = self.svc().one("select retention_purge()")
        self.assertEqual(r["person_invites"], 2)                                  # Used Old (used 13 months ago) and Unused Old (expired 13 months ago)
        left = sorted(x[0] for x in self.db.as_(None).all("select label from public.invite_codes"))
        self.assertEqual(left, ["Beta wave 1", "creator #77 Someone", "invite: Unused Valid", "invite: Used Recent"])     # other codes are untouched
        self.assertEqual(self.admin("select count(*) from public.invite_redemptions"), 1)                                  # the removed code's redemption (the email) went with it
        self.assertEqual((r["applications"], r["help_requests"], r["reports"]), (0, 0, 0))

    def test_an_unused_invite_that_is_still_valid_or_expired_less_than_12_months_ago_is_kept(self):
        self.make_ryan_admin()
        self.invite("Fresh")
        self.invite("Lapsed Recently")
        self.admin("update public.invite_codes set expires_at = now() - interval '11 months' where label = 'invite: Lapsed Recently' returning 1")
        r = self.svc().one("select retention_purge()")
        self.assertEqual(r["person_invites"], 0)
        self.assertEqual(self.admin("select count(*) from public.invite_codes"), 2)


if __name__ == "__main__":
    unittest.main()
