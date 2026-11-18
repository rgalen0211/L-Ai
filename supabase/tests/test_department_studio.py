"""THE STUDIO DEPARTMENT ROW (migrations/20261118000100_department_studio.sql) on a local Postgres, with every migration in place.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_department_studio.py -v

What this proves (Ryan's Q639 yes, 2026-11-17: Studio is shown as Coming soon; the database row is a LIVE step he takes): the migration adds exactly ONE row, 'studio', label Studio, status soon,
no local-compute need, last in the order; the five departments that were there are untouched (ids, labels, status, order); the site's my_departments() and the connector's twin both list it last as
'soon' for an invited account and nobody else; 'Tell me when it's ready' works for it like for any Coming soon department and nothing is sent; running the migration twice changes nothing; the
after-check is all true (and answers false, never an error, before the row); the rollback removes exactly that one row (and the interest rows that cascade with it) and nothing else.
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_film_card_requests as fc  # noqa: E402

setUpModule = core.setUpModule
ALICE, BOB = (str(uuid.UUID(int=i)) for i in (601, 602))
MIG = core.ROOT / "migrations" / "20261118000100_department_studio.sql"
RB = core.ROOT / "rollbacks" / "20261118000100_department_studio_rollback.sql"
CHECK = core.ROOT / "live-steps" / "29_department_studio_after_check.sql"
FIVE = ["data_films", "compilations", "geo_intelligence", "games", "animation_studio"]


class DepartmentStudio(core.Base):
    runner = fc.FilmCards.runner
    app = fc.FilmCards.app
    connect = fc.FilmCards.connect
    owner = fc.FilmCards.owner

    def setUp(self):
        super().setUp()
        self.counter = 0
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x')", (ALICE, BOB))
        d.execute("insert into public.connect_access (user_id) values (%s)", (ALICE,))          # Bob is NOT invited
        d.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude')", (fc.URI,))
        self.a = self.connect(ALICE)

    def rows(self):
        return self.owner("select id, label, status, needs_local_compute, sort from public.departments order by sort, id").fetchall()

    def test_the_row_is_studio_soon_no_local_compute_and_last(self):
        rows = self.rows()
        self.assertEqual([r[0] for r in rows], FIVE + ["studio"])
        self.assertEqual(rows[-1], ("studio", "Studio", "soon", False, 60))
        self.assertEqual([r[0] for r in rows if r[2] == "working"], ["data_films"], "nothing else was promoted")

    def test_the_five_that_were_there_are_untouched(self):
        self.assertEqual(self.rows()[:5], [("data_films", "Data films", "working", False, 10), ("compilations", "Compilations", "soon", True, 20),
                                           ("geo_intelligence", "Geographic Intelligence", "soon", False, 30), ("games", "Games", "soon", False, 40),
                                           ("animation_studio", "Animation Studio", "soon", False, 50)])

    def test_the_site_and_the_connector_list_it_last_as_soon_for_an_invited_account_and_nobody_else(self):
        site = self.app(ALICE).one("select public.my_departments()")
        self.assertEqual(site[-1], {"id": "studio", "label": "Studio", "status": "soon"})
        self.assertEqual(self.runner().one("select public.connect_my_departments(%s)", self.a), site, "the twin answers exactly what the site answers")
        self.assertEqual(self.app(BOB).one("select public.my_departments()"), [], "an account that is not invited sees nothing, Studio included")
        self.assertEqual(self.app(None).one("select public.my_departments()"), [])

    def test_tell_me_when_its_ready_works_for_it_and_sends_nothing(self):
        self.app(ALICE).one("select public.register_department_interest('studio')")
        self.assertEqual(self.app(ALICE).one("select public.my_department_interests()"), [{"department": "studio"}])
        self.app(ALICE).one("select public.register_department_interest('studio')")             # idempotent
        self.assertEqual(self.owner("select count(*) from public.department_interest where department = 'studio'").fetchone()[0], 1)
        self.assertEqual(self.owner("select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('departments', 'department_interest') and not t.tgisinternal").fetchone()[0], 0,
                         "no trigger: nothing is sent")
        with self.assertRaises(psycopg.Error):
            self.app(BOB).one("select public.register_department_interest('studio')")           # not invited

    def test_the_migration_is_one_idempotent_insert_and_nothing_else(self):
        sql = MIG.read_text(encoding="utf-8")
        code = "\n".join(ln.split("--")[0] for ln in sql.splitlines()).lower()
        self.assertEqual(code.count("insert into public.departments"), 1)
        self.assertIn("on conflict (id) do nothing", code)
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"], "like every migration after the waiting list")
        for bad in ("create ", "alter ", "drop ", "update ", "delete ", "grant ", "revoke ", "pg_net", "cron", "trigger"):   # (the gate line is a select)
            self.assertNotIn(bad, code, bad)
        before = self.rows()
        self.owner(sql)
        self.owner(sql)
        self.assertEqual(self.rows(), before)

    def test_the_after_check_is_all_true_and_false_not_an_error_before_the_row(self):
        rows = self.owner(CHECK.read_text(encoding="utf-8")).fetchall()
        self.assertEqual(len(rows), 6)
        self.assertTrue(all(ok for _, ok in rows), rows)
        self.owner("delete from public.departments where id = 'studio'")
        rows = self.owner(CHECK.read_text(encoding="utf-8")).fetchall()                          # before the migration: answers false, never an error
        self.assertFalse(all(ok for _, ok in rows))
        self.assertFalse(rows[0][1], "the first check is the row itself: false when it is not there")
        self.assertTrue(any(not ok for name, ok in rows if "studio" in name.lower()))

    def test_the_after_check_notices_each_wrong_field_of_the_row(self):
        for field, value in (("label", "'Studios'"), ("status", "'working'"), ("needs_local_compute", "true"), ("sort", "5")):
            self.owner("update public.departments set %s = %s where id = 'studio'" % (field, value))
            rows = self.owner(CHECK.read_text(encoding="utf-8")).fetchall()
            self.assertFalse(rows[0][1], "the row check misses a wrong " + field)
            self.owner("delete from public.departments where id = 'studio'")
            self.owner(MIG.read_text(encoding="utf-8"))                                       # back to the right row for the next field
        self.assertTrue(all(ok for _, ok in self.owner(CHECK.read_text(encoding="utf-8")).fetchall()))

    def test_the_rollback_removes_exactly_that_row_and_its_interest_rows(self):
        self.app(ALICE).one("select public.register_department_interest('studio')")
        self.app(ALICE).one("select public.register_department_interest('games')")
        self.owner(RB.read_text(encoding="utf-8"))
        self.assertEqual([r[0] for r in self.rows()], FIVE)
        self.assertEqual(self.app(ALICE).one("select public.my_department_interests()"), [{"department": "games"}], "another department's interest is kept")
        self.owner(RB.read_text(encoding="utf-8"))                                               # a second undo: nothing to do, no error
        self.owner(MIG.read_text(encoding="utf-8"))                                              # and the migration puts it back
        self.assertEqual([r[0] for r in self.rows()], FIVE + ["studio"])
        self.assertTrue(all(ok for _, ok in self.owner(CHECK.read_text(encoding="utf-8")).fetchall()))

    def test_the_table_stays_closed_to_every_api_role(self):
        for role in ("anon", "authenticated", "service_role", "connect_runner"):
            self.assertFalse(self.owner("select has_table_privilege(%s, 'public.departments', 'select, insert, update, delete')", role).fetchone()[0], role)


if __name__ == "__main__":
    unittest.main()
