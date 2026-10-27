"""Fetch the word-building (alignment) model for the desktop app, once, pinned and checked (NEXT-CONNECT 132; the rules are the listening model's, CC1 2026-10-20 17:15). Standard library only.

WHAT IT IS FOR: the "fill missing words" start file builds a word nobody in the person's videos says out of the sounds of words they do say. That needs ONE extra model, wav2vec2
(onnx-community/wav2vec2-base-960h-ONNX), which the engine looks for in the same models folder as the listening model and NEVER downloads itself. This file puts it there.
SIZE, said before anything starts: about 378 MB (onnx/model.onnx, 377,911,891 bytes) plus a 358-byte word list. It is a separate download from the 464 MB listening model.

THE RULES (the same as tools/model_download.py, whose host, redirect and opener code it uses; each is a case in tools/check-get-word-builder.py):
  * One written-in host (huggingface.co) and one written-in path shape: https://HOST/<repo>/resolve/<revision>/<file>. Repo, revision and file names are written in HERE.
  * A redirect only to https, port 443, no user name, on that host's own content domains, at most 5 hops. Anything else is refused and nothing is kept.
  * Every file must announce its size and it must be the pinned one; no more bytes than that are read; at the end the hash must equal the pinned one. model.onnx is pinned by its
    SHA-256 (the host's published LFS hash). vocab.json has no SHA-256 in the host's listing (only a git blob id for small files), so it is pinned by that git blob id, which this file
    computes the same way git does (sha1 over "blob <size>" and a zero byte, then the bytes). A file that differs is deleted with everything else and the download is refused.
  * Nothing is written into the models folder until both files have passed: they are staged in a hidden folder next to it and moved in at the end. A partial file is never used.
  * Nothing downloaded is run, imported or unpacked: the two files are data (weights and a word list).
  * The person has to type YES first, after reading the size; anything else stops with nothing downloaded.
THE PINS were read from the host's public file listing on 2026-10-26 (metadata only; this file's first real download is what confirms them, as WORKER's was for the listening model).
"""
import argparse
import hashlib
import http.client
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _cand in (HERE / "tools", HERE):          # in the bundle this file sits at the folder's root and the maker's tools are in tools\
    if (_cand / "model_download.py").is_file():
        sys.path.insert(0, str(_cand))
        break
import model_download as md  # noqa: E402

REPO = "onnx-community/wav2vec2-base-960h-ONNX"
REVISION = "729c1a6730fb549c20a1c73a3d3f96f11020225e"
FOLDER = "models--onnx-community--wav2vec2-base-960h-ONNX"
# (name in the repo, bytes, kind of check, the check value). The engine looks for exactly these two paths (ryagram/library/align.py MODEL_FILE and vocab.json).
FILES = (
    ("onnx/model.onnx", 377911891, "sha256", "00b7cc69516c1ab63c429e63a2b543e4d42bb77441ec5b98ee935de175b00de1"),
    ("vocab.json", 358, "git-sha1", "7efc55a6619a53189e1ca2b5bdcca400a2d4f3e6"),
)
ALLOWED_NAMES = {n for n, _b, _k, _v in FILES}


def total_bytes(files=FILES) -> int:
    return sum(b for _n, b, _k, _v in files)


def final_dir(root, revision=REVISION) -> Path:
    return Path(root) / FOLDER / "snapshots" / revision


def is_complete(root, files=FILES, revision=REVISION) -> bool:
    d = final_dir(root, revision)
    return all((d / n).is_file() and (d / n).stat().st_size == b for n, b, _k, _v in files)


def _hasher(kind: str, size: int):
    if kind == "sha256":
        return hashlib.sha256()
    if kind == "git-sha1":
        h = hashlib.sha1()
        h.update(b"blob %d\0" % size)
        return h
    raise md.ModelRefused("A check in the download list is not one this program knows.")


def file_url(name: str, net, repo=REPO, revision=REVISION) -> str:
    port = f":{net.port}" if net.port else ""
    return f"{net.scheme}://{net.host}{port}/{repo}/resolve/{revision}/{name}"


