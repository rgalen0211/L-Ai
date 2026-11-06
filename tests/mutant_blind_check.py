"""Finds the BLIND mutants of the SQL mutant runners (tests/*_sql_mutants.py): a mutant that the runner can never count as caught, however good the tests are.

The class: a later migration rewrites a function by TEXT (plpgsql `replace(def, '<old text>', '<new text>')`, and raises if nothing matched). A mutant that removes that very text from an EARLIER migration makes the later migration refuse to run, so the
test suite ERRORS instead of failing an assertion; the runner (rightly) does not count an error as a catch and reports the mutant as NOT CAUGHT. It looks like a missing test and costs a runner-hour to discover
(the 'worker accounts can be connected' mutant, 11-06). A mutant is fine when its new text still contains the matched line (the later rewrite then still finds it), which is how that one was re-aimed.

blind_hits() is pure (no database, no files): it takes the mutants and the migration texts, so a unit test can plant the fault. runner_mutants() reads a runner's list in a child process (the runners share state when imported together).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

MIN_LINE = 30                 # shorter lines are too common to mean anything
WINDOW = 900                  # how far after `replace(` the matched text may sit (the old text and the new text are arguments of it)

_DUMP = r'''
import importlib, json, sys
from pathlib import Path
root = Path(sys.argv[1]); sys.path.insert(0, str(root / "tests"))
mod = importlib.import_module(sys.argv[2])
if hasattr(mod, "W"):
    mig, muts = mod.W.MIG, mod.W.MUTANTS
else:
    mig, muts = mod.MIG, mod.MUTANTS
out = []
for m in muts:
    if isinstance(m[1], list):
        edits = [[p, o, n] for (p, o, n) in m[1]]
    else:
        edits = [[mig, m[1], m[2]]]
    out.append({"name": m[0], "edits": edits})
print(json.dumps(out))
'''


def runner_names(root):
    return sorted(p.stem for p in (Path(root) / "tests").glob("*_sql_mutants.py"))


def runner_mutants(root, name):
    p = subprocess.run([sys.executable, "-I", "-c", _DUMP, str(root), name], capture_output=True, text=True, cwd=str(root))
    if p.returncode:
        raise RuntimeError(f"could not read the mutant list of {name}: {p.stderr[-400:]}")
    return json.loads(p.stdout)


def migration_texts(root):
    return {m.name: m.read_text(encoding="utf-8").replace("\r\n", "\n") for m in sorted((Path(root) / "supabase" / "migrations").glob("*.sql"))}


def blind_hits(mutants, texts):
    """[(mutant name, line, later migration)] for every target line that a LATER migration finds by `replace(` and that the mutant's own new text no longer contains."""
    hits = []
    for m in mutants:
        for path, old, new in m["edits"]:
            mname = Path(path).name
            later = [n for n in texts if n > mname]
            new_text = new.replace("\r\n", "\n")
            for line in (l.strip() for l in old.replace("\r\n", "\n").split("\n")):
                if len(line) < MIN_LINE or line.startswith("--") or line in new_text:
                    continue
                for n in later:
                    tx = texts[n]
                    if any(line in tx[r.start():r.start() + WINDOW] for r in re.finditer(r"replace\(", tx)):
                        hits.append((m["name"], line, n))
    return hits
