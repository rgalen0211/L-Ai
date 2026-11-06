"""Phone-width check of the live editor page (Claude's night note 11-06, item 1: what the sweep left open: a very long title). Mock mode, `liveEditor` ON in a local copy of the config, the data
mode and the compilation mode at 320, 360, 375 and 390 px: once as it is, and once with the page heading and the first words of the page stretched to 80 unbroken capital letters (the longest
heading the page allows) so a long title cannot push the page sideways. Each: no sideways scroll, nothing wider than the screen, no text cut off in its own box, controls at least 44 px, the accessibility
scan. Exit 1 on any finding. Needs Chrome; not part of the node suite. Reuses the probe of tools/check-signin-phone.py. Not covered, and said so: a SLOW network answer (the mock has no network to slow).

    python tools/check-live-editor-phone.py [outdir]        (default D:/Ryagram-scratch/WEB/live-editor-phone-shots)
"""
import importlib.util, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/live-editor-phone-shots')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / file); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


aa = load('aa', 'audit-a11y.py')
sp = load('sp', 'check-signin-phone.py')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cfg = (ROOT / 'assets' / 'ryagram-config.js').read_text(encoding='utf-8')
    flipped = re.sub(r'liveEditor:\s*false', 'liveEditor: true', cfg)
    assert 'liveEditor: true' in flipped
    srv = aa.serve(); port = srv.server_address[1] if hasattr(srv, 'server_address') else aa.PORT
    found, states = [], 0
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel='chrome')
        for width in (320, 360, 375, 390):
            ctx = b.new_context(viewport={'width': width, 'height': 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
            p = ctx.new_page()
            errors = []
            p.on('pageerror', lambda e: errors.append(str(e)))
            for mode, url in (('data', '/app/?mock&standin#/editor/data'), ('compilation', '/app/?mock#/editor/compilation')):
                for stretch in (False, True):
                    p.goto(f'http://127.0.0.1:{port}{url}', wait_until='load')
                    p.wait_for_selector('#library h1:not([hidden])', timeout=20000)
                    p.wait_for_timeout(700)
                    if stretch:
                        p.evaluate("(() => { const long = 'W'.repeat(80); const h = document.querySelector('#library h1'); if (h) h.textContent = long; })()")
                        p.wait_for_timeout(150)
                    r = p.evaluate(sp.PROBE); states += 1
                    tag = (width, mode, 'long heading' if stretch else 'as is')
                    if r['sideways']: found.append(tag + ('sideways scroll',))
                    for k in ('wide', 'cut', 'small', 'wrapped'):
                        for v in r[k]: found.append(tag + (k, v))
                    s = p.evaluate(aa.SCAN)
                    for k in ('noname', 'headings', 'contrast', 'small', 'noalt'):
                        for v in s[k]: found.append(tag + ('a11y-' + k, v))
                    p.screenshot(path=str(OUT / f'{mode}-{"long" if stretch else "asis"}-{width}.png'), full_page=True)
            if errors: found.append((width, 'all', 'page errors', errors[:2]))
            ctx.close()
        b.close()
    srv.shutdown()
    for f in found: print('FINDING', f)
    print(f'states checked: {states} (of 16); FINDINGS: {len(found)}')
    sys.exit(1 if found or states != 16 else 0)


if __name__ == '__main__':
    main()
