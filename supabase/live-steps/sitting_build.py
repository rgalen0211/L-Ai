"""Builds Ryan's SHORT server sitting (GEO, Wed 11-25, Claude 08:03 item 3): the Tuesday steps A1-A19 and their checks folded into
three SQL Editor pastes, each ending in ONE pass line. It only REARRANGES files that are already reviewed; it writes no new SQL logic
beyond the wrappers that fold each check's rows into one verdict.

    sitting_1_before.sql  every BEFORE check the paper names (Q634 before-check, live steps 41 42 43 44 35 46 51 61 63), run once at
                          the start, before any migration. First row: 'PASS: ...' or 'STOP: ...' with the first row that differs.
    sitting_2_apply.sql   A1 to A19, the migration files byte for byte, in the paper's order. Each keeps its own begin ... commit, so
                          on an error the files BEFORE it stay applied and nothing after it runs. Last row: 'PASS: A1 to A19 applied'.
    sitting_3_after.sql   every AFTER check (live steps 30 31 34 38 41 39 40 42 43 44 45 35 46 51 60 59 61 63), with the row count
                          each must have. First row: 'PASS: ...' or 'STOP: ...' with the first false row.

Run:  py -I -B supabase/live-steps/sitting_build.py            (writes the three files)
      py -I -B supabase/live-steps/sitting_build.py --check    (exit 1 if any written file differs from what it would write)
The Q634 before-check is CONNECT's file in Ryagram-logs/proposals (not in this repo); its text is copied in, and its sha256 is pinned
below, so a changed source is refused instead of silently copied."""
import hashlib
import sys
from pathlib import Path

CRLF, LF = bytes([13, 10]), bytes([10])
HERE = Path(__file__).resolve().parent
SUPA = HERE.parent
Q634_SRC = Path(r"C:\Users\Ryan\Ryagram-logs\proposals\CONNECT-Q634-BEFORE-CHECK-1120.sql")
Q634_COPY = HERE / "sitting_q634_before_check_copy.sql"          # the copy kept in the repo, so the build needs no outside file
Q634_SHA = "38f8a116008ae56e85eb74625de8a710eef66776f6ca793cc29b50447914526d"

# (step, migration file) in the paper's order (LAUNCH-LIVE-STEPS-1121.md section 2, Phase A)
APPLY = [
    ("A1", "20261120000100_connect_purge_edit.sql"),
    ("A2", "20261120000200_plan_asks_lock_and_host.sql"),
    ("A3", "20261120000500_prepared_data.sql"),
    ("A4", "20261120000600_prepared_purge_daily.sql"),
    ("A5", "20261121000100_account_delete_paid.sql"),
    ("A6", "20261121000200_expired_films_really_gone.sql"),
    ("A7", "20261121000300_upload_films_gone.sql"),
    ("A8", "20261121000400_retention_outbox_support.sql"),
    ("A9", "20261121000500_unfinished_uploads_purged.sql"),
    ("A10", "20261121000550_delete_revokes_ai.sql"),
    ("A11", "20261121000600_prepared_tombstone.sql"),
    ("A12", "20261121000700_connect_ai_open_to_all.sql"),
    ("A13", "20261121000800_join_open.sql"),
    ("A14", "20261123000100_free_preview_machine_faults.sql"),
    ("A15", "20261123000200_queue_cap_per_owner.sql"),
    ("A16", "20261123000300_blocked_story_views.sql"),
    ("A17", "20261123000400_retention_join_attempts.sql"),
    ("A18", "20261123000500_connect_whoami_desktop_app.sql"),
    ("A19", "20261123000600_welcome_credits.sql"),
]

