"""Adds the DRIFT GUARD to the plan-asks migration and its rollback (CONNECT, 2026-11-20; RENDERER's deep review of the audit merge, MEDIUM: the two migrations replaced LIVE functions with hand-copied bodies and no check
that the live function still matched the old text, unlike supabase/migrations/20261109000300_ask_locks.sql, which compares md5 first).

THE GUARD (the same convention as 20261109000300, see supabase/tests/build_ask_locks_migration.py): before it replaces a live function it compares md5(replace(prosrc, chr(13), '')) of the live body with the md5 of the repository's
ORIGINAL body (taken from the migration that created it). Equal: replace it. Already the new text: leave it alone (safe to run twice). Anything else (a function someone changed on the live database): stop with a plain sentence and
change nothing (the file is one transaction). A function that is not on this database is skipped, as before. The rollback is the mirror: live must be the NEW text (or already the original).

Run:  python supabase/tests/build_plan_asks_guard.py            (rewrites both files; idempotent: a file that already has the guard is left alone)
      python supabase/tests/build_plan_asks_guard.py --check    (exit 1 if either file lacks the guard or the hashes in it are not the ones computed from the repository)
UNRUN against a database: the hashes are computed from the repository's own text exactly as the sibling does; a live function that differs for ANY reason makes the file stop, never silently replace.
"""
import hashlib
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
# the two files to read or rewrite; the tests point these at COPIES in a temp folder (PLAN_ASKS_MIG, PLAN_ASKS_RB), so a planted fault or a killed run can never touch the real migration
MIG = Path(os.environ.get("PLAN_ASKS_MIG") or ROOT / "supabase" / "migrations" / "20261120000200_plan_asks_lock_and_host.sql")
RB = Path(os.environ.get("PLAN_ASKS_RB") or ROOT / "supabase" / "rollbacks" / "20261120000200_plan_asks_lock_and_host_rollback.sql")
FUNCS = [
    ("connect_request_download", "20261027000500_download_plans.sql", "text, text, text, text"),
    ("connect_request_footage", "20261030000200_footage_plans.sql", "text, text, text, text"),
]
START = "do $do$\nbegin\n  if to_regprocedure('public."
GUARDED = "declare cur text;"


def md5(body):
    return hashlib.md5(body.replace("\r", "").encode("utf-8")).hexdigest()


def body(stmt):
    return stmt[stmt.index("$$") + 2: stmt.rindex("$$")]


def original(name, src):
    t = (ROOT / "supabase" / "migrations" / src).read_text(encoding="utf-8").replace("\r\n", "\n")
    i = t.index(f"create function public.{name}(")
    j = t.index("\nend $$;", i) + len("\nend $$;")
    return t[i:j]


def blocks(text):
    """Yield (start, end, name, args, statement) for each unguarded or guarded DO block that executes one function."""
    pos = 0
    while True:
        i = text.find("do $do$\n", pos)
        if i < 0:
            return
        j = text.index("end $do$;\n", i) + len("end $do$;\n")
        chunk = text[i:j]
        k = chunk.index("execute $fn$\n") + len("execute $fn$\n")
        stmt = chunk[k: chunk.rindex("\n$fn$;")]
        name = stmt[stmt.index("function public.") + len("function public."): stmt.index("(", stmt.index("function public."))]
        yield i, j, name, stmt
        pos = j


def guarded(name, args, stmt, expect, already, expect_words, label):
    sig = f"public.{name}({args})"
    return ("-- " + name + ": " + label + "\n"
            "do $do$\n"
            "declare cur text;\n"
            "begin\n"
            f"  select md5(replace(f.prosrc, chr(13), '')) into cur from pg_proc f where f.oid = to_regprocedure('{sig}');\n"
            f"  if cur is null then raise notice '{name} is not on this database: skipped.'; return; end if;\n"
            f"  if cur = '{already}' then raise notice '{name}: nothing to do (already in the wanted state).'; return; end if;\n"
            f"  if cur <> '{expect}' then\n"
            f"    raise exception 'The live function {name} is not the one this change expects ({expect_words.replace(chr(39), chr(39) * 2)}); nothing was changed. Send this sentence to CONNECT.';\n"
            "  end if;\n"
            "  execute $fn$\n"
            f"{stmt}\n"
            "$fn$;\n"
            "end $do$;\n")


