"""Visit counting (migrations/20261006000100_visit_counting.sql) on a local Postgres.

Same setup as test_admin_waitlist.py. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_visits.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule
PATH = "/ryagram/"


class Visits(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def make_ryan_admin(self):
        self.admin("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com' returning 1")

    def visit(self, source="", who="anon", path=PATH):
        self.db.as_(who).one("select record_visit(%s, %s) is null", path, source)

    def signup(self, email, source, at="now()"):
        self.admin("insert into public.ryagram_waitlist (email, source, created_at) values (%s, %s, " + ("now()" if at == "now()" else "%s") + ") returning 1",
                   *((email, source) if at == "now()" else (email, source, at)))

    def by_source(self, days=30):
        return {r[0]: (r[1], r[2]) for r in self.db.as_(RYAN).all("select * from visits_by_source(%s)", days)}

    def test_a_visit_adds_one_to_a_row_for_today_and_stores_nothing_else(self):
        for _ in range(3):
            self.visit("")
        self.visit("youtube")
        rows = self.admin("select count(*), sum(visits) from public.ryagram_visits")
        self.assertEqual(rows, (2, 4))
        cols = [r[0] for r in self.db.as_(None).all("select column_name from information_schema.columns where table_name = 'ryagram_visits' order by ordinal_position")]
        self.assertEqual(cols, ["day", "path", "source", "visits"])          # no id, no timestamp, no address, no agent

    def test_anyone_can_count_a_visit_but_nobody_can_read_or_change_the_table(self):
        for who in ("anon", RYAN, OTHER):
            self.visit("x", who=who)
        for who in ("anon", RYAN, OTHER, "service"):
            for sql in ("select * from public.ryagram_visits", "update public.ryagram_visits set visits = 0", "delete from public.ryagram_visits",
                        "insert into public.ryagram_visits (day, path, visits) values (current_date, '/ryagram/', 5)"):
                with self.subTest(who=who, sql=sql[:30]), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql)

    def test_only_the_ryagram_page_is_counted_and_junk_sources_count_as_no_link(self):
        self.visit("", path="/app/")
        self.visit("", path="/ryagram/../app/")
        self.assertEqual(self.admin("select count(*) from public.ryagram_visits"), 0)       # ignored, no error
        for junk in ("YouTube!", "a b", "x" * 25, "<script>", "ü", None):
            self.db.as_("anon").one("select record_visit(%s, %s) is null", PATH, junk)
        self.assertEqual(self.admin("select source, visits from public.ryagram_visits"), ("", 6))
        self.visit("YouTube")                                                                # case is folded
        self.assertEqual(self.admin("select visits from public.ryagram_visits where source = 'youtube'"), 1)

    def test_fifty_different_sources_a_day_at_most_then_other(self):
        for i in range(50):
            self.visit(f"s{i}")
        self.visit("one-too-many")
        self.visit("another")
        self.visit("s7")                                                                      # an existing source still counts as itself
        self.assertEqual(self.admin("select count(*) from public.ryagram_visits where source <> ''"), 51)   # 50 + 'other'
        self.assertEqual(self.admin("select visits from public.ryagram_visits where source = 'other'"), 2)
        self.assertEqual(self.admin("select visits from public.ryagram_visits where source = 's7'"), 2)

    def test_the_admin_sees_visits_signups_and_both_sides_agree_on_the_source(self):
        self.make_ryan_admin()
        for _ in range(10):
            self.visit("youtube")
        for _ in range(4):
            self.visit("")
        for _ in range(2):
            self.visit("newsletter")                                                         # visits, no signups
        self.signup("a@x.co", "uselai.com/ryagram?utm_source=youtube&utm_campaign=r002&ref=youtube")
        self.signup("b@x.co", "uselai.com/ryagram?ref=YouTube")                              # ref only, case folded
        self.signup("c@x.co", "uselai.com/ryagram?utm_source=youtube&utm_campaign=r002")     # utm_source only: the same source
        self.signup("d@x.co", "uselai.com/ryagram")                                          # no link
        self.signup("e@x.co", "uselai.com/ryagram?utm_source=film_page&ref=youtube")          # ref wins over utm_source
        got = self.by_source()
        self.assertEqual(got["youtube"], (10, 4))
        self.assertEqual(got[""], (4, 1))
        self.assertEqual(got["newsletter"], (2, 0))
        day = self.db.as_(RYAN).all("select visits, signups from visits_by_day(30)")
        self.assertEqual(day, [(16, 5)])
        cols = self.db.as_(RYAN).c.execute("select * from visits_by_day(30)").description
        self.assertEqual([c.name for c in cols], ["day", "visits", "signups"])               # counts only: no email, no use_case

    def test_a_signup_with_no_visits_and_a_visit_with_no_signups_both_show(self):
        self.make_ryan_admin()
        self.signup("a@x.co", "uselai.com/ryagram?ref=podcast")
        self.visit("youtube")
        self.assertEqual(self.by_source(), {"podcast": (0, 1), "youtube": (1, 0)})

    def test_old_days_fall_out_of_the_window(self):
        self.make_ryan_admin()
        self.admin("insert into public.ryagram_visits (day, path, source, visits) values (current_date - 40, '/ryagram/', 'old', 9) returning 1")
        self.visit("new")
        self.assertEqual(self.by_source(30), {"new": (1, 0)})
        self.assertEqual(self.by_source(90), {"new": (1, 0), "old": (9, 0)})

    def test_only_an_admin_can_read_and_the_window_is_bounded(self):
        self.make_ryan_admin()
        self.visit("x")
        for who in (OTHER, "anon"):
            for sql in ("select * from visits_by_day(30)", "select * from visits_by_source(30)"):
                with self.subTest(who=who, sql=sql), self.assertRaises(psycopg.Error):
                    self.db.as_(who).one(sql)
        for days in (0, -1, 3661, None):
            with self.subTest(days=days), self.assertRaises(psycopg.Error):
                self.db.as_(RYAN).one("select count(*) from visits_by_day(%s)", days)
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select ryagram_private.signup_source('x')")                 # the helper is private

    def test_signup_source_rule(self):
        for src, want in [("uselai.com/ryagram?ref=YouTube", "youtube"), ("uselai.com/ryagram?utm_source=film_page", "film_page"),
                          ("uselai.com/ryagram?utm_source=a&ref=b", "b"), ("uselai.com/ryagram", ""), ("uselai.com/ryagram?xref=zzz", ""),
                          ("uselai.com/ryagram?ref=" + "q" * 30, "q" * 24)]:
            self.assertEqual(self.admin("select ryagram_private.signup_source(%s)", src), want, src)


if __name__ == "__main__":
    unittest.main()