T, F = True, False
# BEFORE: (label, check file, expected ok per row), each vector as the paper states it (section 2 row and section 00 step 1)
BEFORE = [
    ("A0 Q634 before-check", Q634_COPY.name, [T] * 14 + [F, F]),
    ("A5 before (step 41)", "41_account_delete_paid_after_check.sql", [F, F, F, F]),
    ("A8 before (step 42)", "42_retention_outbox_support_after_check.sql", None),        # rows 1, 3 AND 4 false at the very start: row 4 tests account_redact_contact, which A5 makes (the paper's vector was for right before A8)
    ("A9 before (step 43)", "43_unfinished_uploads_purged_after_check.sql", None),       # row 1 false; the rest true
    ("A10 before (step 44)", "44_delete_revokes_ai_after_check.sql", None),              # row 1 false; the rest true
    ("A12 before (step 35)", "35_connect_open_check.sql", None),                         # every row false
    ("A13 before (step 46)", "46_join_open_check.sql", [F, F, F, F, F, T, F, T]),   # the paper's seven rows + row 5 join_daily_max; row 3 now also looks for join_daily_max in join_reserve, which only A13 adds, so it is FALSE at the start (the paper said true)
    ("A14 before (step 51)", "51_free_preview_machine_faults_check.sql", [T, F, F, T, F, T]),   # the file's own header: rows 2, 3 and 5 false (a row was added since the paper)
    ("A18 before (step 61)", "61_connect_whoami_desktop_app_check.sql", [F, T]),
    ("A19 before (step 63)", "63_welcome_credits_check.sql", [T, F, F, F, F, F, T, T]),
]
FALSE_ROWS = {"A8 before (step 42)": {1, 3, 4}, "A9 before (step 43)": {1}, "A10 before (step 44)": {1}}

# AFTER: (label, check file); every row must be true; the row count is pinned in AFTER_ROWS (from the files, checked by the test)
AFTER = [
    ("A1 after (step 30)", "30_connect_purge_edit_after_check.sql"),
    ("A2 after (step 31)", "31_plan_asks_lock_and_host_after_check.sql"),
    ("A3 after (step 34)", "34_prepared_data_after_check.sql"),
    ("A4 after (step 38)", "38_prepared_purge_after_check.sql"),
    ("A5 after (step 41)", "41_account_delete_paid_after_check.sql"),
    ("A6 after (step 39)", "39_expired_films_gone_after_check.sql"),
    ("A7 after (step 40)", "40_upload_films_gone_after_check.sql"),
    ("A8 after (step 42)", "42_retention_outbox_support_after_check.sql"),
    ("A9 after (step 43)", "43_unfinished_uploads_purged_after_check.sql"),
    ("A10 after (step 44)", "44_delete_revokes_ai_after_check.sql"),
    ("A11 after (step 45)", "45_prepared_tombstone_after_check.sql"),
    ("A12 after (step 35)", "35_connect_open_check.sql"),
    ("A13 after (step 46)", "46_join_open_check.sql"),
    ("A14 after (step 51)", "51_free_preview_machine_faults_check.sql"),
    ("A15+A16 after (step 60)", "60_queue_cap_blocked_views_after_check.sql"),
    ("A17 after (step 59)", "59_retention_join_attempts_after_check.sql"),
    ("A18 after (step 61)", "61_connect_whoami_desktop_app_check.sql"),
    ("A19 after (step 63)", "63_welcome_credits_check.sql"),
]


def body(name):
    """One check file as a subquery: its text with the final semicolon removed (each is ONE select; any other ';' is inside a string)."""
    text = (HERE / name).read_text(encoding="utf-8").replace("\r\n", "\n").rstrip()
    if not text.endswith(";"):
        raise SystemExit(f"{name}: does not end with ';'")
    # Each row gets its number as a LITERAL (geo_n), so the pinned vectors never rest on UNION ALL's order (BUILDER 08:39 LOW 2).
    # Every check file starts its first row with a line 'select ' and each later row with a line 'union all select ' (GAMES 08:15, checked).
    lines, k, first = text[:-1].split("\n"), 1, True
    for i, line in enumerate(lines):
        if first and line.startswith("select "):
            lines[i] = "select 1 as geo_n, " + line[len("select "):]
            first = False
        elif line.startswith("union all select "):
            k += 1
            lines[i] = f"union all select {k}, " + line[len("union all select "):]
    if first or text.lower().count("union all") != k - 1:
        raise SystemExit(f"{name}: not one 'select' line followed by one 'union all select' line per row")
    return "\n".join(lines)


