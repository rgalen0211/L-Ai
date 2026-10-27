"""Download plans from your AI (NEXT-CONNECT 152): the strict fetch, the safe unzip, the receipt and the approve flow of tools/maker_fetch.py, with MUST-FAILs.

    py -I tools/check-maker-fetch.py <scratch base folder on D:>

Nothing touches the network: the resolver and the transport are stand-ins (a dict of sites). The real transport is checked only for what it must do (connect to the IP number that was checked, and name the host for the
certificate). Scratch is deleted at the end."""
import gzip
import hashlib
import io
import json
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import maker_fetch as MF  # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


def refused(fn):
    try:
        fn()
    except MF.FetchError as e:
        return str(e)
    return None


class Body:
    def __init__(self, data: bytes):
        self.b = io.BytesIO(data)

    def read(self, n):
        return self.b.read(n)

    def close(self):
        pass


class Net:
    """A few websites. SITES[(host, path)] = (status, headers, bytes). Remembers every request."""

    def __init__(self):
        self.sites, self.seen, self.dns = {}, [], {}

    def resolver(self, host):
        return self.dns.get(host, ["93.184.216.34"])

    def transport(self, host, ip, path, method, headers):
        self.seen.append((host, ip, path, method, dict(headers)))
        st, h, data = self.sites.get((host, path), (404, {}, b""))
        h = {k.lower(): v for k, v in h.items()}
        if method == "HEAD":
            return st, dict(h, **({"content-length": str(len(data))} if st == 200 else {})), None
        rng = headers.get("Range")
        if st == 200 and rng:
            start = int(re.match(r"bytes=(\d+)-", rng).group(1))
            return 206, dict(h, **{"content-length": str(len(data) - start)}), Body(data[start:])
        if st == 200 and "x-nolength" in h:
            h = {k: v for k, v in h.items() if k != "x-nolength"}
        elif st == 200:
            h = dict(h, **{"content-length": str(len(data))}) if "content-length" not in h else h
        return st, h, Body(data)


