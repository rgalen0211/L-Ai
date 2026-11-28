"""THE DESKTOP APP AS A SETUP EXE (migrations/20261128000300_app_setup_exe.sql, NOT APPLIED) on a local Postgres with every migration. BUILDER 2026-11-28.
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -B -m unittest supabase/tests/test_app_setup_exe_1128.py -v

What it proves, each with the opposite case beside it
  * an app release may be Ryagram-Setup-<version>.exe and request_app_download hands it out exactly as the zip (same answer keys, 900 seconds, a row per link)
  * an add-on or the notices may NOT be an exe; a bad name (a path, a space, another extension, too long) is still refused
  * switching the active app row from the zip to the exe and back is one row change each way (at most one active app)
  * who may download is unchanged: a tester and an account with compilations on get the exe; a plain account is refused and nothing is written
  * step 87 PASS after, STOP after the undo; the undo refuses while an exe row exists and then restores the original check exactly; applying twice leaves it alone
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_app_downloads as dl  # noqa: E402
from test_2a_core import setUpModule  # noqa: E402,F401

MIG = core.ROOT / "migrations" / "20261128000300_app_setup_exe.sql"
RB = core.ROOT / "rollbacks" / "20261128000300_app_setup_exe_rollback.sql"
STEP = core.ROOT / "live-steps" / "87_app_setup_exe_check.sql"
EXE = "Ryagram-Setup-1.0.0.exe"
ORIGINAL = "CHECK ((file_name ~ '^[A-Za-z0-9._-]{1,120}\\.(zip|txt)$'::text))"


class SetupExe(dl.AppDownloads):
    def run_sql(self, path):
        self.db.c.execute("reset role")
        return self.db.c.execute(path.read_text(encoding="utf-8"))

    def step(self):
        self.db.c.execute("reset role")
        return self.db.c.execute(STEP.read_text(encoding="utf-8")).fetchall()

    def ex(self, sql, *args):
        self.db.c.execute("reset role")
        self.db.c.execute(sql, args)

    def check_def(self):
        return self.admin("select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = 'public.app_releases'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%%file_name%%'")

    def exe_release(self, active=False, name=EXE, kind="app"):
        return self.add_release(active=active, key=f"releases/{name}", name=name, size=290000000, kind=kind)

    def switch_to(self, rid):
        """the release sheet's switch: two updates in one transaction (the one-active index is checked row by row)"""
        self.db.c.execute("reset role")
        with self.db.c.transaction():
            self.db.c.execute("update public.app_releases set active = false where kind = 'app' and active")
            self.db.c.execute("update public.app_releases set active = true where id = %s", (rid,))

    def test_an_app_release_may_be_a_setup_exe_and_is_handed_out_like_the_zip(self):
        exe = self.exe_release()
        self.switch_to(exe)
        got = self.ask(dl.TESTER)
        self.assertEqual(set(got), dl.KEYS)
        self.assertEqual((got["file_name"], got["object_key"], got["expires_seconds"]), (EXE, f"releases/{EXE}", 900))
        self.assertEqual(self.admin("select release_id::text from public.app_downloads where id = %s", got["link_id"]), str(exe))

    def test_an_addon_or_the_notices_cannot_be_an_exe_and_bad_names_are_still_refused(self):
        for kind in ("addon", "notices"):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=kind):
                self.exe_release(name="forge-addon.exe", kind=kind)
        for bad in ("../x.exe", "a b.exe", "setup.msi", "setup.exe.bat", "x" * 121 + ".exe", ".exe", "Setup.EXE", "setup.exe/"):
            with self.assertRaises(psycopg.Error, msg=bad):
                self.exe_release(name=bad)
        self.assertIsNotNone(self.exe_release(name="x" * 120 + ".exe"), "the longest allowed name")

    def test_switching_the_active_app_from_the_zip_to_the_exe_and_back(self):
        exe = self.exe_release()
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.ex("update public.app_releases set active = true where id = %s", exe)
        self.switch_to(exe)
        self.assertEqual(self.ask(dl.TESTER)["file_name"], EXE)
        self.switch_to(self.release)
        self.assertEqual(self.ask(dl.TESTER)["file_name"], "app-1.zip")

    def test_who_may_download_is_unchanged(self):
        self.switch_to(self.exe_release())
        self.db.as_(None).c.execute("insert into public.connect_access (user_id, enabled) values (%s, true) on conflict do nothing", (dl.PLAIN,))
        before = self.rows()
        with self.assertRaises(psycopg.Error):
            self.ask(dl.PLAIN)
        self.assertEqual(self.rows(), before, "a plain account is refused and nothing is written")
        self.db.as_(None).c.execute("insert into public.account_settings (owner_id, switches_on) values (%s, '{compilations}') "
                                    "on conflict (owner_id) do update set switches_on = array_append(public.account_settings.switches_on, 'compilations')", (dl.PLAIN,))
        self.assertEqual(self.ask(dl.PLAIN)["file_name"], EXE, "the same account with compilations on gets the exe")

    def undo_refused(self):
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(RB)
        self.db.c.execute("rollback")           # the file's own transaction, left aborted by the refusal (the SQL Editor ends it the same way)
        return cm.exception.diag.message_primary

    def test_step_87_pass_after_and_the_undo_refuses_while_the_exe_is_active(self):
        rows = self.step()
        self.assertTrue(rows[0][1].startswith("PASS") and all(r[2] for r in rows), rows)
        exe = self.exe_release()
        self.switch_to(exe)
        self.assertEqual(self.undo_refused(), "The active app release is still a setup exe: switch the app back to its zip first; nothing was changed.")
        self.assertIn("exe", self.check_def(), "nothing changed")
        self.switch_to(self.release)

    def test_undo_with_no_exe_row_restores_the_original_check_exactly_and_apply_again(self):
        self.run_sql(RB)
        self.assertEqual(self.check_def(), ORIGINAL, "the original check, exactly (validated)")
        self.assertTrue(self.admin("select convalidated from pg_constraint where conname = 'app_releases_file_name_check'"))
        rows = self.step()
        self.assertTrue(rows[0][1].startswith("STOP") and not rows[1][2], rows)
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.exe_release()
        self.run_sql(MIG)
        after_once = self.check_def()
        self.run_sql(MIG)
        self.assertEqual(self.check_def(), after_once, "applying twice leaves it alone")
        self.assertTrue(self.step()[0][1].startswith("PASS"))

    def test_undo_after_people_downloaded_the_exe_keeps_it_as_history_and_refuses_new_exe_rows(self):
        exe = self.exe_release()
        self.switch_to(exe)
        self.ask(dl.TESTER)                     # a download row now points at the exe release: it can never be deleted
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.ex("delete from public.app_releases where id = %s", exe)
        self.switch_to(self.release)
        self.run_sql(RB)
        self.assertEqual(self.check_def(), ORIGINAL + " NOT VALID")
        self.assertEqual(self.admin("select count(*) from public.app_releases where file_name = %s", EXE), 1, "the past exe stays as history")
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.exe_release(name="Ryagram-Setup-1.0.1.exe")
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.ex("update public.app_releases set note = 'x' where id = %s", exe)
        self.assertEqual(self.ask(dl.TESTER)["file_name"], "app-1.zip")
        self.run_sql(MIG)
        self.assertTrue(self.step()[0][1].startswith("PASS"), "applied again over the history row")

    def test_a_hand_changed_check_is_refused_in_words_and_nothing_changes(self):
        self.run_sql(RB)
        self.ex("alter table public.app_releases drop constraint app_releases_file_name_check")
        self.ex("alter table public.app_releases add constraint app_releases_file_name_check check (file_name ~ '^[a-z0-9-]{1,9}\.zip$')")
        hand = self.check_def()
        with self.assertRaises(psycopg.Error) as cm:
            self.run_sql(MIG)
        self.db.c.execute("rollback")
        self.assertEqual(cm.exception.diag.message_primary,
                         "app_releases is not the one this change expects (its file name check differs from the repository); nothing was changed. Send this sentence to BUILDER.")
        self.assertEqual(self.check_def(), hand)


if __name__ == "__main__":
    unittest.main()
