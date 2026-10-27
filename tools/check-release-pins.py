"""The committed facts of the built zip (assets/windows-release.pins.json), and the proof that they are the file's. (CC1 2026-10-26 22:32.)

    python tools/check-release-pins.py --zip D:/.../app-NNN.zip --write     write the pins from the real zip: file name, size in bytes, unzipped size in bytes, SHA-256
    python tools/check-release-pins.py --zip D:/.../app-NNN.zip             prove the committed pins ARE this zip's (and that the record assets/windows-release.js says the same in MB); exit 1 if not
    python tools/check-release-pins.py --selftest                           the checks of this tool on a made-up zip (planted faults must fail)

Why: tests/windows-release-record.test.mjs must run on every PC without the 274 MB zip, so it compares the record with these small committed pins; this tool is where the pins are compared with the file itself,
once, at release time. Standard library only; the zip is only read (its entries are not extracted)."""
import argparse
import hashlib
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PINS = ROOT / "assets" / "windows-release.pins.json"
RECORD = ROOT / "assets" / "windows-release.js"
FAILED = []


def check(c, what):
    print(("  ok   " if c else "  FAIL ") + what)
    if not c:
        FAILED.append(what)


def facts(zip_path: Path) -> dict:
    h = hashlib.sha256()
    with open(zip_path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    with zipfile.ZipFile(zip_path) as zf:
        unzipped = sum(i.file_size for i in zf.infolist())
    return {"fileName": zip_path.name, "sizeBytes": zip_path.stat().st_size, "unzippedBytes": unzipped, "sha256": h.hexdigest()}


def read_record(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    rec = {}
    for k in ("fileName", "sha256", "sizeMb", "unpackedMb"):
        m = re.search(rf"\b{k}:\s*(null|'[^']*'|\"[^\"]*\"|[0-9.]+)", text)
        v = m.group(1) if m else "null"
        rec[k] = None if v == "null" else (v[1:-1] if v[0] in "'\"" else float(v))
    return rec


def verify(pins: dict, real: dict, rec: dict):
    for k in ("fileName", "sizeBytes", "unzippedBytes", "sha256"):
        check(pins.get(k) == real[k], f"the pins' {k} is the zip's ({str(real[k])[:20]})")
    check(rec.get("fileName") == real["fileName"], "the record's file name is the zip's")
    check(rec.get("sha256") == real["sha256"], "the record's SHA-256 is the zip's")
    check(rec.get("sizeMb") == round(real["sizeBytes"] / 1e6), f"the record's size ({rec.get('sizeMb')} MB) is the zip's ({round(real['sizeBytes'] / 1e6)} MB)")
    check(rec.get("unpackedMb") == round(real["unzippedBytes"] / 1e6), f"the record's unzipped size ({rec.get('unpackedMb')} MB) is the zip's ({round(real['unzippedBytes'] / 1e6)} MB)")


def selftest():
    tmp = Path(tempfile.mkdtemp(prefix="relpins-"))
    z = tmp / "app-test.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr("app/x.bin", bytes(range(256)) * 9000)
    real = facts(z)
    rec = {"fileName": "app-test.zip", "sha256": real["sha256"], "sizeMb": round(real["sizeBytes"] / 1e6), "unpackedMb": round(real["unzippedBytes"] / 1e6)}

    def run(pins, rec_):
        before = len(FAILED)
        import io
        out, sys.stdout = sys.stdout, io.StringIO()
        try:
            verify(pins, real, rec_)
        finally:
            sys.stdout = out
        n = len(FAILED) - before
        del FAILED[before:]
        return n
    print("  ok   " if run(dict(real), rec) == 0 else "  FAIL ", "matching pins and record pass")
    if run(dict(real), rec) != 0:
        FAILED.append("matching")
    for label, pins, r in (("a wrong hash in the pins", {**real, "sha256": "0" * 64}, rec), ("a wrong byte size in the pins", {**real, "sizeBytes": real["sizeBytes"] + 1}, rec),
                           ("a wrong unzipped size in the pins", {**real, "unzippedBytes": 5}, rec), ("a wrong file name in the pins", {**real, "fileName": "x.zip"}, rec),
                           ("a record hash that is not the zip's", dict(real), {**rec, "sha256": "1" * 64}), ("a record unzipped size that is not the zip's", dict(real), {**rec, "unpackedMb": rec["unpackedMb"] + 50}),
                           ("a record size that is not the zip's", dict(real), {**rec, "sizeMb": rec["sizeMb"] + 50}), ("a record file name that is not the zip's", dict(real), {**rec, "fileName": "x.zip"})):
        bad = run(pins, r)
        print("  ok   " if bad > 0 else "  FAIL ", f"MUST-FAIL: {label} is caught")
        if bad == 0:
            FAILED.append(label)
    # a changed byte in the zip changes its hash, so pins written from the old file no longer match
    old = dict(real)
    data = bytearray(z.read_bytes())
    data[100] ^= 1
    z.write_bytes(bytes(data))
    changed = facts(z)
    print("  ok   " if changed["sha256"] != old["sha256"] else "  FAIL ", "MUST-FAIL: one changed byte in the zip changes the hash the pins hold")
    if changed["sha256"] == old["sha256"]:
        FAILED.append("hash")
    print("all passed" if not FAILED else f"FAILED: {FAILED}")
    return 1 if FAILED else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.zip:
        ap.error("--zip is required (or --selftest)")
    real = facts(Path(a.zip))
    if a.write:
        PINS.write_text(json.dumps(real, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {PINS.name}: {real['fileName']}, {real['sizeBytes']} bytes, {real['unzippedBytes']} unzipped, sha256 {real['sha256'][:12]}...")
        return 0
    if not PINS.exists():
        print("  FAIL assets/windows-release.pins.json does not exist (write it with --write)")
        return 1
    verify(json.loads(PINS.read_text(encoding="utf-8")), real, read_record(RECORD))
    print("all passed" if not FAILED else f"FAILED: {len(FAILED)}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
