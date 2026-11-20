"""The drift guard in the plan-asks migration and its rollback (CONNECT, 2026-11-20): offline, no database.
Run:  python supabase/tests/test_plan_asks_guard.py
It proves (1) both files carry the guard with the hashes the builder computes from the repository's own text, (2) the guard's order is: skip when absent, nothing to do when already in the wanted state, STOP when the live text
is anything else, only then replace, and (3) MUST-FAIL: a file with a wrong hash, or with the guard stripped, is reported by the builder's --check."""
import os
import shutil
import subprocess
import tempfile
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BUILDER = ROOT / "supabase" / "tests" / "build_plan_asks_guard.py"
MIG = ROOT / "supabase" / "migrations" / "20261120000200_plan_asks_lock_and_host.sql"
RB = ROOT / "supabase" / "rollbacks" / "20261120000200_plan_asks_lock_and_host_rollback.sql"


def check(mig=None, rb=None):
    env = dict(os.environ)
    if mig: env['PLAN_ASKS_MIG'] = str(mig)
    if rb: env['PLAN_ASKS_RB'] = str(rb)
    return subprocess.run([sys.executable, '-B', str(BUILDER), '--check'], capture_output=True, text=True, cwd=str(ROOT), env=env)


class PlanAsksGuard(unittest.TestCase):
    def test_both_files_carry_the_guard_with_the_repositorys_hashes(self):
        r = check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(r.stdout.count("guard present and its hashes match the repository"), 2)

    def test_the_guard_comes_in_the_right_order_in_every_block(self):
        for path in (MIG, RB):
            t = path.read_text(encoding="utf-8").replace("\r\n", "\n")
            self.assertEqual(t.count("declare cur text;"), 2, path.name)
            for blk in t.split("do $do$\n")[1:]:
                order = [blk.index(x) for x in ("select md5(replace(f.prosrc, chr(13), ''))", "if cur is null then raise notice", "if cur = '", "if cur <> '", "raise exception 'The live function", "execute $fn$")]
                self.assertEqual(order, sorted(order), path.name)
            self.assertNotIn("nothing was changed. Send this sentence to CONNECT.'';", t)
            for line in t.split("\n"):
                if line.strip().startswith("raise exception 'The live function"):
                    body = line.split("raise exception '", 1)[1].rsplit("' using", 1)[0] if "' using" in line else line.split("raise exception '", 1)[1].rsplit("';", 1)[0]
                    self.assertEqual(body.replace("''", "").count("'"), 0, "an apostrophe inside the sentence must be doubled: " + line[:120])

    def test_must_fail_a_wrong_hash_or_a_stripped_guard_is_reported(self):
        # the planted faults go into COPIES in a temp folder, never into the real migration (a killed run could otherwise leave its drift guard off)
        with tempfile.TemporaryDirectory() as td:
            m, r = Path(td) / MIG.name, Path(td) / RB.name
            real = (MIG.read_bytes(), RB.read_bytes())
            for kind in ('mig', 'rb'):
                shutil.copyfile(MIG, m); shutil.copyfile(RB, r)
                self.assertEqual(check(m, r).returncode, 0, 'the untouched copies pass')
                target = m if kind == 'mig' else r
                t = target.read_text(encoding='utf-8')
                i = t.index("if cur <> '") + len("if cur <> '")
                target.write_text(t[:i] + ('0' if t[i] != '0' else '1') + t[i + 1:], encoding='utf-8')
                self.assertNotEqual(check(m, r).returncode, 0, 'a wrong hash must be reported: ' + kind)
                target.write_text(t.replace("  if cur <> '", "  if false and cur <> '", 1), encoding='utf-8')
                self.assertNotEqual(check(m, r).returncode, 0, 'a changed guard must be reported: ' + kind)
            self.assertEqual(real, (MIG.read_bytes(), RB.read_bytes()), 'the real files were never touched')


if __name__ == "__main__":
    unittest.main(verbosity=2)
