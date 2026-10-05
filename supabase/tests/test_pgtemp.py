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
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import psutil  # noqa: E402
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

    def age(self, path, hours=5):
        """Backdate a folder and EVERYTHING in it (including what a test just added), so only the check under test can keep it."""
        old = time.time() - hours * 3600
        for dp, dns, fns in os.walk(path):
            for n in dns + fns:
                try:
                    os.utime(Path(dp) / n, (old, old))
                except OSError:
                    pass
        os.utime(path, (old, old))

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
        control = self.folder("ryagram-pg-control", 5)                              # nothing wrong with it: it MUST go
        for f in (unreadable_pid, bad_handles, unreadable_handles, control):
            self.age(f)                                                             # backdated AFTER the extras exist: age cannot save them
        self.assertEqual(pgtemp.reap(), [str(control)])
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
        self.age(target)                                                           # the target AND its PG_VERSION are old
        self.assertEqual(pgtemp.reap(), [])
        self.assertEqual((target / "keep.txt").read_text(), "mine")
        self.assertTrue(pgtemp._is_link(link))

    def test_a_link_INSIDE_a_folder_is_removed_as_a_link_and_its_target_survives(self):
        outside = Path(self.base) / "outside-target"
        outside.mkdir()
        (outside / "mine.txt").write_text("mine")
        path = self.folder("ryagram-pgtest-innerlink", 5)
        (path / "sub").mkdir()
        inner = path / "sub" / "pointer"
        top = path / "toplink"
        for link in (inner, top):
            if sys.platform == "win32":
                subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], check=True, capture_output=True)
            else:
                link.symlink_to(outside, target_is_directory=True)
        self.age(path)
        self.assertEqual(pgtemp.reap(), [str(path)])
        self.assertFalse(path.exists())
        self.assertEqual((outside / "mine.txt").read_text(), "mine")                # followed, it would have been deleted

    def test_only_a_lock_that_can_clear_is_retried(self):
        sleeps, real_sleep, real_try = [], pgtemp.time.sleep, pgtemp._try_delete_file
        path = self.folder("ryagram-pgtest-denied", 5)
        err = PermissionError(13, "denied")
        err.winerror = 5                                                           # access denied: not a lock that will clear
        pgtemp.time.sleep = sleeps.append
        pgtemp._try_delete_file = lambda f: err
        try:
            self.assertFalse(pgtemp.remove_dir(path, tries=5))
            self.assertEqual(sleeps, [])                                           # gave up at once
            lock = PermissionError(13, "in use")
            lock.winerror = 32
            pgtemp._try_delete_file = lambda f: lock
            self.assertFalse(pgtemp.remove_dir(path, tries=3))
            self.assertEqual(len(sleeps), 3)                                       # a sharing violation IS retried
        finally:
            pgtemp.time.sleep, pgtemp._try_delete_file = real_sleep, real_try
        self.assertTrue((path / "PG_VERSION").exists())

    @unittest.skipUnless(sys.platform == "win32", "an open file blocks deleting only on Windows")
    def test_a_lock_deep_in_a_subfolder_is_retried_until_it_clears(self):
        path = self.folder("ryagram-pgtest-deep", 5)
        (path / "base" / "1").mkdir(parents=True)
        locked = path / "base" / "1" / "1259"
        locked.write_bytes(b"x")
        fh = open(locked, "rb")
        threading.Timer(1.2, fh.close).start()                                     # the handle closes while remove_dir is retrying
        started = time.time()
        self.assertTrue(pgtemp.remove_dir(path, tries=10))
        self.assertFalse(path.exists())
        self.assertGreater(time.time() - started, 0.8)                             # it waited for the lock instead of giving up

    def test_a_postgres_of_someone_else_that_took_over_our_pid_is_never_stopped(self):
        """The pid in an old postmaster.pid now belongs to ANOTHER live postgres: it must survive and the folder must go."""
        victim_dir = Path(self.base) / "victim"
        victim_dir.mkdir()
        script = textwrap.dedent("""
            import sys, time
            sys.path.insert(0, {here!r})
            import pgserver
            s = pgserver.get_server({victim!r}, cleanup_mode="stop")
            print(s.get_pid(), flush=True)
            time.sleep(120)
        """).format(here=str(HERE), victim=str(victim_dir))
        proc = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, text=True)
        try:
            victim_pid = int(proc.stdout.readline().strip())
            old_dir = self.folder("ryagram-pgtest-reused-pid", 5, pm_pid=victim_pid, handles=[self.DEAD])
            self.age(old_dir)
            self.assertEqual(pgtemp.reap(), [str(old_dir)])                        # stale pid file: the folder goes
            self.assertTrue(pgtemp._postmaster_state(victim_dir, victim_pid) == "ours")
            self.assertTrue(psutil.pid_exists(victim_pid))                         # and the other postgres is untouched
        finally:
            proc.kill()
            try:
                psutil.Process(victim_pid).kill()
            except Exception:
                pass
            time.sleep(1)

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

    def _start_orphan(self, label):
        script = textwrap.dedent("""
            import sys, time
            sys.path.insert(0, {here!r})
            import pgtemp
            server = pgtemp.start({label!r})
            print(server.pgdata, flush=True)
            time.sleep(120)
        """).format(here=str(HERE), label=label)
        env = dict(os.environ, TEMP=self.base, TMP=self.base, TMPDIR=self.base)
        proc = subprocess.Popen([sys.executable, "-c", script], env=env, stdout=subprocess.PIPE, text=True)
        folder = Path(proc.stdout.readline().strip())
        return proc, folder

    def _hard_kill(self, proc, folder):
        """Kill the test process the way a crash would: the launcher AND every python that holds a handle on the folder."""
        holders = pgtemp._handle_pids(folder) or []
        proc.kill()
        for pid in holders:
            try:
                psutil.Process(pid).kill()
            except psutil.NoSuchProcess:
                pass
        gone, alive = psutil.wait_procs([psutil.Process(p) for p in holders if psutil.pid_exists(p)], timeout=30)
        self.assertEqual(alive, [])
        proc.wait(30)

    def _stop_everything(self, folder):
        pm = pgtemp._postmaster_pid(folder)
        if pm and psutil.pid_exists(pm):
            try:
                main = psutil.Process(pm)
                for child in main.children(recursive=True):
                    child.kill()
                main.kill()
                main.wait(5)
            except psutil.NoSuchProcess:
                pass

    def test_after_a_hard_kill_the_orphaned_postgres_is_stopped_then_the_folder_deleted(self):
        proc, folder = self._start_orphan("orphan")
        try:
            self.assertTrue(folder.exists())
            pm = pgtemp._postmaster_pid(folder)
            self.assertEqual(pgtemp._postmaster_state(folder, pm), "ours")
            self._hard_kill(proc, folder)                                          # no cleanup runs
            self.assertTrue(pgtemp._alive_postgres(pm))                            # the postgres outlived it
            self.assertEqual(pgtemp.reap(), [])                                    # too new to touch
            self.age(folder)
            self.assertEqual(pgtemp.reap(), [str(folder)])
            self.assertFalse(pgtemp._alive_postgres(pm))
            self.assertFalse(folder.exists())
        finally:
            proc.kill()
            self._stop_everything(folder)                                          # a failing assertion must not leave a live cluster

    def test_a_live_postgres_with_no_handle_file_is_somebody_elses_and_is_left_alone(self):
        proc, folder = self._start_orphan("nohandle")
        try:
            pm = pgtemp._postmaster_pid(folder)
            self._hard_kill(proc, folder)
            (folder / ".handle_pids.json").unlink()                                # nothing proves pgserver started it
            self.age(folder)
            self.assertEqual(pgtemp.reap(), [])
            self.assertTrue(folder.exists())
            self.assertTrue(pgtemp._alive_postgres(pm))
        finally:
            proc.kill()
            self._stop_everything(folder)


if __name__ == "__main__":
    unittest.main()
