"""Waitlist by film (migrations/20261003000300_admin_waitlist_by_film.sql) on a local Postgres.

Same setup as test_2a_core.py (the file is one of the migrations it loads). Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_admin_waitlist.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule
R002 = 'uselai.com/ryagram?utm_source=youtube&utm_campaign=r002-industry-story'
HOUSING = 'uselai.com/ryagram?utm_source=youtube&utm_campaign=housing-supply-story'
FILMPAGE = 'uselai.com/ryagram?utm_source=film_page&utm_medium=referral&utm_campaign=AbCdEfGhIjKlMnOpQrStUv'


class AdminWaitlist(core.Base):
    def admin_sql(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def make_ryan_admin(self):
        # What the migration's seed does on the live project, where Ryan's account exists.
        self.admin_sql("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin_sql("insert into public.app_admins (user_id, note) select id, 'test' from auth.users "
                       "where lower(email) = 'ryan.galen@uselai.com' returning 1")

    def signup(self, email, source, at):
        self.admin_sql("insert into public.ryagram_waitlist (email, source, created_at) values (%s, %s, %s) returning 1",
                       email, source, at)

    # EST5EDT: New York's rules (US daylight saving), built into Postgres. The local test server has
    # no zone files, so 'America/New_York' (the function's default, fine on Supabase) isn't known here.
    def rows(self, who=RYAN, days=90, tz='EST5EDT'):
        return self.db.as_(who).all("select day::text, campaign, utm_source, signups from waitlist_by_film(%s, %s)", days, tz)

    def test_the_seed_finds_ryan_by_email_and_does_nothing_without_him(self):
        self.assertEqual(self.admin_sql("select count(*) from public.app_admins"), 0)   # no such email in the template
        self.make_ryan_admin()
        self.assertIs(self.db.as_(RYAN).one("select is_app_admin()"), True)
        self.assertIs(self.db.as_(OTHER).one("select is_app_admin()"), False)

    def test_counts_per_film_per_day_with_no_personal_data(self):
        self.make_ryan_admin()
        self.signup('a@x.co', R002, '2026-10-03T21:59:03Z')        # 17:59 New York, Oct 3
        self.signup('b@x.co', R002, '2026-10-04T03:30:00Z')        # 23:30 New York, still Oct 3
        self.signup('c@x.co', R002, '2026-10-04T05:00:00Z')        # 01:00 New York, Oct 4
        self.signup('d@x.co', HOUSING, '2026-10-03T15:00:00Z')
        self.signup('e@x.co', FILMPAGE, '2026-10-03T16:00:00Z')
        self.signup('f@x.co', 'uselai.com/ryagram', '2026-10-03T17:00:00Z')
        got = self.rows(days=3660)
        self.assertIn(('2026-10-03', 'r002-industry-story', 'youtube', 2), got)
        self.assertIn(('2026-10-04', 'r002-industry-story', 'youtube', 1), got)
        self.assertIn(('2026-10-03', 'housing-supply-story', 'youtube', 1), got)
        self.assertIn(('2026-10-03', 'AbCdEfGhIjKlMnOpQrStUv', 'film_page', 1), got)
        self.assertIn(('2026-10-03', None, None, 1), got)
        self.assertEqual(sum(r[3] for r in got), 6)
        self.assertNotIn('@', repr(got))                                                    # counts only
        cols = self.db.as_(RYAN).c.execute("select * from waitlist_by_film(3660, 'UTC')").description
        self.assertEqual([c.name for c in cols], ['day', 'campaign', 'utm_source', 'signups'])
        # UTC days differ from New York days at the boundary.
        utc = self.rows(days=3660, tz='UTC')
        self.assertIn(('2026-10-04', 'r002-industry-story', 'youtube', 2), utc)

    def test_the_window_only_counts_recent_signups(self):
        self.make_ryan_admin()
        self.signup('old@x.co', R002, '2020-01-01T00:00:00Z')
        self.admin_sql("insert into public.ryagram_waitlist (email, source) values ('new@x.co', %s) returning 1", R002)
        self.assertEqual(sum(r[3] for r in self.rows(days=30)), 1)
        self.assertEqual(sum(r[3] for r in self.rows(days=3660)), 2)

    def test_nobody_else_reads_anything(self):
        self.make_ryan_admin()
        self.signup('a@x.co', R002, '2026-10-03T21:59:03Z')
        for who in (OTHER, 'anon'):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select count(*) from waitlist_by_film(90, 'UTC')")
        with self.assertRaises(psycopg.Error):
            self.db.as_('anon').one("select is_app_admin()")
        for who in (RYAN, OTHER, 'anon'):
            for sql in ("select * from public.ryagram_waitlist", "select * from public.app_admins",
                        "select ryagram_private.is_app_admin()"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql)
        # Nobody makes themselves an admin.
        for sql in ("insert into public.app_admins (user_id) values (%s)", "delete from public.app_admins where user_id = %s"):
            with self.subTest(sql=sql), self.assertRaises(psycopg.Error):
                self.db.as_(OTHER).one(sql + " returning 1", OTHER)
        self.assertIs(self.db.as_(OTHER).one("select is_app_admin()"), False)

    def test_bad_arguments_are_refused(self):
        self.make_ryan_admin()
        for days, tz in ((0, 'UTC'), (5000, 'UTC'), (None, 'UTC'), (30, 'Not/AZone'), (30, "UTC'; drop table x; --")):
            with self.subTest(days=days, tz=tz), self.assertRaises(psycopg.Error):
                self.db.as_(RYAN).one("select count(*) from waitlist_by_film(%s, %s)", days, tz)

    def test_an_admin_whose_account_is_deleted_drops_out(self):
        self.make_ryan_admin()
        self.admin_sql("delete from auth.users where id = %s returning 1", RYAN)
        self.assertEqual(self.admin_sql("select count(*) from public.app_admins"), 0)


if __name__ == "__main__":
    unittest.main()
