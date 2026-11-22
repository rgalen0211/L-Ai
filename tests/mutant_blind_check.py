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
                    if any(line in lit for r in re.finditer(r"replace\(", tx) for lit in _literals(tx[r.start():r.start() + WINDOW])):
                        hits.append((m["name"], line, n))
    return hits


_LITERAL = re.compile(r"[Ee]?'((?:[^']|'')*)'")


def _literals(window):
    """The quoted SQL string literals in a window that starts at `replace(` (doubled quotes unescaped). Only text INSIDE a literal is what
    a later replace() looks for; the later migration's own code near a replace() (its gate_apply line, another function's header) is not
    (GEO 11-22: those were 30 false hits on train 4, and every one of the flagged mutants that ran was caught on an assertion)."""
    out, end = [], 0
    for m in _LITERAL.finditer(window):
        out.append(m.group(1).replace("''", "'"))
        end = m.end()
    tail = window[end:]
    if "'" in tail:                                   # a literal the window cuts off: its visible part still counts (WORKER 14:18 LOW)
        out.append(tail[tail.index("'") + 1:].replace("''", "'"))
    d = _DOLLAR_ARG.match(window)                     # a dollar-quoted searched argument, replace(def, $x$...$x$, ...): its body counts
    if d:
        close = window.find("$" + d.group(1) + "$", d.end())
        out.append(window[d.end():close if close >= 0 else len(window)])
    return out


_DOLLAR_ARG = re.compile(r"replace\([^,']*,\s*\$(\w*)\$")    # only an ARGUMENT that opens with $tag$, never the do-block's own closing $do$


# -- the second dead-fault class (WORKER and CONNECT 11-22): a fault planted in a function that a LATER migration defines AGAIN
# (create or replace) is overwritten before the tests run, so the planted body never runs and the fault reads MISSED (or a later
# fix reads as proven when it is not). Plant it in the LAST file that defines the function.
_FN = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+([\w.\"]+)\s*\(", re.I)


_DOLLAR = re.compile(r"\$(\w*)\$")


def _function_at(text, pos):
    """The name (schema dropped) of the function whose definition holds position pos (from its header to its closing $tag$), or None
    (a top-level statement after a function, such as a migration's own gate_apply line, is in no function)."""
    last = None
    for m in _FN.finditer(text, 0, pos):
        last = m
    if last is None:
        return None
    opener = _DOLLAR.search(text, last.end())
    if opener and opener.start() < pos:
        close = text.find(opener.group(0), opener.end())
        if 0 <= close < pos:
            return None
    return last.group(1).replace('"', "").split(".")[-1].lower()


def overwritten_hits(mutants, texts):
    """[(mutant name, function, later migration)] for every edited line that sits in a function a LATER migration defines again
    (same function name), whatever its lines: the later body overwrites the planted one, even when it changed the very line the
    fault breaks (WORKER 15:01). A line copied into a DIFFERENT function (r9's node_hit copies connect_anon_hit's caller check) is not
    a hit: the name must match. Known limits (CONNECT 14:59, none on train 4 today): the match is by NAME, not signature, so a later
    OVERLOAD is also flagged (an over-flag to look at, never a hidden miss); a function whose body is single-quoted instead of
    $tag$-quoted has no closing tag here, so its lines may be read as a later one's; and only supabase/migrations is read (no
    phase-2b file redefines a migration's function today; if one ever does, it must join the texts)."""
    hits = []
    for m in mutants:
        for path, old, new in m["edits"]:
            mname = Path(path).name
            if mname not in texts:
                continue
            own = texts[mname]
            old_n = old.replace("\r\n", "\n")
            at_old = own.find(old_n)                  # where THIS fault plants (a common line, e.g. a security definer header, occurs many times)
            if at_old < 0:
                continue
            new_lines = {l.strip() for l in new.replace("\r\n", "\n").split("\n")}
            for line in (l.strip() for l in old_n.split("\n")):
                if len(line) < MIN_LINE or line.startswith("--") or line in new_lines:
                    continue
                fn = _function_at(own, at_old + old_n.find(line))
                if fn is None:
                    continue
                for n in (x for x in texts if x > mname):
                    # ANY later definition of the same function overwrites the planted body, even one that CHANGED this very
                    # line (a later fix to exactly what the fault breaks): match the header by name, not the line (WORKER 15:01)
                    if any(f.group(1).replace('"', "").split(".")[-1].lower() == fn for f in _FN.finditer(texts[n])):
                        hits.append((m["name"], fn, n))
    return sorted(set(hits))


def _value_literals(text):
    """Quoted strings of MIN_LINE+ characters that stand as VALUES (right after ':=', '(' or ','): what a rewrite searches for.
    A pair of quotes that only LOOKS like a string (the closing quote of one literal and the opening quote of the next, with code
    between) starts after a letter or a quote, so it is left out (film_bundles.sql gave ' in def) > 0 then raise notice ')."""
    out = []
    for m in _LITERAL.finditer(text):
        before = text[:m.start()].rstrip()[-2:]
        if (before.endswith(":=") or before.endswith("(") or before.endswith(",")) and len(m.group(1)) >= MIN_LINE:
            out.append(m.group(1).replace("''", "'"))
    return out


# -- the third dead-fault class (GEO 11-22, film_card 'the refresh request is never reported'): a later migration that REWRITES
# live function text (pg_get_functiondef + replace) often keeps its search text in a constant (declare x constant text := '...')
# and refuses to run unless it finds it; blind_hits only reads literals inside the replace() call and asks the opposite question
# (is the removed line inside a literal). Here the searched literal is INSIDE the removed text.
def rewrite_hits(mutants, texts):
    """[(mutant name, searched text, later migration)] for every fault that, PLANTED in its own migration, leaves FEWER copies of
    a quoted string of MIN_LINE+ characters from a LATER migration that rewrites live function text (pg_get_functiondef or
    prosrc): that later migration cannot find its text and refuses, so the fault errors and never counts. Simulated, so every
    shape counts: the fault removes the searched text, sits inside it, or cuts across its end (film_card's 'a failed refresh's
    read', 11-22)."""
    # comments stripped first: an apostrophe in a comment ("the function's") would pair the wrong quotes
    # a rewriter reads live function text through pg_get_functiondef or pg_proc.prosrc (WORKER 18:37 LOW)
    rewriters = {n: _value_literals(re.sub(r"--[^\n]*", "", tx)) for n, tx in texts.items() if "pg_get_functiondef" in tx or "prosrc" in tx}
    hits = []
    for m in mutants:
        for path, old, new in m["edits"]:
            mname = Path(path).name
            old_n, new_n = old.replace("\r\n", "\n"), new.replace("\r\n", "\n")
            own = texts.get(mname, "")
            if old_n not in own:
                continue
            planted = own.replace(old_n, new_n, 1)
            for n, lits in rewriters.items():
                if n <= mname:
                    continue
                for lit in lits:
                    if planted.count(lit) < own.count(lit):
                        hits.append((m["name"], lit[:80], n))
    return sorted(set(hits))
