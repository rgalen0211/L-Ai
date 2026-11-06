"""The SQL tests remove their own throwaway database folder when they finish, however they finish (Q464, Ryan 2026-11-05). CONNECT.

Every SQL test module starts its Postgres through test_2a_core.start_pg, which registers the folder's removal with unittest.addModuleCleanup BEFORE anything can fail. This file proves it the only way that counts: it runs a
tiny test module in a child Python with its own empty temp folder, in three ways (all passed; a test failed; setUpModule itself raised after the server was up), and then looks in that temp folder. Nothing may be left.
    pgvenv/Scripts/python -m unittest supabase/tests/test_pg_cleanup.py -v
Each run starts one real Postgres for about half a minute and removes it again. The helper's own guards (it removes only ryagram-* folders sitting directly in the temp folder, never a link) are tested without a server.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

PROBE = '''
import os, sys, unittest
sys.path.insert(0, {here!r})
import test_2a_core as core

MODE = os.environ["PROBE_MODE"]

def setUpModule():
    core.setUpModule()
    with open(os.environ["PROBE_NOTE"], "w", encoding="utf-8") as f:
        f.write(str(getattr(core._server, "pgdata", "")))
    if MODE == "setup":
        raise RuntimeError("setUpModule fails after the server is up")

class Probe(unittest.TestCase):
    def test_it(self):
        self.assertEqual(MODE != "fail", True, "a test that fails on purpose")
'''


def run_probe(mode):
    work = tempfile.mkdtemp(prefix="probe-work-")
    try:
        tmp = Path(work) / "tmp"
        tmp.mkdir()
        (Path(work) / "probe_mod.py").write_text(PROBE.format(here=str(HERE)), encoding="utf-8")
        env = dict(os.environ, TEMP=str(tmp), TMP=str(tmp), TMPDIR=str(tmp), PROBE_MODE=mode, PROBE_NOTE=str(Path(work) / "note.txt"), PYTHONDONTWRITEBYTECODE="1")
        r = subprocess.run([sys.executable, "-B", "-m", "unittest", "probe_mod"], cwd=work, env=env, capture_output=True, text=True, timeout=600)
        left = sorted(n for n in os.listdir(tmp) if n.startswith("ryagram-"))
        note = (Path(work) / "note.txt")
        return r.returncode, r.stderr, left, note.exists(), sorted(os.listdir(tmp))
    finally:
        shutil.rmtree(work, ignore_errors=True)


class PgCleanup(unittest.TestCase):
    def test_all_passed_leaves_nothing(self):
        code, err, left, ran, _ = run_probe("pass")
        self.assertEqual(code, 0, err[-800:])
        self.assertTrue(ran, "the probe really started a server (setUpModule ran)")
        self.assertEqual(left, [], "a throwaway database folder was left behind")

    def test_a_failed_test_leaves_nothing(self):
        code, err, left, ran, _ = run_probe("fail")
        self.assertNotEqual(code, 0, "the probe's test failed on purpose")
        self.assertTrue(ran)
        self.assertEqual(left, [], "a throwaway database folder was left behind after a failed test")

    def test_a_setup_that_raises_after_the_server_is_up_leaves_nothing(self):
        code, err, left, ran, _ = run_probe("setup")
        self.assertNotEqual(code, 0)
        self.assertTrue(ran, "the server was up when setUpModule raised")
        self.assertEqual(left, [], "a throwaway database folder was left behind after a failed setUpModule")

    def test_the_helper_removes_only_its_own_kind_of_folder(self):
        sys.path.insert(0, str(HERE))
        import test_2a_core as core
        t = Path(tempfile.gettempdir())
        mine = Path(tempfile.mkdtemp(prefix="ryagram-pg-guard-"))
        (mine / "x").write_text("x")
        other = Path(tempfile.mkdtemp(prefix="notmine-guard-"))
        nested_parent = Path(tempfile.mkdtemp(prefix="ryagram-pg-parent-"))
        nested = nested_parent / "ryagram-pg-inner"
        nested.mkdir()
        try:
            self.assertTrue(core.remove_pg_folder(str(mine)))
            self.assertFalse(mine.exists())
            self.assertFalse(core.remove_pg_folder(str(other)), "a folder that is not named ryagram-* is never removed")
            self.assertTrue(other.exists())
            self.assertFalse(core.remove_pg_folder(str(nested)), "a folder that is not directly in the temp folder is never removed")
            self.assertTrue(nested.exists())
            self.assertFalse(core.remove_pg_folder(str(t)), "the temp folder itself is never removed")
            self.assertTrue(t.exists())
        finally:
            for p in (mine, other, nested_parent):
                shutil.rmtree(p, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
