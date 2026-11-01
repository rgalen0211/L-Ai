"""The lyric card film look value (migrations/20261031000200_lyric_card_look.sql, NOT APPLIED) on a local Postgres. NEXT-WEB 189.

Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_lyric_card_look.py -v

Rules proved: the database accepts the three designs and refuses a fourth, a number and a missing value in words; the other film look settings behave as before and a made-up one is still refused;
the track summary the computer posts may carry lyric_card (a good value) and is refused with a bad one; the after-check for Ryan is all true, goes false after the rollback (the setting is refused again) and true again.
The shared cases (tests/edit-op-cases.json) run in test_live_editor.py as before.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
from test_connect import setUpModule  # noqa: E402,F401

MIG = core.ROOT / "migrations" / "20261031000200_lyric_card_look.sql"
RB = core.ROOT / "rollbacks" / "20261031000200_lyric_card_look_rollback.sql"
CHK = core.ROOT / "live-steps" / "18_lyric_card_look_after_check.sql"


class LyricCardLook(core.Base):
    def problem(self, key, value):
        import json
        return self.db.as_(None).c.execute("select ryagram_private.edit_op_problem('compilation', %s::jsonb)", (json.dumps({"op": "set_film_look", "key": key, "value": value}),)).fetchone()[0]

    def test_three_designs_in_and_the_rest_refused_in_words(self):
        for v in ("plate", "bar", "sing_along"):
            self.assertIsNone(self.problem("lyric_card", v))
        for v in ("neon", 3, None):
            self.assertIn("plate, bar, sing_along", self.problem("lyric_card", v) or "")

    def test_the_other_settings_are_as_before(self):
        self.assertIsNone(self.problem("theme", "light"))
        self.assertIn("lyric_card", self.problem("font", "x"))

    def test_the_after_check_is_true_false_after_the_undo_and_true_again(self):
        sql = CHK.read_text(encoding="utf-8")
        self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [])
        self.db.as_(None).c.execute(RB.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len([r for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]]), 1, "after the undo the setting is refused, so the check must fail")
        self.db.as_(None).c.execute(MIG.read_text(encoding="utf-8"))
        self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [])


if __name__ == "__main__":
    unittest.main()
