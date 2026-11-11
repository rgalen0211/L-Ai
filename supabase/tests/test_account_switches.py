"""THE PER-ACCOUNT SWITCH LIST, DATABASE HALF (migrations/20261110000400_account_switches.sql) on a local Postgres.

Q576 (Ryan's yes, CC1 19:04 on 2026-11-10). Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_account_switches.py -v

What this proves: the list is EMPTY for everybody and a missing row never reads as ON; only an admin acting from the app (never through a connected AI) can change it, by email and switch name, with a reason, never
for a worker account, every change an audit row; the owner cannot write the column (insert or update) and cannot read anyone else's list; my_switches() returns only the caller's own stored list and fails closed
(no account, no row, a WAITING account all give nothing on); a switch name must look like aiFirst and at most 20 a person (also held by the table itself); the audit and the table are closed to every API role;
the rollback removes exactly the new objects; the migration ends with the waiting-list gate.
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
setUpModule = core.setUpModule
ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "migrations" / "20261110000400_account_switches.sql"
ROLLBACK = ROOT / "rollbacks" / "20261110000400_account_switches_rollback.sql"
SET = "select public.admin_account_switch_set(%s, %s, %s, %s)"


class AccountSwitches(core.Base):
    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def make_ryan_admin(self):
        self.owner("update auth.users set email = 'ryan.galen@uselai.com' where id = %s", RYAN)
        self.owner("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com'")

    def set(self, email="other@x", switch="aiFirst", on=True, reason="trying it on the test account"):
        try:
            return self.db.as_(RYAN).one(SET, email, switch, on, reason)
        except psycopg.Error as e:
            self.fail(f"a change that was meant to work was refused: {e.sqlstate} {e.diag.message_primary}")        # a failed check, not a crash

    def mine(self, who):
        return self.db.as_(who).one("select public.my_switches()")

    def stored(self, who):
        return self.owner("select switches_on from public.account_settings where owner_id = %s", who).fetchone()

    def refused(self, who, sql, *args, code):
        with self.assertRaises(psycopg.Error, msg=(who, sql, args)) as cm:
            self.db.as_(who).c.execute(sql, args or None)
        self.assertEqual(cm.exception.sqlstate, code, (who, sql, args, cm.exception))
        return cm.exception

    # ---------------------------------------------------------------------------------------------- empty by default, fails closed
    def test_everyone_starts_with_nothing_on_and_a_missing_row_never_reads_as_on(self):
        self.assertEqual(self.owner("select count(*) from public.account_settings").fetchone()[0], 0, "no person has a settings row yet")
        for who in (RYAN, OTHER, WORKER):
            self.assertEqual(self.mine(who), [], who)
        self.owner("insert into public.account_settings (owner_id) values (%s)", OTHER)
        self.assertEqual(self.mine(OTHER), [], "a row made for another setting says nothing is on")
        self.assertEqual(self.stored(OTHER), ([],))

    def test_a_visitor_and_a_caller_with_no_account_get_nothing_and_a_visitor_may_not_even_ask(self):
        self.refused("anon", "select public.my_switches()", code="42501")
        self.db.as_(OTHER)
        self.db.c.execute("select set_config('request.jwt.claim.sub', '', false)")
        self.assertEqual(self.db.one("select public.my_switches()"), [], "a signed-in role with no subject: empty, never an error that reads as on")

    # ---------------------------------------------------------------------------------------------- the admin writer
    def test_an_admin_turns_a_switch_on_for_one_account_by_email_and_only_that_account_sees_it(self):
        self.make_ryan_admin()
        self.assertEqual(self.set(email="  Other@X "), ["aiFirst"])
        self.assertEqual(self.mine(OTHER), ["aiFirst"])
        self.assertEqual(self.mine(RYAN), [], "another account is not touched")
        self.assertEqual(self.mine(WORKER), [])
        self.assertEqual(self.stored(OTHER), (["aiFirst"],))

    def test_the_list_is_sorted_has_no_duplicates_and_off_removes_only_that_name(self):
        self.make_ryan_admin()
        self.set(switch="  liveEditor  ")                                                                     # a name is trimmed
        self.set(switch="aiFirst")
        self.set(switch="liveEditor", reason="again, no change")
        self.assertEqual(self.mine(OTHER), ["aiFirst", "liveEditor"])
        self.assertEqual(self.set(switch="aiFirst", on=False, reason="done testing"), ["liveEditor"])
        self.assertEqual(self.set(switch="neverWasOn", on=False, reason="no change, still recorded"), ["liveEditor"])
        self.assertEqual(self.mine(OTHER), ["liveEditor"])

    def test_the_admin_sees_who_has_what_and_the_history_newest_first_and_a_non_admin_sees_neither(self):
        self.make_ryan_admin()
        self.set(switch="aiFirst")
        self.set(email="ryan.galen@uselai.com", switch="deptStills", reason="my own account too")
        self.set(switch="aiFirst", on=False, reason="done testing")
        lst = self.db.as_(RYAN).all("select user_email, switches from public.admin_account_switch_list()")
        self.assertEqual(lst, [("ryan.galen@uselai.com", ["deptStills"])], "an account with nothing on is not listed")
        aud = self.db.as_(RYAN).all("select user_email, switch, was_on, turned_on, set_by_email, reason from public.admin_account_switch_audit()")
        self.assertEqual(aud, [("other@x", "aiFirst", True, False, "ryan.galen@uselai.com", "done testing"),
                               ("ryan.galen@uselai.com", "deptStills", False, True, "ryan.galen@uselai.com", "my own account too"),
                               ("other@x", "aiFirst", False, True, "ryan.galen@uselai.com", "trying it on the test account")])
        for sql in ("select * from public.admin_account_switch_list()", "select * from public.admin_account_switch_audit()"):
            self.refused(OTHER, sql, code="42501")
            self.refused("anon", sql, code="42501")

    def test_only_an_admin_from_the_app_may_change_it_not_a_person_a_visitor_or_an_admin_connected_through_an_ai(self):
        self.make_ryan_admin()
        self.refused(OTHER, SET, "other@x", "aiFirst", True, "give myself everything", code="42501")
        self.refused("anon", SET, "other@x", "aiFirst", True, "visitor", code="42501")
        d = self.db.as_(RYAN)
        d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % RYAN,))
        with self.assertRaises(psycopg.Error) as cm:
            d.c.execute(SET, ("other@x", "aiFirst", True, "through an AI"))
        self.assertEqual(cm.exception.sqlstate, "42501")
        self.assertEqual(self.owner("select count(*) from public.account_settings where switches_on <> '{}'").fetchone()[0], 0)
        self.assertEqual(self.owner("select count(*) from public.account_switch_audit").fetchone()[0], 0)

    def test_a_bad_name_a_missing_reason_an_unknown_email_and_a_worker_account_are_refused_in_words_and_change_nothing(self):
        self.make_ryan_admin()
        for sw in (None, "", "   ", "A", "a", "Ai", "ai first", "ai-first", "ai.first", "1ai", "a" * 41, "ai'; drop table x; --", "ai\nFirst", "{aiFirst}", "ai,First"):
            e = self.refused(RYAN, SET, "other@x", sw, True, "testing", code="22023")
            self.assertIn("switch name", e.diag.message_primary)
        for reason in (None, "", "  ", "ab", "x" * 301):
            self.refused(RYAN, SET, "other@x", "aiFirst", True, reason, code="22023")
        self.refused(RYAN, SET, "other@x", "aiFirst", None, "testing", code="22023")
        self.refused(RYAN, SET, "nobody-at-all@x", "aiFirst", True, "testing", code="PT404")
        self.refused(RYAN, SET, None, "aiFirst", True, "testing", code="PT404")
        self.refused(RYAN, SET, "worker@x", "aiFirst", True, "testing", code="42501")
        self.assertEqual(self.owner("select count(*) from public.account_settings where switches_on <> '{}'").fetchone()[0], 0)
        self.assertEqual(self.owner("select count(*) from public.account_switch_audit").fetchone()[0], 0)

    def test_names_of_exactly_two_and_forty_characters_are_kept_and_the_twenty_first_switch_is_refused_in_words(self):
        self.make_ryan_admin()
        self.set(switch="ab")
        self.set(switch="a" + "b" * 39)
        names = [f"sw{i:02d}" for i in range(18)]
        for n in names:
            self.set(switch=n)
        self.assertEqual(len(self.mine(OTHER)), 20)
        e = self.refused(RYAN, SET, "other@x", "oneTooMany", True, "testing", code="22023")
        self.assertIn("At most 20", e.diag.message_primary)
        self.assertEqual(len(self.mine(OTHER)), 20)
        self.assertEqual(self.set(switch="ab", on=False, reason="make room"), sorted(["a" + "b" * 39, *names]))

    def test_the_audit_never_holds_more_than_the_change_and_a_refused_change_leaves_no_row(self):
        self.make_ryan_admin()
        self.set()
        cols = [r[0] for r in self.owner("select column_name from information_schema.columns where table_name = 'account_switch_audit' order by ordinal_position").fetchall()]
        self.assertEqual(cols, ["id", "user_id", "switch", "was_on", "turned_on", "set_by", "reason", "at"])
        self.refused(RYAN, SET, "other@x", "Bad Name", True, "testing", code="22023")
        self.assertEqual(self.owner("select count(*) from public.account_switch_audit").fetchone()[0], 1)

    # ---------------------------------------------------------------------------------------------- the owner cannot write or read around it
    def test_the_owner_cannot_write_the_column_by_insert_or_update_and_the_old_settings_flow_still_works(self):
        d = self.db.as_(OTHER)
        d.c.execute("insert into public.account_settings (upload_retention) values ('dont_keep')")                 # the account page's own flow, unchanged
        self.assertEqual(self.mine(OTHER), [])
        self.refused(OTHER, "update public.account_settings set switches_on = '{aiFirst}'", code="42501")
        self.refused(OTHER, "update public.account_settings set switches_on = '{}', upload_retention = 'keep'", code="42501")
        self.refused(RYAN, "insert into public.account_settings (owner_id, switches_on) values (%s, '{aiFirst}')", RYAN, code="42501")
        self.refused(RYAN, "insert into public.account_settings (switches_on) values ('{aiFirst}')", code="42501")
        self.refused("anon", "update public.account_settings set switches_on = '{aiFirst}'", code="42501")
        self.refused("service", "update public.account_settings set switches_on = '{aiFirst}'", code="42501")
        self.assertEqual(self.db.as_(OTHER).one("update public.account_settings set upload_retention = 'keep' returning 1"), 1)
        self.assertEqual(self.mine(OTHER), [])

    def test_a_person_reads_only_their_own_row_and_the_audit_and_its_table_are_closed(self):
        self.make_ryan_admin()
        self.set()
        self.assertEqual(self.db.as_(RYAN).all("select switches_on from public.account_settings"), [], "another person's row is not visible to a person")
        self.assertEqual(self.db.as_(OTHER).all("select switches_on from public.account_settings"), [(["aiFirst"],)])
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.owner("select has_table_privilege(%s, 'public.account_switch_audit', 'select,insert,update,delete')", role).fetchone()[0], role)
        self.assertFalse(self.owner("select has_column_privilege('authenticated', 'public.account_settings', 'switches_on', 'insert')").fetchone()[0])
        self.assertFalse(self.owner("select has_column_privilege('authenticated', 'public.account_settings', 'switches_on', 'update')").fetchone()[0])

    def test_the_table_itself_refuses_a_bad_list_whoever_writes_it(self):
        self.owner("insert into public.account_settings (owner_id) values (%s)", OTHER)
        for bad in ("{aiFirst,aiFirst2,X}", "{\"ai first\"}", "{NULL}", "{aiFirst,NULL}", "{a}", "{" + ",".join(f"sw{i:02d}" for i in range(21)) + "}", "{ai-first}"):
            with self.assertRaises(psycopg.Error, msg=bad) as cm:
                self.owner("update public.account_settings set switches_on = %s where owner_id = %s", bad, OTHER)
            self.assertEqual(cm.exception.sqlstate, "23514", bad)
        self.owner("update public.account_settings set switches_on = %s where owner_id = %s", "{" + ",".join(f"sw{i:02d}" for i in range(20)) + "}", OTHER)
        self.owner("update public.account_settings set switches_on = '{}' where owner_id = %s", OTHER)

    # ---------------------------------------------------------------------------------------------- who may call what
    def test_who_may_execute_each_function(self):
        sigs = {"public.admin_account_switch_set(text, text, boolean, text)": ("authenticated",), "public.admin_account_switch_list()": ("authenticated",),
                "public.admin_account_switch_audit()": ("authenticated",), "public.my_switches()": ("authenticated",)}
        for sig, allowed in sigs.items():
            for role in ("anon", "authenticated", "service_role"):
                got = self.owner("select has_function_privilege(%s, %s, 'execute')", role, sig).fetchone()[0]
                self.assertEqual(got, role in allowed, (sig, role))

    def test_the_functions_never_log_and_my_switches_reads_only_the_callers_own_row(self):
        src = MIG.read_text(encoding="utf-8")
        self.assertNotRegex(src.lower(), r"raise\s+(notice|log|warning|info|debug)")
        fn = src[src.index("create function public.my_switches"):src.index("revoke all on function public.admin_account_switch_set")]
        self.assertIn("s.owner_id = me", fn)
        self.assertEqual(fn.count("account_settings"), 1)
        self.assertIn("auth.uid()", fn)
        self.assertNotIn("p_", fn, "it takes no argument: nobody can ask for someone else's list")

    def test_a_waiting_account_is_held_by_the_gate_like_any_other_function(self):
        n = self.owner("select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any (%s) and p.prosrc like '%%require_active%%'",
                       ["my_switches", "admin_account_switch_set", "admin_account_switch_list", "admin_account_switch_audit"]).fetchone()[0]
        self.assertEqual(n, 4, "gate_apply, run at the end of the migration, guarded all four")

    # ---------------------------------------------------------------------------------------------- rollback and gate
    def test_the_rollback_removes_exactly_the_new_objects_and_keeps_every_other_setting(self):
        self.make_ryan_admin()
        self.set()
        self.owner("update public.account_settings set upload_retention = 'dont_keep', local_compute = true where owner_id = %s", OTHER)
        self.owner(ROLLBACK.read_text(encoding="utf-8"))
        for sig in ("public.my_switches()", "public.admin_account_switch_set(text, text, boolean, text)", "public.admin_account_switch_list()", "public.admin_account_switch_audit()"):
            self.assertIsNone(self.owner("select to_regprocedure(%s)", sig).fetchone()[0], sig)
        self.assertIsNone(self.owner("select to_regclass('public.account_switch_audit')").fetchone()[0])
        self.assertEqual(self.owner("select count(*) from information_schema.columns where table_name = 'account_settings' and column_name = 'switches_on'").fetchone()[0], 0)
        self.assertEqual(self.owner("select upload_retention::text, local_compute from public.account_settings where owner_id = %s", OTHER).fetchone(), ("dont_keep", True))
        self.owner(ROLLBACK.read_text(encoding="utf-8"))                                                       # safe twice

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        lines = [ln.strip() for ln in MIG.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertTrue(lines[-2].startswith("select ryagram_private.gate_apply();"), lines[-2:])
        self.assertEqual(lines[-1], "commit;")


if __name__ == "__main__":
    unittest.main()
