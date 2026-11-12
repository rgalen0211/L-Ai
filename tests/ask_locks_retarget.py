"""Re-aims the body mutants of the three place-question ask functions at the ask-locks migration.

Why: 20261109000300_ask_locks.sql REPLACES connect_geo_ask, connect_geo_ask_shape and connect_forecast_ask (the repository's own text plus one lock line) and, before it does,
compares the live function's md5 with the repository's: a function that has drifted stops the whole file (that is its safety). A mutant that breaks ONE rule inside such a function
in the ORIGINAL migration therefore makes the tests ERROR (the lock migration refuses the drifted function), not FAIL on an assertion, and the runner rightly does not count that as caught.
The final definition of each rule is now the one in the ask-locks migration, so the mutant is made there. Rules that live elsewhere (tables, claim and answer functions, the gate) are not touched.

Use, in a mutant file after W.MUTANTS is set:   retarget(W, "connect_forecast_ask")
Nothing else in the runner changes; every retargeted target must still occur exactly once (W.targets_bad() checks it, --check-targets runs that).
"""
LOCK = "supabase/migrations/20261109000300_ask_locks.sql"
KEEP_OLD_ROWS = "  delete from public.geo_requests where asked_at < now() - interval '7 days';\n"
LOCK_LINE = "  perform pg_advisory_xact_lock(hashtextextended('geo:' || me::text, 0));\n"


def retarget(W, fn):
    text = (W.ROOT / LOCK).read_text(encoding="utf-8").replace("\r\n", "\n")
    start = text.index(f"create or replace function public.{fn}(")
    end = text.index("end $$;", start)
    body = text[start:end]
    done = []
    for m in W.MUTANTS:
        name = m[0]
        edits = W.edits_of(m)
        if len(edits) != 1:
            done.append(m)
            continue
        rel, old, new = edits[0]
        if "grant execute on function" in old and f"public.{fn}(" in old and old.endswith("to connect_runner;"):
            # a grant stays through a replace, so the rule is checked on the final state: add the extra grant at the end of the lock migration
            sig = old[len("grant execute on function "):-len(" to connect_runner;")]
            done.append((name, [(LOCK, "\ncommit;\n", f"\ngrant execute on function {sig} to authenticated;\ncommit;\n")]))
            continue
        if name == "an ask keeps old rows" and f"public.{fn}(" in (W.ROOT / rel).read_text(encoding="utf-8") and old.startswith("begin\n  delete from public.geo_requests where asked_at < now() - interval '7 days';\n"):
            tail = old[len("begin\n" + KEEP_OLD_ROWS):]                      # what follows the delete in the original pattern, e.g. "  if p_series is null"
            pos = body.find(LOCK_LINE + KEEP_OLD_ROWS + tail)
            if pos >= 0 and text.count(LOCK_LINE + KEEP_OLD_ROWS + tail) == 1:
                done.append((name, [(LOCK, LOCK_LINE + KEEP_OLD_ROWS + tail, LOCK_LINE + tail)]))
                continue
        pos = body.find(old) if old else -1
        if pos >= 0 and body.count(old) == 1 and old != new:
            if text.count(old) == 1:
                done.append((name, [(LOCK, old, new)]))
            else:                                                               # the same line is in the other two ask functions: take the text from this function's header to it, which is unique
                long_old = body[:pos + len(old)]
                done.append((name, [(LOCK, long_old, long_old[:len(long_old) - len(old)] + new)]))
            continue
        done.append(m)                                                          # a rule that is not in this function's final text: left where it was
    W.MUTANTS[:] = done
