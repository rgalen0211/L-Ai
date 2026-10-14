"""Creator beta applications (migrations/20261014000100_creator_beta.sql) on a local Postgres.

Same setup as test_2a_core.py. Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_creator_beta.py -v
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule

GOOD = ("Maya Ortiz", "maya@example.com", "youtuber", "Weekly explainers on housing", "https://www.youtube.com/@maya",
        "Did cities that legalized duplexes build more homes within five years?")


class CreatorBeta(core.Base):
    def admin(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def svc(self):
        return self.db.as_("service")

    def make_ryan_admin(self):
        self.admin("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com' returning 1")

    def apply(self, *fields, website=""):
        return self.svc().one("select creator_beta_apply(%s, %s, %s, %s, %s, %s, %s)", *fields, website)

    def count(self):
        return self.admin("select count(*) from public.creator_applications")

    def test_only_the_service_role_can_apply_and_nobody_can_read_or_write_the_table(self):
        for who in ("anon", RYAN, OTHER):
            self.denied(who, "select creator_beta_apply(%s, %s, %s, %s, %s, %s, '')", *GOOD)
        self.assertEqual(self.count(), 0)
        n = self.apply(*GOOD)
        self.assertEqual(n, 1)
        self.assertEqual(self.count(), 1)
        row = self.admin("select source, status from public.creator_applications")
        self.assertEqual(tuple(row), ("creator_beta", "new"))                  # tagged source=creator_beta, waiting for Ryan
        # RLS on, every grant revoked: not even the service role, the public key or a signed-in person can read or change a row.
        self.assertTrue(self.admin("select relrowsecurity from pg_class where oid = 'public.creator_applications'::regclass"))
        for who in ("anon", "service", RYAN, OTHER):
            self.denied(who, "select * from public.creator_applications")
            self.denied(who, "insert into public.creator_applications (name, email, kind, makes, link, question) "
                             "values ('Eve Mallory', 'eve@example.com', 'other', 'things', 'https://e.example/x', 'a question about data?')")
            self.denied(who, "update public.creator_applications set status = 'approved' returning 1")
            self.denied(who, "delete from public.creator_applications returning 1")
        self.assertEqual(self.count(), 1)

    def test_every_field_is_checked_in_the_database_with_a_plain_sentence(self):
        n, e, k, m, l, q = GOOD
        cases = [((" ", e, k, m, l, q), "name"), ((n, "not-an-email", k, m, l, q), "email"), ((n, e, "wizard", m, l, q), "describes you"),
                 ((n, e, None, m, l, q), "describes you"), ((n, e, k, "ab", l, q), "what you make"), ((n, e, k, m, "http://insecure.example/a", q), "https://"),
                 ((n, e, k, m, "javascript:alert(1)", q), "https://"), ((n, e, k, m, "https://has space.example", q), "https://"),
                 ((n, e, k, m, l, "short"), "question"), ((n, e, k, m, l, "x" * 1001), "question"), ((n, e, k, "m" * 201, l, q), "what you make"),
                 (("N" * 101, e, k, m, l, q), "name")]
        for fields, word in cases:
            with self.subTest(word=word, f=str(fields)[:40]), self.assertRaisesRegex(psycopg.Error, word) as cm:
                self.apply(*fields)
            self.assertEqual(cm.exception.sqlstate, "PT422")
        self.assertEqual(self.count(), 0)
        for kind in ("youtuber", "podcaster", "newsletter", "journalist", "teacher", "researcher", "other"):
            self.apply(n, f"{kind}@example.com", kind, m, l, q)
        self.assertEqual(self.count(), 7)

    def test_a_filled_honeypot_looks_like_success_and_stores_nothing(self):
        self.assertEqual(self.apply(*GOOD, website="http://spam.example"), 0)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.admin("select count(*) from public.ops_alerts"), 0)

    def test_the_same_address_twice_changes_nothing_and_answers_the_same(self):
        first = self.apply(*GOOD)
        again = self.apply("Someone Else", "MAYA@example.com", "other", "different", "https://other.example/x", "A completely different question?")
        self.assertEqual(first, again)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.admin("select name from public.creator_applications"), "Maya Ortiz")        # the first application stands

    def test_text_is_trimmed_and_whitespace_collapsed(self):
        self.apply("  Maya   Ortiz ", "  maya@example.com ", "youtuber", "  Weekly   explainers  ", "  https://www.youtube.com/@maya ", "  Did cities that legalized duplexes build more homes?  ")
        self.assertEqual(tuple(self.admin("select name, email, makes, link from public.creator_applications")),
                         ("Maya Ortiz", "maya@example.com", "Weekly explainers", "https://www.youtube.com/@maya"))

    def test_a_flood_is_capped_per_hour(self):
        n, e, k, m, l, q = GOOD
        for i in range(40):
            self.apply(n, f"p{i}@example.com", k, m, l, q)
        with self.assertRaisesRegex(psycopg.Error, "Too many applications") as cm:
            self.apply(n, "p99@example.com", k, m, l, q)
        self.assertEqual(cm.exception.sqlstate, "PT429")
        self.assertEqual(self.count(), 40)
        self.assertEqual(self.apply(n, "p0@example.com", k, m, l, q), 1)                                # an address already in still gets its normal answer

    def test_ryan_sees_the_waiting_applications_and_approves_or_declines_them(self):
        self.make_ryan_admin()
        a = self.apply(*GOOD)
        b = self.apply("Dr. Sam Lee", "sam@example.edu", "teacher", "Statistics lessons", "https://example.edu/~slee", "How did rent and wages move since 2000?")
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'creator:%%' and resolved_at is null"), 2)
        d = self.db.as_(RYAN).one("select admin_creator_beta()")
        self.assertEqual((d["waiting"], d["approved"], d["declined"]), (2, 0, 0))
        self.assertEqual([i["id"] for i in d["items"]], [a, b])                                          # oldest first
        self.assertEqual(set(d["items"][0]), {"id", "created_at", "name", "email", "kind", "makes", "link", "question"})
        self.db.as_(RYAN).one("select admin_decide_creator(%s, 'approved')", a)
        self.db.as_(RYAN).one("select admin_decide_creator(%s, 'declined')", b)
        d = self.db.as_(RYAN).one("select admin_creator_beta()")
        self.assertEqual((d["waiting"], d["approved"], d["declined"], d["items"]), (0, 1, 1, []))
        self.assertEqual(self.admin("select status from public.creator_applications where id = %s", a), "approved")
        self.assertIsNotNone(self.admin("select decided_at from public.creator_applications where id = %s", a))
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key like 'creator:%%' and resolved_at is null"), 0)   # decided = alert cleared
        # A decision is final: approving a declined one does nothing; and only the two words are accepted.
        self.db.as_(RYAN).one("select admin_decide_creator(%s, 'approved')", b)
        self.assertEqual(self.admin("select status from public.creator_applications where id = %s", b), "declined")
        with self.assertRaises(psycopg.Error):
            self.db.as_(RYAN).one("select admin_decide_creator(%s, 'deleted')", a)

    def test_the_admin_functions_are_ryans_only(self):
        self.make_ryan_admin()
        a = self.apply(*GOOD)
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_creator_beta()")
            self.denied(who, "select admin_decide_creator(%s, 'approved')", a)
        self.assertEqual(self.admin("select status from public.creator_applications"), "new")

    def test_approving_sends_nothing_and_moves_no_credits(self):
        self.make_ryan_admin()
        a = self.apply(*GOOD)
        outbox = lambda: self.admin("select count(*) from public.ops_outbox")
        before = outbox()
        self.db.as_(RYAN).one("select admin_decide_creator(%s, 'approved')", a)
        self.assertEqual(outbox(), before)


if __name__ == "__main__":
    unittest.main()
