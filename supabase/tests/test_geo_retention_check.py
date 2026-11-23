"""Live step 59 (GEO 2026-11-23, GAMES 11:04): the after-check for 20261123000400_retention_join_attempts.sql, on a local Postgres with every migration.

  * after the migration all three rows are true, and the purge really does what rows 1 and 2 say (an old try goes, a young one stays);
  * after the migration's rollback rows 1 and 2 are false and row 3 is still true, never an error;
  * the check writes nothing.
Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_retention_check.py -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
STEP59 = core.ROOT / "live-steps" / "59_retention_join_attempts_after_check.sql"
ROLLBACK = core.ROOT / "rollbacks" / "20261123000400_retention_join_attempts_rollback.sql"


class RetentionCheck(core.Base):
    def d(self):
        return self.db.as_(None).c

    def check(self):
        return [row[1] for row in self.d().execute(STEP59.read_text(encoding="utf-8")).fetchall()]

    def test_GEO_59_true_after_the_migration_false_after_its_rollback(self):
        self.assertEqual(self.check(), [True, True, True], "after A17")
        self.d().execute("insert into public.join_attempts (ip_hash, email_hash, at) values ('old', repeat('a', 64), now() - interval '3 days'), ('new', repeat('b', 64), now() - interval '1 day')")
        self.d().execute("insert into public.invite_attempts (ip_hash, at) values ('old', now() - interval '2 days'), ('new', now() - interval '2 hours')")
        self.d().execute("update public.retention_runs set last_run_on = null")
        self.db.as_("service").one("select retention_purge()")
        self.assertEqual(self.d().execute("select ip_hash from public.join_attempts order by 1").fetchall(), [("new",)], "row 1 is what the purge does")
        self.assertEqual(self.d().execute("select ip_hash from public.invite_attempts order by 1").fetchall(), [("new",)], "row 2 is what the purge does")
        counts = self.d().execute("select (select count(*) from public.join_attempts), (select count(*) from public.invite_attempts)").fetchone()
        self.check()
        self.assertEqual(self.d().execute("select (select count(*) from public.join_attempts), (select count(*) from public.invite_attempts)").fetchone(), counts, "the check writes nothing")
        self.d().execute(ROLLBACK.read_text(encoding="utf-8"))
        self.assertEqual(self.check(), [False, False, True], "before A17 (= after its rollback): the two new deletes are absent, the guard row holds")


if __name__ == "__main__":
    unittest.main()
