"""Consumer-readiness walk: every public page and every signed-in screen (mock mode, fake data) at desktop and phone width, as a brand-new person would meet them.
For each screen it records a full-page screenshot and the mechanical problems a script can see: sideways scroll, tap targets under 40 px, images that failed or have no alt text,
form fields with no label, no or several h1, a missing <title>, console errors and failed requests, and text that looks unfinished (TODO, lorem, undefined, null, [object, NaN).
It does NOT judge wording or layout: a person reads the screenshots for that. Writes audit.json and the screenshots. Not part of the node suite (it needs Chrome).

    python tools/audit-walk.py [outdir]        (default D:/Ryagram-scratch/WEB/audit-shots)
"""
import http.server
import json
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/audit-shots')
PORT = 8190
BASE = f'http://127.0.0.1:{PORT}'

PUBLIC = [('home', '/'), ('ryagram', '/ryagram/'), ('ryagram-creators', '/ryagram/#creators'), ('signin', '/app/'), ('help', '/help/'), ('report', '/report/'),
          ('film-sample', '/film/'), ('privacy', '/privacy-policy.html'), ('terms', '/terms/'), ('notfound', '/no-such-page/')]
# signed-in screens in mock mode; `js` runs first (e.g. to empty the library or open a panel)
EMPTY = "(() => { const db = window.ryagramMock.client.db; db.projects.length = 0; db.versions.length = 0; db.jobs.length = 0; db.artifacts.length = 0; })()"
APP = [('app-empty-library', '/app/?mock#/', EMPTY), ('app-library', '/app/?mock#/', None), ('app-account', '/app/?mock#/account', None), ('app-credits', '/app/?mock#/credits', None),
       ('app-request', '/app/?mock#/request', None), ('app-help', '/app/?mock#/help', None), ('app-build', '/app/?mock#/build', None), ('app-looks', '/app/?mock#/looks', None),
       ('app-admin-ops', '/app/?mock#/admin/ops', None), ('app-admin-renders', '/app/?mock#/admin/renders', None), ('app-consent', '/app/?mock#/connect/consent?request=00000000-0000-4000-8000-0000000000aa', None),
       ('app-unknown-route', '/app/?mock#/nowhere', None)]
SUSPECT = re.compile(r'\b(TODO|FIXME|lorem ipsum|undefined|\[object|NaN|null)\b', re.I)

CHECKS = """() => {
  const out = { overflow: document.documentElement.scrollWidth > window.innerWidth + 1, title: document.title, h1: document.querySelectorAll('h1').length, small: [], noalt: [], nolabel: [], broken: [] };
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('a, button, input:not([type=hidden]), select, textarea, summary')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && !el.classList.contains('button');
    if (!inline && (r.height < 40 || r.width < 24) && !(el.type === 'checkbox' || el.type === 'radio')) out.small.push((el.innerText || el.getAttribute('aria-label') || el.name || el.id || el.tagName).trim().slice(0, 40) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  for (const img of document.querySelectorAll('img')) { if (!vis(img)) continue; if (!img.hasAttribute('alt')) out.noalt.push(img.src.slice(-40)); if (img.complete && img.naturalWidth === 0) out.broken.push(img.src.slice(-40)); }
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
    if (!vis(el)) continue;
    const has = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
    if (!has) out.nolabel.push(el.id || el.name || el.type);
  }
  out.text = document.body.innerText.slice(0, 6000);
  return out;
}"""


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(ROOT), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    report = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for width_name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                                     ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                for name, path, js in [(n, p, None) for n, p in PUBLIC] + APP:
                    ctx = b.new_context(**opts)
                    p = ctx.new_page()
                    errs, failed = [], []
                    p.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:160]))
                    p.on('console', lambda m: errs.append('console: ' + m.text[:160]) if m.type == 'error' else None)
                    p.on('requestfailed', lambda r: failed.append(r.url[-80:]))
                    p.on('response', lambda r: failed.append(f'{r.status} {r.url[-70:]}') if r.status >= 400 else None)
                    p.on('dialog', lambda d: d.accept())
                    entry = {'name': name, 'width': width_name, 'url': path}
                    try:
                        p.goto(BASE + path, wait_until='load', timeout=25000)
                        p.wait_for_timeout(1800)
                        if js:
                            p.evaluate(js)
                            p.evaluate("() => { const h = location.hash; location.hash = '#/x'; setTimeout(() => { location.hash = h; }, 30); }")
                            p.wait_for_timeout(1200)
                        r = p.evaluate(CHECKS)
                        text = r.pop('text')
                        r['suspect_text'] = sorted(set(m.group(0) for m in SUSPECT.finditer(text)))
                        r['chars'] = len(text.strip())
                        r['first_words'] = ' '.join(text.split())[:240]
                        entry.update(r)
                        p.screenshot(path=str(OUT / f'{name}-{width_name}.png'), full_page=True)
                    except Exception as e:                                       # noqa: BLE001
                        entry['error'] = str(e)[:200]
                    entry['console'] = [e for e in errs if 'status of 404' not in e][:6]
                    entry['failed'] = [f for f in failed if 'favicon' not in f][:6]
                    report.append(entry)
                    ctx.close()
            b.close()
    finally:
        srv.shutdown()
    (OUT / 'audit.json').write_text(json.dumps(report, indent=1), encoding='utf-8')
    for e in report:
        flags = [k for k in ('overflow',) if e.get(k)] + (['h1=%s' % e['h1']] if e.get('h1') != 1 else []) + (['small=%d' % len(e['small'])] if e.get('small') else []) \
            + (['noalt=%d' % len(e['noalt'])] if e.get('noalt') else []) + (['nolabel=%d' % len(e['nolabel'])] if e.get('nolabel') else []) + (['broken'] if e.get('broken') else []) \
            + (['suspect:' + ','.join(e['suspect_text'])] if e.get('suspect_text') else []) + (['console=%d' % len(e['console'])] if e.get('console') else []) + (['failed=%d' % len(e['failed'])] if e.get('failed') else []) \
            + (['ERROR ' + e['error']] if e.get('error') else [])
        print(f"{e['width'][:2]} {e['name']:<20} {' '.join(flags) or 'ok'}")
    print('written', OUT / 'audit.json')


if __name__ == '__main__':
    main()
