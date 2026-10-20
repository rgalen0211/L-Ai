"""The desktop maker's "Sign in to Ryagram" card (NEXT-CONNECT 98, r9 M1), driven in real Chrome against the FAKE site and a FAKE credential store. No real site, no account, no network beyond 127.0.0.1,
no speech model (Plan and Build run a stand-in `ryagram.local`).

    python tools/check-maker-signin.py <the kit's own folder, or a current Ryagram checkout> [<scratch base folder>]

What it proves
  A  without a site address the maker is exactly r8: no card, the old banner, the sign-in endpoints refuse, Plan and Build are not gated
  B  with one: the card, the code on screen, the approval link on the trusted host only, approval by the "website", then 'Signed in as ...'; the page polls on its own
  C  the token and the device secret are in NO page, no status the page can fetch, no file under the work and films folders, and the activity log holds only fixed events (no email, no computer name, no code)
  D  Remove from this computer; a computer removed on the website is signed out at Check my account
  E  the 7-day grace: after 8 days without a check Plan and Build say 'connect once' and start nothing; Check my account renews it
  F  where the Windows Credential Manager is missing, the card says so and offers no Sign in button
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    sys.exit("Give the engine folder: the kit's own folder (the one that holds ryagram/local) or a current Ryagram checkout.")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
ENGINE = Path(sys.argv[1])
BASE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
import fake_ryagram_site as fake        # noqa: E402
import ryagram_signin as si             # noqa: E402

aspec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(aspec)
sys.modules['audit_a11y'] = aa
aspec.loader.exec_module(aa)
spec = importlib.util.spec_from_file_location('desktop_maker', ROOT / 'tools' / 'desktop_maker.py')
dm = importlib.util.module_from_spec(spec)
sys.modules['desktop_maker'] = dm
spec.loader.exec_module(dm)

RECIPE = {"schema": "ryagram.recipe/0", "name": "any words",
          "slots": [{"id": "source-1", "label": "Your footage", "accepts": "video", "multiple": True}],
          "find": {"op": "words", "text": "the baby", "unit": "words", "slots": ["source-1"]},
          "select": {"min_length": 1, "max_length": 8, "min_seconds": 0.05, "max_seconds": 4.0},
          "arrange": {"order": "text", "join": "cut", "crossfade_ms": 0},
          "effects": {"padding": {"lead_ms": 60, "trail_ms": 60}},
          "render": {"preset": "720p30", "crf": 28}}
STUB_MAIN = '''import sys, json
from pathlib import Path
a = sys.argv
cmd = a[1]
work = Path(a[a.index("--work-dir") + 1]); out = Path(a[a.index("--out") + 1])
clips = [{"n": 1, "words": "the baby", "file_name": "show.mp4", "slot": "source-1", "start_ms": 0, "end_ms": 600, "duration_ms": 600}]
if cmd == "plan":
    work.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"ok": True, "gaps": [], "clips": clips, "seconds_estimate": 0.6, "would_write": out.name, "model": "base", "network_attempts": 0}))
    sys.exit(0)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(b"\\x00\\x00\\x00\\x18ftypmp42" + bytes(range(256)) * 20)
out.with_suffix(".receipt.json").write_text(json.dumps({"schema": "ryagram.local-receipt/0", "film": out.name, "seconds": 0.6, "clips": clips, "network_attempts": 0}))
print("built", out.name)
'''
FAILED = []


def check(c, what):
    print(('  ok   ' if c else '  FAIL ') + what)
    if not c:
        FAILED.append(what)


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def add(self, s):
        self.t += s


def start(tmp, **kw):
    srv = dm.make_server(tmp / 'engine', tmp / 'recipes', tmp / 'work', tmp / 'films', port=0, token='tok', activity=True, **kw)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{dm.STATE['port']}"


def main():
    tmp = Path(tempfile.mkdtemp(prefix='maker-signin-', dir=BASE if BASE else None))
    site = None
    try:
        shutil.copytree(ENGINE / 'ryagram', tmp / 'engine' / 'ryagram', ignore=shutil.ignore_patterns('__pycache__'))
        (tmp / 'engine' / 'ryagram' / 'local' / '__main__.py').write_text(STUB_MAIN, encoding='utf8')
        (tmp / 'recipes').mkdir()
        (tmp / 'recipes' / 'any-words.json').write_text(json.dumps(RECIPE), encoding='utf8')
        clips = tmp / 'Sam Videos'
        clips.mkdir()
        (clips / 'show.mp4').write_bytes(b'not really a video')
        dm.faster_whisper_missing = lambda: False
        dm.pick_files = lambda multiple: [str(clips / 'show.mp4')]

        with sync_playwright() as pw:
            b = pw.chromium.launch(channel=os.environ.get('MAKER_BROWSER', 'chrome'))
            page = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))

            def load(base):
                page.goto(f'{base}/?t=tok', wait_until='load')
                page.wait_for_selector('#recipe option', state='attached', timeout=10000)
                page.wait_for_timeout(300)

            def plan_message():
                if page.locator('.slot li').count() == 0:
                    page.get_by_role('button', name='Choose a file for Your footage').click()
                    page.wait_for_selector('.slot li')
                page.fill('#words', 'the baby')
                page.click('#plan')
                page.wait_for_function("() => document.querySelector('#job-out').innerText.includes('Ready to build') || document.querySelector('#plan-out .problems')", timeout=30000)
                page.wait_for_timeout(300)
                return page.inner_text('#plan-out') + ' ' + page.inner_text('#job-out')


            def a11y(where, base):
                """The shared accessibility scan on the card's state, desktop light, desktop dark and a phone."""
                found = []
                for size, scheme in (('desktop', 'light'), ('desktop', 'dark'), ('phone', 'light')):
                    opts = dict(viewport={'width': 1280, 'height': 900}) if size == 'desktop' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
                    ctx = b.new_context(color_scheme=scheme, **opts)
                    pg = ctx.new_page()
                    pg.goto(f'{base}/?t=tok', wait_until='load')
                    pg.wait_for_selector('#signin-body > *', timeout=10000)
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

            print('A. without a site address it is exactly r8')
            srv, base = start(tmp)
            load(base)
            check(page.locator('#signin').is_hidden(), 'no Sign in card at all')
            check('there is no account' in page.inner_text('.banner'), 'the banner still says it plainly: there is no account')
            import urllib.request
            req = urllib.request.Request(base + '/api/signin', headers={'X-Maker-Token': 'tok'})
            check(json.loads(urllib.request.urlopen(req).read()) == {"enabled": False}, '/api/signin says it is off')
            r = urllib.request.Request(base + '/api/signin-start', data=b'{}', headers={'X-Maker-Token': 'tok', 'Content-Type': 'application/json'}, method='POST')
            try:
                urllib.request.urlopen(r)
                got = 200
            except urllib.error.HTTPError as e:
                got = e.code
            check(got == 400, 'MUST-FAIL: the sign-in endpoints refuse when no site was given')
            txt = plan_message()
            check('Ready to build' in txt, 'Plan works as before (no gate): ' + txt[:160].replace(chr(10), ' '))
            srv.shutdown()
            srv.server_close()

            print('\nB. the card, the code, the approval, signed in')
            site = fake.FakeSite()
            clock = Clock()
            site.clock = clock
            url = site.start()
            store = si.MemoryStore()
            srv, base = start(tmp, site=url, approval_hosts=(), signin_store=store, signin_clock=clock)
            load(base)
            check(page.locator('#signin').is_visible() and 'Your Ryagram account' in page.inner_text('#signin'), 'the card is on the page')
            check('there is no account' not in page.inner_text('.banner') and 'Your videos are never uploaded' in page.inner_text('.banner'), 'the banner no longer says there is no account, and still says videos are never uploaded')
            check(page.get_by_role('button', name='Sign in to Ryagram').count() == 1 and 'password' in page.inner_text('#signin-body'), 'one button, and the page says no password is typed here')
            a11y('signed out', base)
            page.get_by_role('button', name='Sign in to Ryagram').click()
            page.wait_for_selector('#signin-code', timeout=10000)
            code = page.inner_text('#signin-code')
            check(si.USER_CODE_RE.match(code) is not None, f'the code is on screen ({code})')
            check('Only approve a code you can see on THIS screen' in page.inner_text('#signin-body'), 'the warning to approve only a code shown on this screen')
            href = page.get_by_role('link', name='Open the approval page on the Ryagram website').get_attribute('href')
            check(href.startswith(site.root_url + '/app/#/device') and page.locator('#signin-open').get_attribute('rel') == 'noopener noreferrer', f'the link goes to the trusted host and opens safely ({href})')
            check(page.locator('#signin-code').get_attribute('aria-label').startswith('Your code:'), 'the code is spelled out for a screen reader')
            a11y('waiting for approval', base)
            site.approve(code, 'sam@example.test', local_compute=True)
            clock.add(30)
            page.wait_for_selector('#signin-who', timeout=20000)
            who = page.inner_text('#signin-who')
            check('sam@example.test' in who and 'Approved until' in who, f'signed in: {who}')
            check(page.get_by_role('button', name='Remove from this computer').count() == 1 and page.get_by_role('button', name='Check my account').count() == 1, 'Check my account and Remove from this computer are there')
            check('Credential Manager' in page.inner_text('#signin-body') and 'browser cookie' in page.inner_text('#signin-body'), 'the page says where the sign-in is kept and who can read it')

            a11y('signed in', base)
            print('\nC. the token is nowhere it should not be')
            tok, dev = site.issued_tokens[0], site.issued_device_codes[0]
            blob = page.content() + page.inner_text('body') + json.dumps(json.loads(urllib.request.urlopen(urllib.request.Request(base + '/api/signin', headers={'X-Maker-Token': 'tok'})).read()))
            for f in tmp.rglob('*'):
                if f.is_file() and 'engine' not in f.parts:
                    blob += f.read_text(encoding='utf-8', errors='replace')
            check(tok not in blob and dev not in blob, 'MUST-FAIL: neither the token nor the device secret is in the page, the status, or any file under the work and films folders')
            log = (tmp / 'films' / dm.ACTIVITY_NAME).read_text(encoding='utf-8')
            check('signin_started' in log and 'signin_done' in log, 'the activity log has the two fixed events')
            check('sam@example.test' not in log and 'Sam' not in log and code not in log and tok not in log and dev not in log, 'MUST-FAIL: the log holds no email, computer name, code or token')
            check((tmp / 'work' / si.CACHE_NAME).exists() and tok not in (tmp / 'work' / si.CACHE_NAME).read_text(encoding='utf-8'), 'the non-secret account state is in a file; the token is not')
            check(not (page.locator('text=' + tok[:12]).count()), 'a find-in-page for the token finds nothing')

            print('\nE. the 7-day grace')
            clock.add(8 * 86400)
            load(base)
            check('has not been checked for 7 days' in page.inner_text('#signin-note'), 'after 8 days the card says so in plain words')
            a11y('signed in, paused', base)
            msg = plan_message()
            check('has not been checked for 7 days' in msg and 'Connect to the internet once' in msg, 'MUST-FAIL: Plan says "connect once" and does not start')
            check(dm.STATE.get('job') is None, 'and nothing was started')
            page.click('#signin-check')
            page.wait_for_function("() => !document.getElementById('signin-note')", timeout=10000)
            check(True, 'Check my account renews it: the warning is gone')
            txt2 = plan_message()
            check('Ready to build' in txt2, 'and Plan works again: ' + txt2[:160].replace(chr(10), ' '))

            print('\nD. removing')
            site.revoke_all()
            page.click('#signin-check')
            page.wait_for_selector('#signin-start', timeout=10000)
            check('removed from your account' in page.inner_text('#signin-msg'), 'removed on the website: Check my account signs it out and says why')
            check(store.items == {}, 'and the token is gone from the store')
            page.click('#signin-start')
            page.wait_for_selector('#signin-code', timeout=10000)
            site.approve(page.inner_text('#signin-code'), 'sam@example.test')
            clock.add(30)
            page.wait_for_selector('#signin-who', timeout=20000)
            tok2 = store.read(next(iter(store.items)))
            page.click('#signin-remove')
            page.wait_for_selector('#signin-start', timeout=10000)
            check(store.items == {} and not (tmp / 'work' / si.CACHE_NAME).exists() and site.tokens[fake._h(tok2)]['revoked'], 'Remove from this computer: gone here and revoked on the site')
            check('Removed from this computer' in page.inner_text('#signin-msg'), 'and the page says so')
            check(not errors, f'no script errors on the page ({errors[:2]})')
            srv.shutdown()
            srv.server_close()

            print('\nG. with pictures on (--v2) the card still works beside them')
            clock.add(1)
            srv, base = start(tmp, site=url, signin_store=store, signin_clock=clock, v2=True)
            load(base)
            check(page.locator('#signin').is_visible() and page.locator('#v2-images').count() == 1, 'both the Sign in card and the pictures section are on the page')
            page.get_by_role('button', name='Sign in to Ryagram').click()
            page.wait_for_selector('#signin-code', timeout=10000)
            site.approve(page.inner_text('#signin-code'), 'sam@example.test')
            clock.add(30)
            page.wait_for_selector('#signin-who', timeout=20000)
            check('sam@example.test' in page.inner_text('#signin-who') and not errors, f'signing in works with --v2 on, and the page has no script errors ({errors[:2]})')
            check(page.locator('#plan').is_enabled(), 'and Plan is still there')
            srv.shutdown()
            srv.server_close()

            print('\nF. no Credential Manager here')
            real_platform = sys.platform
            try:
                sys.platform = 'linux'
                srv, base = start(tmp, site=url)
            finally:
                sys.platform = real_platform
            load(base)
            check(page.locator('#signin').is_visible() and 'Nothing was stored' in page.inner_text('#signin-body') and page.locator('#signin-start').count() == 0, 'the card says it cannot sign in here and offers no button')
            srv.shutdown()
            srv.server_close()
            b.close()
    finally:
        if site:
            site.stop()
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    if FAILED:
        print(f'FAILED: {len(FAILED)}')
        for f in FAILED:
            print('  -', f)
        sys.exit(1)
    print('all passed')


main()
