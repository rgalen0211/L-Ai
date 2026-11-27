"""Must-fail proof for the Perfect City migration (supabase/migrations/20261127000900_perfect_city_places.sql): each fault breaks ONE rule in a scratch copy of the repo and the
SQL test module it names (supabase/tests/test_perfect_city_places.py or test_perfect_city_summary.py) must then FAIL ON AN ASSERTION.
GEO 2026-11-27. Run from the repo root, ALONE (one runner at a time in a tree; Postgres only in GEO's one Postgres slot), with TEMP on D::
    set TEMP=D:/Ryagram-scratch/GEO/temp/pgmut  (and TMP, TMPDIR the same)   PYTHONPATH=D:/Ryagram-scratch/CC1/pyshim-yaml
    D:/Ryagram-scratch/WEB/pgvenv2/Scripts/python.exe -I -B tests/perfect_city_sql_mutants.py              baseline, then every fault
    ... tests/perfect_city_sql_mutants.py --list         no database: prints every fault, its target module and its match count (must be 1)
    ... tests/perfect_city_sql_mutants.py --baseline     only the two modules, unmutated (must both pass)
    ... tests/perfect_city_sql_mutants.py [fault name ...]   baseline, then only those faults
(-I keeps this runner off PYTHONPATH, but os.environ still carries it, so each unittest child, run as `python -B` without -I, gets the yaml shim the pg venvs need.)
Same rules as tests/waiting_sql_mutants.py / tests/connect_sql_mutants.py (whose helpers this reuses): own temp per run, the pgserver folder stopped and deleted before the next run,
CAUGHT only on an assertion failure (an error or a broken migration is NOT caught), the unmutated modules must pass first, a dirty tree is refused, exit nonzero on any MISSED.
CRLF-proof: the migration is read in binary, matched on LF-normalised text, and written back with its own line endings.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import connect_sql_mutants as base  # noqa: E402  (helpers only; nothing here starts Postgres until a run)

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".mut_pcity"
MIG = "supabase/migrations/20261127000900_perfect_city_places.sql"
PLACES = "supabase/tests/test_perfect_city_places.py"
SUMMARY = "supabase/tests/test_perfect_city_summary.py"
MODULES = [PLACES, SUMMARY]
RUN_TMP = base.BASE_TEMP / f"pcity-mut-{os.getpid()}"

BOX = ("  if p_lat is null or p_lon is null or p_lat not between box.lat0 and box.lat1 or p_lon not between box.lon0 and box.lon1 then\n"
       "    raise exception 'That spot is outside the county. Give a latitude and longitude inside it.' using errcode = '22023';\n"
       "  end if;\n")

# (name, module expected to catch it, old text, new text): every old text must be in the migration exactly once (LF-normalised)
FAULTS = [
    ("the switch check is always true", PLACES,
     "has_switch := p_owner is not null and exists (select 1 from public.account_settings s where s.owner_id = p_owner and 'perfectCity' = any (s.switches_on));",
     "has_switch := true;"),
    ("the admin clause is dropped from the gate", PLACES, "if p_owner is null or not (is_admin or has_switch", "if p_owner is null or not (has_switch"),
    ("the public flip is always true", PLACES,
     "exists (select 1 from public.departments d where d.id = 'geo_intelligence' and d.status = 'working')", "true"),
    ("the 60-place cap is raised to 6000", PLACES, "and n.rn <= 60), '[]'::jsonb))", "and n.rn <= 6000), '[]'::jsonb))"),
    ("within is counted after the 60-place cap", PLACES,
     "'within', jsonb_build_object('1', count(*) filter (where n.km <= 1), '2', count(*) filter (where n.km <= 2), '5', count(*) filter (where n.km <= 5)),",
     "'within', jsonb_build_object('1', count(*) filter (where n.km <= 1 and n.rn <= 60), '2', count(*) filter (where n.km <= 2 and n.rn <= 60),"
     " '5', count(*) filter (where n.km <= 5 and n.rn <= 60)),"),
    ("the daily cap is multiplied by 1000", PLACES, "when has_switch then 300 else", "when has_switch then 300000 else"),
    ("a refused call is not counted", PLACES, "do update set calls = c.calls + 1", "do update set calls = c.calls"),
    ("the places answer returns osm_ref", PLACES,
     "jsonb_build_object('name', n.name, 'lat', n.lat, 'lon', n.lon)", "jsonb_build_object('name', n.name, 'lat', n.lat, 'lon', n.lon, 'osm_ref', n.osm_ref)"),
    ("the AI summary nearest carries a name", SUMMARY,
     "jsonb_build_object('rank', n.rk, 'km',", "jsonb_build_object('rank', n.rk, 'name', 'x', 'km',"),
    ("people at 1 km are given in the summary", SUMMARY, "case when r.km = 5 then", "case when r.km >= 1 then"),
    ("the spot box check is removed", PLACES, BOX, ""),
]


def read_lf(path):
    raw = Path(path).read_bytes()
    return raw.decode("utf-8").replace("\r\n", "\n"), (b"\r\n" in raw)


def write_own_endings(path, text_lf, crlf):
    Path(path).write_bytes((text_lf.replace("\n", "\r\n") if crlf else text_lf).encode("utf-8"))


def match_counts():
    text, _ = read_lf(ROOT / MIG)
    return [(name, mod, text.count(old), old == new) for name, mod, old, new in FAULTS]


def targets_bad():
    names = [f[0] for f in FAULTS]
    bad = [n for n, _, c, same in match_counts() if c != 1 or same]
    return bad + sorted({n for n in names if names.count(n) > 1})


def tree_dirty():
    out = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--untracked-files=no"], capture_output=True, text=True)
    if out.returncode != 0:
        return f"git status failed: {out.stderr.strip()}"
    return out.stdout.strip()


def one_run(label, module, fault=None):
    """('caught' | 'survived' | 'errored' | 'broken', failures, errors) for ONE module on a scratch copy with at most ONE fault planted."""
    if base.free_gb(base.BASE_TEMP) < base.MIN_FREE_GB:
        raise base.HarnessError(f"only {base.free_gb(base.BASE_TEMP):.1f} GB free on the temp drive; stopping")
    RUN_TMP.mkdir(parents=True, exist_ok=True)
    left = base.pg_dirs(RUN_TMP) + base.pg_dirs(RUN_TMP / "t")
    if left:
        raise base.HarnessError(f"a pgserver folder was left behind before {label}: {[p.name for p in left]}")
    shutil.rmtree(SCRATCH, ignore_errors=True)
    (SCRATCH / "supabase").mkdir(parents=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", dirs_exist_ok=True)
    (SCRATCH / "tests").mkdir(exist_ok=True)
    if fault:
        _, _, old, new = fault
        path = SCRATCH / MIG
        text, crlf = read_lf(path)
        if text.count(old) != 1:
            shutil.rmtree(SCRATCH, ignore_errors=True)
            return "broken", 0, 0
        write_own_endings(path, text.replace(old, new, 1), crlf)
        if read_lf(path)[0] == read_lf(ROOT / MIG)[0]:
            shutil.rmtree(SCRATCH, ignore_errors=True)
            return "broken", 0, 0
    mut_tmp = RUN_TMP / "t"
    mut_tmp.mkdir(exist_ok=True)
    trace = RUN_TMP / "pg-trace.txt"
    trace.unlink(missing_ok=True)
    env = dict(os.environ, TEMP=str(mut_tmp), TMP=str(mut_tmp), TMPDIR=str(mut_tmp), PYTHONDONTWRITEBYTECODE="1", **{base.TRACE_ENV: str(trace)})
    proc = subprocess.Popen([sys.executable, "-u", "-B", "-m", "unittest", module], cwd=SCRATCH, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        out, _ = proc.communicate(timeout=1800)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True) if os.name == "nt" else proc.kill()
        out, _ = proc.communicate()
        out += "\nTIMEOUT\n"
    verdict = base.classify(out, proc.returncode)
    if fault is None and verdict[0] != "survived":
        print(out[-4000:], flush=True)
    try:
        base.prove_controlled_temp(label, trace, mut_tmp, verdict[0])
    finally:
        base.remove_pg_folders(mut_tmp)
        shutil.rmtree(SCRATCH, ignore_errors=True)
    return verdict


def cleanup():
    if RUN_TMP.exists():
        try:
            base.remove_pg_folders(RUN_TMP)
            base.remove_pg_folders(RUN_TMP / "t")
        finally:
            shutil.rmtree(RUN_TMP, ignore_errors=True)
    shutil.rmtree(SCRATCH, ignore_errors=True)


def baseline():
    for mod in MODULES:
        v, f, e = one_run(f"baseline {mod}", mod)
        print(f"baseline (unmutated) {mod}: {v}", flush=True)
        if v != "survived":
            print("BASELINE FAILED: the unmutated tests must pass first")
            return False
    return True


def run(only=None, baseline_only=False):
    dirty = tree_dirty()
    if dirty:
        print(f"REFUSING: the tree is dirty (commit or stash first, a planted fault must never mix with work in progress):\n{dirty}")
        return 2
    bad_t = targets_bad()
    if bad_t:
        print(f"REFUSING: these fault targets are not in the migration exactly once: {bad_t}")
        return 2
    selected = [f for f in FAULTS if not only or f[0] in only]
    if only and len(selected) != len(set(only)):
        print(f"REFUSING: unknown fault name(s): {sorted(set(only) - {f[0] for f in FAULTS})}")
        return 2
    bad = 0
    try:
        if not baseline():
            return 2
        if baseline_only:
            print("baseline green: both modules pass unmutated")
            return 0
        for fault in selected:
            name, mod = fault[0], fault[1]
            v, f, e = one_run(name, mod, fault)
            if v == "caught":
                print(f"CAUGHT  {name}  ({Path(mod).name}, assertion failures: {f})", flush=True)
            elif v == "broken":
                print(f"BROKEN FAULT (text not found exactly once, or the plant changed nothing): {name}", flush=True)
                bad += 1
            elif v == "errored":
                print(f"MISSED  {name}  (the tests ERRORED, they did not FAIL on an assertion; errors={e})", flush=True)
                bad += 1
            else:
                print(f"MISSED  {name}  ({Path(mod).name} passed with the fault planted)", flush=True)
                bad += 1
    except base.HarnessError as err:
        print(f"HARNESS STOPPED: {err}")
        return 3
    finally:
        cleanup()
    print(f"{bad} fault(s) not caught" if bad else f"all {len(selected)} faults caught")
    return 1 if bad else 0


def list_faults():
    rows = match_counts()
    for i, (name, mod, count, same) in enumerate(rows, 1):
        print(f"{i:2d}. matches={count}{' (old == new!)' if same else ''}  {Path(mod).name}  {name}")
    b = targets_bad()
    print("targets ok" if not b else f"BAD TARGETS: {b}")
    return 1 if b else 0


if __name__ == "__main__":
    if "--list" in sys.argv:
        sys.exit(list_faults())
    sys.exit(run([a for a in sys.argv[1:] if not a.startswith("--")] or None, baseline_only="--baseline" in sys.argv))