def download(root, progress=None, cancel=None, net=None, files=FILES, repo=REPO, revision=REVISION) -> Path:
    """Fetch and verify the two files. Raises md.ModelRefused (plain words) or md.Cancelled; either way nothing is left in the models folder."""
    net = net or md.Net()
    root = Path(root)
    if is_complete(root, files, revision):
        return final_dir(root, revision)
    root.mkdir(parents=True, exist_ok=True)
    need = int(total_bytes(files) * 1.1) + 100 * (1 << 20)
    if shutil.disk_usage(root).free < need:
        raise md.ModelRefused(f"There is not enough free space for this download (it needs about {need // (1 << 20)} MB free in the folder {root}).")
    stage = root / ".downloading-word-builder"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir()
    done, total = 0, total_bytes(files)
    try:
        op = md._opener(net)
        for name, nbytes, kind, want in files:
            if name not in ALLOWED_NAMES and files is FILES:
                raise md.ModelRefused("A file name in the download list is not allowed.")
            url = file_url(name, net, repo, revision)
            md.check_hop(url, net)
            req = urllib.request.Request(url, headers={"User-Agent": "Ryagram-maker", "Accept-Encoding": "identity"})
            try:
                resp = op.open(req, timeout=md.TIMEOUT_S)
            except urllib.error.HTTPError as e:
                raise md.ModelRefused(f"The download server answered {e.code} for {name}. Nothing was kept.") from None
            except (urllib.error.URLError, OSError, http.client.HTTPException):
                raise md.ModelRefused("The download could not reach the server. Check the internet and try again. " + md.PROXY_NOTE + " Nothing was kept.") from None
            with resp:
                md.check_hop(resp.geturl(), net)
                if getattr(resp, "status", 200) != 200:
                    raise md.ModelRefused(f"The download server answered {resp.status} for {name}. Nothing was kept.")
                try:
                    announced = int(resp.headers.get("Content-Length", ""))
                except ValueError:
                    announced = -1
                if announced != nbytes:
                    raise md.ModelRefused(f"{name} is not the size it should be, so it was refused. Nothing was kept.")
                h, got = _hasher(kind, nbytes), 0
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with open(target, "wb") as out:
                    while True:
                        if cancel is not None and cancel.is_set():
                            raise md.Cancelled()
                        try:
                            chunk = resp.read(min(md.CHUNK, nbytes - got + 1))
                        except (OSError, http.client.HTTPException):
                            raise md.ModelRefused("The download was interrupted. Check the internet and try again. Nothing was kept.") from None
                        if not chunk:
                            break
                        got += len(chunk)
                        if got > nbytes:
                            raise md.ModelRefused(f"{name} was longer than it should be, so it was refused. Nothing was kept.")
                        h.update(chunk)
                        out.write(chunk)
                        done += len(chunk)
                        if progress:
                            progress(done, total, name)
                if got != nbytes:
                    raise md.ModelRefused(f"{name} ended early, so it was refused. Nothing was kept.")
                if h.hexdigest() != want:
                    raise md.ModelRefused(f"{name} is not the file it should be (its check number is different), so it was deleted. Nothing was kept.")
        dest = final_dir(root, revision)
        shutil.rmtree(dest, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(stage, dest)
        refs = dest.parent.parent / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_bytes(revision.encode("ascii"))
        return dest
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Fetch the word-building model once (about 378 MB), pinned and checked.")
    ap.add_argument("--models", default=os.environ.get("RYAGRAM_MODEL_DIR", ""), help="the models folder (default: RYAGRAM_MODEL_DIR)")
    ap.add_argument("--yes", action="store_true", help="skip the question (tests only)")
    a = ap.parse_args(argv)
    if not a.models:
        print("I do not know where the models folder is. Start this from the app's folder (the Get word builder file).")
        return 2
    root = Path(a.models)
    if is_complete(root):
        print("The word builder is already here. Nothing was downloaded.")
        return 0
    mb = total_bytes() / 1_000_000
    print(f"This downloads the word-building model once: about {mb:.0f} MB, from {md.HOST}. It is separate from the listening model.")
    print("Every file is checked before it is kept; if anything is wrong, nothing is kept. Nothing else is downloaded or installed.")
    if not a.yes:
        if input("Type YES and press Enter to download, or just press Enter to stop: ").strip() != "YES":
            print("Stopped. Nothing was downloaded.")
            return 1
    last = [-1]

    def progress(done, total, name):
        pct = int(done * 100 / total)
        if pct // 10 != last[0] // 10 or done == total:
            last[0] = pct
            print(f"  {pct}%  ({done // (1 << 20)} of {total // (1 << 20)} MB)  {name}", flush=True)

    try:
        d = download(root, progress=progress)
    except md.ModelRefused as e:
        print("REFUSED: " + str(e))
        return 1
    except md.Cancelled:
        print("Stopped. Nothing was kept.")
        return 1
    print(f"Done. The word builder is ready: {d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
