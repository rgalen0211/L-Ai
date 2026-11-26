"""LIVE STEPS 75 AND 75b: WELCOME CREDITS 8 -> 16 FOR NEW VERIFIED EMAILS, AND BACK (CONNECT 2026-11-26; Ryan 17:00, CC1 17:01, GAMES 17:01). On a local Postgres with the 2B ledger and migration 20261123000600. Run from the repo root with TEMP/TMP/TMPDIR on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_welcome_16.py -v

What it proves, each with the opposite case beside it
  * after step 75 a NEW verified email gets 16, a person granted BEFORE keeps their 8 (no back-fill), and the same address again gets nothing more (once per address ever);
  * step 75 REFUSES, changing nothing, when the setting is 0 (switched off on purpose), already 16, or the welcome trigger is missing; parts 1 and 3 are read-only;
  * step 75b puts 8 back and REFUSES from 8 or from 0; a new email after it gets 8 again;
  * live step 63 stays ALL true at 16 and its last row then says 16 credits.
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_welcome_credits as wc  # noqa: E402

LS = core.ROOT / "live-steps"
S75 = (LS / "75_welcome_credits_16.sql").read_text(encoding="utf-8")
S75B = (LS / "75b_welcome_credits_back_to_8.sql").read_text(encoding="utf-8")
S63 = (LS / "63_welcome_credits_check.sql").read_text(encoding="utf-8")


def parts(text):
    return {int(m.group(1)): m.group(2) for m in re.finditer(r"-- PART (\d)[^\n]*\n(.*?)(?=\n-- PART \d|\Z)", text, re.S)}


P75, P75B = parts(S75), parts(S75B)


def setUpModule():
    wc.setUpModule()


class Welcome16(wc.WelcomeCredits):
    def run_sql(self, sql):
        return self.d().execute(sql)

    def lever(self, n):
        self.d().execute("update public.ops_settings set welcome_credits = %s", (n,))

    def level(self):
        return self.d().execute("select welcome_credits from public.ops_settings").fetchone()[0]

    def test_step_75_gives_16_to_new_verified_emails_only_once_per_address_and_no_back_fill(self):
        a = self.user(70, "before@example.com")
        self.assertEqual(self.got(a), 8)
        self.assertEqual(self.run_sql(P75[1]).fetchone(), (8, True, 1, 8))
        self.run_sql(P75[2])
        self.assertEqual(self.level(), 16)
        self.assertEqual(self.run_sql(P75[3]).fetchone(), (16, 1, 8), "read-back: 16, and the one person already granted is unchanged")
        self.assertEqual(self.got(a), 8, "nobody granted before changes")
        b = self.user(71, "after@example.com")
        self.assertEqual(self.got(b), 16)
        self.d().execute("set session_replication_role = replica")
        self.d().execute("delete from public.credit_ledger where owner_id = %s", (b,))
        self.d().execute("delete from auth.users where id = %s", (b,))
        self.d().execute("set session_replication_role = origin")
        c = self.user(72, " After@Example.COM ")
        self.assertEqual(self.got(c), 0, "the same address again: nothing more, 16 or 8")

    def test_step_75_refuses_what_it_should_and_changes_nothing(self):
        self.lever(0)
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P75[2])
        self.assertIn("switched off on purpose", str(cm.exception))
        self.assertEqual(self.level(), 0)
        self.lever(16)
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P75[2])
        self.assertIn("already 16", str(cm.exception))
        self.lever(12)
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P75[2])
        self.assertIn("not 8", str(cm.exception))
        self.assertEqual(self.level(), 12)
        self.lever(8)
        self.d().execute("drop trigger welcome_credits_trg on auth.users")
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P75[2])
        self.assertIn("trigger is not there", str(cm.exception))
        self.assertEqual(self.level(), 8)

    def test_parts_1_and_3_of_both_steps_are_read_only(self):
        write = re.compile(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", re.I)
        for text in (P75[1], P75[3], P75B[1], P75B[3]):
            self.assertFalse(write.search(re.sub(r"--[^\n]*", "", text)))

    def test_step_75b_puts_8_back_refuses_from_8_or_0_and_a_new_email_then_gets_8(self):
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P75B[2])
        self.assertIn("already 8", str(cm.exception))
        self.run_sql(P75[2])
        self.assertEqual(self.run_sql(P75B[1]).fetchone(), (16,))
        self.run_sql(P75B[2])
        self.assertEqual(self.level(), 8)
        self.assertEqual(self.run_sql(P75B[3]).fetchone(), (8,))
        self.assertEqual(self.got(self.user(73, "later@example.com")), 8)
        self.lever(0)
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(P75B[2])
        self.assertIn("not 16", str(cm.exception))
        self.assertEqual(self.level(), 0)

    def test_live_step_63_stays_all_true_at_16_and_says_16(self):
        self.run_sql(P75[2])
        rows = self.run_sql(S63).fetchall()
        self.assertEqual(len(rows), 8)
        self.assertTrue(all(r[1] is True for r in rows), rows)
        self.assertIn("16 credits", rows[-1][0])


# the inherited tests belong to test_welcome_credits.py: only this step's own run here
for _n in [n for n in dir(wc.WelcomeCredits) if n.startswith("test_")]:
    setattr(Welcome16, _n, None)

if __name__ == "__main__":
    unittest.main()
