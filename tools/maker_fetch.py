"""DOWNLOAD PLANS FROM YOUR AI (NEXT-CONNECT 152; design: proposals/CONNECT-LOCAL-DATA-DESIGN.md section 2). Standard library only.

The person's own AI may WRITE DOWN a download plan at the Ryagram site (an address, a reason, the NAME of a data folder). This module lets the desktop app read those plans, show each one for the person to
APPROVE (the site, the file, the size, the free space, Official or 'not checked'), and only then fetch the file straight from the publisher to a data folder the person chose, unpack it safely and write a receipt.

THIS IS THE ONLY PLACE IN THE APP THAT OPENS A NETWORK CONNECTION FOR DATA (one create_connection, below), as the model download is for models. The engine's builds stay offline.

WHAT IT NEVER DOES: start anything without the person's press; follow an address the page or the AI did not show; fetch from http, from an address with a user name or password, from an address that is a bare IP number, or
from any host that resolves to a loopback, private, link-local, reserved or multicast address (a download plan must not become a way to reach the person's router or a local service); keep a file whose first bytes are
a program or a web page; unpack a name with .. or a drive or a link; run, open or index anything it fetched; send the file, its name or its path to the site (the site learns only the state, the host, the size, the SHA-256
and the member count); write outside the data folder."""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import stat
import threading
import time
import zipfile
import zlib
from datetime import datetime, timezone
from http.client import HTTPSConnection
from pathlib import Path
from urllib.parse import urlsplit, urljoin

ROUTE = "/node/download-plans"
UPDATE_ROUTE = "/node/download-update"
MIN_GAP_SECONDS = 30
MAX_PLANS = 5                            # at most this many plans wait at once
MAX_REDIRECTS = 5
CONNECT_TIMEOUT = 15
READ_TIMEOUT = 60
CHUNK = 1 << 20
DEFAULT_FOLDER_CAP = 200 * (1 << 30)     # the data folder may hold this much (the person can change it)
SMALL_FILE = 64 * (1 << 20)
FREE_FLOOR = 0.15                        # never leave the drive with less than this share free
MAX_ENTRIES = 10_000
MAX_ENTRY_BYTES = 50 * (1 << 30)
MAX_RATIO = 200                          # unpacked bytes per packed byte (a zip bomb is far above it)
MAX_NAME = 160
DATA_EXTS = {"csv", "tsv", "txt", "json", "geojson", "parquet", "xlsx", "ods", "xml", "dbf", "shp", "shx", "prj", "cpg", "md", "gz", "zip"}
PROGRAM_EXTS = {"exe", "dll", "bat", "cmd", "com", "msi", "scr", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "lnk", "jar", "py", "sh", "reg", "hta", "cpl", "pif", "appx", "msix", "apk", "dmg", "app", "iso"}
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
# Official hosts: a small written-in list until the site's fetch_hosts table is used here (the site, not the AI, decides the label there)
OFFICIAL_SUFFIXES = (".gov", ".mil", ".gov.uk", ".gc.ca", ".gov.au", ".europa.eu", ".un.org", ".worldbank.org", ".who.int", ".oecd.org", ".imf.org", ".nasa.gov", ".noaa.gov")
_TAGS = re.compile(r"[<>]")
_PATHISH = re.compile(r"([A-Za-z]:[\\/])|(^|\s)/(Users|home|mnt|var|etc)/|\\\\|file://", re.IGNORECASE)
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


class FetchError(Exception):
    """A plain sentence for the person."""


# --------------------------------------------------------------------------------------------------------- 1. the address
def _text(v, limit: int) -> str:
    if not isinstance(v, str):
        return ""
    return _TAGS.sub("", re.sub(r"[\x00-\x1f\x7f]+", " ", v)).strip()[:limit]


