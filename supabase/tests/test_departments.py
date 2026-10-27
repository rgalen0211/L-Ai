"""Departments in the top bar, the server half (migrations/20261027000100_departments.sql, NOT APPLIED) on a local Postgres. NEXT-WEB 147 piece 2.

Same setup as test_2a_core.py. Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_departments.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * my_departments() answers only an INVITED account (enabled in connect_access, not an admin, not a worker); anyone else, and nobody, gets []; the list is in the page's order
  * a 'working' department that needs local-compute is shown as 'soon' to an account without that flag and as 'working' to one with it; Ryan promotes a department with one UPDATE
  * 'Tell me when it's ready' stores ONLY (owner, department, time): one row per person per department, idempotent, only for a department the account sees as 'soon'; a working or unknown department is refused
  * 'Take it back' deletes the person's own row and nobody else's; deleting the account deletes the rows
  * nobody can read or write the tables directly (not signed-in people, not anon, not the service role); the functions are for signed-in people only (not anon, not public); counts are Ryan's alone and carry no names
  * NOTHING in the migration can send anything: no email, trigger, queue, webhook, pg_net or cron; the interest table has exactly three columns
"""
import re
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
from test_2a_core import OTHER, WORKER, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

ALICE, BOB, TESTER, ADMIN, NOTINVITED = (str(uuid.UUID(int=i)) for i in (401, 402, 403, 404, 405))
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "20261027000100_departments.sql"
IDS = ["data_films", "compilations", "geo_intelligence", "games", "animation_studio"]


