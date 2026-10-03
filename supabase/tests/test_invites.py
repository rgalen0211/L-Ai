"""Beta invite codes (migrations/20261003000200_invite_codes.sql) on a local Postgres.

Same setup as test_2a_core.py (the file is one of the migrations it loads). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_invites.py -v
"""
import re
import sys
import threading
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule


class Invites(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def issue(self, uses=2, days=14, label="Beta wave 1"):
        return self.admin("select invite_issue(%s, %s, %s)", label, uses, days)

    def reserve(self, code, email="new@example.com", ip="ip-a"):
        return self.db.as_("service").one("select invite_reserve(%s, %s, %s)", code, email, ip)

    def test_codes_are_readable_stored_hashed_and_shown_once(self):
        code = self.issue()
        self.assertRegex(code, r"^RYA-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$")
        self.assertNotRegex(code[4:], r"[01OIL]")
        stored = self.admin("select code_hash from invite_codes")
        self.assertRegex(stored, r"^[0-9a-f]{64}$")
        self.assertNotIn(code.replace("-", ""), stored)
        self.assertNotEqual(self.issue(), code)

    def test_a_good_code_takes_one_use_whatever_its_spacing_or_case(self):
        code = self.issue(uses=2)
        r = self.reserve(code.lower().replace("-", " "))
        self.assertTrue(r["ok"])
        self.assertEqual(self.admin("select uses from invite_codes"), 1)
        self.assertEqual(self.admin("select email, status from invite_redemptions where id = %s", r["redemption"]),
                         ("new@example.com", "pending"))
        self.assertTrue(self.reserve(code[4:], email="second@example.com")["ok"])          # without "RYA-"
        self.assertEqual(self.reserve(code, email="third@example.com"), {"ok": False, "reason": "invalid"})   # used up

    def test_release_gives_the_use_back_once_and_sent_records_the_user(self):
        code = self.issue(uses=1)
        r = self.reserve(code)["redemption"]
        svc = lambda sql, *a: self.db.as_("service").one(sql, *a)
        svc("select invite_release(%s)", r)
        svc("select invite_release(%s)", r)
        self.assertEqual(self.admin("select uses from invite_codes"), 0)
        r2 = self.reserve(code)["redemption"]
        svc("select invite_sent(%s, %s)", r2, RYAN)
        svc("select invite_release(%s)", r2)                                  # too late: it was sent
        self.assertEqual(self.admin("select uses from invite_codes"), 1)
        self.assertEqual(self.admin("select status, user_id::text from invite_redemptions where id = %s", r2), ("sent", RYAN))

    def test_expired_disabled_unknown_and_malformed_are_refused(self):
        old = self.issue(days=1)
        self.admin("update invite_codes set expires_at = now() - interval '1 second' returning 1")
        off = self.issue(label="off")
        self.admin("update invite_codes set disabled = true where label = 'off' returning 1")
        for code in (old, off, "RYA-AAAA-AAAA", "", None, "x" * 500):
            with self.subTest(code=code and code[:12]):
                self.assertEqual(self.reserve(code), {"ok": False, "reason": "invalid"})
        good = self.issue(label="good")
        for email in ("not-an-email", "a@b", "two@@x.com", "", None, "x" * 400 + "@x.com"):
            with self.subTest(email=email and email[:12]):
                self.assertEqual(self.reserve(good, email=email)["reason"], "email")
        self.assertEqual(self.admin("select uses from invite_codes where label = 'good'"), 0)

    def test_guessing_is_throttled_per_address_and_overall(self):
        good = self.issue()
        for _ in range(10):
            self.assertEqual(self.reserve("RYA-WRNG-CODE", ip="ip-a")["reason"], "invalid")
        self.assertEqual(self.reserve(good, ip="ip-a")["reason"], "throttled")    # even a right code, for a while
        self.assertTrue(self.reserve(good, ip="ip-b")["ok"])
        self.admin("insert into invite_attempts (ip_hash) select 'many-' || g from generate_series(1, 300) g returning 1")
        self.assertEqual(self.reserve(good, ip="ip-c")["reason"], "throttled")
        self.admin("update invite_attempts set at = now() - interval '2 days' returning 1")
        self.assertTrue(self.reserve(good, ip="ip-c")["ok"])
        self.assertEqual(self.admin("select count(*) from invite_attempts"), 0)            # old attempts swept

    def test_nobody_but_ryan_mints_codes_and_only_the_service_role_redeems(self):
        code = self.issue()
        for who in ("anon", RYAN, "service"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select invite_issue('x', 1000, 365)")
        for who in ("anon", RYAN):
            for sql in ("select invite_reserve(%s, 'a@b.co', 'ip')", "select * from invite_codes",
                        "select * from invite_redemptions where %s is not null"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql, code)
        with self.assertRaises(psycopg.Error):
            self.db.as_("service").one("select * from invite_codes")

    def test_a_last_use_cannot_be_taken_twice_at_once(self):
        code = self.issue(uses=1)
        uri = core._server.get_uri(database=self.db.c.info.dbname)
        results = []

        def go(i):
            with psycopg.connect(uri, autocommit=True) as c:
                c.execute("set role service_role")
                results.append(c.execute("select invite_reserve(%s, %s, 'ip')", (code, f"p{i}@example.com")).fetchone()[0]["ok"])
        ts = [threading.Thread(target=go, args=(i,)) for i in range(5)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(sorted(results), [False, False, False, False, True])


if __name__ == "__main__":
    unittest.main()
