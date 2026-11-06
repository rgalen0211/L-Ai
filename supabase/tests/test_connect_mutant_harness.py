"""The mutation harness (tests/connect_sql_mutants.py) must itself be trustworthy (CC1 15:19): it must clean up after every mutant, never count an
ERROR as a catch, and stop rather than fill the disk. Fast: no database is started here. `--selftest` of the harness proves the same end to end."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
import connect_sql_mutants as h  # noqa: E402


class FakeProc:
    """Stands in for the unittest child: creates the given number of pgserver folders in its TEMP and answers with canned output.
    Like the real fixture (test_2a_core.start_pg) it appends each folder's path to the marker file named by RYAGRAM_PG_TRACE; the options let a case leave the marker out, point it elsewhere, or remove the folder itself the way the tests now do at the end of the module."""
    def __init__(self, folders, out, code, env, mark=True, marker_dir=None, self_remove=False):
        self.pid, self.returncode, self._out = 1, code, out
        for i in range(folders):
            d = Path(env["TEMP"]) / f"ryagram-pg-fake{i}"
            (d / "pgdata").mkdir(parents=True)
            (d / "pgdata" / "big.dat").write_bytes(b"x" * 1000)
            if mark:
                shown = (Path(marker_dir) / d.name) if marker_dir else d
                with open(env[h.TRACE_ENV], "a", encoding="utf-8") as f:
                    f.write(str(shown) + "\n")
            if self_remove:
                import shutil
                shutil.rmtree(d)

    def communicate(self, timeout=None):
        return self._out, None