def row_counts():
    """Rows per check file = 1 + the number of 'union all select' lines (every check file is written that way; the test proves it on Postgres)."""
    out = {}
    for name in {n for _, n, _ in BEFORE} | {n for _, n in AFTER}:
        text = (HERE / name).read_text(encoding="utf-8").lower()
        out[name] = 1 + text.count("union all select")
    return out


def folded(rows, header, verdict_ok, verdict_name):
    """rows: list of (label, file, expected vector). One SELECT: line 0 is the verdict, then only the rows not as expected."""
    parts = []
    for i, (label, name, exp) in enumerate(rows):
        parts.append(f"  select {i} as k, '{label}'::text as step, t.geo_n::bigint as n, t.check_name::text as check_name, t.ok as ok\n"
                     f"  from (\n{body(name)}\n  ) t")
    vals = []
    for i, (label, name, exp) in enumerate(rows):
        for n, e in enumerate(exp, start=1):
            vals.append(f"({i}, {n}, {'true' if e else 'false'})")
    counts = ",\n".join(f"({i}, {len(exp)})" for i, (_, _, exp) in enumerate(rows))
    return (header +
            "with got as (\n" + "\n  union all\n".join(parts) + "\n),\n"
            "want(k, n, ok) as (values " + ", ".join(vals) + "),\n"
            "want_rows(k, rows_wanted) as (values\n" + counts + "),\n"
            "labels(k, step) as (select distinct k, step from got),\n"
            "bad as (\n"
            "  select g.k, g.step, g.n, g.check_name, g.ok, w.ok as wanted from got g left join want w on w.k = g.k and w.n = g.n\n"
            "  where w.ok is null or g.ok is distinct from w.ok\n"
            "  union all\n"
            "  select r.k, coalesce(l.step, 'check ' || r.k), null::bigint, 'this check gave ' || coalesce(c.got, 0) || ' rows, ' || r.rows_wanted || ' wanted', null::boolean, null::boolean\n"
            "  from want_rows r left join labels l on l.k = r.k left join (select k, count(*)::int as got from got group by k) c on c.k = r.k\n"
            "  where coalesce(c.got, 0) <> r.rows_wanted\n"
            ")\n"
            "select result, step, row_no, check_name, ok, wanted from (\n"
            "  select 0 as o, 0 as k, 0 as n,\n"
            f"         case when (select count(*) from bad) = 0 then 'PASS: {verdict_ok} (' || (select count(*) from got) || ' rows)'\n"
            f"              else 'STOP: ' || (select count(*) from bad) || ' row(s) not as expected; the first is ' || (select step || coalesce(' row ' || n, '') from bad order by k, n nulls first limit 1) || '. {verdict_name}' end as result,\n"
            "         null::text as step, null::bigint as row_no, null::text as check_name, null::boolean as ok, null::boolean as wanted\n"
            "  union all\n"
            "  select 1, k, coalesce(n, 0), 'not as expected', step, n, check_name, ok, wanted from bad\n"
            ") v order by o, k, n;\n")


def before_rows(counts):
    rows = []
    for label, name, exp in BEFORE:
        if exp is None:
            n = counts[name]
            exp = [False] * n if label.startswith("A12") else [i not in FALSE_ROWS[label] for i in range(1, n + 1)]
        if len(exp) != counts[name]:
            raise SystemExit(f"{label}: the paper's vector has {len(exp)} rows, {name} has {counts[name]}")
        rows.append((label, name, exp))
    return rows


