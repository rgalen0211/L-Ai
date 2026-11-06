"""No SQL mutant may be BLIND: removing text from a migration that a later migration finds by `replace(` makes the setup refuse to run, so the suite errors and the runner can never count the mutant as caught
(see tests/mutant_blind_check.py). Fast: no database. The first test reads every tests/*_sql_mutants.py (new runners are picked up by the glob); the others plant the fault so the guard itself must fail."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
import mutant_blind_check as b  # noqa: E402

CLAUSE = "     and not exists (select 1 from public.workers w where w.user_id = p_owner)"
EARLY = "20261018000100_connect_ai.sql"
LATE = "20261104000100_waiting_accounts.sql"
LATE_TEXT = ("do $$ begin\n  newdef := replace(def, 'and not exists (select 1 from public.workers w where w.user_id = p_owner)', E'and not exists (select 1 from public.workers w where w.user_id = p_owner)\n"
             "     and ryagram_private.account_active(p_owner)');\nend $$;\n")


class BlindGuard(unittest.TestCase):
    def test_no_mutant_of_any_runner_is_blind(self):
        texts = b.migration_texts(ROOT)
        names = b.runner_names(ROOT)
        self.assertGreaterEqual(len(names), 6, names)
        hits = []
        total = 0
        for name in names:
            muts = b.runner_mutants(ROOT, name)
            total += len(muts)
            hits += [(name,) + h for h in b.blind_hits(muts, texts)]
        self.assertGreater(total, 150)
        self.assertEqual(hits, [], "these mutants remove text a later migration looks for with replace(), so their setup would refuse to run (an error, never a catch): comment the text out instead of deleting it, or keep it in the new text")

    def test_the_guard_flags_a_mutant_that_deletes_the_text_a_later_migration_rewrites(self):
        # the real 'worker accounts can be connected' mutant before its re-aim
        blind = [{"name": "worker accounts can be connected", "edits": [[EARLY, CLAUSE + "\n", ""]]}]
        hits = b.blind_hits(blind, {EARLY: CLAUSE + "\n", LATE: LATE_TEXT})
        self.assertEqual([(h[0], h[2]) for h in hits], [("worker accounts can be connected", LATE)])

    def test_the_guard_accepts_the_same_mutant_when_its_new_text_keeps_the_line(self):
        # the re-aimed form: the clause is commented out, its text stays for the later migration to find
        fixed = [{"name": "worker accounts can be connected", "edits": [[EARLY, CLAUSE + "\n", "     -- " + CLAUSE.strip() + "\n"]]}]
        self.assertEqual(b.blind_hits(fixed, {EARLY: CLAUSE + "\n", LATE: LATE_TEXT}), [])

    def test_the_guard_ignores_text_that_only_appears_in_a_later_migration_outside_replace(self):
        # a later migration that redefines the whole function (no replace call) is not this class
        mutants = [{"name": "m", "edits": [[EARLY, CLAUSE + "\n", ""]]}]
        self.assertEqual(b.blind_hits(mutants, {EARLY: CLAUSE + "\n", LATE: "create or replace function f() as $$\n" + CLAUSE + "\n$$;\n"}), [])

    def test_the_guard_only_looks_at_later_migrations(self):
        mutants = [{"name": "m", "edits": [[LATE, CLAUSE + "\n", ""]]}]
        self.assertEqual(b.blind_hits(mutants, {EARLY: LATE_TEXT, LATE: CLAUSE + "\n"}), [])


if __name__ == "__main__":
    unittest.main()
