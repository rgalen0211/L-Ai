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

    def test_no_mutant_removes_text_a_later_rewrite_looks_for_by_constant(self):
        # GEO 11-22: film_card 'the refresh request is never reported' errored on train 4 because film_card_failed_age keeps its
        # search text in a declared constant and refuses when it is gone
        texts = b.migration_texts(ROOT)
        hits = []
        for name in b.runner_names(ROOT):
            hits += [(name,) + h for h in b.rewrite_hits(b.runner_mutants(ROOT, name), texts)]
        self.assertEqual(hits, [], "these faults remove text a later migration searches for (a declared constant) before rewriting a live function, so its setup refuses: keep that text in the fault's new text")

    def test_the_rewrite_check_flags_a_searched_constant_the_fault_removes(self):
        later = ("do $do$\ndeclare\n  def text;\n  ref_old constant text := 'jsonb_build_object(''state'', r.state, ''retry'', retry)';\nbegin\n"
                 "  select pg_get_functiondef(f.oid) into def from pg_proc f where f.oid = to_regprocedure('public.f()');  -- the function's text\n"
                 "  execute replace(def, ref_old, 'x');\nend $do$;\n")
        old = "'refresh', case when ok then null else jsonb_build_object('state', r.state, 'retry', retry) end,"
        # MUST-FAIL: the fault drops the searched text -> flagged, naming the later file (the apostrophe in the comment does not confuse it)
        self.assertEqual([h[2] for h in b.rewrite_hits([{"name": "m", "edits": [[EARLY, old, "'refresh', null,"]]}], {EARLY: old, LATE: later})], [LATE])
        # the re-aimed fault keeps it -> not flagged
        kept = "'refresh', case when true then null else jsonb_build_object('state', r.state, 'retry', retry) end,"
        self.assertEqual(b.rewrite_hits([{"name": "m", "edits": [[EARLY, old, kept]]}], {EARLY: old, LATE: later}), [])
        # a later file that does not rewrite live function text is not read
        self.assertEqual(b.rewrite_hits([{"name": "m", "edits": [[EARLY, old, "'refresh', null,"]]}], {EARLY: old, LATE: later.replace("pg_get_functiondef", "now")}), [])

    def test_no_mutant_plants_in_a_function_a_later_migration_defines_again(self):
        # GEO 11-22 (WORKER's and CONNECT's drift): a fault in a function that a later migration redefines never runs
        texts = b.migration_texts(ROOT)
        hits = []
        for name in b.runner_names(ROOT):
            hits += [(name,) + h for h in b.overwritten_hits(b.runner_mutants(ROOT, name), texts)]
        self.assertEqual(hits, [], "these faults plant in a function a later migration defines again, so the planted body never runs: plant each in the LAST file that defines its function")

    def test_the_overwrite_check_flags_only_the_same_function_defined_again(self):
        f1 = "create function public.f(a int) returns int language plpgsql as $$\nbegin\n  if a is null then raise exception 'a must be set'; end if;\n  return a;\nend $$;\n"
        g_copy = "create function public.g(a int) returns int language plpgsql as $$\nbegin\n  if a is null then raise exception 'a must be set'; end if;\n  return a;\nend $$;\n"
        f_again = f1.replace("create function", "create or replace function")
        fault = [{"name": "f takes a null", "edits": [[EARLY, "  if a is null then raise exception 'a must be set'; end if;\n", ""]]}]
        # MUST-FAIL: the same function defined again with the line -> a hit naming it and the later file
        self.assertEqual(b.overwritten_hits(fault, {EARLY: f1, LATE: f_again}), [("f takes a null", "f", LATE)])
        # MUST-FAIL (WORKER 15:01): a later definition that CHANGED the very line (a fix to what the fault breaks) still overwrites it
        f_fixed = f_again.replace("'a must be set'", "'a must be set, and positive'")
        self.assertEqual(b.overwritten_hits(fault, {EARLY: f1, LATE: f_fixed}), [("f takes a null", "f", LATE)])
        # a later COPY of the line in a different function (r9's node_hit copies connect_anon_hit's check) is not a hit
        self.assertEqual(b.overwritten_hits(fault, {EARLY: f1, LATE: g_copy}), [])
        # a top-level statement after a function's closing $$ is in no function (a migration's own gate_apply line)
        gate = "select ryagram_private.gate_apply();                       -- the gate"
        self.assertEqual(b.overwritten_hits([{"name": "no gate", "edits": [[EARLY, gate + "\n", ""]]}], {EARLY: f1 + gate + "\n", LATE: f_again + gate + "\n"}), [])
        # a common line is placed where THIS fault plants it, not at its first occurrence in the file
        f2 = f1.replace("return a;", "return a + 1;")
        two = g_copy + f2
        fault_in_f = [{"name": "f takes a null", "edits": [[EARLY, "  if a is null then raise exception 'a must be set'; end if;\n  return a + 1;\n", "  return a + 1;\n"]]}]
        g_again = g_copy.replace("create function", "create or replace function")
        self.assertEqual(b.overwritten_hits(fault_in_f, {EARLY: two, LATE: g_again}), [])        # g's first copy of the line is not where this fault plants
        self.assertEqual(b.overwritten_hits(fault_in_f, {EARLY: two, LATE: f2.replace("create function", "create or replace function")}),
                         [("f takes a null", "f", LATE)])

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

    def test_the_guard_ignores_a_later_migration_s_own_code_that_merely_sits_near_a_replace(self):
        # GEO 11-22 (CC1 14:16): 20261113000100_film_card_caps.sql ends with its OWN 'select ryagram_private.gate_apply();' four lines
        # after an unrelated replace(def, ...); a mutant that drops an earlier migration's gate line is not blind (on train 4 every such
        # mutant was caught on an assertion). Only text inside a quoted argument is what a replace() looks for.
        gate = "select ryagram_private.gate_apply();                       -- the gate"
        later = ("do $do$ declare def text; neu text; begin\n  neu := replace(def, 'octet_length(p_card::text) > 262144', 'octet_length(p_card::text) > 320000');\n"
                 "  execute neu;\nend $do$;\n\n" + gate + "\n")
        mutants = [{"name": "the gate is not applied after it", "edits": [[EARLY, gate + "\n", ""]]}]
        self.assertEqual(b.blind_hits(mutants, {EARLY: gate + "\n", LATE: later}), [])
        # MUST-FAIL: the same line as a QUOTED argument of that replace is still flagged
        quoted = "do $do$ begin\n  neu := replace(def, '" + gate.replace("'", "''") + "', '');\nend $do$;\n"
        self.assertEqual([h[2] for h in b.blind_hits(mutants, {EARLY: gate + "\n", LATE: quoted})], [LATE])

    def test_the_guard_still_sees_a_searched_text_cut_off_by_the_window_or_dollar_quoted(self):
        # WORKER 14:18 LOW: a searched literal longer than the window, and a $x$...$x$ argument, must still be flagged
        mutants = [{"name": "m", "edits": [[EARLY, CLAUSE + "\n", ""]]}]
        long_lit = "do $$ begin\n  newdef := replace(def, '" + ("x" * (b.WINDOW - 120)) + "\n" + CLAUSE.strip() + " and more text that runs on past the window " * 20 + "', '');\nend $$;\n"
        self.assertEqual([h[2] for h in b.blind_hits(mutants, {EARLY: CLAUSE + "\n", LATE: long_lit})], [LATE])
        dollar = "do $do$ begin\n  newdef := replace(def, $q$" + CLAUSE.strip() + "$q$, $q$x$q$);\nend $do$;\n"
        self.assertEqual([h[2] for h in b.blind_hits(mutants, {EARLY: CLAUSE + "\n", LATE: dollar})], [LATE])
        # and a do-block's own closing $do$ after a replace is not an argument: code after it is still not flagged
        after = "do $do$ begin\n  neu := replace(def, 'a', 'b');\nend $do$;\n" + CLAUSE + "\n"
        self.assertEqual(b.blind_hits(mutants, {EARLY: CLAUSE + "\n", LATE: after}), [])

    def test_the_guard_only_looks_at_later_migrations(self):
        mutants = [{"name": "m", "edits": [[LATE, CLAUSE + "\n", ""]]}]
        self.assertEqual(b.blind_hits(mutants, {EARLY: LATE_TEXT, LATE: CLAUSE + "\n"}), [])


if __name__ == "__main__":
    unittest.main()