def make_zip(files: dict, extra=None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in files.items():
            z.writestr(n, d)
        for zi, d in (extra or []):
            z.writestr(zi, d)
    return buf.getvalue()


CSV = b"county,year,value\nAutauga AL,2019,5\nBaldwin AL,2019,7\n"
tmp = Path(tempfile.mkdtemp(prefix="fetch-", dir=sys.argv[1] if len(sys.argv) > 1 else None))
try:
    # ---- 1. the address
    ok_urls = ["https://www.census.gov/data/file.csv", "https://data.example.org/a/b.zip?x=1"]
    check(all(MF.check_url(u) for u in ok_urls), "an https address with a website name is accepted")
    bads = {"http": "http://www.census.gov/a.csv", "user": "https://user:pw@www.census.gov/a.csv", "at": "https://www.census.gov@evil.example/a.csv", "ip": "https://93.184.216.34/a.csv",
            "ip6": "https://[2606:4700::1111]/a.csv", "port": "https://www.census.gov:8443/a.csv", "no-dot": "https://localhost/a.csv", "file": "file:///C:/x.csv", "ftp": "ftp://x.org/a",
            "space": "https://www.census.gov/a b.csv", "ctl": "https://www.census.gov/a\x01.csv", "long": "https://x.org/" + "a" * 2100, "none": None}
    for k, u in bads.items():
        check(refused(lambda u=u: MF.check_url(u)) is not None, f"MUST-FAIL: an address that is not allowed is refused ({k})")
    for ip, why in (("127.0.0.1", "loopback"), ("10.1.2.3", "private"), ("192.168.1.1", "private"), ("172.16.0.5", "private"), ("169.254.169.254", "metadata/link-local"), ("100.64.0.1", "carrier NAT"),
                    ("::1", "v6 loopback"), ("fe80::1", "v6 link-local"), ("fd00::1", "v6 unique local"), ("::ffff:127.0.0.1", "v4-mapped loopback"), ("0.0.0.0", "unspecified"), ("224.0.0.1", "multicast")):
        check(MF.bad_address(ip) is not None, f"MUST-FAIL: {ip} ({why}) is not a public address")
    check(MF.bad_address("93.184.216.34") is None and MF.bad_address("2606:4700::1111") is None, "public addresses pass")
    net = Net()
    f = MF.Fetcher(net.resolver, net.transport)
    net.dns["www.rebind.example"] = ["93.184.216.34", "127.0.0.1"]
    net.sites[("www.rebind.example", "/a.csv")] = (200, {}, CSV)
    check("this computer" in (refused(lambda: f.probe("https://www.rebind.example/a.csv")) or "") and not net.seen, "MUST-FAIL: a host with ONE bad address among its answers is refused before any request")
    net.dns["internal.example.org"] = ["10.0.0.7"]
    check(refused(lambda: f.download("https://internal.example.org/a.csv", tmp / "d0", max_bytes=1 << 20)) is not None and not net.seen, "MUST-FAIL: a host that points at a private network is refused before any request")

    # ---- 2. the real transport reaches the IP that was checked
    seen = {}
    real_cc = socket.create_connection

    class FakeSock:
        def close(self):
            pass
    socket.create_connection = lambda addr, timeout=None, **k: (seen.setdefault("addr", addr), (_ for _ in ()).throw(OSError("stop")))[1]
    try:
        try:
            MF.real_transport("www.census.gov", "93.184.216.34", "/a.csv", "GET", {"Host": "www.census.gov"})
        except OSError:
            pass
    finally:
        socket.create_connection = real_cc
    check(seen.get("addr") == ("93.184.216.34", 443), "the real transport connects to the IP number that was checked, not to a second lookup")
    src = (HERE / "maker_fetch.py").read_text(encoding="utf-8")
    check(src.count("socket.create_connection(") == 1 and "urlopen" not in src and "requests" not in src.replace("requests ", ""), "the module opens a data connection in exactly one place")

    # ---- 3. a normal download
    net = Net()
    f = MF.Fetcher(net.resolver, net.transport)
    net.sites[("www.census.gov", "/data/counties.csv")] = (200, {}, CSV)
    d1 = tmp / "d1"
    got = f.download("https://www.census.gov/data/counties.csv", d1, max_bytes=1 << 20)
    check(got["path"].read_bytes() == CSV and got["sha256"] == hashlib.sha256(CSV).hexdigest() and got["bytes"] == len(CSV) and got["name"] == "counties.csv", "the file arrives intact, with its SHA-256")
    check(not list(d1.glob("*.part")) and net.seen[0][1] == "93.184.216.34", "no part file is left behind, and the request went to the checked address")
    pr = f.probe("https://www.census.gov/data/counties.csv")
    check(pr["size"] == len(CSV) and pr["label"] == "official" and pr["domain"] == "census.gov", "the approve screen's probe gives the size, the label and the registered domain from one HEAD request")
    check(net.seen[-1][3] == "HEAD", "the probe asks for the head only, never the body")

    # ---- 4. MUST-FAIL downloads
    net.sites[("www.census.gov", "/big.csv")] = (200, {"content-length": "5000000"}, b"x" * 10)
    e = refused(lambda: f.download("https://www.census.gov/big.csv", tmp / "d2", max_bytes=1 << 20))
    check(e is not None and "more than" in e and not list((tmp / "d2").glob("*")), "MUST-FAIL: a file bigger than the approved size is refused from its headers and nothing is kept")
    net.sites[("www.census.gov", "/liar.csv")] = (200, {"content-length": "100"}, b"a,b\n" * 5000)
    e = refused(lambda: f.download("https://www.census.gov/liar.csv", tmp / "d3", max_bytes=1000))
    check(e is not None and not list((tmp / "d3").glob("*")), "MUST-FAIL: a body bigger than the approved size is stopped while it arrives and the part file is deleted")
    net.sites[("www.census.gov", "/nolen.csv")] = (200, {"x-nolength": "1"}, b"a,b\n" * 5000)
    e = refused(lambda: f.download("https://www.census.gov/nolen.csv", tmp / "d3b", max_bytes=1000))
    check(e is not None and "bigger than" in e and not list((tmp / "d3b").glob("*")), "MUST-FAIL: a body with no declared length is stopped at the approved size and deleted")
    net.sites[("www.census.gov", "/short.csv")] = (200, {"content-length": "999"}, b"a,b\n")
    check(refused(lambda: f.download("https://www.census.gov/short.csv", tmp / "d4", max_bytes=1 << 20)) is not None and not list((tmp / "d4").glob("*")), "MUST-FAIL: a download that stops short is refused and removed")
    net.sites[("www.census.gov", "/prog.csv")] = (200, {}, b"MZ\x90\x00" + b"\x00" * 100)
    e = refused(lambda: f.download("https://www.census.gov/prog.csv", tmp / "d5", max_bytes=1 << 20))
    check(e is not None and "never opened" in e and not list((tmp / "d5").glob("*")), "MUST-FAIL: a program renamed .csv is refused and deleted")
    net.sites[("www.census.gov", "/script.csv")] = (200, {}, b"#!/bin/sh\nrm -rf /\n")
    check("never opened" in (refused(lambda: f.download("https://www.census.gov/script.csv", tmp / "d5b", max_bytes=1 << 20)) or ""), "MUST-FAIL: a script renamed .csv is refused")
    net.sites[("www.census.gov", "/page.csv")] = (200, {}, b"<!DOCTYPE html><html><body>Please log in</body></html>")
    check("web page" in (refused(lambda: f.download("https://www.census.gov/page.csv", tmp / "d6", max_bytes=1 << 20)) or ""), "MUST-FAIL: a web page where data was expected is refused")
    net.sites[("www.census.gov", "/bin.dat")] = (200, {}, bytes(range(256)) * 10)
    check("not a kind of data file" in (refused(lambda: f.download("https://www.census.gov/bin.dat", tmp / "d7", max_bytes=1 << 20)) or ""), "MUST-FAIL: bytes that are not text or a data format are refused")
    net.sites[("www.census.gov", "/gone")] = (404, {}, b"")
    check("404" in (refused(lambda: f.download("https://www.census.gov/gone", tmp / "d8", max_bytes=1 << 20)) or ""), "a missing file is said in words")

    # ---- 5. redirects
    net.sites[("www.census.gov", "/old")] = (302, {"Location": "https://www2.census.gov/new.csv"}, b"")
    net.sites[("www2.census.gov", "/new.csv")] = (200, {}, CSV)
    check(refused(lambda: f.download("https://www.census.gov/old", tmp / "d9", max_bytes=1 << 20)) is not None, "MUST-FAIL: a redirect to another host is refused unless that host was approved")
    got = f.download("https://www.census.gov/old", tmp / "d9", max_bytes=1 << 20, allow_hosts=("www2.census.gov",))
    check(got["redirects"] == 1 and got["final_host"] == "www2.census.gov", "an approved host may be redirected to")
    net.sites[("www.census.gov", "/tohttp")] = (302, {"Location": "http://www.census.gov/new.csv"}, b"")
    check(refused(lambda: f.download("https://www.census.gov/tohttp", tmp / "d10", max_bytes=1 << 20)) is not None, "MUST-FAIL: a redirect to http is refused")
    net.sites[("www.census.gov", "/toprivate")] = (302, {"Location": "https://router.example.org/admin"}, b"")
    net.dns["router.example.org"] = ["192.168.0.1"]
    check(refused(lambda: f.download("https://www.census.gov/toprivate", tmp / "d11", max_bytes=1 << 20, allow_hosts=("router.example.org",))) is not None, "MUST-FAIL: a redirect to a private address is refused even if the host name was approved")
    net.sites[("www.census.gov", "/loop")] = (302, {"Location": "https://www.census.gov/loop"}, b"")
    check("round too many" in (refused(lambda: f.download("https://www.census.gov/loop", tmp / "d12", max_bytes=1 << 20)) or ""), "MUST-FAIL: a redirect loop stops after five")

    # ---- 6. cancel and resume
    big = b"a,b\n" + b"1,2\n" * 600_000
    net.sites[("www.census.gov", "/long.csv")] = (200, {}, big)
    ev = threading.Event()

    def stop_soon(a, b):
        if a > 1 << 20:
            ev.set()
    e = refused(lambda: f.download("https://www.census.gov/long.csv", tmp / "d13", max_bytes=1 << 30, cancel=ev, progress=stop_soon))
    check(e is not None and "Cancelled" in e and not list((tmp / "d13").glob("*")), "Cancel stops the download and deletes the part file")
    part = tmp / "d14"
    part.mkdir()
    pf = part / (".fetch-" + hashlib.sha256(b"https://www.census.gov/long.csv").hexdigest()[:12] + ".part")
    pf.write_bytes(big[:100_000])
    got = f.download("https://www.census.gov/long.csv", part, max_bytes=1 << 30)
    check(got["path"].read_bytes() == big and got["sha256"] == hashlib.sha256(big).hexdigest() and any(s[4].get("Range") == "bytes=100000-" for s in net.seen), "a stopped download carries on from where it stopped (Range) and the SHA-256 covers the whole file")

    # ---- 7. names
    check(MF.safe_name("..\\..\\Windows\\evil.csv", "text") == "evil.csv", "a file name loses any folder it came with")
    check(MF.safe_name("con.csv", "text") == "_con.csv" and MF.safe_name("nul", "text").startswith("_nul"), "a reserved Windows name is changed")
    check(MF.safe_name("report", "zip") == "report.zip" and MF.safe_name("sheet.xlsx", "zip") == "sheet.xlsx", "the extension fits what the bytes are")
    check(len(MF.safe_name("a" * 400 + ".csv", "text")) <= 170, "a very long name is cut")

    # ---- 8. unzip
    z = make_zip({"data/counties.csv": CSV, "README.txt": b"hello", "map.shp": b"\x00\x01"})
    zp = tmp / "ok.zip"
    zp.write_bytes(z)
    out = MF.safe_unzip(zp, tmp / "u1")
    check((out["folder"] / "data" / "counties.csv").read_bytes() == CSV and len(out["members"]) == 3 and out["folder"].parent == tmp / "u1", "a normal archive unpacks into a NEW sub-folder")
    z2 = make_zip({"a.csv": CSV, "tool.dat": b"x", "notes.docx": b"y"})
    (tmp / "skip.zip").write_bytes(z2)
    out2 = MF.safe_unzip(tmp / "skip.zip", tmp / "u2")
    check(out2["skipped"] == ["tool.dat", "notes.docx"] and not (out2["folder"] / "tool.dat").exists(), "files that are not data types are not unpacked and are NAMED")
    for label, files, extra in (("a ../ name", {"../evil.csv": CSV}, None), ("a nested ../ name", {"a/../../evil.csv": CSV}, None), ("an absolute name", {"/etc/x.csv": CSV}, None), ("a drive name", {"C:/x.csv": CSV}, None),
                                ("a backslash escape", {"..\\evil.csv": CSV}, None), ("a program inside", {"a.csv": CSV, "setup.exe": b"MZ"}, None), ("a script inside", {"a.csv": CSV, "run.ps1": b"x"}, None),
                                ("a reserved name", {"aux.csv": CSV}, None), ("two files with one name", {"a.csv": CSV}, [("A.csv", CSV)])):
        p = tmp / f"bad-{re.sub('[^a-z]', '', label)}.zip"
        p.write_bytes(make_zip(files, extra))
        dest = tmp / ("ub-" + re.sub("[^a-z]", "", label))
        e = refused(lambda p=p, dest=dest: MF.safe_unzip(p, dest))
        check(e is not None and not (dest.exists() and any(dest.rglob("*"))) and not (tmp / "evil.csv").exists(), f"MUST-FAIL: an archive with {label} is refused and writes nothing")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zz:
        zi = zipfile.ZipInfo("link.csv")
        zi.external_attr = (0o120777 << 16)
        zz.writestr(zi, "../../etc/passwd")
    (tmp / "link.zip").write_bytes(buf.getvalue())
    check(refused(lambda: MF.safe_unzip(tmp / "link.zip", tmp / "ul")) is not None, "MUST-FAIL: an archive holding a symbolic link is refused")
    bomb = make_zip({"zeros.csv": b"0" * (60 * (1 << 20))})
    (tmp / "bomb.zip").write_bytes(bomb)
    e = refused(lambda: MF.safe_unzip(tmp / "bomb.zip", tmp / "ubomb", max_ratio=50))
    check(e is not None and not (tmp / "ubomb").exists() or not any((tmp / "ubomb").rglob("*")), "MUST-FAIL: a zip bomb (far more unpacked than packed) is refused")
    e = refused(lambda: MF.safe_unzip(zp, tmp / "ucap", max_total=10))
    check(e is not None and not any((tmp / "ucap").rglob("*")) if (tmp / "ucap").exists() else e is not None, "MUST-FAIL: an archive over the size cap is refused")
    e = refused(lambda: MF.safe_unzip(zp, tmp / "uent", max_entries=1))
    check(e is not None, "MUST-FAIL: an archive with too many files is refused")
    (tmp / "broken.zip").write_bytes(b"PK\x03\x04garbage")
    check(refused(lambda: MF.safe_unzip(tmp / "broken.zip", tmp / "ubr")) is not None, "MUST-FAIL: a damaged archive is refused in words")
    # a lie in the header about sizes: written bytes are counted, not trusted
    lie = tmp / "lie.zip"
    lie.write_bytes(make_zip({"a.csv": b"0" * (5 * (1 << 20))}))
    e = refused(lambda: MF.safe_unzip(lie, tmp / "ulie", max_total=1 << 20, max_ratio=10_000))
    check(e is not None, "an archive over the cap is stopped as it is written")
    (tmp / "z.gz").write_bytes(gzip.compress(CSV))
    g = MF.gunzip(tmp / "z.gz", tmp / "ug")
    check(g["members"][0]["bytes"] == len(CSV) and (tmp / "ug" / g["members"][0]["name"]).read_bytes() == CSV, "a gzip file unpacks to its one file")
    (tmp / "b.gz").write_bytes(gzip.compress(b"0" * (30 * (1 << 20))))
    check(refused(lambda: MF.gunzip(tmp / "b.gz", tmp / "ugb", max_ratio=50)) is not None, "MUST-FAIL: a gzip bomb is refused")

    # ---- 9. space
    check("not enough room" in (refused(lambda: MF.free_ok(tmp / "sp", 10 ** 18, MF.DEFAULT_FOLDER_CAP)) or ""), "MUST-FAIL: a file bigger than the free space is refused before it starts")
    (tmp / "cap").mkdir()
    (tmp / "cap" / "x.bin").write_bytes(b"0" * 1000)
    check("limit" in (refused(lambda: MF.free_ok(tmp / "cap", 1000, 1500)) or ""), "MUST-FAIL: a file that takes the data folder over its limit is refused")

    # ---- 10. the receipt
    p = {"id": "1" * 8 + "-1111-1111-1111-" + "1" * 12, "url": "https://www.census.gov/data/counties.csv", "why": "county table for your film", "label": "official", "licence": ""}
    g = {"host": "www.census.gov", "final_host": "www.census.gov", "bytes": len(CSV), "sha256": hashlib.sha256(CSV).hexdigest(), "kind": "text", "name": "counties.csv"}
    r = MF.receipt(p, g, None)
    blob = json.dumps(r["public"])
    check("counties.csv" not in blob and "data/" not in blob and str(tmp) not in blob and r["public"]["licence"] == "not stated" and r["public"]["sha256"] == g["sha256"], "the part the site may learn has no file name and no path, and says 'not stated' for a licence nobody gave")
    check("stays on this computer" in MF.receipt_text(r) and "official host" in MF.receipt_text(r) and "Autauga" not in MF.receipt_text(r), "the receipt says in words that the file stays here, and holds none of its rows")

    # ---- 11. plans from the site
    good = {"id": "aaaaaaaa-1111-2222-3333-444444444444", "request": {"url": "https://www.census.gov/a.csv", "why": "for the map", "folder": "Census"}}
    check(MF.clean_plan(good) and MF.clean_plan(good)["label"] == "official", "a plan with an https address and a folder name is read")
    for label, row in (("http", dict(good, request=dict(good["request"], url="http://www.census.gov/a.csv"))), ("a folder PATH", dict(good, request=dict(good["request"], folder="C:\\Users\\me"))),
                       ("a path in the reason", dict(good, request=dict(good["request"], why="save to C:\\Users\\me\\x"))), ("no id", {"request": good["request"]}), ("not an object", "x"), ("a bare IP", dict(good, request=dict(good["request"], url="https://1.2.3.4/a.csv")))):
        check(MF.clean_plan(row) is None, f"MUST-FAIL: a plan with {label} is dropped")
    v = MF.clean_plan(dict(good, request=dict(good["request"], why="<b>hi</b>\x00 there")))
    check("<" not in v["why"] and "\x00" not in v["why"], "markup and control characters are cut from the reason")

    # ---- 12. the approve flow
    class Sign:
        def __init__(self):
            self.posts = []
            self.plans = [good, dict(good, id="bbbbbbbb-1111-2222-3333-444444444444", request={"url": "https://data.example.org/b.csv", "why": "x", "folder": ""})]

        def status(self):
            return {"state": "signed_in"}

        def api(self, method, route, body):
            self.posts.append((route, body))
            return (200, {"plans": self.plans}) if route == MF.ROUTE else (200, {})
    net = Net()
    net.sites[("www.census.gov", "/a.csv")] = (200, {}, CSV)
    net.sites[("data.example.org", "/b.csv")] = (200, {}, CSV)
    sg = Sign()
    run_now = lambda fn: fn()
    dp = MF.DownloadPlans(sg, fetcher=MF.Fetcher(net.resolver, net.transport), runner=run_now)
    v = dp.refresh()
    check(v["on"] and len(v["plans"]) == 2 and all(p["state"] == "waiting" for p in v["plans"]) and not net.seen, "plans are read and wait; nothing is fetched and no website is contacted before the person acts")
    check("folder" in (refused(lambda: dp.approve(good["id"], max_bytes=1 << 20)) or "").lower(), "MUST-FAIL: Download without a data folder chosen is refused")
    dp.set_folder(tmp / "mydata")
    check("size" in (refused(lambda: dp.approve(good["id"])) or ""), "MUST-FAIL: approving without knowing the size is refused (look it up first)")
    dp.look(good["id"])
    check(dp.plans[good["id"]]["size"] == len(CSV), "'Look up the size' fills in the size")
    other = "bbbbbbbb-1111-2222-3333-444444444444"
    dp.look(other)
    check("not checked" in (refused(lambda: dp.approve(other)) or "") and dp.plans[other]["state"] == "waiting", "MUST-FAIL: a website that is not official needs the separate 'use it anyway' press")
    dp.approve(good["id"])
    p1 = dp.plans[good["id"]]
    check(p1["state"] == "done" and (tmp / "mydata" / "Census" / "a.csv").read_bytes() == CSV, "an approved official plan downloads into the person's folder")
    check(list((tmp / "mydata" / "Census").glob("a.RECEIPT.*")).__len__() == 2, "a receipt (json and text) is written beside the file")
    states = [b["state"] for r, b in sg.posts if r == MF.UPDATE_ROUTE and b["id"] == good["id"]]
    check(states == ["downloading", "done"], "the site is told the states, in order")
    posted = json.dumps([b for r, b in sg.posts if r == MF.UPDATE_ROUTE])
    check("a.csv" not in posted and str(tmp) not in posted and "Census" not in posted, "the site is never told a file name, a folder or a path")
    dp.approve(other, use_anyway=True)
    check(dp.plans[other]["state"] == "done" and (tmp / "mydata" / "Ryagram data" / "b.csv").exists(), "'use it anyway' lets an unchecked website through; the folder falls back to a default name")
    check("already" in (refused(lambda: dp.approve(good["id"])) or ""), "MUST-FAIL: a plan cannot be run twice")
    dp2 = MF.DownloadPlans(Sign(), fetcher=MF.Fetcher(net.resolver, net.transport), runner=run_now)
    dp2.refresh()
    dp2.set_folder(tmp / "mydata2")
    dp2.decline(good["id"])
    check(dp2.plans[good["id"]]["state"] == "declined" and "already" in (refused(lambda: dp2.approve(good["id"], max_bytes=1 << 20)) or ""), "a declined plan stays declined")
    z3 = make_zip({"../escape.csv": CSV})
    net.sites[("www.census.gov", "/evil.zip")] = (200, {}, z3)
    sg3 = Sign()
    sg3.plans = [dict(good, id="cccccccc-1111-2222-3333-444444444444", request={"url": "https://www.census.gov/evil.zip", "why": "x", "folder": "E"})]
    dp3 = MF.DownloadPlans(sg3, fetcher=MF.Fetcher(net.resolver, net.transport), runner=run_now, data_dir=tmp / "mydata3")
    dp3.refresh()
    dp3.look("cccccccc-1111-2222-3333-444444444444")
    dp3.approve("cccccccc-1111-2222-3333-444444444444")
    check(dp3.plans["cccccccc-1111-2222-3333-444444444444"]["state"] == "refused" and not (tmp / "mydata3" / "escape.csv").exists() and not (tmp / "escape.csv").exists(), "MUST-FAIL: a plan whose archive tries to leave its folder ends 'refused' and writes nothing outside")
    class Out:
        def status(self):
            return {"state": "signed_out"}
    check(MF.DownloadPlans(Out()).refresh() == {"on": False}, "signed out: no plans, no card")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
