"""The test Postgres cleans up after itself: pass, fail, a crash in setUpModule, and old leftovers.

Each case runs a tiny test module in a subprocess with its own TEMP folder, then checks what is left there.
Run from the repo root:  pgvenv/Scripts/python -m unittest supabase/tests/test_pgtemp.py -v
"""
import os
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pgtemp  # noqa: E402

MODULE = textwrap.dedent('''
    import sys, unittest
    sys.path.insert(0, {here!r})
    import pgtemp
    import psycopg

    _server = None

    def setUpModule():
        global _server
        _server = pgtemp.start("selftest")
        with psycopg.connect(_server.get_uri(), autocommit=True) as c:
            c.execute("create database scratch")
        {boom}

    class T(unittest.TestCase):
        def setUp(self):
            with psycopg.connect(_server.get_uri(), autocommit=True) as c:
                c.execute("create database t1 template scratch")
            self.c = psycopg.connect(_server.get_uri(database="t1"), autocommit=True)
        def tearDown(self):
            self.c.close()
            pgtemp.drop_database(_server, "t1")
        def test_it(self):
            self.assertEqual(self.c.execute("select 1").fetchone()[0], {expected})
''')


def run_module(boom="pass", expected=1):
    """Run the module in a subprocess whose TEMP is a fresh folder; return (returncode, leftovers in that TEMP)."""
    with tempfile.TemporaryDirectory(prefix="pgtemp-selftest-") as base:
        mod = Path(base) / "case_test.py"
        mod.write_text(MODULE.format(here=str(HERE), boom=boom, expected=expected), encoding="utf-8")
        env = dict(os.environ, TEMP=base, TMP=base, TMPDIR=base)
        run = subprocess.run([sys.executable, "-m", "unittest", str(mod)], cwd=base, env=env, capture_output=True, text=True, timeout=600)
        left = sorted(p.name for p in Path(base).glob("ryagram-*"))
        return run.returncode, left, run.stderr[-600:]


class SelfCleaning(unittest.TestCase):
    def test_a_passing_run_leaves_nothing(self):
        code, left, err = run_module()
        self.assertEqual((code, left), (0, []), err)

    def test_a_failing_test_still_leaves_nothing(self):
        code, left, err = run_module(expected=2)
        self.assertNotEqual(code, 0)
        self.assertEqual(left, [], err)

    def test_a_crash_in_setup_after_the_server_started_still_leaves_nothing(self):
        code, left, err = run_module(boom='raise RuntimeError("boom")')
        self.assertNotEqual(code, 0)
        self.assertEqual(left, [], err)


class Reap(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="pgtemp-reap-")
        self.was = tempfile.tempdir
        tempfile.tempdir = self.base

    def tearDown(self):
        tempfile.tempdir = self.was
        pgtemp.remove_dir(self.base)

    def folder(self, name, age_hours, pg=True, pid=None):
        path = Path(self.base) / name
        path.mkdir()
        (path / "data.bin").write_bytes(b"x" * 1000)
        if pg:
            (path / "PG_VERSION").write_text("16\n")
        if pid is not None:
            (path / "postmaster.pid").write_text(f"{pid}\n")
        old = time.time() - age_hours * 3600
        os.utime(path, (old, old))
        return path

    def test_only_our_old_unused_postgres_folders_go(self):
        gone = [self.folder("ryagram-pg-abc", 5), self.folder("ryagram-2b-abc", 5), self.folder("ryagram-stripe-abc", 5),
                self.folder("ryagram-pgtest-pg-abc", 5), self.folder("ryagram-pgtest-pg-dead", 5, pid=2 ** 22 + 12345)]
        kept = [self.folder("ryagram-pg-young", 0.1),                        # too new: may be a run in progress
                self.folder("ryagram-pg-live", 5, pid=os.getpid()),         # a running postgres owns it
                self.folder("ryagram-pgtest-notpg", 5, pg=False),           # not a postgres data folder
                self.folder("ryagram-preflight-abc", 5), self.folder("other-pg-abc", 5)]
        removed = pgtemp.reap()
        self.assertEqual(sorted(removed), sorted(str(p) for p in gone))
        self.assertTrue(all(not p.exists() for p in gone))
        self.assertTrue(all(p.exists() for p in kept))


if __name__ == "__main__":
    unittest.main()