def bad_address(ip: str) -> str | None:
    """None when this IP number is a public one, else the plain reason. IPv4-mapped IPv6 is read as its IPv4."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return "not an address"
    if isinstance(a, ipaddress.IPv6Address) and a.ipv4_mapped:
        a = a.ipv4_mapped
    if a.is_loopback:
        return "this computer"
    if a.is_private or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified or not a.is_global:
        return "a private or reserved network"
    return None


def check_url(url: str) -> tuple:
    """(host, port, path_and_query) of an address the app may contact, or a FetchError. https only; no user name; no bare IP number; the default port only."""
    if not isinstance(url, str) or len(url) > 2000 or re.search(r"[\x00-\x20\x7f]", url):
        raise FetchError("That address is not one the program can use.")
    p = urlsplit(url)
    if p.scheme != "https":
        raise FetchError("Only https addresses are fetched. This one is not.")
    if p.username or p.password or "@" in (p.netloc or ""):
        raise FetchError("An address with a user name or password in it is not fetched.")
    host = (p.hostname or "").lower().rstrip(".")
    if not host or "." not in host:
        raise FetchError("That address has no website name the program can use.")
    try:
        ipaddress.ip_address(host)
        raise FetchError("An address that is a number, not a website name, is not fetched.")
    except ValueError:
        pass
    if p.port not in (None, 443):
        raise FetchError("Only the standard secure port is used.")
    return host, 443, (p.path or "/") + (("?" + p.query) if p.query else "")


def registered_domain(host: str) -> str:
    """The last two parts of a host name (the last three under a known two-part ending), so a look-alike host stands out on the approve screen. A guess for display only; nothing is decided from it."""
    parts = host.split(".")
    two = {"co.uk", "gov.uk", "com.au", "gov.au", "gc.ca", "org.uk", "ac.uk"}
    n = 3 if len(parts) >= 3 and ".".join(parts[-2:]) in two else 2
    return ".".join(parts[-n:])


def trust_label(host: str) -> str:
    return "official" if any(host == s[1:] or host.endswith(s) for s in OFFICIAL_SUFFIXES) else "unchecked"


def host_display(host: str) -> dict:
    """The host for the approve screen: as written, and with its punycode decoded when it has any (a look-alike made of other alphabets is visible)."""
    shown = host
    try:
        shown = host.encode("ascii").decode("idna")
    except (UnicodeError, ValueError):
        pass
    return {"host": host, "shown": shown, "domain": registered_domain(host), "punycode": "xn--" in host}


# --------------------------------------------------------------------------------------------------------- 2. the one network place
class _Pinned(HTTPSConnection):
    """An https connection to a given IP NUMBER with the host name used for the certificate check, so the address that was checked is the address that is reached (no second lookup to trick)."""

    def __init__(self, host: str, ip: str, **kw):
        super().__init__(host, 443, **kw)
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, 443), self.timeout)               # THE ONE place in the app that opens a data connection
        ctx = ssl.create_default_context()
        self.sock = ctx.wrap_socket(sock, server_hostname=self.host)


def real_resolver(host: str) -> list:
    return sorted({i[4][0] for i in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})


def real_transport(host: str, ip: str, path: str, method: str, headers: dict):
    """(status, headers dict, body reader or None). The caller closes the reader."""
    c = _Pinned(host, ip, timeout=READ_TIMEOUT)
    c.request(method, path, headers=dict(headers, **{"User-Agent": "Ryagram-desktop-data/1", "Accept-Encoding": "identity"}))
    r = c.getresponse()
    hdrs = {k.lower(): v for k, v in r.getheaders()}

    class _Body:
        def read(self, n):
            return r.read(n)

        def close(self):
            c.close()
    return r.status, hdrs, _Body()


def _resolve_checked(host: str, resolver) -> str:
    """The first address of the host, after every address it resolves to was checked: ONE bad address refuses the host."""
    try:
        ips = list(resolver(host))
    except OSError:
        raise FetchError(f"The website name {host} could not be found.") from None
    if not ips:
        raise FetchError(f"The website name {host} could not be found.")
    for ip in ips:
        why = bad_address(ip)
        if why:
            raise FetchError(f"{host} points to {why}, so the program will not fetch from it.")
    return ips[0]


# --------------------------------------------------------------------------------------------------------- 3. looking at a file, and keeping it
def sniff(head: bytes) -> str:
    """What a file's first bytes say it is: zip, gzip, parquet, program, web, text, or other. The name is never trusted."""
    if head[:4] == b"PK\x03\x04" or head[:4] == b"PK\x05\x06":
        return "zip"
    if head[:2] == b"\x1f\x8b":
        return "gzip"
    if head[:4] == b"PAR1":
        return "parquet"
    if head[:2] == b"MZ" or head[:4] == b"\x7fELF" or head[:4] in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe") or head[:2] == b"#!":
        return "program"
    low = head[:2048].lstrip().lower()
    if low.startswith((b"<!doctype html", b"<html", b"<head", b"<body")) or b"<script" in low[:600]:
        return "web"
    if b"\x00" in head[:65536]:
        return "other"
    try:
        head[:65536].decode("utf-8")
    except UnicodeDecodeError:
        try:
            head[:65536].decode("cp1252")
        except UnicodeDecodeError:
            return "other"
    return "text"


