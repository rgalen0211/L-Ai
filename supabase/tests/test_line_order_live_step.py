"""LIVE STEP 79 (supabase/live-steps/79_line_order_check.sql) for migrations/20261125000100_queue_order_joined_line.sql, on a local Postgres. BUILDER 2026-11-27 (Claude's wave 7, BUILDER b).
Same setup as test_queue_order_joined_line.py. Run from the repo root with TEMP/TMP on D::
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_line_order_live_step.py -v

  * after the migration the step says PASS and every row is true; after the rollback (= before the change) it says STOP with rows 2 to 5 false and row 6 true, as its header says
  * a single function left on created_at (each of the five, one at a time) turns its row false and row 1 STOP
  * the file is ONE statement, has no semicolon inside a string and no address
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_queue_order_joined_line as qo  # noqa: E402

STEP = qo.core.ROOT / "live-steps" / "79_line_order_check.sql"
setUpModule = qo.setUpModule

def statements(sql):
    """Statements outside comments and quoted strings (a ; inside quotes or a -- comment is not a statement end)."""
    out, cur, i, q = [], [], 0, False
    while i < len(sql):
        ch = sql[i]
        if not q and sql.startswith("--", i):
            i = sql.find("\n", i)
            i = len(sql) if i < 0 else i
            continue
        if ch == "'":
            q = not q
        if ch == ";" and not q:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    rest = "".join(cur).strip()
    return out + ([rest] if rest else [])


# (function, the joined_line_at piece, its created_at original, the row that must go false)
DRIFTS = [
    ("public.claim_next_job()", "then 0 else 1 end, joined_line_at, id", "then 0 else 1 end, created_at, id", 4),
    ("public.claim_next_job()", "and o.joined_line_at < now() - interval '", "and o.created_at < now() - interval '", 4),
    ("public.node_claim(text)", "order by joined_line_at, id for update skip locked limit 1", "order by created_at, id for update skip locked limit 1", 4),
    ("public.queue_position(uuid)", "(q.joined_line_at, q.id) < (j.joined_line_at, j.id)", "(q.created_at, q.id) < (j.created_at, j.id)", 4),
    ("ryagram_private.expire_stale_queue()", "and j.joined_line_at < now() - make_interval(mins => s.queue_timeout_min)", "and j.created_at < now() - make_interval(mins => s.queue_timeout_min)", 5),
    ("ryagram_private.admin_ops_base()", "min(joined_line_at)) / 60)", "min(created_at)) / 60)", 5),
]


class LineOrderStep(qo.QueueOrder):
    def rows(self):
        return self.db.as_(None).c.execute(STEP.read_text(encoding="utf-8")).fetchall()

    def test_pass_after_the_migration(self):
        rows = self.rows()
        self.assertEqual([r[0] for r in rows], [1, 2, 3, 4, 5, 6])
        self.assertTrue(rows[0][1].startswith("PASS"), rows)
        self.assertTrue(all(r[2] is True for r in rows), rows)

    def test_stop_before_the_change_as_the_header_says(self):
        self.ddl(qo.RB.read_text(encoding="utf-8"))
        rows = self.rows()
        self.assertEqual([r[2] for r in rows], [False, False, False, False, False, True], rows)
        self.assertTrue(rows[0][1].startswith("STOP"))
        self.ddl(qo.MIG.read_text(encoding="utf-8"))
        self.assertTrue(self.rows()[0][1].startswith("PASS"), "and PASS again once it is applied again")

    def test_each_function_left_on_created_at_is_a_stop(self):
        for fn, new, old, row in DRIFTS:
            with self.subTest(fn=fn, piece=new):
                d = self.admin("select replace(pg_get_functiondef(to_regprocedure(%s)), chr(13), '')", fn)
                self.assertEqual(d.count(new), 1, (fn, new))
                self.ddl(d.replace(new, old))
                rows = self.rows()
                self.assertTrue(rows[0][1].startswith("STOP"), (fn, rows))
                self.assertFalse(rows[row - 1][2], (fn, rows))
                self.assertEqual([r[0] for r in rows if r[2] is False], [1, row], (fn, rows))
                self.ddl(d)
                self.assertTrue(self.rows()[0][1].startswith("PASS"), fn)

    def test_a_trigger_on_every_update_is_a_stop(self):
        self.ddl("drop trigger jobs_joined_line on public.jobs")
        self.ddl("create trigger jobs_joined_line before update on public.jobs for each row execute function ryagram_private.jobs_joined_line()")
        rows = self.rows()
        self.assertFalse(rows[2][2], rows)
        self.assertTrue(rows[0][1].startswith("STOP"))

    def test_one_statement_no_semicolon_in_a_string_no_address(self):
        t = STEP.read_text(encoding="utf-8")
        self.assertEqual(len(statements(t)), 1)
        self.assertNotIn("@", t)
        self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("--"))))


# the parent class's own tests must not run twice from this file
for _name in [n for n in dir(qo.QueueOrder) if n.startswith("test_")]:
    setattr(LineOrderStep, _name, None)

if __name__ == "__main__":
    unittest.main()
