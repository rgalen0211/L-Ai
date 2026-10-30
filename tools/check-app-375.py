"""Phone layout pass of the signed-in app at 375 px wide (or the width given as the second argument) (NEXT-WEB 172), mock mode, LOCAL server only, `liveEditor` ON in a local config copy so the editor routes exist. For every route:
sideways scroll (the page wider than the screen), elements sticking out past the right edge (outside a deliberate scroller), visible controls under 44 px high, and console errors. Writes a full-page
screenshot per route and a list. Exit 0 only when no route scrolls sideways and no element sticks out. Needs Chrome.

    python tools/check-app-375.py [outdir]          (default D:/Ryagram-scratch/WEB/app-375-shots)
"""
import http.server, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/app-375-shots')
PORT = 8375
WIDTH = int(sys.argv[2]) if len(sys.argv) > 2 else 375
ROUTES = [('projects', '?mock#/'), ('projects-empty', '?mock&empty#/'), ('account', '?mock#/account'), ('credits', '?mock#/credits'), ('help', '?mock#/help'), ('looks', '?mock#/looks'),
          ('request', '?mock#/request'), ('start-door', '?mock&door#/start'), ('build', '?mock#/build'), ('editor-data', '?mock#/editor/data'), ('editor-data-banded', '?mock&banded#/editor/data'),
          ('editor-compilation', '?mock#/editor/compilation'), ('computers', '?mock&tester#/account'), ('device', '?mock#/device?code=ABCD-2345'), ('connect-consent', '?mock#/connect/consent?request=mock'),
          ('project', '?mock#/', ['a[href^="#/p/"]']), ('version', '?mock#/', ['a[href^="#/p/"]', 'a[href^="#/v/"]']),
          ('admin-ops', '?mock#/admin/ops'), ('admin-renders', '?mock#/admin/renders'), ('admin-tester', '?mock#/admin/tester'), ('admin-funnel', '?mock#/admin/funnel'),
          ('admin-visits', '?mock#/admin/visits'), ('admin-waitlist', '?mock#/admin/waitlist'), ('signed-out', '?signedout#/')]

SCAN = r"""() => {
  const W = document.documentElement.clientWidth, out = { h1: (([...document.querySelectorAll('h1')].find(e => e.getBoundingClientRect().height > 0 && !e.closest('[hidden]')) || {}).textContent || '(no heading)').trim().slice(0, 40), nodes: document.querySelectorAll('body *').length, wide: document.documentElement.scrollWidth > W, scrollW: document.documentElement.scrollWidth, over: [], small: 0, smallEx: [] };
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],[aria-hidden=true]'); };
  const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(' ')[0] : '');
  const inScroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('.mock-bar')) continue;                   // the mock's own test bar is scaffolding, not the site
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && !inScroller(el) && getComputedStyle(el).position !== 'fixed') out.over.push(desc(el) + ' right=' + Math.round(r.right));
  }
  for (const el of document.querySelectorAll('button,select,summary,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]),textarea')) {
    if (!vis(el) || el.closest('.mock-bar')) continue;
    if (el.getBoundingClientRect().height < 44) { out.small++; if (out.smallEx.length < 4) out.smallEx.push(desc(el) + ' ' + Math.round(el.getBoundingClientRect().height) + 'px'); }
  }
  out.over = out.over.slice(0, 6);
  return out;
}"""


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = re.sub(r'liveEditor:\s*false', 'liveEditor: true', (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8'))
OUT.mkdir(parents=True, exist_ok=True)
bad = 0
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, q, *steps in ROUTES:
        ctx = b.new_context(viewport={'width': WIDTH, 'height': 812}, device_scale_factor=1, is_mobile=True, has_touch=True)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
        ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        try:
            p.goto(f'http://127.0.0.1:{PORT}/app/{q}', wait_until='load'); p.wait_for_timeout(1800)
            for sel in (steps[0] if steps else []):
                p.locator(sel).first.click(); p.wait_for_timeout(1500)
            r = p.evaluate(SCAN)
            p.screenshot(path=str(OUT / f'{name}.png'), full_page=True)
        except Exception as e:                                                  # a route that cannot open is a finding, not a crash
            print(f'  ERR  {name}: {str(e)[:100]}'); bad += 1; ctx.close(); continue
        flag = r['wide'] or r['over']
        bad += 1 if flag else 0
        print(('  FAIL ' if flag else '  ok   ') + f"{name:<20} [{r['h1']}] width {r['scrollW']} px{'  OVER: ' + '; '.join(r['over']) if r['over'] else ''}   small controls: {r['small']}{' (' + ', '.join(r['smallEx']) + ')' if r['smallEx'] else ''}{'  ERRORS: ' + str(errs[:1]) if errs else ''}")
        ctx.close()
    b.close()
srv.shutdown()
print('ALL OK' if not bad else f'{bad} route(s) to fix'); sys.exit(0 if not bad else 1)
