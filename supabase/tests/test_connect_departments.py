"""THE PERSON'S DEPARTMENTS FOR THE AI'S HOME PANEL (migrations/20261113000200_connect_departments.sql) on a local Postgres, with the waiting-accounts gate in place.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_departments.py -v

What this proves: the token-checked twin answers EXACTLY what the site's my_departments() answers for the same person (same rows, same order, the local-compute rule included), it takes no owner or department
argument, a token that is not valid is refused, only the connector login can run it, the table stays closed to every API role, the migration changes nothing else and ends with the gate, the after-check is all true
and the rollback removes exactly this one function.
"""
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_film_card_requests as fc  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB = (str(uuid.UUID(int=i)) for i in (501, 502))
MIG = core.ROOT / "migrations" / "20261113000200_connect_departments.sql"
RB = core.ROOT / "rollbacks" / "20261113000200_connect_departments_rollback.sql"
CHECK = core.ROOT / "live-steps" / "26_connect_departments_after_check.sql"


class ConnectDepartments(core.Base):
    # the same OAuth dance as the film card tests (one definition, not two)
    runner = fc.FilmCards.runner
    app = fc.FilmCards.app
    connect = fc.FilmCards.connect
    owner = fc.FilmCards.owner

    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x')", (ALICE, BOB))
        d.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (fc.URI,))
        self.a = self.connect(ALICE)
        self.b = self.connect(BOB)

    def twin(self, token):
        return self.runner().one("select public.connect_my_departments(%s)", token)

    def site(self, who):
        return self.app(who).one("select public.my_departments()")

    def test_the_twin_answers_exactly_what_the_site_answers_for_the_same_person_in_the_same_order(self):
        mine = self.twin(self.a)
        self.assertEqual(mine, self.site(ALICE))
        self.assertEqual([d["id"] for d in mine], ["data_films", "compilations", "geo_intelligence", "games", "animation_studio"])
        self.assertEqual(mine[0], {"id": "data_films", "label": "Data films", "status": "working"})
        self.assertTrue(all(set(d) == {"id", "label", "status"} for d in mine), "three keys and nothing else")
        self.assertEqual(self.twin(self.b), self.site(BOB))

    def test_a_working_department_that_needs_local_compute_is_soon_until_the_account_has_it_exactly_as_on_the_site(self):
        self.owner("update public.departments set status = 'working' where id = 'compilations'")
        self.assertEqual({d["id"]: d["status"] for d in self.twin(self.a)}["compilations"], "soon")
        self.assertEqual(self.twin(self.a), self.site(ALICE))
        self.owner("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", ALICE)
        self.assertEqual({d["id"]: d["status"] for d in self.twin(self.a)}["compilations"], "working")
        self.assertEqual(self.twin(self.a), self.site(ALICE))
        self.assertEqual({d["id"]: d["status"] for d in self.twin(self.b)}["compilations"], "soon", "another person's setting is not shared")

    def test_a_token_that_is_not_valid_is_refused_and_the_function_takes_no_owner_or_department(self):
        with self.assertRaises(psycopg.Error):
            self.runner().one("select public.connect_my_departments(%s)", "0" * 64)
        self.assertEqual(self.owner("select pronargs from pg_proc where oid = to_regprocedure('public.connect_my_departments(text)')").fetchone()[0], 1)

    def test_only_the_connector_login_can_run_either_function_and_the_tables_stay_closed(self):
        for who in (ALICE, "anon"):
            for fn in ("connect_my_departments", "connect_my_switches"):
                with self.assertRaises(psycopg.Error, msg=who + fn):
                    self.db.as_(who).one(f"select public.{fn}(%s)", self.a)
        for role in ("anon", "authenticated", "service_role", "connect_runner"):
            self.assertFalse(self.owner("select has_table_privilege(%s, 'public.departments', 'select, insert, update, delete')", role).fetchone()[0], role)
        self.assertFalse(self.owner("select has_table_privilege('connect_runner', 'public.account_settings', 'select, insert, update, delete')").fetchone()[0], "the switch list is read only through the twin")

    def test_the_switch_twin_answers_exactly_what_the_site_answers_for_the_same_person_and_nothing_for_nobody_else(self):
        self.assertEqual(self.runner().one("select public.connect_my_switches(%s)", self.a), [], "no row, no switches")
        self.owner("insert into public.account_settings (owner_id, switches_on) values (%s, '{myFilms}') on conflict (owner_id) do update set switches_on = '{myFilms}'", ALICE)
        mine = self.runner().one("select public.connect_my_switches(%s)", self.a)
        self.assertEqual(mine, ["myFilms"])
        self.assertEqual(mine, self.app(ALICE).one("select public.my_switches()"))
        self.assertEqual(self.runner().one("select public.connect_my_switches(%s)", self.b), [], "another person's list is not shared")
        with self.assertRaises(psycopg.Error):
            self.runner().one("select public.connect_my_switches(%s)", "0" * 64)

    def test_the_migration_adds_two_functions_and_ends_with_the_gate(self):
        sql = MIG.read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        self.assertEqual(len([ln for ln in lines if ln.startswith("create ")]), 2)
        self.assertEqual(self.owner("select prosecdef from pg_proc where oid = to_regprocedure('public.connect_my_departments(text)')").fetchone()[0], True)

    def test_the_after_check_is_all_true_and_the_rollback_removes_exactly_these_two_functions(self):
        rows = self.owner(CHECK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(len(rows), 8)
        self.assertTrue(all(ok for _, ok in rows), rows)
        before = self.owner("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')").fetchone()[0]
        self.owner(RB.read_text(encoding="utf-8"))
        self.assertIsNone(self.owner("select to_regprocedure('public.connect_my_departments(text)')").fetchone()[0])
        self.assertIsNone(self.owner("select to_regprocedure('public.connect_my_switches(text)')").fetchone()[0])
        self.assertEqual(self.owner("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private')").fetchone()[0], before - 2)
        self.assertIsNotNone(self.owner("select to_regprocedure('public.my_departments()')").fetchone()[0], "the site's own function is untouched")
        self.owner(RB.read_text(encoding="utf-8"))                                                       # a second undo: nothing to do, no error
        self.owner(MIG.read_text(encoding="utf-8"))                                                      # and the migration puts it back
        self.assertTrue(all(ok for _, ok in self.owner(CHECK.read_text(encoding="utf-8")).fetchall()))


if __name__ == "__main__":
    unittest.main()
