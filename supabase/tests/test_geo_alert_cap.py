"""Live step 62 (GEO 2026-11-23, Ryan 15:46 'Alert cap 60 for launch week'), on a local Postgres with every migration.

  * the file's own four parts, split on its headers as Ryan pastes them: part 1 reads 20 and today's alert mails; part 2 sets 60;
    part 3 reads 60; part 4 (the undo) puts 20 back;
  * the change reaches what the scheduler sees: ops_tick()'s alert_mail_budget is 60 after part 2 (minus alerts already sent today),
    and 20 again after the undo;
  * parts 1 and 3 are read-only; part 2 and part 4 touch only max_alert_mails_per_day.
Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_alert_cap.py -v
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
STEP62 = core.ROOT / "live-steps" / "62_alert_cap_launch_week.sql"


def parts():
    chunks = re.split(r"^-- PART \d.*$", STEP62.read_text(encoding="utf-8"), flags=re.M)[1:]
    assert len(chunks) == 4, len(chunks)
    return [c.strip() for c in chunks]


class AlertCap(core.Base):
    def d(self):
        return self.db.as_(None).c

    def budget(self):
        return self.db.as_("service").one("select ops_tick()")["alert_mail_budget"]

    def others(self):
        self.db.as_(None)
        row = self.d().execute("select to_jsonb(o) - 'max_alert_mails_per_day' from public.ops_settings o").fetchone()[0]
        return row

    def test_GEO_62_sets_60_for_launch_week_and_the_undo_puts_20_back(self):
        p1, p2, p3, p4 = parts()
        self.assertTrue(p1.lower().startswith("select") and p3.lower().startswith("select"), "parts 1 and 3 are read-only")
        self.assertEqual(self.d().execute(p1).fetchall(), [(20, 0)], "BEFORE: the built-in 20, no alert mail today")
        self.assertEqual(self.budget(), 20)
        rest = self.others()
        self.d().execute(p2)
        self.assertEqual(self.d().execute(p3).fetchall(), [(60,)], "AFTER shows 60")
        self.assertEqual(self.others(), rest, "part 2 touches nothing else in ops_settings")
        self.assertEqual(self.budget(), 60, "the scheduler's budget follows at once")
        self.d().execute("insert into public.ops_outbox (kind, mode, to_addr, subject, body) values ('alert', 'live', 'ops@x', 's', 'b')")
        self.assertEqual(self.budget(), 59, "an alert already sent today counts")
        self.assertEqual(self.d().execute(p1).fetchall()[0][1], 1, "part 1 counts today's alert mails")
        self.d().execute(p4)
        self.assertEqual(self.d().execute(p3).fetchall(), [(20,)], "the undo puts 20 back")
        self.assertEqual(self.others(), rest, "the undo touches nothing else")
        self.assertEqual(self.budget(), 19)


if __name__ == "__main__":
    unittest.main()
