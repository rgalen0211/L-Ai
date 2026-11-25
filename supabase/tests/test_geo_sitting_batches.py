"""Ryan's short server sitting (GEO, Wed 11-25, Claude 08:03 item 3): the three SQL Editor pastes made by live-steps/sitting_build.py.

On a throwaway Postgres built like live is before the sitting (the stub, every migration EXCEPT A1-A19, then phase-2b/credits_ledger.sql,
which Q673 row 5 found live), each paste is sent WHOLE as one query, the way the SQL Editor sends it:
  * paste 1 (every BEFORE check) says PASS on the live-before state, and STOP once the migrations are in (it catches a second sitting);
  * paste 2 (A1-A19 byte for byte) ends in 'PASS: A1 to A19 applied';
  * paste 3 (every AFTER check) then says PASS, with every row of every check;
  * MUST-FAIL 1: A9 left out, paste 3 says STOP and names 'A9 after' first;
  * MUST-FAIL 2: an error planted in A7 inside paste 2: the paste raises, A1-A6 stay applied, nothing after A7 runs, and paste 3 says
    STOP naming 'A7 after' first (the instruction 'on an error STOP and send paste 3' is what Ryan does);
  * the three files are exactly what sitting_build.py writes (no hand edit).
Run from the repo root with TEMP/TMP on D: (the storage rule):
    <pgvenv>/Scripts/python -m unittest supabase/tests/test_geo_sitting_batches.py -v
"""
import subprocess
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

LIVE = core.ROOT / "live-steps"
sys.path.insert(0, str(LIVE))
import sitting_build as sb  # noqa: E402

A_FILES = {name for _, name in sb.APPLY}
LEDGER = core.ROOT / "phase-2b" / "credits_ledger.sql"
_server = None
_n = 0


def setUpModule():
    global _server
    _server = core.start_pg("ryagram-pg-geo-sitting-")
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute("create database before_tmpl")
    with psycopg.connect(_server.get_uri(database="before_tmpl"), autocommit=True) as c:
        c.execute((core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8"))
        for path in core.MIGRATIONS:
            if path.name not in A_FILES:
                c.execute(path.read_text(encoding="utf-8"))
        c.execute(LEDGER.read_text(encoding="utf-8"))


def fresh():
    global _n
    _n += 1
    name = f"s{_n}"
    with psycopg.connect(_server.get_uri(), autocommit=True) as c:
        c.execute(f"create database {name} template before_tmpl")
    return psycopg.connect(_server.get_uri(database=name), autocommit=True)


def paste(c, name, text=None):
    """The whole file as ONE query (the SQL Editor's way); returns the rows of the LAST statement."""
    cur = c.execute(text if text is not None else (LIVE / name).read_text(encoding="utf-8"))
    rows = cur.fetchall()
    while cur.nextset():
        rows = cur.fetchall() if cur.description else rows
    return rows


class Sitting(unittest.TestCase):
    def verdict(self, rows):
        return rows[0][0]

    def test_GEO_0_files_are_what_the_builder_writes(self):
        r = subprocess.run([sys.executable, "-I", "-B", str(LIVE / "sitting_build.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_GEO_1_before_passes_on_the_live_before_state(self):
        with fresh() as c:
            rows = paste(c, "sitting_1_before.sql")
            self.assertTrue(self.verdict(rows).startswith("PASS"), "\n".join(map(str, rows)))
            print("\n  paste 1:", self.verdict(rows))

    def test_GEO_2_apply_then_after_passes_and_before_now_stops(self):
        with fresh() as c:
            rows = paste(c, "sitting_2_apply.sql")
            self.assertEqual(rows[-1][0], "PASS: A1 to A19 applied; now paste 3")
            after = paste(c, "sitting_3_after.sql")
            self.assertTrue(self.verdict(after).startswith("PASS"), "\n".join(map(str, after)))
            self.assertEqual(len(after), 1, "a PASS shows only its one line")
            print("\n  paste 3:", self.verdict(after))
            again = paste(c, "sitting_1_before.sql")
            self.assertTrue(self.verdict(again).startswith("STOP"), "paste 1 must stop once the migrations are in")

    def test_GEO_2b_the_two_halves_do_the_same(self):
        with fresh() as c:
            self.assertEqual(paste(c, "sitting_2a_apply_half.sql")[-1][0], "PASS: A1 to A10 applied; now paste 2b")
            self.assertEqual(paste(c, "sitting_2b_apply_half.sql")[-1][0], "PASS: A11 to A19 applied; now paste 3")
            after = paste(c, "sitting_3_after.sql")
            self.assertTrue(self.verdict(after).startswith("PASS"), "\n".join(map(str, after)))

    def test_GEO_3_mustfail_a_migration_left_out(self):
        with fresh() as c:
            for step, name in sb.APPLY:
                if step != "A9":
                    c.execute((core.ROOT / "migrations" / name).read_text(encoding="utf-8"))
            after = paste(c, "sitting_3_after.sql")
            self.assertTrue(self.verdict(after).startswith("STOP"), after[0])
            self.assertIn("the first is A9 after", self.verdict(after))
            print("\n  must-fail 1:", self.verdict(after))

    def test_GEO_4_mustfail_an_error_in_the_middle_of_paste_2(self):
        text = (LIVE / "sitting_2_apply.sql").read_text(encoding="utf-8")
        marker = "-- ===== A7: migrations/"
        self.assertEqual(text.count(marker), 1)
        broken = text.replace(marker, "select 1 / 0;\n" + marker)
        with fresh() as c:
            with self.assertRaises(psycopg.Error):
                paste(c, None, broken)
            after = paste(c, "sitting_3_after.sql")
            self.assertTrue(self.verdict(after).startswith("STOP"), after[0])
            self.assertIn("the first is A7 after", self.verdict(after))
            steps = {r[1] for r in after[1:]}
            for s in ("A1 after", "A2 after", "A3 after", "A4 after", "A5 after", "A6 after"):
                self.assertFalse(any(x and x.startswith(s + " ") for x in steps), f"{s} must be applied (before the error)")
            self.assertTrue(any(x and x.startswith("A19 after") for x in steps), "nothing after the error may run")
            print("\n  must-fail 2:", self.verdict(after))


if __name__ == "__main__":
    unittest.main()
