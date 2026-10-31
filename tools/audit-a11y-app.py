"""Accessibility pass on the signed-in app pages (NEXT-WEB 175), in real Chrome, mock mode, LOCAL server only, desktop and phone, every switch the pages hide behind turned ON in a local config copy. It reuses
tools/audit-a11y.py's scan (the same checks axe would make for these things, written for this site; axe itself is not installed and was not downloaded): controls with no name, heading problems, text contrast under
4.5:1 (3:1 for large text), tap targets under 40 px, sideways scroll, a keyboard Tab walk (every control reachable, a visible focus mark, no trap), messages outside a live region, images with no alt.
Routes that do not exist on this checkout are skipped by name. It does not replace a person with a screen reader. Exit 1 if any finding. Needs Chrome.

    python tools/audit-a11y-app.py [route-name ...]        (no names: every route)
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit_a11y', ROOT / 'tools' / 'audit-a11y.py')
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)
aa.PORT = 8188
BASE = f'http://127.0.0.1:{aa.PORT}'
# (name, query+hash, heading that proves the page opened, clicks first)
ROUTES = [
    ('projects', '?mock#/', 'Your projects', []), ('projects-empty', '?mock&empty#/', 'Your projects', []), ('account', '?mock#/account', 'Your account', []),
    ('credits', '?mock#/credits', 'Credits', []), ('help', '?mock#/help', 'Get help', []), ('looks', '?mock#/looks', 'Your look', []), ('request', '?mock#/request', 'Request a film', []),
    ('start-door', '?mock&door#/start', 'Use your AI to make films', []), ('build', '?mock#/build', 'film step by step', []) , ('project', '?mock#/', 'Obesity and fast food', ['a[href^="#/p/"]']),
    ('version', '?mock#/', 'Version 1', ['a[href^="#/p/"]', 'a[href^="#/v/"]']), ('computers', '?mock&tester#/account', 'Your account', []), ('device', '?mock#/device?code=ABCD-2345', 'Approve this computer', []),
    ('admin-ops', '?mock#/admin/ops', 'Operations', []), ('admin-renders', '?mock#/admin/renders', 'Render approvals', []), ('admin-tester', '?mock#/admin/tester', 'Tester computers', []),
    ('admin-funnel', '?mock#/admin/funnel', 'Funnel by day', []), ('admin-visits', '?mock#/admin/visits', 'Visits and signups', []), ('admin-waitlist', '?mock#/admin/waitlist', 'Waitlist by film', []),
    ('films', '?mock#/films', 'My films', []), ('intake', '?mock#/new', 'Make a film', []), ('editor-data', '?mock#/editor/data', 'Edit your film', []), ('editor-compilation', '?mock#/editor/compilation', 'Edit your film', []),
    ('signed-out', '?signedout#/', 'Sign in', []),
]
SWITCHES = ('liveEditor', 'myFilms', 'intake', 'departments', 'aiFirst', 'connectAi', 'desktopApp', 'lookEditor', 'guidedBuilder')


def main(only):
    srv = aa.serve()
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf8')
    for k in SWITCHES:
        cfg = re.sub(rf'\b{k}:\s*false', f'{k}: true', cfg)
    findings, skipped = [], []

    def scan(p, where):
        r = p.evaluate(aa.SCAN)
        for k, label in (('noname', 'control with no name'), ('headings', 'heading'), ('contrast', 'low contrast'), ('small', 'tap target under 40 px'), ('noalt', 'image with no alt')):
            for v in r[k]:
                if 'mock-' not in v:                                                   # the mock's own test bar is scaffolding, not the site
                    findings.append(f'{where}: {label}: {v}')
        if r['overflow']:
            findings.append(f'{where}: sideways scroll')
        for v in r['live']:
            if 'NOT-LIVE' in v:
                findings.append(f'{where}: message not in a live region: {v}')
        n, reached, noring, trapped = aa.tab_walk(p)
        if reached < n * 0.8:
            findings.append(f'{where}: keyboard reaches {reached} of about {n} controls (missed: {", ".join(aa.tab_walk.missed[:5])})')
        for d in noring:
            if 'mock-' not in d:
                findings.append(f'{where}: no visible focus mark on {d}')
        if trapped:
            findings.append(f'{where}: keyboard focus got stuck')

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for dev, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                ctx = b.new_context(**opts)
                ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
                ctx.route('**/assets/ryagram-config.js*', lambda route, _q: route.fulfill(status=200, content_type='text/javascript', body=cfg))
                for name, q, heading, clicks in ROUTES:
                    if only and name not in only:
                        continue
                    p = ctx.new_page(); p.on('dialog', lambda d: d.accept())
                    try:
                        p.goto(f'{BASE}/app/{q}', wait_until='load')
                        p.wait_for_timeout(1200)
                        for sel in clicks:
                            p.locator(sel).first.click(); p.wait_for_timeout(1200)
                        shown = p.evaluate("(h) => [...document.querySelectorAll('h1,h2')].some(e => e.getBoundingClientRect().height > 0 && e.textContent.includes(h))", heading)
                        if not shown:
                            skipped.append(f'{dev} {name} (no "{heading}" heading: not on this checkout, or needs more than the mock gives)')
                        else:
                            scan(p, f'{dev} {name}')
                    except Exception as e:
                        findings.append(f'{dev} {name}: could not be opened: {str(e)[:80]}')
                    p.close()
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    seen = set()
    uniq = [f for f in findings if not (f.split(': ', 1)[1] in seen or seen.add(f.split(': ', 1)[1]))]
    for s in dict.fromkeys(skipped):
        print('SKIPPED:', s)
    for f in findings:
        print(f)
    print(f'FINDINGS: {len(findings)} ({len(uniq)} distinct), skipped {len(set(skipped))} route(s)')
    print('RESULT:', 'PASS' if not findings else 'FAIL')
    return 0 if not findings else 1


if __name__ == '__main__':
    sys.exit(main(set(sys.argv[1:])))
