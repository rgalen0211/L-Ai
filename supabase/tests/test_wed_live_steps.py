"""The Wednesday live step GEO owns (LAUNCH-LIVE-STEPS section 00, step 3a), on a local Postgres with every migration. GEO 2026-11-23.

  * live-steps/52_join_daily_max_set.sql, run part by part as Ryan will: part 1 shows 200 and the flag; part 2 with Ryan's number
    sets it and join_reserve then answers 'full' past that number (and not before; a repeat of the same address takes no second place); part 3 shows the number; part 2 unchanged
    (the undo) puts 200 back and the next stranger is let in again. The file's part 2 as shipped changes nothing.
Run from the repo root:
    pgvenv/Scripts/python -m unittest supabase/tests/test_wed_live_steps.py -v
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
STEP52 = core.ROOT / "live-steps" / "52_join_daily_max_set.sql"


def parts():
    """the three statements, split on the file's own '-- PART n' headers, exactly as Ryan pastes them"""
    text = STEP52.read_text(encoding="utf-8")
    chunks = re.split(r"^-- PART \d.*$", text, flags=re.M)[1:]
    assert len(chunks) == 3, len(chunks)
    return [c.strip() for c in chunks]


class WedLiveSteps(core.Base):
    def d(self):
        return self.db.as_(None).c

    def join(self, mail, ip):
        return self.db.as_("service").one("select public.join_reserve(%s, %s)", mail, ip)

    def test_GEO_52_sets_the_size_and_the_undo_puts_200_back(self):
        p1, p2, p3 = parts()
        self.assertIn("= 200;", p2, "the shipped part 2 is the undo: it sets the default")
        self.assertTrue(p1.lstrip().lower().startswith("select") and p3.lstrip().lower().startswith("select"), "parts 1 and 3 are read-only")
        self.assertEqual(self.d().execute(p1).fetchall(), [(200, False)], "BEFORE: the default, sign-up still closed")
        self.d().execute(p2)                                                     # unchanged = no change
        self.assertEqual(self.d().execute(p3).fetchall(), [(200,)])
        self.assertEqual(self.d().execute("select join_open, waiting_accounts from public.ops_settings").fetchall(), [(False, False)], "part 2 touches nothing but the size: it never opens sign-up or moves the waiting switch")
        self.d().execute("update public.ops_settings set join_open = true")     # live step 47
        self.d().execute(p2.replace("= 200;", "= 2;"))                          # Ryan types his number
        self.assertEqual(self.d().execute(p3).fetchall(), [(2,)], "AFTER shows his number")
        self.assertEqual(self.join("a@example.com", "ipA"), {"ok": True})
        self.assertEqual(self.join("a@example.com", "ipA2"), {"ok": True}, "the same person pressing Send again takes no second place (people, not tries)")
        self.assertEqual(self.join("b@example.com", "ipB"), {"ok": True})
        self.assertEqual(self.join("c@example.com", "ipC"), {"ok": False, "reason": "full"}, "the 3rd try with a size of 2")
        self.d().execute(p2)                                                     # the undo
        self.assertEqual(self.d().execute(p3).fetchall(), [(200,)])
        self.assertEqual(self.join("c@example.com", "ipC"), {"ok": True}, "after the undo the next stranger is let in")


if __name__ == "__main__":
    unittest.main()
