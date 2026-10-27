"""'Downloads your AI asked for': the card on the desktop maker's main page, in REAL Chrome against the REAL maker (NEXT-CONNECT 152). The site and the websites are stand-ins (no network).

    py tools/check-maker-data-card.py <Ryagram checkout with ryagram/local> <scratch base folder on D:>

Starts the maker's own server in this process (the signed-in state, the folder dialog and the websites replaced by stand-ins), opens the page in Chrome and plays a first-timer: the card shows the plan with its
host written large, nothing downloads until Download is pressed, an unchecked website needs 'Use it anyway', the file lands in the chosen folder with a receipt, a plan that tries to escape is refused and shown
as refused. Nothing is requested from outside the maker's own address."""
import json
import re
import shutil
import sys
import tempfile
import threading
import zipfile
import io
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ENGINE = Path(sys.argv[1]).resolve()
BASE = Path(sys.argv[2])
sys.path[:0] = [str(HERE), str(ENGINE)]
import desktop_maker as DM  # noqa: E402
import maker_fetch as MF  # noqa: E402

FAILED = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        FAILED.append(what)


CSV = b"county,year,value\nAutauga AL,2019,5\n"
EVIL = io.BytesIO()
with zipfile.ZipFile(EVIL, "w") as z:
    z.writestr("../escape.csv", CSV)


class Net:
    def __init__(self):
        self.seen = []
        self.sites = {("www.census.gov", "/a.csv"): CSV, ("data.example.org", "/b.csv"): CSV, ("www.census.gov", "/evil.zip"): EVIL.getvalue()}

    def resolver(self, host):
        return ["93.184.216.34"]

    def transport(self, host, ip, path, method, headers):
        self.seen.append((host, method, path))
        data = self.sites.get((host, path))
        if data is None:
            return 404, {}, None

        class B:
            def __init__(s, d):
                s.b = io.BytesIO(d)

            def read(s, n):
                return s.b.read(n)

            def close(s):
                pass
        return (200, {"content-length": str(len(data))}, None if method == "HEAD" else B(data))


PLANS = [{"id": "aaaaaaaa-1111-2222-3333-444444444444", "request": {"url": "https://www.census.gov/a.csv", "why": "the county table for your map", "folder": "Census"}},
         {"id": "bbbbbbbb-1111-2222-3333-444444444444", "request": {"url": "https://data.example.org/b.csv", "why": "another table", "folder": ""}},
         {"id": "cccccccc-1111-2222-3333-444444444444", "request": {"url": "https://www.census.gov/evil.zip", "why": "a zip", "folder": "Z"}}]


class Sign:
    def __init__(self):
        self.posts = []

    def status(self):
        return {"state": "signed_in"}

    def api(self, method, route, body=None):
        self.posts.append((route, body))
        return (200, {"plans": PLANS}) if route == MF.ROUTE else (200, {})


