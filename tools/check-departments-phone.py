"""Phone-width check (Claude's night note 11-06, item 2) of the department pages in mock mode (`departments` and `aiFirst` on, as committed): Data films and the four Coming soon pages
(Compilations, Geographic Intelligence, Games, Animation Studio) at 320, 360, 375 and 390 px, in three switch settings: all picture and detail switches OFF (today), `deptStills` ON with test
pictures, and `departmentDetails` + `locationPreview` ON (the longest pages), and `locationWords` + `locationPreview` ON (GEO's words). For each: no sideways scroll, nothing wider than the screen, no text cut off in its own box, every visible control
at least 44 px, no button wrapped to more than two lines, the accessibility scan, and (with deptStills on) every picture inside the screen. Writes screenshots. Exit 1 on any finding.
Needs Chrome, so it is not part of the node suite. Reuses the probe of tools/check-signin-phone.py.

    python tools/check-departments-phone.py [outdir]        (default D:/Ryagram-scratch/WEB/departments-phone-shots)
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/departments-phone-shots')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / file); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


aa = load('aa', 'audit-a11y.py')
sp = load('sp', 'check-signin-phone.py')
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#445"/></svg>'
PAGES = (('data_films', 'Data films'), ('compilations', 'Compilations'), ('geo_intelligence', 'Geographic Intelligence'), ('games', 'Games'), ('animation_studio', 'Animation Studio'))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    has_stills = 'deptStills: false' in cfg
    settings = [('base', cfg, False)]
    if has_stills:
        settings.append(('stills', cfg.replace('deptStills: false', 'deptStills: true'), True))
    settings.append(('details', cfg.replace('departmentDetails: false', 'departmentDetails: true').replace('locationPreview: false', 'locationPreview: true'), False))
    if 'locationWords: false' in cfg:                                              # GEO's Location Intelligence words (WEB-3), with the made-up picture too: the longest Geographic Intelligence page
        settings.append(('location-words', cfg.replace('locationWords: false', 'locationWords: true').replace('locationPreview: false', 'locationPreview: true'), False))
    srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
    found, states = [], 0
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for width in (320, 360, 375, 390):
            for sname, cfgtext, pics in settings:
                ctx = b.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
                ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
                ctx.route('**/assets/ryagram-config.js*', (lambda body: (lambda route: route.fulfill(status=200, content_type='text/javascript', body=body)))(cfgtext))
                if pics:
                    ctx.route('**/assets/dept-stills/*.svg', lambda route: route.fulfill(status=200, content_type='image/svg+xml', body=SVG))
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.goto(f'http://127.0.0.1:{port}/app/?mock&aiconnected#/', wait_until='load')
                p.wait_for_selector('.dept-bar', timeout=20000)
                for dept, label in PAGES:
                    p.evaluate(f"location.hash = '#/d/{dept}'")
                    p.wait_for_selector(f'h1:has-text("{label}")', timeout=10000)
                    p.wait_for_timeout(450 if pics else 150)
                    r = p.evaluate(sp.PROBE); states += 1
                    tag = (width, sname, dept)
                    if r['sideways']: found.append(tag + ('sideways scroll',))
                    for k in ('wide', 'cut', 'small', 'wrapped'):
                        for v in r[k]: found.append(tag + (k, v))
                    s = p.evaluate(aa.SCAN)
                    for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                        for v in s[k]: found.append(tag + ('a11y-' + k, v))
                    if pics and dept in ('games', 'geo_intelligence', 'data_films'):
                        n = p.locator('.soon-still:not([hidden])').count()
                        if n != 4: found.append(tag + ('pictures shown', n))
                    p.screenshot(path=str(OUT / f'{dept}-{sname}-{width}.png'), full_page=True)
                if errors: found.append((width, sname, 'all', 'page errors', errors[:2]))
                ctx.close()
        b.close()
    srv.shutdown()
    for f in found: print('FINDING', f)
    want = 4 * len(settings) * len(PAGES)
    print(f'states checked: {states} (of {want}); FINDINGS: {len(found)}')
    sys.exit(1 if found or states != want else 0)


if __name__ == '__main__':
    main()
