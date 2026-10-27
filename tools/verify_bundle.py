"""Start-time self-check of the Ryagram app folder (NEXT-CONNECT 105; planned in FACES' Sam card, step 4). Standard library only. Runs from the folder's own Python before the app opens.

WHAT IT CAN SAY: whether this folder is the one that was unzipped, i.e. every app file (ryagram, tools, recipes, docs, the start files) is byte for byte what the builder recorded in
SHA256SUMS.txt, nothing was added to those folders, and every big file (Python, libraries, ffmpeg, the model) is still there at the size the builder recorded.
WHAT IT CANNOT SAY: that the folder is the one Ryan built (someone who changed a file could change the list too). The SHA-256 Ryan reads out for the ZIP is what ties it to him.

    python verify_bundle.py <the folder that holds BUNDLE-MANIFEST.json> [--deep]       exit 0 = fine, exit 1 = something changed (the sentence says what)
--deep also re-reads every big file and compares its SHA-256 (about a minute); the start file does not use it.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

APP_DIRS = ("ryagram", "tools", "recipes", "docs")
SKIP_NAMES = {"__pycache__"}
SKIP_SUFFIX = {".pyc"}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_sums(path: Path) -> dict:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if len(line) > 66 and line[64:66] == "  ":
            out[line[66:]] = line[:64]
    return out


def app_files(root: Path):
    for d in APP_DIRS:
        base = root / d
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [n for n in dirnames if n not in SKIP_NAMES]
            for fn in filenames:
                if Path(fn).suffix in SKIP_SUFFIX:
                    continue
                yield (Path(dirpath) / fn).relative_to(root).as_posix()


def check(root: Path, deep: bool = False) -> list:
    """Returns the plain sentences for everything that differs; an empty list means the folder is as it was built."""
    problems = []
    mf, sums_path = root / "BUNDLE-MANIFEST.json", root / "SHA256SUMS.txt"
    if not mf.is_file() or not sums_path.is_file():
        return ["The list of files this folder was built with (BUNDLE-MANIFEST.json or SHA256SUMS.txt) is missing."]
    try:
        manifest = json.loads(mf.read_text(encoding="utf-8"))
    except ValueError:
        return ["BUNDLE-MANIFEST.json cannot be read."]
    sums = read_sums(sums_path)
    for rel, want in sorted(sums.items()):
        p = root / rel
        if not p.is_file():
            problems.append(f"{rel} is missing.")
        elif sha256_file(p) != want:
            problems.append(f"{rel} has been changed.")
    expected = set(sums)
    for rel in app_files(root):
        if rel not in expected:
            problems.append(f"{rel} was added and is not part of what was built.")
    for rel, info in sorted((manifest.get("large_files") or {}).items()):
        p = root / rel
        if not p.is_file():
            problems.append(f"{rel} is missing.")
        elif p.stat().st_size != info.get("bytes"):
            problems.append(f"{rel} is not the size it was built with.")
        elif deep and sha256_file(p) != info.get("sha256"):
            problems.append(f"{rel} has been changed.")
    return problems


def main(argv) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    if not args:
        print("Give the folder that holds BUNDLE-MANIFEST.json.")
        return 2
    problems = check(Path(args[0]), deep="--deep" in argv)
    if not problems:
        print("All files are as they were when this folder was built.")
        return 0
    print("This folder is not exactly as it was built. Do not go on; tell Ryan, and say what is listed here:")
    for p in problems[:12]:
        print("  - " + p)
    if len(problems) > 12:
        print(f"  ... and {len(problems) - 12} more.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