tmp = Path(tempfile.mkdtemp(prefix="data-card-", dir=str(BASE)))
srv = None
try:
    (tmp / "recipes").mkdir()
    shutil.copy(ENGINE / "recipes" / "sam-first.json", tmp / "recipes" / "sam-first.json")
    srv = DM.make_server(ENGINE, tmp / "recipes", tmp / "work", tmp / "films", port=0, token="tok", activity=False)
    port = srv.server_address[1]
    net = Net()
    sign = Sign()
    DM.STATE["signin"] = sign
    DM.STATE["data_on"] = True
    DM.STATE["fetch"] = MF.DownloadPlans(sign, fetcher=MF.Fetcher(net.resolver, net.transport))
    mydata = tmp / "mydata"
    mydata.mkdir()
    DM.pick_folder_path = lambda: str(mydata)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    outside = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        pg = b.new_context(viewport={"width": 1100, "height": 1600}).new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("request", lambda r: outside.append(r.url) if not re.match(r"^(http://127\.0\.0\.1:\d+/|data:|blob:)", r.url) else None)
        pg.goto(f"http://127.0.0.1:{port}/?t=tok", wait_until="load")
        pg.wait_for_selector("#dl-list li", timeout=15000)
        check(pg.locator("#dl-list li").count() == 3 and "www.census.gov" in pg.inner_text("#dl-list") and "the county table for your map" in pg.inner_text("#dl-list"), "the card lists the plans with the host written out and the AI's reason")
        check(not net.seen, "nothing was downloaded and no website was contacted before the person pressed anything")
        check("official website" in pg.locator("#dl-list li").nth(0).inner_text() and "has NOT checked" in pg.locator("#dl-list li").nth(1).inner_text(), "an official website and an unchecked one are told apart in words")
        first = pg.locator("#dl-list li").nth(0)
        first.get_by_role("button", name="Download").click()
        pg.wait_for_function("() => document.getElementById('dl-msg').textContent.length > 0", timeout=8000)
        check("folder" in pg.inner_text("#dl-msg").lower() and not net.seen, "Download without a chosen folder says so and downloads nothing")
        pg.click("#dl-folder")
        pg.wait_for_function("() => document.getElementById('dl-folder-note').textContent.indexOf('is chosen') >= 0", timeout=8000)
        first = pg.locator("#dl-list li").nth(0)
        first.get_by_role("button", name="Download").click()
        pg.wait_for_function("() => document.getElementById('dl-msg').textContent.toLowerCase().indexOf('size') >= 0", timeout=8000)
        check(not [s for s in net.seen if s[1] == "GET"], "Download before the size is known is refused (look it up first); no file was fetched")
        first.get_by_role("button", name="Look up the size").click()
        pg.wait_for_function("() => document.querySelector('#dl-list li').innerText.indexOf('MB') >= 0", timeout=8000)
        pg.locator("#dl-list li").nth(0).get_by_role("button", name="Download").click()
        pg.wait_for_function("() => document.querySelector('#dl-list li').innerText.indexOf('done') >= 0", timeout=15000)
        check((mydata / "Census" / "a.csv").read_bytes() == CSV and len(list((mydata / "Census").glob("a.RECEIPT.*"))) == 2, "an approved official plan lands in the chosen folder with a receipt")
        second = pg.locator("#dl-list li").nth(1)
        second.get_by_role("button", name="Look up the size").click()
        pg.wait_for_function("() => document.querySelectorAll('#dl-list li')[1].innerText.indexOf('MB') >= 0", timeout=8000)
        second.get_by_role("button", name="Download").click()
        pg.wait_for_function("() => document.getElementById('dl-msg').textContent.indexOf('not checked') >= 0", timeout=8000)
        check(not (mydata / "Ryagram data").exists(), "an unchecked website is not downloaded from without the separate 'Use it anyway' press")
        pg.locator("#dl-list li").nth(1).locator("input[type=checkbox]").check()
        pg.locator("#dl-list li").nth(1).get_by_role("button", name="Download").click()
        pg.wait_for_function("() => document.querySelectorAll('#dl-list li')[1].innerText.indexOf('done') >= 0", timeout=15000)
        check((mydata / "Ryagram data" / "b.csv").exists(), "with 'Use it anyway' it is downloaded")
        third = pg.locator("#dl-list li").nth(2)
        third.get_by_role("button", name="Look up the size").click()
        pg.wait_for_function("() => document.querySelectorAll('#dl-list li')[2].innerText.indexOf('B') >= 0", timeout=8000)
        pg.locator("#dl-list li").nth(2).get_by_role("button", name="Download").click()
        pg.wait_for_function("() => document.querySelectorAll('#dl-list li')[2].innerText.indexOf('refused') >= 0", timeout=15000)
        check("leave its folder" in pg.locator("#dl-list li").nth(2).inner_text() and not (mydata / "escape.csv").exists() and not (tmp / "escape.csv").exists(), "a plan whose archive tries to leave its folder is shown as refused, in words, and writes nothing outside")
        told = json.dumps([bd for r, bd in sign.posts if r == MF.UPDATE_ROUTE])
        check("a.csv" not in told and str(tmp) not in told and "Census" not in told, "the site was told the states only: no file name, no folder, no path")
        pg.screenshot(path=str(tmp / "card.png"), full_page=True)
        check(not errors, "no page errors" + (f": {errors[:2]}" if errors else ""))
        check(not outside, "nothing was requested from outside the maker's own address" + (f": {outside[:2]}" if outside else ""))
        b.close()
finally:
    if srv is not None:
        srv.shutdown()
        srv.server_close()
    shutil.rmtree(tmp, ignore_errors=True)
print("RESULT: " + ("PASS" if not FAILED else f"FAIL ({len(FAILED)})"))
sys.exit(1 if FAILED else 0)
