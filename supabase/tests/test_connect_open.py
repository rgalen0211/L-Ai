"""CONNECT-AN-AI OPENS TO EVERYONE (migrations/20261121000700_connect_ai_open_to_all.sql, NOT APPLIED) on a local Postgres. CONNECT, 2026-11-21 (Ryan 11:30).

STATE: RUN 2026-11-21 12:32 on a local Postgres (WEB's pgvenv2, own TEMP on D:): 5 of 5. Also run on this branch the same day: test_connect.py 67 of 67 (after the full rollback script learned the new admin function) and test_connect_departments.py 7 of 7. To run it again, from the repo root with TEMP/TMP on D: and RYAGRAM_LAI_REPO set:
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_open.py -v
and kill any pgserver it leaves by PID (about 1 GB a run).

What it proves, each with the opposite case beside it
  * the flag is OFF after the migration and the person rule answers exactly as before: an enabled list row is allowed; an unlisted account, a disabled row, an administrator and a worker are not
  * with the flag ON an unlisted signed-up account is allowed; an administrator, a worker and an account whose list row is DISABLED are still refused
  * an administrator's own session can flip the flag with admin_connect_set_open; a signed-in non-administrator is refused; anon cannot run it; the connector login cannot run it
  * the rollback puts the old rule back and removes the flag, the helper and the function
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
LISTED, UNLISTED, DISABLED, ADMIN, WORKER = (str(uuid.UUID(int=i)) for i in (601, 602, 603, 604, 605))
RB = core.ROOT / "rollbacks" / "20261121000700_connect_ai_open_to_all_rollback.sql"


class ConnectOpen(core.Base):
    app = fc.FilmCards.app
    runner = fc.FilmCards.runner

    def setUp(self):
        super().setUp()
        d = self.db.as_(None).c
        d.execute("insert into auth.users (id, email) values (%s,'l@x'),(%s,'u@x'),(%s,'d@x'),(%s,'a@x'),(%s,'w@x')", (LISTED, UNLISTED, DISABLED, ADMIN, WORKER))
        d.execute("insert into public.connect_access (user_id, enabled) values (%s, true), (%s, false)", (LISTED, DISABLED))
        d.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        d.execute("insert into public.workers (user_id, name) values (%s, 'open-test-worker')", (WORKER,))

    def ok(self, who):
        return self.db.as_(None).c.execute("select ryagram_private.connect_person_ok(%s)", (who,)).fetchone()[0]

    def flag(self, on):
        self.db.as_(None).c.execute("update public.connect_flags set open_to_all = %s where id", (on,))

    def test_the_flag_is_off_after_the_migration_and_the_old_rule_holds(self):
        self.assertFalse(self.db.as_(None).c.execute("select open_to_all from public.connect_flags where id").fetchone()[0])
        self.assertEqual([self.ok(x) for x in (LISTED, UNLISTED, DISABLED, ADMIN, WORKER)], [True, False, False, False, False])

    def test_with_the_flag_on_only_the_unlisted_signed_up_account_is_added(self):
        self.flag(True)
        self.assertEqual([self.ok(x) for x in (LISTED, UNLISTED, DISABLED, ADMIN, WORKER)], [True, True, False, False, False])
        self.flag(False)
        self.assertFalse(self.ok(UNLISTED), "turning it off again refuses the account at once")

    def test_who_may_flip_it(self):
        self.app(ADMIN).one("select public.admin_connect_set_open(true)")
        self.assertTrue(self.db.as_(None).c.execute("select open_to_all from public.connect_flags where id").fetchone()[0])
        self.app(ADMIN).one("select public.admin_connect_set_open(false)")
        for who in (UNLISTED, LISTED, "anon"):
            with self.assertRaises(psycopg.Error):
                self.app(who).one("select public.admin_connect_set_open(true)")
        with self.assertRaises(psycopg.Error):
            self.runner().one("select public.admin_connect_set_open(true)")
        self.assertFalse(self.db.as_(None).c.execute("select open_to_all from public.connect_flags where id").fetchone()[0], "nobody but the administrator changed it")

    def test_the_check_step_answers_true_on_every_row_after_the_migration_with_the_flag_off_and_on(self):
        text = (core.ROOT / "live-steps" / "35_connect_open_check.sql").read_text(encoding="utf-8")
        for on in (False, True):
            self.flag(on)
            rows = self.db.as_(None).c.execute(text).fetchall()
            self.assertEqual(len(rows), 5)
            self.assertTrue(all(r[1] is True for r in rows), rows)
            self.assertIn("ON" if on else "OFF", rows[-1][0])

    def test_the_rollback_puts_the_old_rule_back_and_removes_what_was_added(self):
        self.flag(True)
        self.db.as_(None).c.execute(RB.read_text(encoding="utf-8"))
        self.assertFalse(self.ok(UNLISTED))
        self.assertTrue(self.ok(LISTED))
        d = self.db.as_(None).c
        self.assertIsNone(d.execute("select to_regprocedure('public.admin_connect_set_open(boolean)')").fetchone()[0])
        self.assertIsNone(d.execute("select to_regprocedure('ryagram_private.connect_open()')").fetchone()[0])
        self.assertEqual(d.execute("select count(*) from information_schema.columns where table_name = 'connect_flags' and column_name = 'open_to_all'").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