def rewrite(path, direction):
    nl_crlf = "\r\n" in path.read_text(encoding="utf-8")
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    out, last, problems = [], 0, []
    infos = {n: (s, a) for n, s, a in FUNCS}
    for i, j, name, stmt in blocks(text):
        if name not in infos:
            continue
        src, args = infos[name]
        old = original(name, src)
        old_md5 = md5(body(old))
        if direction == "up":
            new_stmt, new_md5 = stmt, md5(body(stmt))
            blk = guarded(name, args, stmt, old_md5, new_md5, f"its text differs from the repository's {src}", "the per-person lock and the host rule")
        else:
            blk_stmt = stmt
            if md5(body(stmt)) != old_md5:
                problems.append(f"{name}: the rollback's body is not byte for byte the original of {src} (md5 differs)")
            # the rollback restores the ORIGINAL text: live must be the new (locked) text, or already the original
            new_md5 = None
            mig = MIG.read_text(encoding="utf-8").replace("\r\n", "\n")
            for _i, _j, n2, s2 in blocks(mig):
                if n2 == name:
                    new_md5 = md5(body(s2))
            if new_md5 is None:
                problems.append(f"{name}: not found in the migration")
                continue
            blk = guarded(name, args, blk_stmt, new_md5, old_md5, "its text is neither the locked text nor the original of the repository", "puts the original back")
        out.append(text[last:i])
        out.append(blk)
        last = j
    out.append(text[last:])
    return "".join(out).replace("\n", "\r\n") if nl_crlf else "".join(out), problems


def main():
    check = "--check" in sys.argv
    bad = 0
    for path, direction in ((MIG, "up"), (RB, "down")):
        cur = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if GUARDED in cur and cur.count(GUARDED) == 2 and not check:
            print(path.name, ": already guarded, left alone")
            continue
        if GUARDED in cur:
            # guarded already: unwrap to the bare statements first so --check can recompute the hashes from scratch
            unguarded = cur
            for i, j, name, stmt in reversed(list(blocks(cur))):
                if name in dict((n, 1) for n, _s, _a in FUNCS):
                    bare = ("do $do$\nbegin\n  if to_regprocedure('public." + name + "(text, text, text, text)') is null then\n    raise notice '" + name + " is not on this database: skipped.';\n    return;\n  end if;\n"
                            "  execute $fn$\n" + stmt + "\n$fn$;\nend $do$;\n")
                    unguarded = unguarded[:i] + bare + unguarded[j:]
            # drop the one-line label comments the guard adds
            lines = [l for l in unguarded.split("\n") if not (l.startswith("-- connect_request_") and ": the per-person lock" in l) and not (l.startswith("-- connect_request_") and ": puts the original back" in l)]
            unguarded = "\n".join(lines)
            with tempfile.TemporaryDirectory() as td:                      # never write next to the real file
                tmp = Path(td) / path.name
                tmp.write_text(unguarded, encoding="utf-8")
                new, problems = rewrite(tmp, direction)
        else:
            new, problems = rewrite(path, direction)
        for p in problems:
            print("PROBLEM:", p)
            bad += 1
        if check:
            if new.replace("\r\n", "\n") != cur:
                print(path.name, ": the guard is missing or its hashes are not the ones computed from the repository")
                bad += 1
            else:
                print(path.name, ": guard present and its hashes match the repository")
        else:
            path.write_text(new, encoding="utf-8", newline="")
            print(path.name, ": guard written")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