EXT_FOR = {"zip": "zip", "gzip": "gz", "parquet": "parquet", "text": "csv"}


def safe_name(raw: str, kind: str) -> str:
    """A file name with no folder, no odd characters, no reserved Windows name, at most MAX_NAME long, with an extension that fits what the bytes are."""
    base = Path(str(raw).replace("\\", "/").split("/")[-1]).name
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" .") or "data"
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    ext = ext.lower()
    want = EXT_FOR.get(kind)
    if kind == "text" and ext in ("csv", "tsv", "txt", "json", "geojson", "xml", "md"):
        want = ext
    if kind == "zip" and ext in ("xlsx", "ods"):
        want = ext                                                     # an office sheet is a zip inside; it is kept as what it says it is
    if want is None:
        raise FetchError("That is not a data file the program keeps.")
    if stem.lower() in RESERVED:
        stem = "_" + stem
    return (stem[: MAX_NAME - 8] or "data") + "." + want


def free_ok(folder: Path, need: int, cap: int) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    u = shutil.disk_usage(folder)
    if need and (need > u.free or (need > SMALL_FILE and need > u.free - u.total * FREE_FLOOR)):                  # a small file only has to fit; a big one must leave the drive its floor
        raise FetchError(f"There is not enough room: the file is about {need / (1 << 30):.1f} GB and the drive would be left with too little free space.")
    used = sum(p.stat().st_size for p in folder.rglob("*") if p.is_file())
    if need and used + need > cap:
        raise FetchError(f"The data folder would go over its limit of {cap / (1 << 30):.0f} GB.")