class Departments(core.Base):
    def setUp(self):
        super().setUp()
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'a@x'),(%s,'b@x'),(%s,'t@x'),(%s,'adm@x'),(%s,'n@x')", (ALICE, BOB, TESTER, ADMIN, NOTINVITED))
        c.execute("insert into public.connect_access (user_id) values (%s),(%s),(%s),(%s)", (ALICE, BOB, TESTER, ADMIN))        # invited; NOTINVITED has no row
        c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (TESTER,))
        c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, false) on conflict (owner_id) do update set local_compute = false", (ALICE,))
        c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        c.execute("insert into public.workers (user_id, name) values (%s, 'ryan-pc') on conflict do nothing", (WORKER,))
        c.execute("insert into public.connect_access (user_id) values (%s) on conflict do nothing", (WORKER,))

    def admin_sql(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def deps(self, who):
        return self.db.as_(who).one("select my_departments()")

    def status(self, who):
        return {d["id"]: d["status"] for d in self.deps(who)}

    def test_an_invited_account_gets_the_list_in_the_pages_order(self):
        got = self.deps(ALICE)
        self.assertEqual([d["id"] for d in got], IDS)
        self.assertEqual(got[0], {"id": "data_films", "label": "Data films", "status": "working"})
        self.assertEqual(set(got[1]), {"id", "label", "status"})                      # nothing else in the answer
        self.assertEqual([d["status"] for d in got], ["working", "soon", "soon", "soon", "soon"])

    def test_nobody_else_gets_a_list_not_an_uninvited_account_an_admin_a_worker_or_nobody(self):
        for who in (NOTINVITED, ADMIN, WORKER, OTHER):
            self.assertEqual(self.deps(who), [], str(who))
        self.assertEqual(self.db.as_(None).one("select my_departments()"), [])                      # no signed-in user
        self.assertEqual(len(self.deps(ALICE)), 5)                                                  # control

    def test_a_working_department_that_needs_local_compute_is_soon_for_an_account_without_it(self):
        self.admin_sql("update public.departments set status = 'working' where id = 'compilations' returning 1")
        self.assertEqual(self.status(TESTER)["compilations"], "working")                           # has the flag
        self.assertEqual(self.status(ALICE)["compilations"], "soon")                               # does not
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(TESTER).one("select register_department_interest('compilations')")        # working for this account: not announced
        self.assertEqual(cm.exception.sqlstate, "PT404")
        self.db.as_(ALICE).one("select register_department_interest('compilations')")             # still 'soon' for Alice: she may ask
        self.admin_sql("update public.departments set needs_local_compute = false where id = 'compilations' returning 1")
        self.assertEqual(self.status(ALICE)["compilations"], "working")

    def test_interest_stores_one_row_with_three_facts_idempotently(self):
        a = self.db.as_(ALICE)
        a.one("select register_department_interest('games')")
        a.one("select register_department_interest('games')")
        self.assertEqual(a.one("select my_department_interests()"), [{"department": "games"}])
        row = self.admin_sql("select owner_id::text, department, created_at is not null from public.department_interest")
        self.assertEqual(row, (ALICE, "games", True))
        self.assertEqual(self.admin_sql("select count(*) from public.department_interest"), 1)
        self.assertEqual(self.admin_sql("select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'department_interest'"),
                         ["owner_id", "department", "created_at"])                                  # exactly three facts

    def test_only_a_soon_department_the_account_sees_can_be_asked_for(self):
        for dept, code in (("data_films", "PT404"), ("time_machine", "PT404"), ("", "PT404"), (None, "PT404")):
            with self.assertRaises(psycopg.Error, msg=str(dept)) as cm:
                self.db.as_(ALICE).one("select register_department_interest(%s)", dept)
            self.assertEqual(cm.exception.sqlstate, code, str(dept))
        for who, code in ((NOTINVITED, "PT403"), (ADMIN, "PT403"), (WORKER, "PT403")):
            with self.assertRaises(psycopg.Error, msg=str(who)) as cm:
                self.db.as_(who).one("select register_department_interest('games')")
            self.assertEqual(cm.exception.sqlstate, code, str(who))
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(None).one("select register_department_interest('games')")
        self.assertEqual(cm.exception.sqlstate, "PT401")
        self.assertEqual(self.admin_sql("select count(*) from public.department_interest"), 0)
        self.db.as_(ALICE).one("select register_department_interest('geo_intelligence')")           # control
        self.assertEqual(self.admin_sql("select count(*) from public.department_interest"), 1)

    def test_take_it_back_removes_only_the_persons_own_row_and_the_account_takes_its_rows_with_it(self):
        self.db.as_(ALICE).one("select register_department_interest('games')")
        self.db.as_(BOB).one("select register_department_interest('games')")
        self.db.as_(BOB).one("select withdraw_department_interest('games')")
        self.assertEqual(self.db.as_(BOB).one("select my_department_interests()"), [])
        self.assertEqual(self.db.as_(ALICE).one("select my_department_interests()"), [{"department": "games"}])      # Alice's row is untouched
        self.db.as_(BOB).one("select withdraw_department_interest('games')")                                         # idempotent
        self.admin_sql("delete from auth.users where id = %s returning 1", ALICE)
        self.assertEqual(self.admin_sql("select count(*) from public.department_interest"), 0)

    def test_a_person_sees_only_their_own_interest(self):
        self.db.as_(ALICE).one("select register_department_interest('games')")
        self.db.as_(BOB).one("select register_department_interest('animation_studio')")
        self.assertEqual(self.db.as_(ALICE).one("select my_department_interests()"), [{"department": "games"}])
        self.assertEqual(self.db.as_(BOB).one("select my_department_interests()"), [{"department": "animation_studio"}])
        self.assertEqual(self.db.as_(NOTINVITED).one("select my_department_interests()"), [])

    def test_counts_are_ryans_alone_and_carry_no_names(self):
        self.db.as_(ALICE).one("select register_department_interest('games')")
        self.db.as_(BOB).one("select register_department_interest('games')")
        self.db.as_(BOB).one("select register_department_interest('compilations')")
        got = self.db.as_(ADMIN).one("select admin_department_interest_counts()")
        self.assertEqual({d["department"]: d["people"] for d in got}, {"data_films": 0, "compilations": 1, "geo_intelligence": 0, "games": 2, "animation_studio": 0})
        self.assertTrue(all(set(d) == {"department", "people"} for d in got), "numbers and department names only")
        for who in (ALICE, TESTER, NOTINVITED):
            with self.assertRaises(psycopg.Error, msg=str(who)) as cm:
                self.db.as_(who).one("select admin_department_interest_counts()")
            self.assertEqual(cm.exception.sqlstate, "42501", str(who))
        with self.assertRaises(psycopg.Error):
            self.db.as_(None).one("select admin_department_interest_counts()")

    def test_the_tables_are_closed_and_the_functions_are_for_signed_in_people_only(self):
        for who in ("anon", ALICE, "service", ADMIN):
            for t in ("departments", "department_interest"):
                with self.assertRaises(psycopg.Error, msg=f"{who} {t}"):
                    self.db.as_(who).one(f"select count(*) from public.{t}")
                with self.assertRaises(psycopg.Error, msg=f"write {who} {t}"):
                    self.db.as_(who).one(f"delete from public.{t} returning 1")
        for fn in ("my_departments()", "my_department_interests()", "register_department_interest(text)", "withdraw_department_interest(text)", "admin_department_interest_counts()"):
            self.assertTrue(self.admin_sql(f"select has_function_privilege('authenticated', 'public.{fn}', 'EXECUTE')"), fn)
            for role in ("anon", "public"):
                self.assertFalse(self.admin_sql(f"select has_function_privilege('{role}', 'public.{fn}', 'EXECUTE')"), f"{role} {fn}")
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select my_departments()")
        for helper in ("departments_for(uuid)", "department_person_ok(uuid)"):
            for role in ("anon", "authenticated", "public"):
                self.assertFalse(self.admin_sql(f"select has_function_privilege('{role}', 'ryagram_private.{helper}', 'EXECUTE')"), f"{role} {helper}")      # the helpers are not callable by clients

    def test_nothing_in_the_migration_can_send_anything(self):
        sql = re.sub(r"--[^\n]*", "", MIGRATION.read_text(encoding="utf-8"))                       # the comments say 'no email' on purpose; only the code counts
        self.assertFalse(re.search(r"pg_net|net\.http|http_post|cron\.|create\s+trigger|notify|listen|pg_notify|mail|webhook|smtp|resend|queue", sql, re.I), "no send path of any kind")
        self.assertEqual(self.admin_sql("select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('departments', 'department_interest') and not t.tgisinternal"), 0)

    def test_the_seed_is_the_five_departments_and_only_data_films_works(self):
        self.assertEqual(self.admin_sql("select array_agg(id order by sort, id) from public.departments"), IDS)
        self.assertEqual(self.admin_sql("select array_agg(id) from public.departments where status = 'working'"), ["data_films"])
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.admin_sql("insert into public.departments (id, label, status) values ('x', 'X', 'maybe') returning 1")
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.admin_sql("insert into public.departments (id, label) values ('Bad-Id', 'X') returning 1")


if __name__ == "__main__":
    unittest.main()
