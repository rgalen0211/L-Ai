"""The one place the desktop maker fetches a listening model (NEXT-CONNECT 106; the rules are CC1's, 2026-10-20 17:15). Standard library only.

WHAT IT DOES: downloads the four files of one speech model into the folder the maker already reads (RYAGRAM_MODEL_DIR), in the layout the engine looks for
(models--Systran--faster-whisper-<size>/snapshots/<revision>/ with refs/main), and checks every file against a SIZE and a SHA-256 written into THIS FILE.
THE RULES, each one a check in tools/check-model-download.py:
  * One written-in host (HOST) and one written-in path shape: https://HOST/<repo>/resolve/<revision>/<file>. The repo, the revision and the file names come from PINS
    below, never from the page, a recipe, a server reply or a file on disk.
  * A redirect is followed only to https, port 443, no user name, on a host that is HOST or one of that host's own content domains (REDIRECT_DOMAINS), at most 5 hops.
    Anything else is refused and nothing is kept.
  * Each file must announce its size (Content-Length) and that size must be the pinned one; no more bytes than the pinned size are ever read; after the last byte the
    SHA-256 must equal the pinned one. A file that differs is deleted with everything else of that model, and the model is refused.
  * Nothing is written into the models folder until every file has passed: the files are staged in a hidden folder next to it and moved in at the end.
  * Nothing downloaded is ever run, imported or unpacked: the four files are data (weights, settings, a word list). No archive is opened, no name from the network is used
    as a file name, no cookie or login is sent.
  * Cancel at any moment leaves nothing behind. A model that is already complete (every file the pinned size) downloads nothing.
THE PINS: sizes and SHA-256 of the published files of Systran/faster-whisper-{tiny,base,small} at the revisions below. The tiny files were also compared with the
copy the engine had already downloaded on this PC (all four equal). The big model.bin of base and small are the host's published LFS hashes and are confirmed by the first real download.
"""
import hashlib
import http.client
import os
import re
import shutil
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlsplit

HOST = "huggingface.co"
REDIRECT_DOMAINS = ("huggingface.co", "hf.co")      # the host's own content domains (a download is answered from there); subdomains of these only
MAX_HOPS = 5
CHUNK = 1 << 20
TIMEOUT_S = 30
FOLDER = "models--Systran--faster-whisper-{size}"
NAME_OK = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