class Fetcher:
    def __init__(self, resolver=real_resolver, transport=real_transport, clock=time.time):
        self.resolver, self.transport, self.clock = resolver, transport, clock

    def probe(self, url: str) -> dict:
        """What the approve screen shows about an address, from ONE head request (no file body): the host, the size if the site says, the name, the type the site claims."""
        host, _p, path = check_url(url)
        ip = _resolve_checked(host, self.resolver)
        st, h, body = self.transport(host, ip, path, "HEAD", {"Host": host})
        if body:
            body.close()
        if 300 <= st < 400 and h.get("location"):
            nxt = urljoin(url, h["location"])
            nh = check_url(nxt)[0]
            return dict(host_display(host), redirect_host=nh, label=trust_label(host), size=None, name=safe_label(path))
        if st != 200:
            raise FetchError(f"{host} answered {st}, not a file.")
        size = int(h["content-length"]) if str(h.get("content-length", "")).isdigit() else None
        return dict(host_display(host), label=trust_label(host), size=size, name=safe_label(path), claimed=_text(h.get("content-type", ""), 60))

    def download(self, url: str, folder: Path, *, max_bytes: int, folder_cap: int = DEFAULT_FOLDER_CAP, allow_hosts=None, progress=None, cancel: threading.Event | None = None) -> dict:
        """Fetch the file to FOLDER, following redirects only to allow_hosts (the approved host first). Returns {path, name, bytes, sha256, kind, host, final_host, redirects}. A part file is kept under .part and removed on any failure."""
        cancel = cancel or threading.Event()
        host0, _p, path = check_url(url)
        allowed = {host0, *(allow_hosts or ())}
        cur, redirects, final_host = url, 0, host0
        folder.mkdir(parents=True, exist_ok=True)
        part = folder / (".fetch-" + hashlib.sha256(url.encode()).hexdigest()[:12] + ".part")
        try:
            while True:
                host, _p, path = check_url(cur)
                if host not in allowed:
                    raise FetchError(f"The file moved to another website ({host}) that you did not approve.")
                ip = _resolve_checked(host, self.resolver)
                have = part.stat().st_size if part.exists() else 0
                hdr = {"Host": host}
                if have:
                    hdr["Range"] = f"bytes={have}-"
                st, h, body = self.transport(host, ip, path, "GET", hdr)
                if 300 <= st < 400 and h.get("location"):
                    if body:
                        body.close()
                    redirects += 1
                    if redirects > MAX_REDIRECTS:
                        raise FetchError("The address sent the program round too many times.")
                    cur = urljoin(cur, h["location"])
                    continue
                final_host = host
                break
            if st not in (200, 206):
                if body:
                    body.close()
                raise FetchError(f"{host} answered {st}, not a file.")
            if st == 200 and have:
                part.unlink()                                                      # the site ignored the resume request: start again
                have = 0
            total = None
            if str(h.get("content-length", "")).isdigit():
                total = int(h["content-length"]) + have
            if total is not None and total > max_bytes:
                body.close()
                raise FetchError(f"The file is {total / (1 << 30):.2f} GB, more than the {max_bytes / (1 << 30):.2f} GB you approved. Nothing was kept.")
            free_ok(folder, (total or max_bytes) - have, folder_cap)
            sha = hashlib.sha256()
            if have:
                with open(part, "rb") as f:
                    for blk in iter(lambda: f.read(CHUNK), b""):
                        sha.update(blk)
            written, head = have, b""
            try:
                with open(part, "ab") as f:
                    while True:
                        if cancel.is_set():
                            raise FetchError("Cancelled. Nothing was kept.")
                        blk = body.read(CHUNK)
                        if not blk:
                            break
                        written += len(blk)
                        if written > max_bytes:
                            raise FetchError(f"The file is bigger than the {max_bytes / (1 << 30):.2f} GB you approved. Nothing was kept.")
                        if len(head) < 65536:
                            head += blk[: 65536 - len(head)]
                        f.write(blk)
                        sha.update(blk)
                        if progress:
                            progress(written, total)
            finally:
                body.close()
            if total is not None and written != total:
                raise FetchError("The download stopped before the end. Try again; it can carry on from where it stopped.")
            if not head and have:
                with open(part, "rb") as f:
                    head = f.read(65536)
            kind = sniff(head)
            if kind == "program":
                raise FetchError("That file is a program, not data. It was deleted and never opened.")
            if kind == "web":
                raise FetchError("That address gave a web page, not a data file. Nothing was kept.")
            if kind == "other":
                raise FetchError("That is not a kind of data file the program keeps.")
            name = safe_name(path, kind)
            dest = folder / name
            n = 2
            while dest.exists():
                dest = folder / f"{Path(name).stem}-{n}{Path(name).suffix}"
                n += 1
            os.replace(part, dest)
            return {"path": dest, "name": dest.name, "bytes": written, "sha256": sha.hexdigest(), "kind": kind, "host": host0, "final_host": final_host, "redirects": redirects}
        except BaseException:
            if part.exists():
                try:
                    part.unlink()
                except OSError:
                    pass
            raise


def safe_label(path: str) -> str:
    return _text(Path(path.split("?")[0]).name, 80)


