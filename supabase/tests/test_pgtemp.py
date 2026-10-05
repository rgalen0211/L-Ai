"""The test Postgres cleans up after itself: pass, fail, a crash in setUpModule, old leftovers, a hard kill.

Each case runs a tiny test module in a subprocess with its own TEMP folder, then checks what is left there.
Run from the repo root:  pgvenv/Scripts/python -m unittest supabase/tests/test_pgtemp.py -v
"""
import json
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
    with tempfile.TemporaryDirectory(prefix="ryagram-pgtemp-selftest-") as base:
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
    DEAD = 2 ** 22 + 12345                         # a pid no process has

    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="ryagram-pgtemp-reap-")
        self.was = tempfile.tempdir
        tempfile.tempdir = self.base

    def tearDown(self):
        tempfile.tempdir = self.was
        for entry in Path(self.base).iterdir():
            if pgtemp._is_link(entry):
                pgtemp._unlink_link(entry)
        pgtemp.remove_dir(self.base)

    def folder(self, name, age_hours, pg=True, pm_pid=None, handles=None):
        path = Path(self.base) / name
        path.mkdir()
        (path / "data.bin").write_bytes(b"x" * 1000)
        if pg:
            (path / "PG_VERSION").write_text("16\n")
        if pm_pid is not None:
            (path / "postmaster.pid").write_text(f"{pm_pid}\n")
        if handles is not None:
            (path / ".handle_pids.json").write_text(json.dumps(handles))
        old = time.time() - age_hours * 3600
        for f in path.iterdir():
            os.utime(f, (old, old))
        os.utime(path, (old, old))
        return path

    def test_only_our_old_unused_postgres_folders_go(self):
        gone = [self.folder("ryagram-pg-abc", 5), self.folder("ryagram-2b-abc", 5), self.folder("ryagram-stripe-abc", 5),
                self.folder("ryagram-pgtest-pg-abc", 5),
                self.folder("ryagram-pgtest-pg-dead", 5, pm_pid=self.DEAD, handles=[self.DEAD]),
                self.folder("ryagram-pgtest-pg-reused", 5, pm_pid=os.getpid(), handles=[])]       # a live pid that is not a postgres
        kept = [self.folder("ryagram-pg-young", 0.1),                           # too new: may be a run in progress
                self.folder("ryagram-pg-held", 5, handles=[os.getpid()]),        # a live python still holds it
                self.folder("ryagram-pgtest-notpg", 5, pg=False),                # not a postgres data folder
                self.folder("ryagram-preflight-abc", 5), self.folder("other-pg-abc", 5)]
        removed = pgtemp.reap()
        self.assertEqual(sorted(removed), sorted(str(p) for p in gone))
        self.assertTrue(all(not p.exists() for p in gone))
        self.assertTrue(all(p.exists() for p in kept))

    def test_reap_fails_closed_when_it_cannot_tell(self):
        unreadable_pid = self.folder("ryagram-pg-unreadable-pid", 5)
        (unreadable_pid / "postmaster.pid").mkdir()                                # reading it raises; it does not say "no pid"
        bad_handles = self.folder("ryagram-pg-bad-handles", 5)
        (bad_handles / ".handle_pids.json").write_text("{not json")
        unreadable_handles = self.folder("ryagram-pg-unreadable-handles", 5)
        (unreadable_handles / ".handle_pids.json").mkdir()
        self.assertEqual(pgtemp.reap(), [])
        self.assertTrue(all(p.exists() for p in (unreadable_pid, bad_handles, unreadable_handles)))

    def test_a_top_level_link_is_skipped_and_its_target_never_touched(self):
        target = Path(self.base) / "precious"
        target.mkdir()
        (target / "PG_VERSION").write_text("16\n")
        (target / "keep.txt").write_text("mine")
        link = Path(self.base) / "ryagram-pg-link"
        if sys.platform == "win32":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
        else:
            link.symlink_to(target, target_is_directory=True)
        old = time.time() - 5 * 3600
        os.utime(target, (old, old))
        self.assertEqual(pgtemp.reap(), [])
        self.assertEqual((target / "keep.txt").read_text(), "mine")
        self.assertTrue(pgtemp._is_link(link))

    @unittest.skipUnless(sys.platform == "win32", "an open file blocks deleting only on Windows")
    def test_a_locked_file_keeps_the_marker_so_the_next_start_retries(self):
        path = self.folder("ryagram-pgtest-locked", 5)
        (path / "sub").mkdir()
        locked = path / "sub" / "open.bin"
        locked.write_bytes(b"x")
        old = time.time() - 5 * 3600
        os.utime(path, (old, old))
        with open(locked, "rb"):                                                   # an open handle blocks deleting it
            self.assertFalse(pgtemp.remove_dir(path, tries=2))
            self.assertTrue((path / "PG_VERSION").exists())                        # the marker is deleted LAST
            self.assertFalse((path / "data.bin").exists())                         # everything else already went
            self.assertEqual(pgtemp.reap(), [])                                    # still locked: kept, not forgotten
        self.assertEqual(pgtemp.reap(), [str(path)])                               # the handle closed: now it goes
        self.assertFalse(path.exists())
        self.assertIn("COULD NOT DELETE", (Path(self.base) / pgtemp.FAILURE_LOG).read_text())   # and the failure was recorded

    def test_after_a_hard_kill_the_orphaned_postgres_is_stopped_then_the_folder_deleted(self):
        script = textwrap.dedent("""
            import sys, time
            sys.path.insert(0, {here!r})
            import pgtemp
            server = pgtemp.start("orphan")
            print(server.pgdata, flush=True)
            time.sleep(120)
        """).format(here=str(HERE))
        env = dict(os.environ, TEMP=self.base, TMP=self.base, TMPDIR=self.base)
        proc = subprocess.Popen([sys.executable, "-c", script], env=env, stdout=subprocess.PIPE, text=True)
        try:
            folder = Path(proc.stdout.readline().strip())
            self.assertTrue(folder.exists())
            pm = pgtemp._postmaster_pid(folder)
            self.assertTrue(pgtemp._alive_postgres(pm))
            proc.kill()                                                            # a HARD kill: no cleanup runs
            proc.wait(30)
            self.assertTrue(pgtemp._alive_postgres(pm))                            # the postgres outlived it
            self.assertEqual(pgtemp.reap(), [])                                    # too new to touch
            old = time.time() - 5 * 3600
            for f in (folder, folder / "PG_VERSION", folder / "postmaster.pid", folder / ".handle_pids.json"):
                os.utime(f, (old, old))
            self.assertEqual(pgtemp.reap(), [str(folder)])
            self.assertFalse(pgtemp._alive_postgres(pm))
            self.assertFalse(folder.exists())
        finally:
            proc.kill()


if __name__ == "__main__":
    unittest.main()