class Harness(unittest.TestCase):
    def setUp(self):
        self._saved = (h.RUN_TMP, h.BASE_TEMP, h.free_gb, h.subprocess.Popen, h.SCRATCH)
        self.tmp = Path(tempfile.mkdtemp(prefix="harness-test-"))
        h.RUN_TMP, h.BASE_TEMP, h.SCRATCH = self.tmp / "run", self.tmp, self.tmp / "scratch"
        h.free_gb = lambda p: 500.0
        self.addCleanup(self.restore)

    def restore(self):
        h.RUN_TMP, h.BASE_TEMP, h.free_gb, h.subprocess.Popen, h.SCRATCH = self._saved
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake_popen(self, folders, out, code, **opts):
        h.subprocess.Popen = lambda cmd, **kw: FakeProc(folders, out, code, kw["env"], **opts)

    # ---- only an assertion failure is a catch
    def test_classify_counts_only_assertion_failures_as_caught(self):
        ok = "Ran 58 tests in 70s\n\nOK\n"
        self.assertEqual(h.classify(ok, 0)[0], "survived")
        self.assertEqual(h.classify("Ran 58 tests in 70s\n\nFAILED (failures=2)\n", 1)[0], "caught")
        self.assertEqual(h.classify("Ran 58 tests in 70s\n\nFAILED (failures=1, errors=3)\n", 1)[0], "caught")
        self.assertEqual(h.classify("Ran 58 tests in 70s\n\nFAILED (errors=3)\n", 1), ("errored", 0, 3))      # a broken migration or full disk
        self.assertEqual(h.classify("Ran 1 test in 0.1s\n\nFAILED (errors=1)\n", 1)[0], "errored")           # a setUpClass failure
        self.assertEqual(h.classify("Traceback (most recent call last): disk full", 1)[0], "errored")         # no summary at all
        self.assertEqual(h.classify("", 3221225786)[0], "errored")                                            # killed
        self.assertEqual(h.classify("Ran 58 tests in 70s\n\nOK (skipped=2)\n", 0)[0], "survived")

    def test_a_mutant_whose_tests_error_is_not_counted_as_caught(self):
        self.fake_popen(1, "Ran 58 tests in 5s\n\nFAILED (errors=58)\n", 1)
        verdict, f, e = h.one_run("erroring mutant", None)
        self.assertEqual((verdict, f, e), ("errored", 0, 58))
        self.fake_popen(1, "Ran 58 tests in 5s\n\nFAILED (failures=1)\n", 1)
        self.assertEqual(h.one_run("failing mutant", None)[0], "caught")

    # ---- cleanup
    def test_each_runs_pgserver_folder_is_gone_before_the_next_run(self):
        for i in range(3):
            self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0)
            h.one_run(f"run {i}", None)
            self.assertEqual(h.pg_dirs(h.RUN_TMP / "t"), [], "a pgserver folder was left behind")

    def test_more_than_one_folder_in_one_runs_temp_stops_the_run_and_is_still_cleaned_up(self):
        self.fake_popen(2, "Ran 58 tests in 5s\n\nOK\n", 0)
        with self.assertRaises(h.HarnessError):
            h.one_run("two folders", None)
        self.assertEqual(h.pg_dirs(h.RUN_TMP / "t"), [])

    def test_a_folder_that_cannot_be_removed_stops_the_whole_run(self):
        self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0)
        real_rmtree, real_sleep = h.shutil.rmtree, h.time.sleep
        h.shutil.rmtree = lambda path, **kw: (real_rmtree(path, **kw) if Path(str(path)).name == "scratch" else None)       # the pgserver folder refuses to go
        h.time.sleep = lambda s: None
        try:
            with self.assertRaises(h.HarnessError):
                h.one_run("stuck folder", None)
        finally:
            h.shutil.rmtree, h.time.sleep = real_rmtree, real_sleep

    def test_a_leftover_folder_stops_the_next_run_before_it_starts(self):
        (h.RUN_TMP / "t" / "ryagram-pg-old").mkdir(parents=True)
        self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0)
        with self.assertRaises(h.HarnessError):
            h.one_run("after a leftover", None)

    def test_tests_that_ran_without_a_marker_stop_the_run(self):
        # no marker = the server was not started through the test fixture, so where the tests ran cannot be proved (the folder may be somewhere this harness can neither see nor delete): stop, do not guess
        self.fake_popen(0, "Ran 58 tests in 5s\n\nOK\n", 0, mark=False)
        with self.assertRaises(h.HarnessError):
            h.one_run("tests wrote no marker", None)
        self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0, mark=False)            # a folder is there but the fixture never wrote its marker: still refused
        with self.assertRaises(h.HarnessError):
            h.one_run("folder without a marker", None)
        self.fake_popen(0, "Ran 58 tests in 5s\n\nFAILED (errors=58)\n", 1, mark=False)           # an erroring run that never started a server is just errored
        self.assertEqual(h.one_run("no server started", None)[0], "errored")

    def test_a_marker_that_points_outside_the_controlled_temp_stops_the_run(self):
        elsewhere = self.tmp / "somewhere-else"
        elsewhere.mkdir()
        self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0, marker_dir=elsewhere)
        with self.assertRaises(h.HarnessError):
            h.one_run("tests wrote elsewhere", None)

    def test_a_folder_the_tests_removed_themselves_is_fine_when_the_marker_is_in_the_controlled_temp(self):
        # what the real tests do now (Q464): the folder is gone when the run ends, only the marker remains
        self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0, self_remove=True)
        self.assertEqual(h.one_run("self-removing", None)[0], "survived")
        self.assertEqual(h.pg_dirs(h.RUN_TMP / "t"), [])

    def test_low_disk_space_stops_the_run(self):
        h.free_gb = lambda p: 1.0
        self.fake_popen(1, "Ran 58 tests in 5s\n\nOK\n", 0)
        with self.assertRaises(h.HarnessError):
            h.one_run("low disk", None)

    # ---- the mutant list itself
    def test_every_mutant_target_is_in_the_migration_exactly_once_and_names_are_unique(self):
        self.assertEqual(h.broken_targets(), [])
        self.assertEqual(h.duplicate_names(), [])
        self.assertGreaterEqual(len(h.MUTANTS), 68)


if __name__ == "__main__":
    unittest.main()
