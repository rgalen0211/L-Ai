"""The starter data must sit directly in the data folder, or the app says so at start (NEXT-WORKER 71, from WORKER 70's Sam pack check).

Windows' Extract All adds a folder named after the zip, and a wrong 'program folder' leaves the data folder empty. Both used to pass
find_problems (it only asked whether the folder exists), so the app said it could render, took the order, and the film failed late.

  A  the starter data directly in the folder (its manifest STARTER-DATA.sha256 at the top, every file at its size): no problem
  B  one folder too deep (the manifest in a subfolder): a plain sentence that names that folder
  C  an empty data folder: 'not in place yet'
  D  a listed file missing, or cut short: 'not complete', with how many and one name
  E  a house cache or a hand-made folder (files, no manifest anywhere): accepted, as before
  F  find_problems carries the sentence, so the maker wires no renderer and the card shows it
  G  (optional) the REAL starter zip, extracted flat and as Windows' Extract All does by default

No site, no network, no engine.

    python tools/check-node-starter.py [<starter data zip, for G>]
"""
import hashlib
import os
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ryagram_node_render as rr              # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


FILES = {"co2010a.txt": b"county permits 2010\n" * 50, "SUB-EST2020_9.csv": b"town,pop\n" * 20,
         "geo/cb_2024_us_state_20m/cb_2024_us_state_20m.shx": b"\x00" * 516}


def lay_starter(d: Path):
    d.mkdir(parents=True, exist_ok=True)
    lines = []
    for rel, data in FILES.items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_bytes(data)
        lines.append(f"{hashlib.sha256(data).hexdigest()}  {len(data)}  {rel}")
    (d / rr.STARTER_MANIFEST).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="node-starter-", dir=os.environ.get("TEMP")))

    print("A. in place")
    a = tmp / "a" / "node-data"
    lay_starter(a)
    check(rr.starter_data_problem(a) is None, "the manifest at the top and every file at its size: no problem")

    print("\nB. one folder too deep (Windows' Extract All default)")
    b = tmp / "b" / "node-data"
    lay_starter(b / "starter-data-1030a")
    msg = rr.starter_data_problem(b) or ""
    check("one folder too deep" in msg and str(b / "starter-data-1030a") in msg and "co2010a.txt" in msg,
          f"said plainly, naming the folder ({msg[:80]}...)")

    print("\nC. empty")
    c = tmp / "c" / "node-data"
    c.mkdir(parents=True)
    msg = rr.starter_data_problem(c) or ""
    check("not in place yet" in msg and str(c) in msg, f"'not in place yet' ({msg[:70]}...)")

    print("\nD. incomplete")
    d1 = tmp / "d1" / "node-data"
    lay_starter(d1)
    (d1 / "co2010a.txt").unlink()
    msg = rr.starter_data_problem(d1) or ""
    check("not complete" in msg and "1 of 3" in msg and "co2010a.txt" in msg, f"a missing file: how many and which ({msg[:90]}...)")
    d2 = tmp / "d2" / "node-data"
    lay_starter(d2)
    (d2 / "SUB-EST2020_9.csv").write_bytes(b"cut")
    msg = rr.starter_data_problem(d2) or ""
    check("not complete" in msg and "SUB-EST2020_9.csv" in msg, "a file cut short is caught by its size")

    print("\nE. a folder with no manifest anywhere")
    e = tmp / "e" / "cache"
    (e / "bps").mkdir(parents=True)
    (e / "bps" / "co2010a.txt").write_bytes(b"x")
    check(rr.starter_data_problem(e) is None, "a house cache (files, no manifest) is accepted, as before")
    f0 = tmp / "e2" / "cache"
    f0.mkdir(parents=True)
    (f0 / "x.csv").write_text("a", encoding="ascii")
    check(rr.starter_data_problem(f0) is None, "a hand-made folder with one file is accepted, as before")

    print("\nF. find_problems carries it")
    s = rr.Settings(path=tmp / "node.toml", raw={}, root=tmp / "root", engine_dir=tmp / "engine", python=Path(sys.executable),
                    chrome=None, path_dirs=(), cache_dir=b, datasets=("bps_county_permits",), gpu_lock=None, house_jobs=None,
                    gpu_lock_dir=None, no_house_worker=True, who="T", memory_bytes=1)
    pr = rr.find_problems(s, tmp / "work", ram=lambda: 64 << 30, free_gb=lambda: 500.0)
    check(any("one folder too deep" in p for p in pr), "the too-deep sentence is one of the problems (so no renderer is wired)")
    s2 = rr.Settings(**{**s.__dict__, "cache_dir": a})
    pr2 = rr.find_problems(s2, tmp / "work", ram=lambda: 64 << 30, free_gb=lambda: 500.0)
    check(not any("film data" in p for p in pr2), "data in place: no data sentence (the other stand-in gaps are other lines)")

    if len(sys.argv) > 1:
        print("\nG. the real starter zip")
        z = zipfile.ZipFile(sys.argv[1])
        flat = tmp / "g-flat" / "node-data"
        z.extractall(flat)
        check(rr.starter_data_problem(flat) is None, f"extracted flat: no problem ({len(z.namelist())} entries)")
        nested = tmp / "g-nested" / "node-data"
        z.extractall(nested / Path(sys.argv[1]).stem)          # what Extract All proposes: <chosen folder>\<zip name>
        msg = rr.starter_data_problem(nested) or ""
        check("one folder too deep" in msg and Path(sys.argv[1]).stem in msg, "extracted as Extract All proposes: 'one folder too deep'")
    else:
        print("\nG. skipped (no starter zip given)")

    print()
    if FAILED:
        print(f"{len(FAILED)} FAILED:")
        for f in FAILED:
            print("  " + f)
        return 1
    print("all node starter checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