def build():
    src = Q634_SRC.read_bytes() if Q634_SRC.exists() else Q634_COPY.read_bytes()
    src = src.replace(CRLF, LF)                                   # git may check files out with CRLF: compare and hash as LF
    if hashlib.sha256(src).hexdigest() != Q634_SHA:
        raise SystemExit(f"the Q634 before-check changed (sha256 {hashlib.sha256(src).hexdigest()}); re-read it before pinning")
    out = {Q634_COPY.name: src}
    counts = row_counts()
    head = ("-- {title} (GEO sitting_build.py, Wed 11-25; generated: edit sitting_build.py, never this file). Read-only: one SELECT, changes nothing.\n"
            "-- Copy ALL of this file into the Supabase SQL Editor and Run. Read ONLY the first row: PASS or STOP. On STOP, send GEO the rows below it.\n")
    out["sitting_1_before.sql"] = folded(before_rows(counts), head.format(title="SITTING PASTE 1 of 3: every BEFORE check, before any migration"),
                                         "every BEFORE check is as expected; go on to paste 2",
                                         "Do NOT run paste 2; send GEO this grid.").encode()
    out["sitting_3_after.sql"] = folded([(label, name, [True] * counts[name]) for label, name in AFTER],
                                        head.format(title="SITTING PASTE 3 of 3: every AFTER check of A1 to A19"),
                                        "A1 to A19 are all applied and every AFTER row is true",
                                        "Send GEO this grid; do not undo anything yourself.").encode()
    apply = ["-- SITTING PASTE 2 of 3: migrations A1 to A19, byte for byte, in the paper's order (GEO sitting_build.py, Wed 11-25; generated).\n"
             "-- THIS CHANGES THE LIVE DATABASE. Run it ONCE, only after paste 1 said PASS. Copy ALL, paste into the SQL Editor, Run.\n"
             "-- The Editor may warn about a destructive operation: that is expected, click 'Run this query'.\n"
             "-- PASS = the last result reads 'PASS: A1 to A19 applied'. ANY error: STOP, do NOT run this again; run paste 3 and send GEO both.\n"
             "-- Each migration keeps its own begin ... commit: on an error, the ones before it stay applied and nothing after it runs.\n"]
    for step, name in APPLY:
        text = (SUPA / "migrations" / name).read_text(encoding="utf-8").replace("\r\n", "\n").rstrip() + "\n"
        apply.append(f"\n-- ===== {step}: migrations/{name} =====\n{text}")
    apply.append("\nselect 'PASS: A1 to A19 applied; now paste 3' as result;\n")
    out["sitting_2_apply.sql"] = "".join(apply).encode()
    # FALLBACK only if the SQL Editor refuses paste 2 as too long: the same files in two halves (2a = A1-A10, then 2b = A11-A19)
    for part, (lo, hi), nxt in (("2a", (0, 10), "now paste 2b"), ("2b", (10, 19), "now paste 3")):
        steps = APPLY[lo:hi]
        txt = [f"-- SITTING PASTE {part} (FALLBACK, only if paste 2 was refused as too long, BEFORE it ran): {steps[0][0]} to {steps[-1][0]}, byte for byte (GEO sitting_build.py; generated).\n"
               "-- THIS CHANGES THE LIVE DATABASE. Run it ONCE. ANY error: STOP, do NOT run it again; run paste 3 and send GEO both.\n"]
        for step, name in steps:
            text = (SUPA / "migrations" / name).read_text(encoding="utf-8").replace("\r\n", "\n").rstrip() + "\n"
            txt.append(f"\n-- ===== {step}: migrations/{name} =====\n{text}")
        txt.append(f"\nselect 'PASS: {steps[0][0]} to {steps[-1][0]} applied; {nxt}' as result;\n")
        out[f"sitting_{part}_apply_half.sql"] = "".join(txt).encode()
    return out


def main():
    out = build()
    bad = []
    for name, data in out.items():
        p = HERE / name
        if "--check" in sys.argv:
            if not p.exists() or p.read_bytes().replace(CRLF, LF) != data:
                bad.append(name)
        else:
            p.write_bytes(data)
    if bad:
        print("differs:", ", ".join(bad))
        sys.exit(1)
    print("ok", ", ".join(sorted(out)))


if __name__ == "__main__":
    main()
