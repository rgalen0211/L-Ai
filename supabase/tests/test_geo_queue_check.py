"""Live step 60 (GEO 2026-11-23): the after-check for A15 (20261123000200_queue_cap_per_owner) and A16 (20261123000300_blocked_story_views),
on the same database BUILDER's test uses (every migration, the 2B ledger and PIPE-1 orders).

  * after both migrations every row is true;
  * after 000300's rollback rows 1 and 2 (the cap) stay true and rows 3 and 4 (the blocked list) turn false;
  * after 000200's rollback too rows 1 to 4 are false; row 5 is true at every stage; never an error;
  * the check writes nothing.
Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_queue_check.py -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

STEP60 = core.ROOT / "live-steps" / "60_queue_cap_blocked_views_after_check.sql"
RB300 = core.ROOT / "rollbacks" / "20261123000300_blocked_story_views_rollback.sql"
RB200 = core.ROOT / "rollbacks" / "20261123000200_queue_cap_per_owner_rollback.sql"


def setUpModule():
    credits.setUpModule()


class QueueCheck(unittest.TestCase):
    setUp = credits.Ledger.setUp
    tearDown = credits.Ledger.tearDown

    def check(self):
        self.db.c.execute("reset role")
        return [r[1] for r in self.db.c.execute(STEP60.read_text(encoding="utf-8")).fetchall()]

    def test_GEO_60_true_after_both_and_each_rollback_turns_its_own_rows_false(self):
        self.db.c.execute("reset role")
        self.db.c.execute("update public.ops_settings set queue_cap_per_owner = 50")   # what a test template sets (BUILDER 80a39c87)
        self.assertEqual(self.check()[1], False, "a limit other than 2 is shown")
        self.db.c.execute("update public.ops_settings set queue_cap_per_owner = 2")    # as on live
        before = self.db.c.execute("select count(*) from ryagram_private.blocked_story_views").fetchone()[0]
        self.assertEqual(self.check(), [True, True, True, True, True, True], "after A15 and A16")
        self.assertEqual(self.db.c.execute("select count(*) from ryagram_private.blocked_story_views").fetchone()[0], before, "the check writes nothing")
        self.db.c.execute(RB300.read_text(encoding="utf-8"))
        self.assertEqual(self.check(), [True, True, True, False, False, True], "after 000300's undo: the cap stays, the blocked list is gone")
        self.db.c.execute(RB200.read_text(encoding="utf-8"))
        self.assertEqual(self.check(), [False, False, False, False, False, True], "after both undos (= before A15): no error, all false but the grants row")


if __name__ == "__main__":
    unittest.main()
