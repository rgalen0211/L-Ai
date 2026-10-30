"""The maker's "This computer renders my site films" card (NEXT-CONNECT 100, r9 M4), driven in real Chrome against the REAL `node` function logic (run by Node through
tests/node-fake-server.mjs) and its in-memory database stand-in. No real site, no account, no engine render (the renderer is a stand-in).

    python tools/check-maker-node.py <the kit's own folder, or a current Ryagram checkout> [<scratch base folder>]

What it proves
  A  the card is hidden until a flagged account is signed in, and says plainly what it does; it is OFF and nothing is checked
  B  with a renderer: switch on, a queued film is made and finished, the page says Done, the site shows the job complete
  C  switch off: nothing more is claimed
  D  with no renderer: the switch is offered DISABLED with the reason (this copy cannot make site films yet), it cannot be turned on, and the job stays queued
  E  an account that is not flagged never sees the card
  F  the accessibility scan on the card (off, on), desktop light, dark and phone: 0 findings
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    sys.exit("Give the engine folder: the kit's own folder (the one that holds ryagram/local) or a current Ryagram checkout.")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
import ryagram_node as rn                  # noqa: E402
import ryagram_signin as si                # noqa: E402

aspec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(aspec)
sys.modules['audit_a11y'] = aa
aspec.loader.exec_module(aa)
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

ALICE, BOB = "00000000-0000-4000-8000-00000000a11c", "00000000-0000-4000-8000-0000000000b0"
RECIPE = {"schema": "ryagram.recipe/0", "name": "any words", "slots": [{"id": "source-1", "label": "Your footage", "accepts": "video", "multiple": True}],
          "find": {"op": "words", "text": "the baby", "unit": "words", "slots": ["source-1"]}, "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0}, "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}}, "render": {"preset": "720p30", "crf": 28}}
STUB_MAIN = 'import sys\nsys.exit(0)\n'
FAILED = []


def check(c, what):
    print(('  ok   ' if c else '  FAIL ') + what)
    if not c:
        FAILED.append(what)


class Server:
    def __init__(self):
        self.p = subprocess.Popen(["node", "--no-warnings", str(ROOT / "tests" / "node-fake-server.mjs")], cwd=ROOT, stdout=subprocess.PIPE, text=True)
        line = self.p.stdout.readline().strip()
        if not line.startswith("READY"):
            raise SystemExit("the test server did not start: " + line)
        self.host = f"127.0.0.1:{int(line.split()[1])}"
        self.url = f"http://{self.host}/node"

    def admin(self, what, body=None):
        req = urllib.request.Request(f"http://{self.host}/__admin/{what}", data=json.dumps(body or {}).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as r:
            return json.loads(r.read())

    def close(self):
        self.p.terminate()
        try:
            self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.p.kill()


def render(job, work, progress):
    (work / "film.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 8)
    return {"final_video": work / "film.mp4"}


def main():
    tmp = Path(tempfile.mkdtemp(prefix='maker-node-', dir=BASE if BASE else None))
    srv = Server()
    try:
        shutil.copytree(ENGINE / 'ryagram', tmp / 'engine' / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        (tmp / 'engine' / 'ryagram' / 'local' / '__main__.py').write_text(STUB_MAIN, encoding='utf8')
        (tmp / 'recipes').mkdir()
        (tmp / 'recipes' / 'any-words.json').write_text(json.dumps(RECIPE), encoding='utf8')
        srv.admin("user", {"id": ALICE, "email": "alice@example.test", "local_compute": True})
        srv.admin("user", {"id": BOB, "email": "bob@example.test", "local_compute": False})
        rn.POLL_SECONDS = 0.3
        rn.IDLE_POLL_SECONDS = 0.3

        def start(sub, renderer):
            work = tmp / sub / 'work'
            srv_ = dm.make_server(tmp / 'engine', tmp / 'recipes', work, tmp / sub / 'films', port=0, token='tok', activity=True, site=srv.url,
                                  signin_store=si.MemoryStore(), node_renderer=renderer, node_validate=lambda job: job)
            threading.Thread(target=srv_.serve_forever, daemon=True).start()
            return srv_, f"http://127.0.0.1:{dm.STATE['port']}"

        def sign_in(page, who):
            page.get_by_role('button', name='Sign in to Ryagram').click()
            page.wait_for_selector('#signin-code', timeout=10000)
            assert srv.admin("approve", {"user_code": page.inner_text('#signin-code'), "owner": who})["ok"]
            page.wait_for_selector('#signin-who', timeout=25000)

        def job_states():
            return {j["id"]: j["state"] for j in srv.admin("jobs")}

        with sync_playwright() as pw:
            b = pw.chromium.launch(channel=os.environ.get('MAKER_BROWSER', 'chrome'))
            page = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))

            def a11y(where, base):
                found = []
                for size, scheme in (('desktop', 'light'), ('desktop', 'dark'), ('phone', 'light')):
                    opts = dict(viewport={'width': 1280, 'height': 900}) if size == 'desktop' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
                    ctx = b.new_context(color_scheme=scheme, **opts)
                    pg = ctx.new_page()
                    pg.goto(f'{base}/?t=tok', wait_until='load')
                    pg.wait_for_selector('#node:not([hidden])', timeout=10000)
                    pg.wait_for_timeout(300)
                    r = pg.evaluate(aa.SCAN)
                    for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
                        found += [f'{size} {scheme}: {label}: {v}' for v in r[k]]
                    if r['overflow']:
                        found.append(f'{size} {scheme}: sideways scroll')
                    n, reached, noring, trapped = aa.tab_walk(pg)
                    if reached < n * 0.8:
                        found.append(f'{size} {scheme}: keyboard reaches {reached} of about {n} controls')
                    found += [f'{size} {scheme}: no visible focus mark on {d}' for d in noring]
                    if trapped:
                        found.append(f'{size} {scheme}: keyboard focus got stuck')
                    ctx.close()
                check(not found, f'accessibility scan, {where}: 0 findings (3 views)' + ('' if not found else ' ' + '; '.join(found[:4])))

            print('A. hidden until a flagged account is signed in')
            maker, base = start('a', render)
            page.goto(f'{base}/?t=tok', wait_until='load')
            page.wait_for_selector('#recipe option', state='attached', timeout=10000)
            check(page.locator('#node').is_hidden(), 'signed out: no node card')
            sign_in(page, ALICE)
            page.wait_for_selector('#node:not([hidden])', timeout=10000)
            txt = page.inner_text('#node')
            check('checks the Ryagram site about every half minute' in txt and 'Your own videos never leave this computer' in txt and 'uses no credits' in txt, 'the card says what it does, that videos stay here, and that it costs no credits')
            check(not page.is_checked('#node-on') and 'It is off. Nothing is being checked.' in page.inner_text('#node-state'), 'it is OFF, and says nothing is being checked')
            check(not srv.admin("calls").count("node_claim"), 'and the site has not been asked for anything')
            a11y('off', base)

            print('\nB. switched on: a queued film is made')
            srv.admin("addjob", {"id": "00000000-0000-4000-8000-000000000501", "owner_id": ALICE, "run_on": "owner_local", "job_type": "final_render"})
            page.check('#node-on')
            page.wait_for_function("() => document.getElementById('node-state').innerText.includes('The last film was made and sent')", timeout=20000)
            check(job_states()["00000000-0000-4000-8000-000000000501"] == "complete", 'the page says the last film was made and sent, and the site shows the job complete')
            check(len(srv.admin("uploads")) == 1 and srv.admin("uploads")[0]["path"].endswith("/film.mp4"), 'and the film (only) was sent, to the path the site derived')
            check('null' not in page.inner_text('#node') and 'undefined' not in page.inner_text('#node'), 'no stray null in the card')
            a11y('on and waiting', base)

            print('\nC. switched off: nothing more is claimed')
            page.uncheck('#node-on')
            page.wait_for_function("() => document.getElementById('node-state').innerText.includes('off')", timeout=10000)
            srv.admin("addjob", {"id": "00000000-0000-4000-8000-000000000502", "owner_id": ALICE, "run_on": "owner_local", "job_type": "preview"})
            time.sleep(1.5)
            check(job_states()["00000000-0000-4000-8000-000000000502"] == "queued", 'MUST-FAIL: with the switch off the next film is NOT claimed')
            check(not errors, f'no script errors ({errors[:2]})')
            maker.shutdown()
            maker.server_close()

            print('\nD. no renderer in this copy')
            maker, base = start('d', None)
            page.goto(f'{base}/?t=tok', wait_until='load')
            page.wait_for_selector('#recipe option', state='attached', timeout=10000)
            sign_in(page, ALICE)
            page.wait_for_selector('#node:not([hidden])', timeout=10000)
            claims_before = srv.admin("calls").count("node_claim")
            page.wait_for_function("() => document.getElementById('node-state').innerText.includes('cannot make site films yet')", timeout=10000)
            check(page.is_disabled('#node-on') and not page.is_checked('#node-on'), 'with no renderer the switch is offered DISABLED and off, with the reason')
            page.evaluate("() => document.getElementById('node-on').click()")             # a click on a disabled box changes nothing
            check(not page.is_checked('#node-on'), 'and a click cannot turn it on')
            time.sleep(1.2)
            check(job_states()["00000000-0000-4000-8000-000000000502"] == "queued", 'MUST-FAIL: with no renderer the job is left queued, not failed')
            check(srv.admin("calls").count("node_claim") == claims_before, 'and this copy made no claim at all')
            maker.shutdown()
            maker.server_close()

            print('\nE. an account that is not flagged never sees the card')
            maker, base = start('e', render)
            page.goto(f'{base}/?t=tok', wait_until='load')
            page.wait_for_selector('#recipe option', state='attached', timeout=10000)
            sign_in(page, BOB)
            page.wait_for_timeout(1500)
            check(page.locator('#node').is_hidden(), 'MUST-FAIL: signed in without the tester flag: no node card at all')
            maker.shutdown()
            maker.server_close()
            b.close()
    finally:
        srv.close()
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    if FAILED:
        print(f'FAILED: {len(FAILED)}')
        for f in FAILED:
            print('  -', f)
        sys.exit(1)
    print('all passed')


main()
