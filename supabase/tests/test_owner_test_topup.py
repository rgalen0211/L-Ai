"""OWNER-ONLY TEST CREDIT TOP-UP (migrations/20261127000100_owner_test_topup.sql, NOT APPLIED) on a local Postgres with the 2B credits ledger. BUILDER, 2026-11-27 (Claude's wave-6 order of 11-26 23:00 for Ryan).
Same setup as test_2b_credits.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_owner_test_topup.py -v

What it proves, each with the opposite case beside it
  * an account NOT on the owner list gets nothing, with the same words whether or not the address has an account, and no log row; an account ON the list gets the credits through grant_credits ('grant', 'granted'), one log row;
  * only an admin in the app can call it: a signed-in non-admin (even one on the list, for themselves), anonymous, the service key and an admin through a connected AI are all refused;
  * the limits: 1 to 100 a top-up, a note of 3 to 200 characters, 200 a day for one account (an undo gives the room back);
  * the undo takes back only what is unspent (all, part, or nothing), once, through adjust_credits; it still works after the account leaves the list; nobody else's credits move;
  * the list and the log are closed to every API role; the three calls are behind the waiting gate;
  * live steps 78, 78b, 78c and 78d answer as their headers say, are one statement each, and 78b says STOP before the migration (rollback applied) and when a call is opened to anonymous;
  * the rollback removes the new objects and leaves the credits already given.
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
MIG = core.ROOT / "migrations" / "20261127000100_owner_test_topup.sql"
RB = core.ROOT / "rollbacks" / "20261127000100_owner_test_topup_rollback.sql"
STEPS = core.ROOT / "live-steps"
S78, S78B, S78C, S78D = (STEPS / n for n in ("78_test_topup.sql", "78b_test_topup_check.sql", "78c_test_topup_add_account.sql", "78d_test_topup_remove_account.sql"))
TOPUP = "select public.admin_test_topup(%s, %s, %s)"
UNDO = "select public.admin_test_topup_undo(%s, %s)"
PLACEHOLDER = "PUT-THE-TEST-ACCOUNT-ADDRESS-HERE"
STRANGER = "33333333-3333-3333-3333-333333333333"


def setUpModule():
    credits.setUpModule()


def statements(sql):
    """Statements outside comments and quoted strings (a ; inside quotes or a -- comment is not a statement end)."""
    out, cur, i, q = [], [], 0, False
    while i < len(sql):
        ch = sql[i]
        if not q and sql.startswith("--", i):
            i = sql.find("\n", i)
            i = len(sql) if i < 0 else i
            continue
        if ch == "'":
            q = not q
        if ch == ";" and not q:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    rest = "".join(cur).strip()
    return out + ([rest] if rest else [])


class OwnerTestTopup(unittest.TestCase):
    tearDown = credits.Ledger.tearDown
    admin = credits.Ledger.admin

    def setUp(self):
        credits.Ledger.setUp(self)
        self.d().execute("insert into public.app_admins (user_id, note) values (%s, 'test')", (RYAN,))
        self.d().execute("insert into auth.users (id, email) values (%s, 'stranger@x')", (STRANGER,))
        self.d().execute("select public.grant_credits(%s, 'grant', 5, 'a stranger''s own credits', 'test')", (STRANGER,))
        self.on_list(OTHER)

    def d(self):
        return self.db.as_(None).c

    def on_list(self, who):
        self.d().execute("insert into ryagram_private.test_topup_accounts (user_id, added_by) values (%s, 'test')", (who,))

    def available(self, who, pool=None):
        return credits.Ledger.available(self, who, pool)

    def log_count(self):
        return self.d().execute("select count(*) from ryagram_private.test_topups").fetchone()[0]

    def topup(self, email="other@x", n=50, note="film tests", who=RYAN):
        try:
            return self.db.as_(who).one(TOPUP, email, n, note)
        except psycopg.Error as e:
            self.fail(f"a top-up that was meant to work was refused: {e.sqlstate} {e.diag.message_primary}")

    def refused(self, who, sql, *args, code):
        with self.assertRaises(psycopg.Error, msg=(who, sql, args)) as cm:
            self.db.as_(who).c.execute(sql, args or None)
        self.assertEqual(cm.exception.sqlstate, code, (who, sql, args, cm.exception))
        return cm.exception.diag.message_primary

    # ------------------------------------------------------------------------------------------ the list
    def test_an_account_not_on_the_list_gets_nothing_and_the_words_do_not_say_whether_it_exists(self):
        before = self.available(STRANGER)
        w1 = self.refused(RYAN, TOPUP, "stranger@x", 50, "film tests", code="42501")
        w2 = self.refused(RYAN, TOPUP, "nobody-at-all@x", 50, "film tests", code="42501")
        self.assertEqual(w1, w2, "the same words for an account and for no account")
        self.assertIn("not on the owner test-account list", w1)
        self.assertEqual(self.available(STRANGER), before, "the stranger's credits did not move")
        self.assertEqual(self.log_count(), 0)

    def test_an_account_on_the_list_gets_the_credits_through_grant_credits_and_one_log_row(self):
        tid = self.topup(email="  Other@X ", n=40)
        self.assertIsInstance(tid, int)
        self.assertEqual(self.available(OTHER), 40)
        rows = self.d().execute("select entry::text, pool::text, amount, reason, created_by from public.credit_ledger where owner_id = %s", (OTHER,)).fetchall()
        self.assertEqual(rows, [("grant", "granted", 40, "Owner test top-up: film tests", "test-topup:" + RYAN)])
        log = self.d().execute("select owner_id::text, credits, note, by_admin::text, undone_at from ryagram_private.test_topups where id = %s", (tid,)).fetchone()
        self.assertEqual(log, (OTHER, 40, "film tests", RYAN, None))
        self.assertEqual(self.available(STRANGER), 5, "nobody else's credits moved")
        self.assertEqual(self.available(RYAN), 0, "not even the admin's own")

    def test_only_an_admin_in_the_app_can_call_it(self):
        self.assertIn("Only an admin", self.refused(OTHER, TOPUP, "other@x", 50, "for me", code="42501"), "on the list, for themselves: still no")
        self.refused("anon", TOPUP, "other@x", 50, "film tests", code="42501")
        self.refused("service", TOPUP, "other@x", 50, "film tests", code="42501")
        d = self.db.as_(RYAN)
        d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % RYAN,))
        with self.assertRaises(psycopg.Error) as cm:
            d.c.execute(TOPUP, ("other@x", 50, "film tests"))
        self.assertEqual(cm.exception.sqlstate, "42501")
        self.assertIn("connected AI", cm.exception.diag.message_primary)
        d.c.execute("select set_config('request.jwt.claims', '', false)")
        for who in (OTHER, "anon", "service"):
            self.refused(who, "select * from public.admin_test_topup_list()", code="42501")
            self.refused(who, UNDO, 1, "because", code="42501")
        self.assertEqual(self.available(OTHER), 0)
        self.assertEqual(self.log_count(), 0)

    # ------------------------------------------------------------------------------------------ the limits
    def test_the_amount_and_the_note_are_limited(self):
        for n in (0, -5, 101, None):
            self.refused(RYAN, TOPUP, "other@x", n, "film tests", code="22023")
        for note in (None, "", "  x ", "y" * 201):
            self.refused(RYAN, TOPUP, "other@x", 10, note, code="22023")
        for note in ("\n\n\n", "\t\t\t", " \r\n\t "):                                           # RENDERER 08:47: only blank characters is no note
            self.refused(RYAN, TOPUP, "other@x", 10, note, code="22023")
        self.assertEqual(self.available(OTHER), 0)
        self.topup(n=1)
        self.topup(n=100)
        self.assertEqual(self.available(OTHER), 101)

    def test_at_most_200_a_day_for_one_account_and_an_undo_gives_the_room_back(self):
        first = self.topup(n=100)
        self.topup(n=100)
        words = self.refused(RYAN, TOPUP, "other@x", 1, "one more", code="22023")
        self.assertIn("200", words)
        self.assertEqual(self.available(OTHER), 200)
        self.assertEqual(self.db.as_(RYAN).one(UNDO, first, "too many"), 100)
        self.topup(n=100)
        self.assertEqual(self.available(OTHER), 200)
        self.d().execute("update ryagram_private.test_topups set created_at = now() - interval '25 hours'")
        self.topup(n=100)
        self.assertEqual(self.available(OTHER), 300, "a day later there is room again")

    # ------------------------------------------------------------------------------------------ the undo
    def test_the_undo_takes_back_all_of_an_unspent_top_up_once(self):
        tid = self.topup(n=60)
        self.assertEqual(self.db.as_(RYAN).one(UNDO, tid, "typed the wrong number"), 60)
        self.assertEqual(self.available(OTHER), 0)
        row = self.d().execute("select entry::text, pool::text, amount, created_by from public.credit_ledger where owner_id = %s and entry = 'adjustment'", (OTHER,)).fetchone()
        self.assertEqual(row, ("adjustment", "granted", -60, "test-topup:" + RYAN))
        self.assertIn("already undone", self.refused(RYAN, UNDO, tid, "again", code="22023"))
        self.assertEqual(self.available(OTHER), 0, "a second undo takes nothing")
        log = self.d().execute("select taken_back, undone_by::text, undo_note from ryagram_private.test_topups where id = %s", (tid,)).fetchone()
        self.assertEqual(log, (60, RYAN, "typed the wrong number"))

    def test_the_undo_takes_back_only_what_is_unspent(self):
        tid = self.topup(n=50)
        self.d().execute("select public.adjust_credits(%s, 'granted', -30, 'spent on a film', 'test')", (OTHER,))
        self.assertEqual(self.db.as_(RYAN).one(UNDO, tid, "done testing"), 20)
        self.assertEqual(self.available(OTHER), 0, "never below zero")
        t2 = self.topup(n=10)
        self.d().execute("select public.adjust_credits(%s, 'granted', -10, 'spent on a film', 'test')", (OTHER,))
        self.assertEqual(self.db.as_(RYAN).one(UNDO, t2, "done testing"), 0, "all of it spent: nothing taken back")
        self.assertEqual(self.d().execute("select count(*) from public.credit_ledger where owner_id = %s and entry = 'adjustment' and created_by like 'test-topup:%%'", (OTHER,)).fetchone()[0], 1,
                         "no zero adjustment row was written")
        self.assertIsNotNone(self.d().execute("select undone_at from ryagram_private.test_topups where id = %s", (t2,)).fetchone()[0], "and it is marked undone")

    def test_the_undo_works_after_the_account_leaves_the_list_and_refuses_an_unknown_number(self):
        tid = self.topup(n=30)
        self.d().execute("delete from ryagram_private.test_topup_accounts where user_id = %s", (OTHER,))
        self.refused(RYAN, TOPUP, "other@x", 10, "film tests", code="42501")
        self.assertEqual(self.db.as_(RYAN).one(UNDO, tid, "off the list now"), 30)
        self.refused(RYAN, UNDO, tid + 999, "no such", code="PT404")
        self.refused(RYAN, UNDO, tid, "x", code="22023")

    def test_the_list_call_shows_newest_first_with_the_address(self):
        a = self.topup(n=10, note="first")
        b = self.topup(n=20, note="second")
        self.db.as_(RYAN).one(UNDO, a, "not needed")
        rows = self.db.as_(RYAN).all("select id, user_email, credits, note, undone_at is not null, taken_back from public.admin_test_topup_list()")
        self.assertEqual(rows, [(b, "other@x", 20, "second", False, None), (a, "other@x", 10, "first", True, 10)])

    # ------------------------------------------------------------------------------------------ closed
    def test_the_list_and_the_log_are_closed_and_the_calls_are_behind_the_gate(self):
        for who in ("anon", OTHER, "service"):
            for sql in ("select count(*) from ryagram_private.test_topup_accounts", "select count(*) from ryagram_private.test_topups",
                        "insert into ryagram_private.test_topup_accounts (user_id) values ('%s')" % STRANGER):
                with self.assertRaises(psycopg.Error, msg=(who, sql)):
                    self.db.as_(who).c.execute(sql)
        n = self.d().execute("select count(*) from pg_proc where proname in ('admin_test_topup', 'admin_test_topup_undo', 'admin_test_topup_list') "
                             "and prosrc like '%perform ryagram_private.require_active();%'").fetchone()[0]
        self.assertEqual(n, 3, "the waiting gate guards all three")
        self.assertTrue(MIG.read_text(encoding="utf-8").rstrip().endswith("select ryagram_private.gate_apply();                       -- every migration after the gate ends with this line (a test fails otherwise)\n\ncommit;"))
        self.assertIn("select ryagram_private.gate_apply();", RB.read_text(encoding="utf-8"))

    # ------------------------------------------------------------------------------------------ live steps
    def test_each_live_step_file_is_one_statement(self):
        for p in (S78, S78B, S78C, S78D):
            self.assertEqual(len(statements(p.read_text(encoding="utf-8"))), 1, p.name)
        self.assertEqual(len(statements("select 'a;b' -- c;d\n; select 2")), 2, "the counter itself splits on a real ; only")

    def test_step_78b_says_pass_after_and_stop_when_a_call_is_opened_or_before_the_migration(self):
        text = S78B.read_text(encoding="utf-8")
        rows = self.d().execute(text).fetchall()
        self.assertEqual(len(rows), 7)
        self.assertTrue(rows[0][1].startswith("PASS"), rows)
        self.assertTrue(all(r[2] is True for r in rows), rows)
        self.d().execute("grant execute on function public.admin_test_topup(text, int, text) to anon")
        rows = self.d().execute(text).fetchall()
        self.assertTrue(rows[0][1].startswith("STOP") and rows[3][2] is False, rows)
        self.d().execute("revoke execute on function public.admin_test_topup(text, int, text) from anon")
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.d().execute(text).fetchall()
        self.assertEqual([r[2] for r in rows], [False, True, False, False, False, False, True], rows)
        self.assertTrue(rows[0][1].startswith("STOP"), "before the migration: STOP, as the header says")

    def test_step_78_counts_after_the_migration_and_says_the_table_is_missing_before(self):
        self.topup(n=25)
        t2 = self.topup(n=10)
        self.db.as_(RYAN).one(UNDO, t2, "not needed")
        rows = self.d().execute(S78.read_text(encoding="utf-8")).fetchall()
        self.assertEqual([r[2] for r in rows], ["1", "2", "25"])
        self.d().execute(RB.read_text(encoding="utf-8"))
        with self.assertRaises(psycopg.errors.UndefinedTable):
            self.d().execute(S78.read_text(encoding="utf-8"))

    def run_step(self, path, address):
        text = path.read_text(encoding="utf-8")
        if address is not None:
            text = text.replace(PLACEHOLDER, address)              # "replace all", as an editor would: the guard literal is split so it survives
        return self.d().execute(text).fetchone()[0]

    def test_steps_78c_and_78d_add_and_remove_one_account_and_refuse_in_words(self):
        self.d().execute("delete from ryagram_private.test_topup_accounts")
        self.assertEqual(self.run_step(S78C, None), "STOP: type the address first")
        self.assertEqual(self.run_step(S78C, "nobody@x"), "STOP: no account with that address")
        self.assertEqual(self.run_step(S78C, "worker@x"), "STOP: a worker account cannot be on the list")
        self.assertEqual(self.run_step(S78C, " Other@X "), "added")
        self.assertEqual(self.run_step(S78C, "other@x"), "already on the list")
        self.assertEqual(self.d().execute("select user_id::text, added_by from ryagram_private.test_topup_accounts").fetchall(), [(OTHER, "live step 78c")])
        self.topup(n=10)
        self.assertEqual(self.run_step(S78D, None), "STOP: type the address first")
        self.assertEqual(self.run_step(S78D, "stranger@x"), "was not on the list")
        self.assertEqual(self.run_step(S78D, "other@x"), "removed")
        self.assertEqual(self.d().execute("select count(*) from ryagram_private.test_topup_accounts").fetchone()[0], 0)
        self.assertEqual(self.available(OTHER), 10, "taking an account off the list leaves its credits")

    def test_the_rollback_removes_the_new_objects_and_leaves_the_credits(self):
        self.topup(n=35)
        self.d().execute(RB.read_text(encoding="utf-8"))
        for name in ("ryagram_private.test_topups", "ryagram_private.test_topup_accounts"):
            self.assertIsNone(self.d().execute("select to_regclass(%s)", (name,)).fetchone()[0])
        self.assertEqual(self.d().execute("select count(*) from pg_proc where proname like 'admin\\_test\\_topup%%'").fetchone()[0], 0)
        self.assertEqual(self.available(OTHER), 35, "credits already given stay given")

    def test_no_semicolon_hides_in_a_step_string_and_no_address_is_written_in_the_steps(self):
        for p in (S78, S78B, S78C, S78D):
            t = p.read_text(encoding="utf-8")
            self.assertNotIn("@", t, p.name)
            self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("--"))), p.name)


if __name__ == "__main__":
    unittest.main()