# --------------------------------------------------------------------------------------------------------- 4. unpacking
def safe_unzip(zpath: Path, dest_parent: Path, *, max_total: int = MAX_ENTRY_BYTES, max_entries: int = MAX_ENTRIES, max_ratio: int = MAX_RATIO) -> dict:
    """Unpack a zip into a NEW sub-folder of dest_parent. Refuses the whole archive (writing nothing) when any member is a program, a link, or named with .. / a drive / a leading slash / a reserved
    name; stops when the unpacked size runs past the caps (counted as it is written, never trusting the sizes the archive states). Returns {folder, members, skipped}."""
    zp = Path(zpath)
    packed = max(zp.stat().st_size, 1)
    try:
        z = zipfile.ZipFile(zp)
    except zipfile.BadZipFile:
        raise FetchError("That archive is damaged, so nothing was unpacked.") from None
    with z:
        infos = z.infolist()
        if len(infos) > max_entries:
            raise FetchError(f"That archive holds {len(infos)} files, more than the {max_entries} the program unpacks.")
        plan = []
        seen = set()
        for i in infos:
            raw = i.filename
            if i.is_dir():
                continue
            name = raw.replace("\\", "/")
            parts = name.split("/")
            if name.startswith("/") or ".." in parts or any(p == "" for p in parts[:-1]) or ":" in name or "\x00" in name:         # a colon also catches a drive name (C:/x)
                raise FetchError("That archive has a file name that tries to leave its folder, so nothing was unpacked.")
            if (i.external_attr >> 16) & 0o170000 == stat.S_IFLNK:
                raise FetchError("That archive holds a link, so nothing was unpacked.")
            if any(p.lower().split(".")[0] in RESERVED for p in parts):
                raise FetchError("That archive uses a name Windows reserves, so nothing was unpacked.")
            ext = parts[-1].rpartition(".")[2].lower() if "." in parts[-1] else ""
            if ext in PROGRAM_EXTS:
                raise FetchError("That archive holds a program file, so nothing was unpacked.")
            if len(name) > 200:
                raise FetchError("That archive has a file name that is too long.")
            key = name.lower()
            if key in seen:
                raise FetchError("That archive holds two files with the same name.")
            seen.add(key)
            plan.append((i, name, ext))
        total_decl = sum(i.file_size for i, _n, _e in plan)
        if total_decl > max_total or total_decl > packed * max_ratio:
            raise FetchError("That archive would unpack to far more than it looks (a zip bomb, or simply too big), so nothing was unpacked.")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out = dest_parent / f"{safe_name(zp.stem, 'zip').rpartition('.')[0] or 'archive'}-{stamp}"
        n = 2
        while out.exists():
            out = dest_parent / f"{safe_name(zp.stem, 'zip').rpartition('.')[0] or 'archive'}-{stamp}-{n}"
            n += 1
        members, skipped, running = [], [], 0
        out.mkdir(parents=True)
        try:
            for i, name, ext in plan:
                if ext not in DATA_EXTS and ext != "":
                    skipped.append(name)
                    continue
                target = out / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(i) as src, open(target, "wb") as dst:
                    got = 0
                    for blk in iter(lambda: src.read(CHUNK), b""):
                        got += len(blk)
                        running += len(blk)
                        if got > MAX_ENTRY_BYTES or running > max_total or running > packed * max_ratio:
                            raise FetchError("That archive unpacked to far more than it said, so it was stopped and removed.")
                        dst.write(blk)
                members.append({"name": name, "bytes": got})
        except BaseException:
            shutil.rmtree(out, ignore_errors=True)
            raise
    return {"folder": out, "members": members, "skipped": skipped}


def gunzip(gpath: Path, dest_parent: Path, *, max_total: int = MAX_ENTRY_BYTES, max_ratio: int = MAX_RATIO) -> dict:
    import gzip
    gp = Path(gpath)
    packed = max(gp.stat().st_size, 1)
    stem = gp.name[:-3] if gp.name.lower().endswith(".gz") else gp.name
    dest_parent.mkdir(parents=True, exist_ok=True)
    dest = dest_parent / safe_name(stem, "text") if "." in stem else dest_parent / (safe_name(stem + ".csv", "text"))
    n = 2
    while dest.exists():
        dest = dest_parent / f"{dest.stem}-{n}{dest.suffix}"
        n += 1
    got = 0
    try:
        with gzip.open(gp, "rb") as src, open(dest, "wb") as dst:
            for blk in iter(lambda: src.read(CHUNK), b""):
                got += len(blk)
                if got > max_total or got > packed * max_ratio:
                    raise FetchError("That file unpacked to far more than it said, so it was stopped and removed.")
                dst.write(blk)
    except (gzip.BadGzipFile, EOFError, zlib.error):
        dest.unlink(missing_ok=True)
        raise FetchError("That compressed file is damaged.") from None
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return {"folder": dest.parent, "members": [{"name": dest.name, "bytes": got}], "skipped": []}


# --------------------------------------------------------------------------------------------------------- 5. the receipt
def receipt(plan: dict, got: dict, unpacked: dict | None, *, now=None) -> dict:
    """What happened, in plain words. The PUBLIC part (what the site may learn: state, host, size, SHA-256, member count) has no path and no file name; the LOCAL part is kept in the data folder only."""
    when = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    members = (unpacked or {}).get("members") or []
    pub = {"schema": "ryagram.download-receipt/0", "address_host": got["host"], "final_host": got["final_host"], "retrieved": when, "bytes": got["bytes"], "sha256": got["sha256"], "kind": got["kind"],
           "members": len(members), "licence": plan.get("licence") or "not stated", "trust_label": plan.get("label") or "unchecked", "why": _text(plan.get("why"), 300),
           "steps": ["downloaded", "checked the first bytes (not a program, not a web page)"] + (["unpacked safely"] if unpacked else []) + ["the raw file stays on this computer"]}
    local = dict(pub, address=_text(plan.get("url"), 600), file=got["name"], members_list=[m["name"] for m in members], skipped=(unpacked or {}).get("skipped") or [])
    return {"public": pub, "local": local}


