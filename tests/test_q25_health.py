"""tools/q25_health.py: the refusals happen before the Supabase command line is ever started; the SQL it sends is the two health files unchanged, inside
`begin read only;`; rows are shown worst first; the exit code says whether anything needs doing. A stand-in command line records what it was asked.
Run: py tests/test_q25_health.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "q25_health.py"
SQLDIR = ROOT / "supabase" / "connect-live"
LIVE, PROOF = "jxtkfishqfxuptwjzczz", "awjbjersplaqhxhuvozi"

FAKE = r'''
import json, os, sys
log = os.environ["FAKE_LOG"]
a = sys.argv[1:]
open(log, "a", encoding="utf-8").write(json.dumps(a) + "\n")
if a[:1] == ["--version"]:
    print("2.0-fake"); sys.exit(0)
if a[:2] == ["db", "query"]:
    f = a[a.index("-f") + 1]
    open(log + ".sql", "a", encoding="utf-8").write(open(f, encoding="utf-8").read() + "\n=====\n")
    mode = os.environ.get("FAKE_MODE", "ok")
    if mode == "error":
        print(json.dumps({"_tag": "Error", "error": {"code": "X", "message": "unexpected status 400: Failed to run sql query: ERROR: 25006: cannot execute UPDATE in a read-only transaction"}})); sys.exit(1)
    if "cron.job" in open(f, encoding="utf-8").read():
        print("Initialising login role...")
        print(json.dumps({"rows": [{"job_id": 1, "schedule": "17 7 * * *", "last_success_at": "x", "last_run_status": "succeeded", "last_run_at": "x", "status": "ok", "what_to_do": "Nothing to do."}]})); sys.exit(0)
    rows = [{"check_name": "master switch (connect_flags.connections_enabled)", "value": "ON", "status": "ok", "what_to_do": "Nothing to do."},
            {"check_name": "refusals in 24 hours", "value": "38", "status": "look", "what_to_do": "Read it, no rush."}]
    if mode == "act":
        rows.insert(0, {"check_name": "full renders from a connection (must stay off)", "value": "ON", "status": "act", "what_to_do": "Run 90_switch_off.sql now."})
    rows = rows[::-1] if mode == "act" else rows                      # deliberately not sorted: the script sorts
    print("Initialising login role...")
    print(json.dumps({"boundary": "b", "rows": rows}))
    sys.exit(0)
sys.exit(3)
'''


class Q25(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="q25test_"))
        (self.d / "fake.py").write_text(FAKE, encoding="utf-8")
        self.log = self.d / "log.txt"

    def tearDown(self):
        for f in self.d.iterdir():
            f.unlink()
        self.d.rmdir()

    def run_cmd(self, *args, mode="ok", cli=True):
        env = dict(os.environ, FAKE_LOG=str(self.log), FAKE_MODE=mode, PYTHONUTF8="1")
        cmd = [sys.executable, str(SCRIPT), *args]
        if cli:
            cmd += ["--cli", f"{sys.executable} {self.d / 'fake.py'}"]
        p = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
        return p.returncode, p.stdout + p.stderr

    def calls(self):
        return self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []

    def test_live_without_the_flag_is_refused_and_the_command_line_is_never_started(self):
        code, out = self.run_cmd("--project", "live")
        self.assertEqual(code, 2); self.assertIn("--live", out); self.assertEqual(self.calls(), [])

    def test_the_flag_is_refused_for_proof(self):
        code, out = self.run_cmd("--project", "proof", "--live")
        self.assertEqual(code, 2); self.assertIn("only for --project live", out); self.assertEqual(self.calls(), [])

    def test_a_missing_command_line_is_a_plain_refusal(self):
        env = dict(os.environ, PYTHONUTF8="1")
        p = subprocess.run([sys.executable, str(SCRIPT), "--project", "proof", "--cli", "no-such-program-xyz"], capture_output=True, text=True, env=env, timeout=120)
        self.assertEqual(p.returncode, 2); self.assertIn("not found", p.stdout)

    def test_all_good_exits_0_and_names_the_project(self):
        code, out = self.run_cmd("--project", "proof")
        self.assertEqual(code, 0, out)
        self.assertIn("DAILY HEALTH", out); self.assertIn("(proof)", out); self.assertIn("0 act", out)
        self.assertTrue(any(f'"{PROOF}"' in c for c in self.calls()), "it targeted the proof project, by its ref")
        self.assertFalse(any(LIVE in c for c in self.calls()))

    def test_live_with_both_words_targets_the_live_ref_only(self):
        code, out = self.run_cmd("--project", "live", "--live")
        self.assertEqual(code, 0, out)
        self.assertTrue(any(f'"{LIVE}"' in c for c in self.calls())); self.assertFalse(any(PROOF in c for c in self.calls()))
        self.assertIn("LIVE", out)

    def test_the_sql_sent_is_the_two_files_unchanged_inside_a_read_only_transaction(self):
        self.run_cmd("--project", "proof")
        sent = (Path(str(self.log) + ".sql")).read_text(encoding="utf-8").split("=====\n")
        files = [(SQLDIR / "05_daily_health.sql").read_text(encoding="utf-8").rstrip().rstrip(";"), (SQLDIR / "05b_purge_last_run.sql").read_text(encoding="utf-8").rstrip().rstrip(";")]
        self.assertEqual(len([s for s in sent if s.strip()]), 2)
        for s, body in zip(sent, files):
            self.assertTrue(s.startswith("begin read only;\n"), "the database itself refuses any write")
            self.assertIn(body, s)                                         # the file text, nothing added or removed

    def test_an_act_row_exits_1_and_is_printed_first_with_what_to_do(self):
        code, out = self.run_cmd("--project", "proof", mode="act")
        self.assertEqual(code, 1)
        lines = [ln for ln in out.splitlines() if ln.strip()]
        self.assertTrue(lines[1].startswith("ACT"), lines[1])
        self.assertIn("Run 90_switch_off.sql now.", out)
        self.assertIn("1 act", out)

    def test_a_command_line_error_is_reported_and_exits_2(self):
        code, out = self.run_cmd("--project", "proof", mode="error")
        self.assertEqual(code, 2); self.assertIn("COULD NOT RUN", out); self.assertIn("read-only transaction", out)

    def test_the_source_runs_only_the_two_health_files(self):
        src = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(sorted(set(__import__("re").findall(r'"(\d\d[a-z_]*\.sql)"', src))), ["05_daily_health.sql", "05b_purge_last_run.sql"])
        self.assertIn('"begin read only;\\n"', src)


if __name__ == "__main__":
    unittest.main()
