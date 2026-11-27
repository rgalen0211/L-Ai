"""THE TOP BAR PER ACCOUNT (migrations/20261127000250_department_switches.sql, NOT APPLIED) on a local Postgres with every migration. BUILDER 2026-11-27 (CC1's 08:10 one-switch design).
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -m unittest supabase/tests/test_department_switches.py -v

  * a department shows WORKING in the top bar (my_departments) AND the chat panel (connect_my_departments) to an account whose switch is on, Coming soon to every other account
  * the switch names are exactly compilations, games, perfectCity (geo_intelligence's); another name does nothing; a worker is never on; data films is untouched
  * opening for everyone (82a-c) changes one row and reads back; the undo (82d-f) puts it back; a switch-on account still sees it working after the undo
  * compilations keeps its tester rule when opened without 82a's needs_local_compute change
  * live step 82 says PASS after and STOP before; a hand-changed departments_for is refused in words and nothing changes; the rollback restores the live text and refuses while the
    compilations migration (which reads the helper) is applied
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
THIRD = "66666666-6666-6666-6666-666666666666"
MIG = core.ROOT / "migrations" / "20261127000250_department_switches.sql"
RB = core.ROOT / "rollbacks" / "20261127000250_department_switches_rollback.sql"
STEPS = core.ROOT / "live-steps"
setUpModule = credits.setUpModule


class DepartmentSwitches(unittest.TestCase):
    tearDown = credits.Ledger.tearDown
    admin = credits.Ledger.admin

    def setUp(self):
        credits.Ledger.setUp(self)
        self.d().execute("insert into auth.users (id, email) values (%s, 'third@x')", (THIRD,))
        self.d().execute("insert into public.connect_access (user_id, enabled) values (%s, true), (%s, true)", (OTHER, THIRD))

    def d(self):
        return self.db.as_(None).c

    def switches(self, who, *names):
        self.d().execute("insert into public.account_settings (owner_id, switches_on) values (%s, %s) on conflict (owner_id) do update set switches_on = excluded.switches_on",
                         (who, list(names)))

    def bar(self, who):
        return {d["id"]: d["status"] for d in self.db.as_(who).one("select my_departments()")}

    def step(self, name):
        return self.d().execute((STEPS / name).read_text(encoding="utf-8")).fetchall()

    def test_a_switch_makes_its_department_working_for_that_account_only(self):
        before = self.bar(OTHER)
        self.assertEqual({k: before[k] for k in ("data_films", "compilations", "games", "geo_intelligence")},
                         {"data_films": "working", "compilations": "soon", "games": "soon", "geo_intelligence": "soon"})
        self.switches(OTHER, "compilations", "games", "perfectCity")
        after = self.bar(OTHER)
        self.assertEqual({k: after[k] for k in ("compilations", "games", "geo_intelligence")}, {"compilations": "working", "games": "working", "geo_intelligence": "working"})
        self.assertEqual(after["data_films"], "working")
        self.assertEqual(self.bar(THIRD), before, "another account sees exactly what it saw")
        self.switches(THIRD, "games")
        self.assertEqual((self.bar(THIRD)["games"], self.bar(THIRD)["compilations"]), ("working", "soon"), "one switch, one department")

    def test_the_names_are_exact_and_a_worker_is_never_on(self):
        self.switches(OTHER, "geoIntelligence", "game", "compilation", "perfectcity")   # (a capital first letter is refused by the list itself)
        self.assertEqual({k: self.bar(OTHER)[k] for k in ("compilations", "games", "geo_intelligence")}, {"compilations": "soon", "games": "soon", "geo_intelligence": "soon"})
        self.switches(WORKER, "games")
        self.assertFalse(self.admin("select ryagram_private.department_switch_on(%s, 'games')", WORKER))
        self.assertFalse(self.admin("select ryagram_private.department_switch_on(%s, 'data_films')", OTHER), "no switch for a department that is already working for all")

    def test_the_chat_panel_answers_the_same(self):
        self.switches(OTHER, "games")
        got = self.admin("select pg_get_functiondef('public.connect_my_departments(text)'::regprocedure)")
        self.assertIn("ryagram_private.departments_for(me)", got, "the chat panel reads the same function, so it answers the same")
        self.assertEqual(self.admin("select x.status from ryagram_private.departments_for(%s) x where x.id = 'games'", OTHER), "working")
        self.assertEqual(self.admin("select x.status from ryagram_private.departments_for(%s) x where x.id = 'games'", THIRD), "soon")

    def test_opening_for_everyone_and_the_undo(self):
        self.switches(OTHER, "games")
        self.assertEqual(self.step("82b_open_games_for_everyone.sql"), [("opened for everyone: games is working",)])
        self.assertEqual(self.bar(THIRD)["games"], "working")
        self.assertEqual(self.step("82e_close_games_for_everyone.sql"), [("closed for everyone: games is soon",)])
        self.assertEqual((self.bar(THIRD)["games"], self.bar(OTHER)["games"]), ("soon", "working"), "the switch-on account keeps it")
        self.assertEqual(self.step("82c_open_geo_intelligence_for_everyone.sql")[0][0], "opened for everyone: geo_intelligence is working")
        self.assertEqual(self.step("82f_close_geo_intelligence_for_everyone.sql")[0][0], "closed for everyone: geo_intelligence is soon")
        self.assertEqual(self.step("82a_open_compilations_for_everyone.sql")[0][0], "opened for everyone: compilations is working")
        self.assertEqual(self.bar(THIRD)["compilations"], "working", "82a also drops the tester-only rule")
        self.assertEqual(self.step("82d_close_compilations_for_everyone.sql")[0][0], "closed for everyone: compilations is soon")
        self.assertEqual(self.admin("select needs_local_compute from public.departments where id = 'compilations'"), True, "the undo restores the tester rule too")
        self.d().execute("update public.departments set status = 'working' where id = 'compilations'")
        self.assertEqual(self.bar(THIRD)["compilations"], "soon", "working without 82a's change is still testers-only, as before")
        self.d().execute("delete from public.departments where id = 'games'")
        self.assertEqual(self.step("82b_open_games_for_everyone.sql"), [("STOP: there is no department named games, nothing was changed",)])

    def test_step_82_pass_after_stop_before_and_the_rollback(self):
        rows = self.step("82_department_switches_check.sql")
        self.assertTrue(rows[0][1].startswith("PASS") and all(r[2] for r in rows), rows)
        self.d().execute(RB.read_text(encoding="utf-8"))
        rows = self.step("82_department_switches_check.sql")
        self.assertEqual([r[2] for r in rows], [False, False, False, True], rows)
        self.assertNotIn("department_switch_on", self.admin("select prosrc from pg_proc where oid = 'ryagram_private.departments_for(uuid)'::regprocedure"))
        self.switches(OTHER, "games")
        self.assertEqual(self.bar(OTHER)["games"], "soon", "after the undo the switch no longer opens it")
        self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertEqual(self.bar(OTHER)["games"], "working", "forward again")

    def test_a_hand_changed_departments_for_is_refused_and_nothing_changes(self):
        self.d().execute(RB.read_text(encoding="utf-8"))
        d0 = self.admin("select pg_get_functiondef('ryagram_private.departments_for(uuid)'::regprocedure)")
        self.d().execute(d0.replace("d.status = 'working' and d.needs_local_compute", "d.needs_local_compute and d.status = 'working'"))
        with self.assertRaises(psycopg.Error) as cm:
            self.d().execute(MIG.read_text(encoding="utf-8"))
        self.assertIn("departments_for is not the one this change expects", str(cm.exception))
        self.db.c.execute("rollback")
        self.assertIsNone(self.admin("select to_regprocedure('ryagram_private.department_switch_on(uuid,text)')"), "one transaction: nothing applied")

    def test_every_step_file_is_one_statement_with_no_semicolon_in_a_string_and_no_address(self):
        files = sorted(STEPS.glob("82*.sql"))
        self.assertEqual(len(files), 7)
        for p in files:
            t = p.read_text(encoding="utf-8")
            code = "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("--"))
            self.assertEqual(code.strip().count(";"), 1, p.name)
            self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", code), p.name)
            self.assertNotIn("@", t, p.name)


if __name__ == "__main__":
    unittest.main()
