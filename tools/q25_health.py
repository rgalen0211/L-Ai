"""Q25, the daily health check of the connector, as ONE command (INTERNAL, CONNECT 2026-10-19). READ-ONLY.

    py tools/q25_health.py --project proof
    py tools/q25_health.py --project live --live            (live needs BOTH words; Ryan types --live himself)
    options: --cli "npx.cmd supabase"   (the Supabase command line; default tries `supabase`, then `npx.cmd supabase`, then `npx supabase`)

It runs supabase/connect-live/05_daily_health.sql and 05b_purge_last_run.sql (the files the SQL Editor route uses, unchanged) through Ryan's own signed-in
Supabase command line (`supabase db query --linked`), inside `begin read only;` so the DATABASE itself refuses any write (tested). It needs no database
password, no key and no secret of the project; it prints no secret. What it does NOT do: schedule the clean-up job (that is the separate SQL in the Q25
section) or change anything.

Output: one line per check, worst first (ACT, then look, then ok), and a one-line summary. Exit code 0 = nothing to act on, 1 = at least one ACT row,
2 = refused or could not run. A `look` row is "read it, no rush"; an `act` row says in its last column what to do today.

Note for whoever runs it: the Supabase command line signs in to a project's database by creating a short-lived LOGIN role there ("Initialising login
role..."). That is the command line's own standard step for every database command, not something this script adds, and the queries themselves are read-only."""
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE_REF = "jxtkfishqfxuptwjzczz"
PROOF_REF = "awjbjersplaqhxhuvozi"
SQL_DIR = ROOT / "supabase" / "connect-live"
ORDER = {"act": 0, "look": 1, "ok": 2}


def find_cli(given: str | None) -> list[str] | None:
    candidates = [given] if given else ["supabase", "npx.cmd supabase", "npx supabase"]
    for c in candidates:
        argv = shlex.split(c, posix=False)
        try:
            r = subprocess.run([*argv, "--version"], capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if r.returncode == 0:
            return argv
    return None


def run_sql(cli: list[str], ref: str, sql: str):
    """-> (rows, error text). The SQL runs inside a READ ONLY transaction: a write is refused by the database itself."""
    with tempfile.TemporaryDirectory(prefix="q25_") as d:
        f = Path(d) / "q.sql"
        f.write_text("begin read only;\n" + sql.rstrip().rstrip(";") + ";\n", encoding="utf-8")
        p = subprocess.run([*cli, "db", "query", "--linked", "--project-ref", ref, "-f", str(f), "--output-format", "json"], capture_output=True, text=True, timeout=300)
    out = p.stdout
    i = out.find("{")
    if p.returncode != 0 or i < 0:
        msg = (out + p.stderr)
        m = re.search(r'"message"\s*:\s*"([^"]{0,300})', msg)
        return None, (m.group(1) if m else re.sub(r"\s+", " ", msg)[:300])
    try:
        data = json.loads(out[i:])
    except ValueError:
        return None, "the command line answered something that is not JSON"
    return data.get("rows", []), None


def main() -> int:
    ap = argparse.ArgumentParser(description="Q25 daily health check (read-only)")
    ap.add_argument("--project", required=True, choices=["proof", "live"])
    ap.add_argument("--live", action="store_true", help="required, typed by Ryan, for --project live; refused for proof")
    ap.add_argument("--cli", default=None, help="the Supabase command line, e.g. \"npx.cmd supabase\"")
    a = ap.parse_args()
    if a.project == "live" and not a.live:
        print("REFUSED: --project live needs --live as well, typed by Ryan. This check is read-only, but it is still a connection to the live project.")
        return 2
    if a.live and a.project != "live":
        print("REFUSED: --live is only for --project live.")
        return 2
    ref = LIVE_REF if a.project == "live" else PROOF_REF
    cli = find_cli(a.cli)
    if cli is None:
        print("REFUSED: the Supabase command line was not found. Install it or pass --cli \"npx.cmd supabase\" (and sign in with `supabase login`).")
        return 2
    files = [SQL_DIR / "05_daily_health.sql", SQL_DIR / "05b_purge_last_run.sql"]
    for f in files:
        if not f.is_file():
            print(f"REFUSED: {f.name} is not in {SQL_DIR}")
            return 2
    print(f"Q25 daily health on the {a.project.upper()} project (read-only), {time.strftime('%Y-%m-%d %H:%M')}")
    rows, err = run_sql(cli, ref, files[0].read_text(encoding="utf-8"))
    if err:
        print(f"COULD NOT RUN the health check: {err}")
        return 2
    purge_rows, perr = run_sql(cli, ref, files[1].read_text(encoding="utf-8"))
    if perr:
        purge_rows = None
    rows = sorted(rows, key=lambda r: ORDER.get(str(r.get("status")), 3))
    counts = {"act": 0, "look": 0, "ok": 0}
    for r in rows:
        st = str(r.get("status"))
        counts[st] = counts.get(st, 0) + 1
        tag = {"act": "ACT ", "look": "look", "ok": "ok  "}.get(st, "??  ")
        line = f"{tag} {str(r.get('check_name'))[:92]}: {r.get('value')}"
        if st != "ok":
            line += f"\n       -> {str(r.get('what_to_do'))[:300]}"
        print(line)
    if purge_rows is None:
        print("look the clean-up job's last run could not be read here (pg_cron may not be enabled on this project, or the job is not scheduled yet)")
    else:
        for r in purge_rows:
            st = str(r.get("status", "?"))
            print(f"{ {'act': 'ACT ', 'look': 'look', 'ok': 'ok  '}.get(st, '??  ') } clean-up job (connect-purge): schedule {r.get('schedule')}, last run {r.get('last_run_status')} -> {str(r.get('what_to_do', ''))[:200]}")
            counts[st] = counts.get(st, 0) + 1
    master = next((str(r.get("value")) for r in rows if str(r.get("check_name")).startswith("master switch")), "?")
    print(f"\nDAILY HEALTH {time.strftime('%Y-%m-%d %H:%M')} ({a.project}): {counts.get('act', 0)} act, {counts.get('look', 0)} look, {counts.get('ok', 0)} ok | master switch {master}")
    return 1 if counts.get("act", 0) else 0


if __name__ == "__main__":
    sys.exit(main())