def receipt_text(r: dict) -> str:
    L = r["local"]
    lines = [f"Downloaded {L['retrieved']} from {L['final_host']}", f"Address: {L['address']}", f"File: {L['file']} ({L['bytes']:,} bytes)", f"SHA-256: {L['sha256']}", f"Licence: {L['licence']}",
             f"Source label: {'official host' if L['trust_label'] == 'official' else 'not checked by Ryagram'}"]
    if L["members_list"]:
        lines.append(f"Unpacked {len(L['members_list'])} file(s): " + ", ".join(L["members_list"][:30]) + (" ..." if len(L["members_list"]) > 30 else ""))
    if L["skipped"]:
        lines.append("Not unpacked (not a data type): " + ", ".join(L["skipped"][:30]))
    lines.append("Why: " + (L["why"] or "(no reason given)"))
    lines.append("This file stays on this computer. Ryagram's cloud keeps no copy of it.")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------------------------------------- 6. the plans (read from the site, approved here)
def clean_plan(row) -> dict | None:
    """One plan as the page shows it: only plain, cut-down text, an https address, and a folder NAME (never a path). Anything else is dropped."""
    if not isinstance(row, dict) or not isinstance(row.get("request"), dict):
        return None
    pid = row.get("id")
    if not (isinstance(pid, str) and _UUID.match(pid)):
        return None
    req = row["request"]
    url = req.get("url")
    try:
        host, _p, path = check_url(url)
    except FetchError:
        return None
    why = _text(req.get("why"), 300)
    folder = _text(req.get("folder"), 60)
    if _PATHISH.search(why) or not re.match(r"^[A-Za-z0-9 ._-]{0,60}$", folder or ""):
        return None
    return {"id": pid, "url": url, "why": why, "folder": folder, "licence": _text(req.get("licence"), 200), **host_display(host), "label": trust_label(host)}


