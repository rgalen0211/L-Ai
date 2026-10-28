"""Invite email sent by Ryagram (migrations/20261027000800_invite_email.sql, NEXT-WEB 155): the address is bound to the code on the first send, 60 seconds between sends,
3 sends at most, a failed send gives its reservation back, only an admin can reserve one, only 'invite: <name>' codes qualify, ops_outbox accepts the 'invite' kind, and the
address goes with its code when the 12-month purge removes it.

Same setup as test_invite_someone.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_invite_email.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2b_credits as credits  # noqa: E402
import test_creator_flow as flow  # noqa: E402

RYAN, OTHER = flow.RYAN, flow.OTHER
setUpModule = flow.setUpModule


class InviteEmail(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, denied = credits.Ledger.admin, credits.Ledger.denied
    make_ryan_admin, ryan, svc = flow.CreatorFlow.make_ryan_admin, flow.CreatorFlow.ryan, flow.CreatorFlow.svc

    def invite(self, name="Maya Ortiz", credits=None):
        return self.ryan().one("select admin_invite_person(%s, %s)", name, credits)

    def begin(self, code, email="maya@example.com"):
        return self.ryan().one("select admin_invite_send_begin(%s, %s)", code, email)

    def age(self, minutes=2):
        self.admin("update public.invite_sends set last_sent_at = now() - make_interval(secs => %s) returning 1", minutes * 60)

    def test_the_first_send_binds_the_address_and_returns_what_the_email_needs(self):
        self.make_ryan_admin()
        code = self.invite("Maya Ortiz", 35)
        r = self.begin(code, "  Maya@Example.COM ")
        self.assertEqual((r["to"], r["name"], r["credits"], r["sends"]), ("maya@example.com", "Maya Ortiz", 35, 1))
        row = self.admin("select to_addr, sends, first_sent_at is not null, last_sent_at is not null from public.invite_sends")
        self.assertEqual(tuple(row), ("maya@example.com", 1, True, True))
        self.assertEqual(self.admin("select count(*) from public.invite_sends where code_hash = %s", code), 0)       # only a hash, as for the code itself

    def test_another_address_is_refused_and_so_is_a_list_or_a_malformed_one(self):
        self.make_ryan_admin()
        code = self.invite()
        self.begin(code)
        self.age()
        with self.assertRaisesRegex(psycopg.Error, "another address"):
            self.begin(code, "stranger@example.com")
        self.assertEqual(self.admin("select to_addr from public.invite_sends"), "maya@example.com")
        fresh = self.invite("Sam Lee")
        for bad in ("", "   ", "nobody", "a@b", "a b@example.com", "a@example.com, b@example.com", "<a@example.com>", "a@example.com;b@example.com", "x" * 320 + "@e.co"):
            with self.assertRaisesRegex(psycopg.Error, "one email address", msg=bad):
                self.begin(fresh, bad)
        self.assertEqual(self.admin("select count(*) from public.invite_sends"), 1)

    def test_resend_waits_60_seconds_and_stops_after_three(self):
        self.make_ryan_admin()
        code = self.invite()
        self.begin(code)
        with self.assertRaisesRegex(psycopg.Error, "Wait \\d+ more seconds"):
            self.begin(code)                                                          # at once: too soon
        self.age(0.5)
        with self.assertRaisesRegex(psycopg.Error, "Wait \\d+ more seconds"):
            self.begin(code)                                                          # 30 s: still too soon
        self.age(2)
        self.assertEqual(self.begin(code)["sends"], 2)
        self.age(2)
        self.assertEqual(self.begin(code)["sends"], 3)
        self.age(2)
        with self.assertRaisesRegex(psycopg.Error, "3 times"):
            self.begin(code)
        self.assertEqual(self.admin("select sends from public.invite_sends"), 3)

    def test_a_failed_send_gives_its_reservation_back(self):
        self.make_ryan_admin()
        code = self.invite()
        self.begin(code)
        self.ryan().one("select admin_invite_send_undo(%s)", code)
        self.assertEqual(self.admin("select count(*) from public.invite_sends"), 0)           # the first send never happened: the address is not bound either
        self.begin(code, "other@example.com")                                                 # so the right address can still be set
        self.age()
        self.begin(code, "other@example.com")
        self.ryan().one("select admin_invite_send_undo(%s)", code)
        row = self.admin("select sends, last_sent_at < now() - interval '60 seconds' from public.invite_sends")
        self.assertEqual(tuple(row), (1, True))                                               # back to one send, and no 60-second wait for the retry
        self.begin(code, "other@example.com")

    def test_only_an_admin_can_reserve_or_undo_a_send(self):
        self.make_ryan_admin()
        code = self.invite()
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_invite_send_begin(%s, 'maya@example.com')", code)
            self.denied(who, "select admin_invite_send_undo(%s)", code)
        self.assertEqual(self.admin("select count(*) from public.invite_sends"), 0)
        for who in (RYAN, OTHER, "anon", "service"):                                          # the table itself is closed to every API role
            self.denied(who, "select * from public.invite_sends")

    def test_only_a_valid_unused_person_invite_can_be_sent(self):
        self.make_ryan_admin()
        with self.assertRaisesRegex(psycopg.Error, "not one you can send"):
            self.begin("RYA-ZZZZ-ZZZZ")                                                       # unknown
        creator = self.admin("select public.invite_issue('creator #7 Someone', 1, 30)")
        with self.assertRaisesRegex(psycopg.Error, "not one you can send"):
            self.begin(creator)                                                               # a creator application's code is not sent from here
        used, lapsed, off = self.invite("Used"), self.invite("Lapsed"), self.invite("Off")
        self.admin("update public.invite_codes set uses = 1 where label = 'invite: Used' returning 1")
        self.admin("update public.invite_codes set expires_at = now() - interval '1 day' where label = 'invite: Lapsed' returning 1")
        self.admin("update public.invite_codes set disabled = true where label = 'invite: Off' returning 1")
        for c in (used, lapsed, off):
            with self.assertRaisesRegex(psycopg.Error, "expired or was already used"):
                self.begin(c)
        self.assertEqual(self.admin("select count(*) from public.invite_sends"), 0)

    def test_the_outbox_takes_the_invite_kind_and_still_refuses_others(self):
        self.assertTrue(self.admin("select ops_outbox_add('invite', 'dry_run', 'maya@example.com', 'Your Ryagram invite', 'body')"))
        self.assertEqual(self.admin("select kind from public.ops_outbox"), "invite")
        with self.assertRaises(psycopg.Error):
            self.admin("select ops_outbox_add('bogus', 'dry_run', 'a@b.co', 's', 'b')")
        self.assertTrue(self.admin("select ops_outbox_add('alert', 'dry_run', 'ryagram@uselai.com', 's', 'b')"))     # the old kinds still work

    def test_the_address_goes_with_its_code_when_the_12_month_purge_removes_it(self):
        self.make_ryan_admin()
        old, keep = self.invite("Old One"), self.invite("Keep One")
        self.begin(old)
        self.begin(keep, "keep@example.com")
        self.admin("update public.invite_codes set expires_at = now() - interval '13 months' where label = 'invite: Old One' returning 1")
        self.assertEqual(self.svc().one("select retention_purge()")["person_invites"], 1)
        self.assertEqual(self.admin("select string_agg(to_addr, ',') from public.invite_sends"), "keep@example.com")


if __name__ == "__main__":
    unittest.main()
