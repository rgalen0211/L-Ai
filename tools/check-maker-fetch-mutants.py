"""Must-fail proof for tools/check-maker-fetch.py: each mutant breaks ONE safety rule in a scratch copy of tools/maker_fetch.py and the check must then FAIL (a baseline on the unbroken copy passes first).

    py -I tools/check-maker-fetch-mutants.py <scratch base folder on D:>"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = Path(sys.argv[1])
NL = chr(10)
M = [
    ("every address counts as public", '    if a.is_loopback:' + NL + '        return "this computer"', '    return None' + NL + '    if a.is_loopback:' + NL + '        return "this computer"'),
    ("http is accepted", '    if p.scheme != "https":', "    if False:"),
    ("a user name in the address is accepted", '    if p.username or p.password or "@" in (p.netloc or ""):', "    if False:"),
    ("a bare IP number is accepted as a host", "        ipaddress.ip_address(host)" + NL + '        raise FetchError("An address that is a number', "        pass" + NL + '        raise FetchError("An address that is a number'),
    ("other ports are accepted", "    if p.port not in (None, 443):", "    if False:"),
    ("a host with one bad address is fetched from", "        why = bad_address(ip)" + NL + "        if why:", "        why = None" + NL + "        if why:"),
    ("any redirect target is followed", "                if host not in allowed:", "                if False:"),
    ("a redirect loop never ends", "                    if redirects > MAX_REDIRECTS:", "                    if False:"),
    ("a file bigger than the approved size is read", "            if total is not None and total > max_bytes:", "            if False:"),
    ("the body is not stopped at the approved size", "                        if written > max_bytes:", "                        if False:"),
    ("a short download is kept", "            if total is not None and written != total:", "            if False:"),
    ("a program is kept", '            if kind == "program":', "            if False:"),
    ("a web page is kept", '            if kind == "web":', "            if False:"),
    ("an unknown binary is kept", '            if kind == "other":', "            if False:"),
    ("the part file is left behind on failure", "        except BaseException:" + NL + "            if part.exists():", "        except BaseException:" + NL + "            if False:"),
    ("a download ignores Cancel", "                        if cancel.is_set():", "                        if False:"),
    ("a stopped download starts again from zero", '                if have:' + NL + '                    hdr["Range"]', "                if False:" + NL + '                    hdr["Range"]'),
    ("the transport looks the host up again", "        sock = socket.create_connection((self._ip, 443), self.timeout)", "        sock = socket.create_connection((self.host, 443), self.timeout)"),
    ("a name with .. is unpacked", 'or ".." in parts or', 'or'),
    ("a drive or colon name is unpacked", 'or ":" in name or', 'or'),
    ("a link in an archive is unpacked", "            if (i.external_attr >> 16) & 0o170000 == stat.S_IFLNK:", "            if False:"),
    ("a program inside an archive is unpacked", "            if ext in PROGRAM_EXTS:", "            if False:"),
    ("a reserved Windows name is unpacked", "            if any(p.lower().split(\".\")[0] in RESERVED for p in parts):", "            if False:"),
    ("two files with one name are unpacked", "            if key in seen:", "            if False:"),
    ("a zip bomb is unpacked", ["        if total_decl > max_total or total_decl > packed * max_ratio:", "if got > MAX_ENTRY_BYTES or running > max_total or running > packed * max_ratio:"], ["        if False:", "if False:"]),
    ("too many files are unpacked", "        if len(infos) > max_entries:", "        if False:"),
    ("files that are not data are unpacked", "                if ext not in DATA_EXTS and ext != \"\":", "                if False:"),
    ("a gzip bomb is unpacked", "                if got > max_total or got > packed * max_ratio:", "                if False:"),
    ("a file bigger than the free space is fetched", "    if need and (need > u.free or", "    if False and (need > u.free or"),
    ("the data folder limit is ignored", "    if need and used + need > cap:", "    if False:"),
    ("the public receipt names the file", '"kind": got["kind"],', '"kind": got["kind"], "file": got["name"],'),
    ("an unchecked website needs no extra press", '        if p["label"] != "official" and not use_anyway:', "        if False:"),
    ("a download starts with no data folder", "        if self.data_dir is None:", "        if False:"),
    ("a download starts without a known size", "        if not limit:", "        if False:"),
    ("a plan can be run twice", '        if p["state"] != "waiting":', "        if False:"),
    ("a plan with an http address is read", "        host, _p, path = check_url(url)" + NL + "    except FetchError:" + NL + "        return None", "        host, _p, path = urlsplit(url).hostname, 443, '/'" + NL + "    except FetchError:" + NL + "        return None"),
    ("a folder PATH is accepted as the folder name", '    if _PATHISH.search(why) or not re.match(r"^[A-Za-z0-9 ._-]{0,60}$", folder or ""):', "    if False:"),
    ("the site is sent the file name", '            self.signin.api("POST", UPDATE_ROUTE, {"id": p["id"], "state": state, "receipt": public})', '            self.signin.api("POST", UPDATE_ROUTE, {"id": p["id"], "state": state, "receipt": public, "name": p.get("name")})'),
]


def run(tools: Path, scratch: Path):
    return subprocess.run([sys.executable, "-I", str(tools / "check-maker-fetch.py"), str(scratch)], capture_output=True, text=True, timeout=300)


work = Path(tempfile.mkdtemp(prefix="fetch-mut-", dir=str(BASE)))
bad = 0
try:
    for i, item in enumerate([("baseline", None, None)] + M):
        name, a, b = item
        tools = work / f"t{i}"
        tools.mkdir()
        for f in ("maker_fetch.py", "check-maker-fetch.py"):
            shutil.copy(HERE / f, tools / f)
        if a is not None:
            f = tools / "maker_fetch.py"
            t = f.read_bytes().decode("utf-8").replace(chr(13) + NL, NL)
            As, Bs = (a, b) if isinstance(a, list) else ([a], [b])
            if any(t.count(x) != 1 for x in As):
                print(f"  BROKEN MUTANT (an anchor is not found exactly once): {name}")
                bad += 1
                continue
            for x, y in zip(As, Bs):
                t = t.replace(x, y)
            f.write_bytes(t.encode("utf-8"))
        scratch = work / f"s{i}"
        scratch.mkdir()
        try:
            r = run(tools, scratch)
            rc, tail = r.returncode, r.stdout[-600:] + r.stderr[-300:]
        except subprocess.TimeoutExpired:
            rc, tail = 1, "timeout"
        if a is None:
            if rc != 0:
                print("BASELINE FAILS:" + NL + tail)
                sys.exit(1)
            print("baseline passes")
            continue
        print(("caught  " if rc != 0 else "MISSED  ") + name)
        bad += 0 if rc != 0 else 1
finally:
    shutil.rmtree(work, ignore_errors=True)
print("all mutants caught" if not bad else f"{bad} PROBLEM(S)")
sys.exit(1 if bad else 0)