class DownloadPlans:
    """The plans waiting at the site for THIS computer, their state here, and the work. A plan does nothing until approve() is called for it."""

    def __init__(self, signin, *, fetcher: Fetcher | None = None, data_dir=None, clock=time.time, runner=None):
        self.signin, self.fetcher, self.clock = signin, fetcher or Fetcher(), clock
        self.data_dir = Path(data_dir) if data_dir else None
        self._lock = threading.Lock()
        self._last = 0.0
        self.plans: dict = {}
        self.message = ""
        self._cancel: dict = {}
        self._run = runner or self._thread

    @staticmethod
    def _thread(fn):
        threading.Thread(target=fn, daemon=True).start()

    def set_folder(self, path: Path) -> None:
        self.data_dir = Path(path)

    def refresh(self, force: bool = False) -> dict:
        try:
            signed_in = self.signin.status().get("state") == "signed_in"
        except Exception:  # noqa: BLE001
            signed_in = False
        if not signed_in:
            return {"on": False}
        with self._lock:
            if force or self._last == 0.0 or self.clock() - self._last >= MIN_GAP_SECONDS:
                self._last = self.clock()
                self._read()
            return self.view()

    def _read(self) -> None:
        try:
            status, obj = self.signin.api("POST", ROUTE, {})
        except Exception as e:  # noqa: BLE001
            self.message = _text(str(e), 200) or "Could not read what your AI asked for just now."
            return
        if status != 200 or not isinstance(obj, dict) or not isinstance(obj.get("plans"), list):
            self.message = "Could not read what your AI asked for just now."
            return
        self.message = ""
        for row in obj["plans"][:MAX_PLANS]:
            p = clean_plan(row)
            if p and p["id"] not in self.plans:
                self.plans[p["id"]] = dict(p, state="waiting", size=None, progress=0, note="")

    def view(self) -> dict:
        return {"on": True, "message": self.message, "folder_set": self.data_dir is not None, "plans": [self._public(p) for p in self.plans.values()]}

    @staticmethod
    def _public(p: dict) -> dict:
        return {k: p.get(k) for k in ("id", "why", "folder", "host", "shown", "domain", "punycode", "label", "state", "size", "progress", "note", "name")}

    def look(self, pid: str) -> dict:
        """'How big is it?': one head request, only when the person asks for the card to show it (and for every card, at the moment it is shown)."""
        p = self._get(pid)
        try:
            info = self.fetcher.probe(p["url"])
        except FetchError as e:
            p["note"] = str(e)
            return self._public(p)
        p["size"], p["name"] = info.get("size"), info.get("name")
        if info.get("redirect_host"):
            p["note"] = f"This address sends you on to {info['redirect_host']}. You will be asked again for that website."
        return self._public(p)

    def _get(self, pid: str) -> dict:
        if pid not in self.plans:
            raise FetchError("That plan is not here any more.")
        return self.plans[pid]

    def decline(self, pid: str) -> dict:
        p = self._get(pid)
        if p["state"] in ("waiting",):
            p["state"] = "declined"
            self._tell(p, "declined")
        return self._public(p)

    def cancel(self, pid: str) -> dict:
        ev = self._cancel.get(pid)
        if ev:
            ev.set()
        return self._public(self._get(pid))

    def approve(self, pid: str, *, use_anyway: bool = False, max_bytes: int | None = None, extra_hosts=()) -> dict:
        """The person pressed Download. A website the program has not checked needs the separate 'use it anyway' press. Starts the work in the background."""
        p = self._get(pid)
        if p["state"] != "waiting":
            raise FetchError("That plan has already been dealt with.")
        if self.data_dir is None:
            raise FetchError("Choose the folder for your data first.")
        if p["label"] != "official" and not use_anyway:
            raise FetchError("The program has not checked this website. Press Use it anyway if you trust it.")
        limit = max_bytes if max_bytes is not None else (p.get("size") or 0)
        if not limit:
            raise FetchError("The size of this file is not known yet. Press Look up the size first, so you know what you are approving.")
        p["state"] = "downloading"
        ev = self._cancel[pid] = threading.Event()
        self._tell(p, "downloading")
        self._run(lambda: self._work(p, int(limit), tuple(extra_hosts), ev))
        return self._public(p)

    def _work(self, p: dict, limit: int, extra_hosts, ev) -> None:
        try:
            folder = self.data_dir / (p["folder"] or "Ryagram data")
            got = self.fetcher.download(p["url"], folder, max_bytes=limit, allow_hosts=extra_hosts, cancel=ev, progress=lambda a, b: p.__setitem__("progress", int(100 * a / b) if b else 0))
            unpacked = None
            if got["kind"] == "zip" and got["name"].lower().endswith(".zip"):
                p["state"] = "unpacking"
                unpacked = safe_unzip(got["path"], folder)
            elif got["kind"] == "gzip":
                p["state"] = "unpacking"
                unpacked = gunzip(got["path"], folder)
            r = receipt(p, got, unpacked)
            rdir = (unpacked["folder"] if unpacked and unpacked["folder"] != folder else folder)
            (rdir / f"{Path(got['name']).stem}.RECEIPT.json").write_text(json.dumps(r["local"], indent=1, ensure_ascii=False), encoding="utf-8")
            (rdir / f"{Path(got['name']).stem}.RECEIPT.txt").write_text(receipt_text(r), encoding="utf-8")
            p["state"], p["note"], p["progress"] = "done", "Saved in your data folder, with a receipt. The film table is the next step.", 100
            self._tell(p, "done", r["public"])
        except FetchError as e:
            p["state"], p["note"] = ("cancelled" if ev.is_set() else "refused"), str(e)
            self._tell(p, p["state"])
        except OSError as e:
            p["state"], p["note"] = "refused", "The file could not be written: " + _text(str(e), 120)
            self._tell(p, "refused")

    def _tell(self, p: dict, state: str, public: dict | None = None) -> None:
        """Best effort: the site learns the STATE, never a path or a file name."""
        try:
            self.signin.api("POST", UPDATE_ROUTE, {"id": p["id"], "state": state, "receipt": public})
        except Exception:  # noqa: BLE001
            pass