PINS = {
    "tiny": {"repo": "Systran/faster-whisper-tiny", "revision": "d90ca5fe260221311c53c58e660288d3deb8d356", "files": (
        ("config.json", 2249, "a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8"),
        ("model.bin", 75538270, "dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1"),
        ("tokenizer.json", 2203239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
        ("vocabulary.txt", 459861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
    )},
    "base": {"repo": "Systran/faster-whisper-base", "revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66", "files": (
        ("config.json", 2309, "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a"),
        ("model.bin", 145217532, "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9"),
        ("tokenizer.json", 2203239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
        ("vocabulary.txt", 459861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
    )},
    "small": {"repo": "Systran/faster-whisper-small", "revision": "536b0662742c02347bc0e980a01041f333bce120", "files": (
        ("config.json", 2370, "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
        ("model.bin", 483546902, "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
        ("tokenizer.json", 2203239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
        ("vocabulary.txt", 459861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
    )},
}


class ModelRefused(Exception):
    """Plain words for the person; nothing of the model is kept."""


class Cancelled(Exception):
    pass


class Net:
    """Where the downloads go. The app uses the defaults; only the checks pass another one (a local test server)."""

    def __init__(self, scheme="https", host=HOST, domains=REDIRECT_DOMAINS, port=None, opener=None):
        self.scheme, self.host, self.domains, self.port, self.opener = scheme, host, tuple(domains), port, opener


def model_info(model: str) -> dict:
    p = PINS.get(model)
    if not p:
        raise ModelRefused("This listening setting cannot be downloaded from here.")
    return {"size": model, "repo": p["repo"], "revision": p["revision"], "files": [{"name": n, "bytes": b, "sha256": h} for n, b, h in p["files"]],
            "total_bytes": sum(b for _n, b, _h in p["files"])}


def final_dir(root: Path, model: str) -> Path:
    return Path(root) / FOLDER.format(size=model) / "snapshots" / PINS[model]["revision"]


def is_complete(root, model: str) -> bool:
    """Every pinned file is there at its pinned size (the cheap check; the hash was checked when it was downloaded)."""
    if model not in PINS:
        return False
    d = final_dir(Path(root), model)
    return all((d / n).is_file() and (d / n).stat().st_size == b for n, b, _h in PINS[model]["files"])


def host_allowed(host: str, net: Net) -> bool:
    host = (host or "").lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in ((net.host,) + net.domains))


def check_hop(url: str, net: Net) -> None:
    u = urlsplit(url)
    if u.scheme != net.scheme:
        raise ModelRefused("The download server tried to send the computer somewhere that is not allowed. Nothing was kept.")
    if u.username or u.password or not host_allowed(u.hostname, net):
        raise ModelRefused("The download server tried to send the computer to a place that is not on the allowed list. Nothing was kept.")
    default_port = 443 if net.scheme == "https" else 80
    if (u.port or default_port) != (net.port or default_port):
        raise ModelRefused("The download server tried to send the computer to a place that is not allowed. Nothing was kept.")


class _Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_HOPS

    def __init__(self, net: Net):
        self.net = net

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_hop(urljoin(req.full_url, newurl), self.net)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener(net: Net):
    if net.opener is not None:
        return net.opener
    # No proxy variables, no cookies, no stored logins: a plain opener with the default certificate checks.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _Redirects(net), urllib.request.HTTPSHandler(context=ssl.create_default_context()))


def file_url(model: str, name: str, net: Net) -> str:
    p = PINS[model]
    port = f":{net.port}" if net.port else ""
    return f"{net.scheme}://{net.host}{port}/{p['repo']}/resolve/{p['revision']}/{name}"


def free_bytes_needed(model: str) -> int:
    return int(model_info(model)["total_bytes"] * 1.1) + 100 * (1 << 20)


def download(model: str, root, progress=None, cancel=None, net: Net = None) -> Path:
    """Fetch and verify one model. progress(done_bytes, total_bytes, file_name) is called as bytes arrive; cancel is an object with is_set(). Returns the folder of the files.
    Raises ModelRefused (plain words) or Cancelled; in both cases nothing of this model is left in the models folder."""
    net = net or Net()
    info = model_info(model)
    root = Path(root)
    if is_complete(root, model):
        return final_dir(root, model)
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < free_bytes_needed(model):
        raise ModelRefused(f"There is not enough free space for this download (it needs about {free_bytes_needed(model) // (1 << 20)} MB free in the folder {root}).")
    stage = root / f".downloading-{model}"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir()
    done, total = 0, info["total_bytes"]
    try:
        op = _opener(net)
        for f in info["files"]:
            if not NAME_OK.match(f["name"]):
                raise ModelRefused("A file name in the download list is not allowed.")
            url = file_url(model, f["name"], net)
            check_hop(url, net)
            req = urllib.request.Request(url, headers={"User-Agent": "Ryagram-maker", "Accept-Encoding": "identity"})
            try:
                resp = op.open(req, timeout=TIMEOUT_S)
            except urllib.error.HTTPError as e:
                raise ModelRefused(f"The download server answered {e.code} for {f['name']}. Nothing was kept.") from None
            except (urllib.error.URLError, OSError, http.client.HTTPException):
                raise ModelRefused("The download could not reach the server. Check the internet and try again. Nothing was kept.") from None
            with resp:
                check_hop(resp.geturl(), net)
                if getattr(resp, "status", 200) != 200:
                    raise ModelRefused(f"The download server answered {resp.status} for {f['name']}. Nothing was kept.")
                try:
                    announced = int(resp.headers.get("Content-Length", ""))
                except ValueError:
                    announced = -1
                if announced != f["bytes"]:
                    raise ModelRefused(f"{f['name']} is not the size it should be, so it was refused. Nothing was kept.")
                h, got = hashlib.sha256(), 0
                with open(stage / f["name"], "wb") as out:
                    while True:
                        if cancel is not None and cancel.is_set():
                            raise Cancelled()
                        try:
                            chunk = resp.read(min(CHUNK, f["bytes"] - got + 1))
                        except (OSError, http.client.HTTPException):
                            raise ModelRefused("The download was interrupted. Check the internet and try again. Nothing was kept.") from None
                        if not chunk:
                            break
                        got += len(chunk)
                        if got > f["bytes"]:
                            raise ModelRefused(f"{f['name']} was longer than it should be, so it was refused. Nothing was kept.")
                        h.update(chunk)
                        out.write(chunk)
                        done += len(chunk)
                        if progress:
                            progress(done, total, f["name"])
                if got != f["bytes"]:
                    raise ModelRefused(f"{f['name']} ended early, so it was refused. Nothing was kept.")
                if h.hexdigest() != f["sha256"]:
                    raise ModelRefused(f"{f['name']} is not the file it should be (its check number is different), so it was deleted. Nothing was kept.")
        dest = final_dir(root, model)
        shutil.rmtree(dest, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(stage, dest)
        refs = dest.parent.parent / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_bytes(info["revision"].encode("ascii"))
        return dest
    finally:
        shutil.rmtree(stage, ignore_errors=True)
