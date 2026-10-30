"""More lead-in on the first video clip (migrations/20261030000200_live_editor_leadin.sql, NOT APPLIED) on a local Postgres. NEXT-WEB 180.

Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_live_editor_leadin.py -v

Rules proved (each with a control and a fault)
  * the shared cases (tests/edit-op-cases.json, which the page, TypeScript and the computer's twin also run) agree with the SQL, including the new start-trim cases
  * a start trim may be negative down to -3600 seconds; below that, and a negative END trim, are refused in words that name the range
  * the after-check for Ryan is all true; it goes false when the old function is put back (the rollback), and true again when the migration is applied again
  * the function kept its owner: nobody but the editor functions runs it
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
from test_connect import setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

CASES = json.loads((Path(__file__).resolve().parents[2] / "tests" / "edit-op-cases.json").read_text(encoding="utf-8"))
MIG = core.ROOT / "migrations" / "20261030000200_live_editor_leadin.sql"
RB = core.ROOT / "rollbacks" / "20261030000200_live_editor_leadin_rollback.sql"
CHK = core.ROOT / "live-steps" / "15_live_editor_leadin_after_check.sql"


class Leadin(core.Base):
    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def problem(self, mode, op):
        return self.admin("select ryagram_private.edit_op_problem(%s, %s::jsonb)", mode, json.dumps(op))

    def test_the_new_shared_cases_agree_with_the_sql(self):
        found = []

        def walk(x):
            if isinstance(x, dict):
                op = x.get("op")
                if isinstance(op, dict) and op.get("op") == "trim_clip" and op.get("edge") == "start" and isinstance(op.get("to"), (int, float)) and op["to"] < 0 and "mode" in x:
                    found.append(x)
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(CASES)
        self.assertGreaterEqual(len(found), 3)
        for c in found:
            got = self.problem(c["mode"], c["op"])
            if c["ok"]:
                self.assertIsNone(got, c["op"])
            else:
                self.assertIn(c["word"], got or "", c["op"])

    def test_the_range_has_a_floor_for_a_start_trim_and_none_for_an_end_trim(self):
        t = lambda edge, to: {"op": "trim_clip", "id": "v1", "edge": edge, "to": to}  # noqa: E731
        self.assertIsNone(self.problem("compilation", t("start", -1)))
        self.assertIsNone(self.problem("compilation", t("start", -3600)))
        self.assertIn("between -3600 and 86400", self.problem("compilation", t("start", -3601)))
        self.assertIn("between 0 and 86400", self.problem("compilation", t("end", -2)))
        self.assertIsNotNone(self.problem("compilation", t("start", 86401)))

    def test_the_after_check_is_all_true_goes_false_on_the_old_function_and_true_again(self):
        sql = CHK.read_text(encoding="utf-8")
        self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [])
        self.db.as_(None).c.execute(RB.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len([r for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]]), 1, "the old function must fail the check")
        self.db.as_(None).c.execute(MIG.read_text(encoding="utf-8"))
        self.assertEqual([r[0] for r in self.db.as_(None).c.execute(sql).fetchall() if not r[1]], [])

    def test_the_function_kept_its_owner(self):
        for role in ("authenticated", "anon", "connect_runner"):
            self.assertFalse(self.admin("select has_function_privilege(%s, 'ryagram_private.edit_op_problem(text,jsonb)', 'execute')", role), role)


if __name__ == "__main__":
    unittest.main()
