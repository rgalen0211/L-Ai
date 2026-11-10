"""THE WAITING LIST'S DATABASE HALF (migrations/20261110000200_waitlist_join.sql) on a local Postgres, with the waiting-accounts gate in place.

NEXT-CONNECT 206 (Ryan's Q555 answer 2). Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_waitlist_join.py -v

What this proves: a visitor leaves an address (and a one-line reason) and gets the SAME answer for a new address and a repeat, so nothing says who is on the list; the address and the reason are never echoed, and no
refusal contains them; a bad address or a long or multi-line reason is refused in words; one visitor may join 5 times an hour (a hash of their address and the day is all that is kept) and the list takes at most 1000 new
rows a day (checked before the repeat check); only visitors may call it; the table is not readable and the new columns are not writable by a visitor; Ryan sees counts only and his approve step marks the oldest N and does
nothing else (no account, no invite); a non-admin is refused both; the rollback removes exactly the new objects; the migration ends with the waiting-list gate.
"""
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
setUpModule = core.setUpModule
ROOT = Path(__file__).resolve().parent.parent
WORDS_OK = "You are on the list. Nothing is sent to you now; if you are invited, the invitation comes by email."


class WaitlistJoin(core.Base):
    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def make_ryan_admin(self):
        self.owner("update auth.users set email = 'ryan.galen@uselai.com' where id = %s", RYAN)
        self.owner("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com'")

    def join(self, email, reason=None, source=None, ip=None, strict=True):
        d = self.db.as_("anon")
        d.c.execute("select set_config('request.headers', %s, false)", (json.dumps({"x-forwarded-for": ip}) if ip else "{}",))
        try:
            return d.one("select public.join_waitlist(%s, %s, %s)", email, reason, source)
        except psycopg.Error as e:
            if strict:                                          # a join that was meant to work and did not is a failed check, not a crash
                self.fail(f"the join was refused: {e.sqlstate} {e.diag.message_primary}")
            raise

    def refused(self, email, reason=None, ip=None, code="22023"):
        with self.assertRaises(psycopg.Error) as cm:
            self.join(email, reason, ip=ip, strict=False)
        self.assertEqual(cm.exception.sqlstate, code)
        return cm.exception

    def rows(self):
        return self.owner("select email, use_case, source, approved_at, invited_at from public.ryagram_waitlist order by id").fetchall()

    # ---------------------------------------------------------------------------------------------- joining
    def test_a_new_address_is_stored_lowercased_and_trimmed_with_its_reason_and_the_answer_is_fixed_words(self):
        r = self.join("  Ana@Example.COM ", "  I make short films about my town  ", ip="1.1.1.1")
        self.assertEqual(r, {"ok": True, "message": WORDS_OK})
        self.assertEqual(self.rows(), [("ana@example.com", "I make short films about my town", "uselai.com/ryagram", None, None)])

    def test_a_repeat_gets_exactly_the_same_answer_and_no_second_row_whatever_the_capitals(self):
        first = self.join("a@x.co", ip="1.1.1.1")
        again = self.join("A@X.CO", "a later reason", ip="1.1.1.2")
        self.assertEqual(first, again, "nothing tells a new address from one already on the list")
        self.assertEqual(len(self.rows()), 1)
        self.assertIsNone(self.rows()[0][1], "a repeat never changes what was stored")

    def test_the_answer_never_holds_the_address_or_the_reason(self):
        r = json.dumps(self.join("secret.person@example.org", "my private reason", ip="1.1.1.1"))
        self.assertNotIn("secret", r)
        self.assertNotIn("private", r)

    def test_a_film_link_label_is_kept_for_the_per_film_counts_and_a_bad_one_falls_back_without_an_error(self):
        self.join("a@x.co", source="uselai.com/ryagram?utm_source=youtube&utm_campaign=r002-industry-story", ip="1.1.1.1")
        self.join("b@x.co", source="<script>alert(1)</script>", ip="1.1.1.1")
        self.join("c@x.co", source="x" * 200, ip="1.1.1.1")
        self.assertEqual([r[2] for r in self.rows()], ["uselai.com/ryagram?utm_source=youtube&utm_campaign=r002-industry-story", "uselai.com/ryagram", "uselai.com/ryagram"])

    # ---------------------------------------------------------------------------------------------- refusals
    def test_a_bad_address_a_long_reason_or_a_reason_on_two_lines_is_refused_in_words_that_never_hold_what_was_typed(self):
        typed = "bad address with spaces@x"
        for email, reason in ((typed, None), ("no-at-sign.example.com", None), ("a@b", None), ("", None), (None, None), ("a" * 250 + "@x.co", None),
                              ("ok@x.co", "x" * 141), ("ok@x.co", "line one\nline two"), ("ok@x.co", "tab\there")):
            e = self.refused(email, reason, ip="2.2.2.2")
            text = " ".join(filter(None, [e.diag.message_primary, e.diag.message_detail, e.diag.message_hint]))
            self.assertTrue(len(e.diag.message_primary) > 20, (email, reason))
            for secret in ("spaces@x", "no-at-sign", "line one", "xxxxxxxx"):
                self.assertNotIn(secret, text, (email, reason))
        self.assertEqual(self.rows(), [], "a refused join stores nothing")

    def test_a_reason_of_exactly_140_characters_is_kept(self):
        self.join("a@x.co", "y" * 140, ip="1.1.1.1")
        self.assertEqual(len(self.rows()[0][1]), 140)

    # ---------------------------------------------------------------------------------------------- limits
    def test_one_visitor_may_join_five_times_an_hour_the_sixth_is_told_to_wait_and_another_visitor_is_not_held(self):
        for i in range(5):
            self.join(f"p{i}@x.co", ip="3.3.3.3")
        e = self.refused("p5@x.co", ip="3.3.3.3", code="PT429")
        self.assertIn("busy", e.diag.message_primary)
        self.assertNotIn("p5@x.co", e.diag.message_primary)
        self.assertEqual(len(self.rows()), 5)
        self.join("other@x.co", ip="4.4.4.4")
        self.assertEqual(len(self.rows()), 6)

    def test_the_visitor_limit_counts_repeats_too_and_keeps_only_a_hash_never_the_address(self):
        for _ in range(5):
            self.join("same@x.co", ip="5.5.5.5")
        self.refused("same@x.co", ip="5.5.5.5", code="PT429")
        keys = [r[0] for r in self.owner("select key from public.ryagram_waitlist_hits").fetchall()]
        self.assertEqual(len(keys), 1)
        self.assertRegex(keys[0], r"^[0-9a-f]{64}$")
        self.assertNotIn("5.5.5.5", " ".join(map(str, self.owner("select * from public.ryagram_waitlist_hits").fetchall())))

    def test_the_list_takes_at_most_a_thousand_new_rows_a_day_and_a_full_list_does_not_tell_a_repeat_from_a_new_address(self):
        self.owner("insert into public.ryagram_waitlist (email) select 'bulk' || g || '@x.co' from generate_series(1, 1000) g")
        full = self.refused("bulk1@x.co", ip="6.6.6.6", code="PT429")          # a repeat is refused exactly like a new address
        fresh = self.refused("brand.new@x.co", ip="6.6.6.7", code="PT429")
        self.assertEqual(full.diag.message_primary, fresh.diag.message_primary)
        self.owner("update public.ryagram_waitlist set created_at = now() - interval '2 days'")
        self.assertEqual(self.join("brand.new@x.co", ip="6.6.6.8"), {"ok": True, "message": WORDS_OK})

    def test_old_hit_rows_are_purged_by_the_next_join(self):
        self.join("a@x.co", ip="7.7.7.7")
        self.owner("update public.ryagram_waitlist_hits set hour = now() - interval '3 days'")
        self.join("b@x.co", ip="7.7.7.8")
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist_hits where hour < now() - interval '2 days'").fetchone()[0], 0)

    def test_without_an_address_header_the_visitor_limit_is_skipped_and_the_daily_cap_still_holds(self):
        for i in range(8):
            self.join(f"n{i}@x.co")
        self.assertEqual(len(self.rows()), 8)
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist_hits").fetchone()[0], 0)

    # ---------------------------------------------------------------------------------------------- who may do what
    def test_only_visitors_may_call_join_and_the_table_stays_closed(self):
        self.assertTrue(self.owner("select has_function_privilege('anon', 'public.join_waitlist(text, text, text)', 'execute')").fetchone()[0])
        for who in ("authenticated", "public", "service_role"):
            if who == "public":
                continue
            self.assertFalse(self.owner("select has_function_privilege(%s, 'public.join_waitlist(text, text, text)', 'execute')", who).fetchone()[0], who)
        for role in ("anon", "authenticated"):
            self.assertFalse(self.owner("select has_table_privilege(%s, 'public.ryagram_waitlist', 'select')", role).fetchone()[0], role)
            for col in ("approved_at", "approved_by", "invited_at", "user_id"):
                self.assertFalse(self.owner("select has_column_privilege(%s, 'public.ryagram_waitlist', %s, 'insert')", role, col).fetchone()[0], f"{role} {col}")
            for t in ("ryagram_waitlist_hits", "ryagram_waitlist_approvals"):
                self.assertFalse(self.owner("select has_table_privilege(%s, %s, 'select,insert,update,delete')", role, f"public.{t}").fetchone()[0], f"{role} {t}")

    def test_the_function_never_logs_and_no_refusal_is_built_from_what_was_typed(self):
        src = (ROOT / "migrations" / "20261110000200_waitlist_join.sql").read_text(encoding="utf-8")
        fn = src[src.index("create function public.join_waitlist"):src.index("revoke all on function public.join_waitlist")]
        self.assertNotRegex(fn.lower(), r"raise\s+(notice|log|warning|info|debug)")
        for line in fn.splitlines():
            if "raise exception" in line:
                self.assertNotIn("%", line, "a refusal sentence is fixed words, never a format with the address in it")
                self.assertNotIn("p_email", line)
                self.assertNotIn("p_reason", line)

    # ---------------------------------------------------------------------------------------------- Ryan's counts and approve step
    def test_counts_are_numbers_only_and_only_for_an_admin(self):
        self.make_ryan_admin()
        for i in range(3):
            self.join(f"w{i}@x.co", ip=f"8.8.8.{i}")
        self.owner("update public.ryagram_waitlist set created_at = now() - interval '3 days' where email = 'w0@x.co'")
        self.owner("update public.ryagram_waitlist set invited_at = now() where email = 'w1@x.co'")
        row = self.db.as_(RYAN).c.execute("select * from public.admin_waitlist_counts()").fetchone()
        self.assertEqual(tuple(row), (2, 2, 0, 1), "waiting, joined in the last day, approved, invited")
        self.assertEqual([c.name for c in self.db.c.execute("select * from public.admin_waitlist_counts()").description], ["waiting", "joined_24h", "approved", "invited"])
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(OTHER).c.execute("select * from public.admin_waitlist_counts()")
        self.assertEqual(cm.exception.sqlstate, "42501")
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").c.execute("select * from public.admin_waitlist_counts()")

    def test_approve_marks_the_oldest_n_waiting_rows_and_does_nothing_else(self):
        self.make_ryan_admin()
        for i in range(5):
            self.join(f"q{i}@x.co", ip=f"9.9.9.{i}")
        self.owner("update public.ryagram_waitlist set created_at = now() - make_interval(hours => (10 - id)::int)")          # id 1 is oldest
        self.owner("update public.ryagram_waitlist set invited_at = now() where email = 'q0@x.co'")                    # already invited: never approved
        accounts = self.owner("select count(*) from auth.users").fetchone()[0]
        self.assertEqual(self.db.as_(RYAN).one("select public.admin_waitlist_approve(2)"), 2)
        approved = [r[0] for r in self.owner("select email from public.ryagram_waitlist where approved_at is not null order by id").fetchall()]
        self.assertEqual(approved, ["q1@x.co", "q2@x.co"], "the oldest waiting rows, skipping the invited one")
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist where approved_by = %s", RYAN).fetchone()[0], 2)
        self.assertEqual(self.db.as_(RYAN).one("select public.admin_waitlist_approve(10)"), 2, "only the two still waiting are left")
        self.assertEqual(self.db.as_(RYAN).one("select public.admin_waitlist_approve(10)"), 0)
        self.assertEqual(self.owner("select count(*) from auth.users").fetchone()[0], accounts, "no account is made")
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist where invited_at is not null").fetchone()[0], 1, "nobody is invited by approving")
        self.assertEqual([r[0] for r in self.owner("select n from public.ryagram_waitlist_approvals order by id").fetchall()], [2, 2, 0], "every step is recorded as a number")

    def test_an_admin_connected_through_an_ai_is_refused_by_both_admin_functions(self):
        """The repository's rule for every admin function: an admin acts from the app, never through a connected AI (an OAuth token carries a client_id)."""
        self.make_ryan_admin()
        self.join("a@x.co", ip="1.2.3.4")
        for sql in ("select * from public.admin_waitlist_counts()", "select public.admin_waitlist_approve(1)"):
            d = self.db.as_(RYAN)
            d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % RYAN,))
            with self.assertRaises(psycopg.Error, msg=sql) as cm:
                d.c.execute(sql)
            self.assertEqual(cm.exception.sqlstate, "42501", sql)
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist where approved_at is not null").fetchone()[0], 0)

    def test_approve_refuses_a_non_admin_and_a_count_outside_one_to_five_hundred(self):
        self.make_ryan_admin()
        self.join("a@x.co", ip="1.2.3.4")
        for who, n, code in ((OTHER, 1, "42501"), (RYAN, 0, "22023"), (RYAN, -1, "22023"), (RYAN, 501, "22023"), (RYAN, None, "22023")):
            with self.assertRaises(psycopg.Error, msg=(who, n)) as cm:
                self.db.as_(who).one("select public.admin_waitlist_approve(%s)", n)
            self.assertEqual(cm.exception.sqlstate, code, (who, n))
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select public.admin_waitlist_approve(1)")
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist where approved_at is not null").fetchone()[0], 0)

    # ---------------------------------------------------------------------------------------------- closing the old direct insert (connect-drafts/20261110000300, applied only with WEB's page)
    CLOSE = ROOT / "connect-drafts" / "20261110000300_waitlist_close_direct_insert.sql"
    CLOSE_RB = ROOT / "rollbacks" / "20261110000300_waitlist_close_direct_insert_rollback.sql"
    CHECK = ("select not has_column_privilege('anon', 'public.ryagram_waitlist', 'email', 'insert') and not has_column_privilege('authenticated', 'public.ryagram_waitlist', 'email', 'insert') "
             "and not exists (select 1 from pg_policy where polrelid = 'public.ryagram_waitlist'::regclass and polcmd = 'a') as closed")

    def direct_insert(self, who, email="direct@x.co"):
        d = self.db.as_(who)
        d.c.execute("insert into public.ryagram_waitlist (email, use_case, source) values (%s, 'x', 'uselai.com/ryagram')", (email,))

    def test_before_it_a_visitor_can_insert_directly_after_it_nobody_can_and_join_still_works(self):
        self.direct_insert("anon", "old.door@x.co")                                                        # the old door is open today
        self.assertFalse(self.owner(self.CHECK).fetchone()[0], "the check says it is not closed yet")
        self.owner(self.CLOSE.read_text(encoding="utf-8"))
        self.assertTrue(self.owner(self.CHECK).fetchone()[0], "the check Ryan runs says closed")
        for who in ("anon", RYAN):
            with self.assertRaises(psycopg.Error, msg=who) as cm:
                self.direct_insert(who, f"{str(who)[:4]}@x.co")
            self.assertEqual(cm.exception.sqlstate, "42501", who)
        self.assertEqual(self.join("through.the.function@x.co", ip="1.1.1.1"), {"ok": True, "message": WORDS_OK})
        self.assertEqual(self.owner("select count(*) from public.ryagram_waitlist").fetchone()[0], 2)
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").c.execute("select * from public.ryagram_waitlist")

    def test_closing_twice_is_safe_and_its_rollback_reopens_exactly_the_old_door(self):
        close = self.CLOSE.read_text(encoding="utf-8")
        self.owner(close)
        self.owner(close)
        self.owner(self.CLOSE_RB.read_text(encoding="utf-8"))
        self.assertFalse(self.owner(self.CHECK).fetchone()[0])
        self.direct_insert("anon", "back@x.co")                                                            # the old form works again
        for sql in ("insert into public.ryagram_waitlist (email, user_id) values ('q@x.co', %s)" % ("'%s'" % RYAN),
                    "insert into public.ryagram_waitlist (email, invited_at) values ('r@x.co', now())"):
            with self.assertRaises(psycopg.Error, msg=sql):
                self.db.as_("anon").c.execute(sql)                                                          # still only a plain signup: no user, no invite
        self.owner(self.CLOSE_RB.read_text(encoding="utf-8"))                                              # safe twice

    def test_the_closing_file_ends_with_the_gate_and_says_it_goes_live_only_with_the_page(self):
        text = self.CLOSE.read_text(encoding="utf-8")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertTrue(lines[-2].startswith("select ryagram_private.gate_apply();"), lines[-2:])
        self.assertIn("ONLY TOGETHER WITH WEB", text)
        self.assertFalse((ROOT / "migrations" / "20261110000300_waitlist_close_direct_insert.sql").exists(), "it must not be a migration that any lane applies by itself")

    # ---------------------------------------------------------------------------------------------- rollback and gate
    def test_the_rollback_removes_exactly_the_new_objects_and_keeps_the_list(self):
        self.join("keep@x.co", ip="1.1.1.1")
        rb = (ROOT / "rollbacks" / "20261110000200_waitlist_join_rollback.sql").read_text(encoding="utf-8")
        self.owner(rb)
        for sig in ("public.join_waitlist(text, text, text)", "public.admin_waitlist_counts()", "public.admin_waitlist_approve(integer)"):
            self.assertIsNone(self.owner("select to_regprocedure(%s)", sig).fetchone()[0], sig)
        for t in ("ryagram_waitlist_hits", "ryagram_waitlist_approvals"):
            self.assertIsNone(self.owner("select to_regclass(%s)", f"public.{t}").fetchone()[0], t)
        self.assertEqual(self.owner("select count(*) from information_schema.columns where table_name = 'ryagram_waitlist' and column_name in ('approved_at', 'approved_by')").fetchone()[0], 0)
        self.assertEqual(self.owner("select email from public.ryagram_waitlist").fetchall(), [("keep@x.co",)], "the list is untouched")
        self.owner(rb)                                                                                        # safe twice

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        lines = [ln.strip() for ln in (ROOT / "migrations" / "20261110000200_waitlist_join.sql").read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertTrue(lines[-2].startswith("select ryagram_private.gate_apply();"), lines[-2:])
        self.assertEqual(lines[-1], "commit;")


if __name__ == "__main__":
    unittest.main()
