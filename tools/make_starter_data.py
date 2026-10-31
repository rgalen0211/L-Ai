"""The starter data pack for a tester's first site film (NEXT-CONNECT 171; the list is tools/node-starter-data.json, measured by RENDERER 44).

    py -I tools/make_starter_data.py --cache <a Ryagram data cache folder> --out <new folder on D:> [--zip]

The film engine builds OFFLINE, so a tester's first site film needs its data folder filled before it can start. This copies ONLY the public files that list names (2010 to 2024 permits and place summaries, county and
town population, county and state shapes: about 98 MB) from a cache that already has them, never fetches anything, and writes STARTER-DATA.sha256 (every file, size and SHA-256). The pack is NOT inside the app zip
(the zip must stay under the 300 MB the website's upload accepts): the tester unzips it into <app>\\work\\node-data, where tools/node_settings.py points the engine. Missing files are reported by name and make the
build refuse unless --allow-missing; links and anything outside the cache are never followed.

What it does NOT prove: that these files are exactly what the film reads. The names come from the dataset clients, not from a traced render; the first real proof is one contact sheet on a clean second PC."""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

YEARS = range(2010, 2025)
REGIONS = ("ne", "mw", "so", "we")
STATE_CODES = ("01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34",
               "35", "36", "37", "38", "39", "40", "41", "42", "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56")
SHAPES = ("cb_2024_us_county_500k", "cb_2021_us_county_20m", "cb_2013_us_county_20m", "cb_2024_us_county_20m", "cb_2024_us_state_20m")
MANIFEST = "STARTER-DATA.sha256"
MAX_MB = 250


def wanted() -> list:
    """Relative paths (files, or whole shape folders under geo/) the pack must hold."""
    out = []
    for y in YEARS:
        out.append(f"co{y}a.txt")
        out += [f"{r}{y}a.txt" for r in REGIONS]
    out += ["co-est2024-alldata.csv", "sub-est2024_9.csv", "SUB-EST2020_9.csv"]
    out += [f"cc-est2020int-agesex-{s}.csv" for s in STATE_CODES]
    out += [f"geo/{s}" for s in SHAPES]
    return out


def _is_link(p: Path) -> bool:
    return p.is_symlink() or bool(getattr(p, "is_junction", lambda: False)())


def plan(cache: Path) -> tuple:
    """(files to copy as (source, relative), missing relative names). A link, or a path that leaves the cache, is treated as missing."""
    cache = Path(cache).resolve()
    files, missing = [], []
    for rel in wanted():
        src = cache / rel
        try:
            real = src.resolve()
            inside = real == cache or cache in real.parents
        except OSError:
            inside = False
        if not inside or _is_link(src) or not src.exists():
            missing.append(rel)
        elif src.is_dir():
            got = [p for p in sorted(src.rglob("*")) if p.is_file() and not any(_is_link(a) for a in [p, *p.parents] if cache in a.parents)]
            if not got:
                missing.append(rel)
            files += [(p, p.relative_to(cache).as_posix()) for p in got]
        else:
            files.append((src, rel))
    return files, missing


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def build(cache: Path, out: Path, *, allow_missing: bool = False, zip_it: bool = False, max_mb: int = MAX_MB) -> dict:
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"REFUSED: {out} already has files (a pack is built into a new, empty folder).")
    files, missing = plan(cache)
    if missing and not allow_missing:
        raise SystemExit("REFUSED: the cache does not have " + str(len(missing)) + " of the files the list names (e.g. " + ", ".join(missing[:5]) + "). Nothing was copied.")
    total = sum(p.stat().st_size for p, _r in files)
    if total > max_mb * (1 << 20):
        raise SystemExit(f"REFUSED: the pack would be {total // (1 << 20)} MB, over {max_mb} MB.")
    out.mkdir(parents=True, exist_ok=True)
    lines = []
    for src, rel in files:
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        h = sha256_file(dest)
        if h != sha256_file(src):
            raise SystemExit(f"REFUSED: {rel} was not copied faithfully.")
        lines.append(f"{h}  {dest.stat().st_size}  {rel}")
    (out / MANIFEST).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    res = {"files": len(files), "bytes": total, "missing": missing, "out": str(out)}
    if zip_it:
        zp = out.with_name(out.name + ".zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for p in sorted(x for x in out.rglob("*") if x.is_file()):
                z.write(p, p.relative_to(out).as_posix())
        res.update(zip=str(zp), zip_bytes=zp.stat().st_size, zip_sha256=sha256_file(zp))
    return res


def verify(folder: Path) -> list:
    """Problems with an unpacked pack (empty = as built): a missing, changed or added file. Reads the manifest only; used by the app before a film starts."""
    folder = Path(folder)
    mf = folder / MANIFEST
    if not mf.is_file():
        return [f"{MANIFEST} is missing"]
    want = {}
    for line in mf.read_text(encoding="utf-8").splitlines():
        m = re.fullmatch(r"([0-9a-f]{64})  (\d+)  (.+)", line)
        if not m:
            return ["the manifest is not readable"]
        want[m.group(3)] = (m.group(1), int(m.group(2)))
    problems = []
    for rel, (h, size) in sorted(want.items()):
        p = folder / rel
        if not p.is_file():
            problems.append(f"{rel} is missing")
        elif p.stat().st_size != size or sha256_file(p) != h:
            problems.append(f"{rel} has been changed")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--zip", action="store_true")
    ap.add_argument("--allow-missing", action="store_true")
    ap.add_argument("--allow-any-drive", action="store_true", help="tests only")
    a = ap.parse_args(argv)
    if not a.allow_any_drive and not re.match(r"^[dD]:", str(Path(a.out).resolve())):
        print("REFUSED: --out must be on D: (the storage rule).")
        return 2
    try:
        r = build(Path(a.cache), Path(a.out), allow_missing=a.allow_missing, zip_it=a.zip)
    except SystemExit as e:
        print(str(e))
        return 2
    print(r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
