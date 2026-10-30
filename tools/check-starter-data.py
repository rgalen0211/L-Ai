"""The starter data pack (NEXT-CONNECT 171): tools/make_starter_data.py, with MUST-FAILs. A FAKE cache of tiny files on the scratch drive; nothing real is read or fetched.

    py -I tools/check-starter-data.py <scratch base folder on D:>"""
import os
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_starter_data as sd                  # noqa: E402

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="starter-check-"))
BASE.mkdir(parents=True, exist_ok=True)
FAILS = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what, flush=True)
    if not c:
        FAILS.append(what)


def fake_cache(name, skip=()):
    cache = BASE / name / "cache"
    for rel in sd.wanted():
        if rel in skip:
            continue
        p = cache / rel
        if rel.startswith("geo/"):
            (p).mkdir(parents=True, exist_ok=True)
            for ext in ("shp", "dbf", "prj"):
                (p / f"{Path(rel).name}.{ext}").write_bytes(("data " + rel + ext).encode())
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(("data " + rel).encode())
    (cache / "other-dataset.csv").parent.mkdir(parents=True, exist_ok=True)
    (cache / "other-dataset.csv").write_bytes(b"not on the list")
    return cache


print("A. the list")
w = sd.wanted()
check(len(w) == 15 * 5 + 3 + 51 + 5 and len(set(w)) == len(w), f"134 names: 15 years of permits and four place summaries, three population and town files, 51 states, 5 shape folders ({len(w)})")
check("co2010a.txt" in w and "we2024a.txt" in w and "cc-est2020int-agesex-56.csv" in w and "geo/cb_2024_us_county_500k" in w and "co2009a.txt" not in w, "the window is 2010 to 2024 (not the 1990s files)")

print("B. building")
cache = fake_cache("b")
files, missing = sd.plan(cache)
check(not missing and len(files) == 129 + 5 * 3, f"the whole list is found in a full cache ({len(files)} files)")
r = sd.build(cache, BASE / "b" / "out", zip_it=True)
check(r["files"] == 144 and not r["missing"] and not (BASE / "b" / "out" / "other-dataset.csv").exists(), "everything on the list is copied and NOTHING else from the cache")
mf = (BASE / "b" / "out" / sd.MANIFEST).read_text(encoding="utf-8").splitlines()
check(len(mf) == 144 and all(len(x.split("  ")[0]) == 64 for x in mf), "the manifest names every file with its SHA-256 and size")
with zipfile.ZipFile(r["zip"]) as z:
    names = set(z.namelist())
check(sd.MANIFEST in names and "geo/cb_2024_us_county_500k/cb_2024_us_county_500k.shp" in names and len(r["zip_sha256"]) == 64, "the zip holds the manifest and the shape folders, with its own SHA-256")
check(sd.verify(BASE / "b" / "out") == [], "an unpacked pack verifies as built")
(BASE / "b" / "out" / "co2012a.txt").write_bytes(b"changed")
(BASE / "b" / "out" / "we2020a.txt").unlink()
vp = sd.verify(BASE / "b" / "out")
check(vp == ["co2012a.txt has been changed", "we2020a.txt is missing"], f"MUST-FAIL: a changed and a missing file are named: {vp}")
check(sd.verify(BASE / "b") == [f"{sd.MANIFEST} is missing"], "MUST-FAIL: a folder with no manifest is not a pack")

print("C. refusals, with nothing copied")
cache2 = fake_cache("c", skip=("co2015a.txt", "geo/cb_2013_us_county_20m"))
files2, missing2 = sd.plan(cache2)
check(missing2 == ["co2015a.txt", "geo/cb_2013_us_county_20m"], f"MUST-FAIL: missing names are reported exactly: {missing2}")
try:
    sd.build(cache2, BASE / "c" / "out")
    check(False, "MUST-FAIL: a build with files missing is refused")
except SystemExit as e:
    check("does not have 2 of the files" in str(e) and not (BASE / "c" / "out").exists(), "MUST-FAIL: a build with files missing is refused and copies nothing: " + str(e)[:100])
r2 = sd.build(cache2, BASE / "c" / "out2", allow_missing=True)
check(r2["missing"] == missing2 and r2["files"] == 144 - 1 - 3, "with --allow-missing it builds what exists and says what is missing")
try:
    sd.build(cache, BASE / "b" / "out")
    check(False, "MUST-FAIL: an out folder that already has files is refused")
except SystemExit as e:
    check("already has files" in str(e), "MUST-FAIL: an out folder that already has files is refused")
try:
    sd.build(cache, BASE / "b" / "out3", max_mb=0)
    check(False, "MUST-FAIL: a pack over the size cap is refused")
except SystemExit as e:
    check("over 0 MB" in str(e) and not (BASE / "b" / "out3").exists(), "MUST-FAIL: a pack over the size cap is refused and copies nothing")
cache3 = fake_cache("d")
linked = cache3 / "co2011a.txt"
real = BASE / "d" / "elsewhere.txt"
real.write_bytes(b"outside the cache")
linked.unlink()
try:
    os.symlink(real, linked)
    f3, m3 = sd.plan(cache3)
    check(m3 == ["co2011a.txt"], "MUST-FAIL: a link out of the cache is treated as missing, never followed")
except OSError:
    print("  SKIP this account may not make symbolic links on this PC (the link rule was not exercised)")
check(sd.main(["--cache", str(cache), "--out", "C:/nowhere-pack"]) == 2, "MUST-FAIL: an --out off D: is refused")

print()
if FAILS:
    print(f"FAILED: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print("all passed")
