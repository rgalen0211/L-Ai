"""Page weight pass (local, mock mode, real Chrome at 1280 px, cold cache): for every app page and the public pages, the number of requests, the bytes (as served here, and as GitHub Pages would send the text files
gzipped), the time until the page is ready (the key control of that page is on screen), and, for a few pages, how much of each script and stylesheet the page actually ran. Outside hosts (the Supabase library on
jsDelivr, Google Fonts) are counted apart because they are not ours to shrink. Each page is measured 3 times and the median is reported. Writes a table; exit 0.

    python tools/audit-page-weight.py [out.json]
"""
import gzip
import http.server
import json
import socketserver
import statistics
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8197
BASE = f'http://127.0.0.1:{PORT}'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TEXT = ('text/', 'javascript', 'json', 'svg', 'xml')

# (name, url, the selector that means "ready")
APP = [('library', '/app/?mock#/', '#np-title'), ('project', '/app/?mock#/p/00000000-0000-4000-8000-000000000001', 'h1'), ('version', '/app/?mock#/v/00000000-0000-4000-8000-000000000004', 'h2:has-text("Render")'),
       ('account', '/app/?mock#/account', '#acct-password'), ('credits', '/app/?mock#/credits', 'h1:has-text("Credits")'), ('request a film', '/app/?mock#/request', '#rq-question'),
       ('help', '/app/?mock#/help', 'h1'), ('guided builder', '/app/?mock#/build', 'h2:has-text("Which data?")'), ('your look', '/app/?mock#/looks', 'h1:has-text("Your look")'),
       ('consent', '/app/?mock#/connect/consent?request=00000000-0000-4000-8000-0000000000aa', 'h1'), ('admin: ops', '/app/?mock#/admin/ops', 'h1'), ('admin: render approvals', '/app/?mock#/admin/renders', 'h1')]
PUBLIC = [('home', '/', 'h1'), ('ryagram landing', '/ryagram/', 'h1'), ('help (public)', '/help/', 'h1'), ('terms', '/terms/', 'h1'), ('privacy', '/privacy-policy.html', 'h1'),
          ('AI content', '/ai-content/', 'h1'), ('film page sample', '/film/?mock', 'h1'), ('connect your AI', '/connect-ai/', 'h1')]
COVER = {'library', 'version', 'guided builder', 'ryagram landing'}


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


def used_bytes(entry, text_len):
    """Bytes of a script that never ran: the union of V8's count-0 block ranges."""
    cold = []
    for fn in entry.get('functions', []):
        for r in fn['ranges']:
            if r['count'] == 0:
                cold.append((r['startOffset'], r['endOffset']))
    cold.sort()
    total, cur_end = 0, -1
    for a, b in cold:
        a = max(a, cur_end)
        if b > a:
            total += b - a
            cur_end = b
    return text_len - total


def css_used(entry):
    return sum(r['end'] - r['start'] for r in entry['ranges'])


def measure_once(browser, url, ready, cover):
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    resp = []
    page.on('response', lambda r: resp.append(r))
    cdp, sheets = None, {}
    if cover:
        cdp = ctx.new_cdp_session(page)
        cdp.on('CSS.styleSheetAdded', lambda e: sheets.__setitem__(e['header']['styleSheetId'], e['header']))
        for m in ('Profiler.enable', 'Debugger.enable', 'DOM.enable', 'CSS.enable', 'CSS.startRuleUsageTracking'):
            cdp.send(m)
        cdp.send('Profiler.startPreciseCoverage', {'callCount': True, 'detailed': True})
    t0 = time.time()
    page.goto(BASE + url, wait_until='load')
    load_ms = (time.time() - t0) * 1000
    try:
        page.wait_for_selector(ready, state='attached', timeout=20000)
        page.wait_for_function('true')
    except Exception:  # noqa: BLE001
        pass
    ready_ms = page.evaluate('performance.now()')
    page.wait_for_timeout(700)                               # let late requests settle
    nav = page.evaluate("(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; })()")
    rows = []
    for r in resp:
        u = urlparse(r.url)
        own = u.hostname in ('127.0.0.1', 'localhost')
        try:
            sz = r.request.sizes()
            raw = sz['responseBodySize']
        except Exception:  # noqa: BLE001
            raw = 0
        ctype = r.headers.get('content-type', '')
        gz = raw
        if own and raw and any(t in ctype for t in TEXT):
            try:
                gz = len(gzip.compress(r.body(), 6))
            except Exception:  # noqa: BLE001
                pass
        rows.append({'url': u.path + (('?' + u.query) if u.query else '') if own else r.url, 'own': own, 'raw': raw, 'gz': gz, 'type': ctype.split(';')[0], 'status': r.status})
    cov = None
    if cover:
        cov = []
        for e in cdp.send('Profiler.takePreciseCoverage')['result']:
            if urlparse(e['url']).hostname in ('127.0.0.1', 'localhost'):
                src = cdp.send('Debugger.getScriptSource', {'scriptId': e['scriptId']})['scriptSource']
                cov.append({'url': urlparse(e['url']).path, 'kind': 'js', 'total': len(src), 'unused': len(src) - used_bytes(e, len(src))})
        used = {}
        for r in cdp.send('CSS.stopRuleUsageTracking')['ruleUsage']:
            if r['used']:
                used[r['styleSheetId']] = used.get(r['styleSheetId'], 0) + (r['endOffset'] - r['startOffset'])
        for sid, h in sheets.items():
            if urlparse(h.get('sourceURL', '')).hostname in ('127.0.0.1', 'localhost') and h.get('length'):
                cov.append({'url': urlparse(h['sourceURL']).path, 'kind': 'css', 'total': h['length'], 'unused': max(0, h['length'] - used.get(sid, 0))})
    ctx.close()
    return {'load_ms': load_ms, 'ready_ms': ready_ms, 'dcl': nav['dcl'], 'rows': rows, 'cov': cov}


def main():
    srv = serve()
    results = {}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for group, pages in (('app', APP), ('public', PUBLIC)):
                for name, url, ready in pages:
                    runs = [measure_once(b, url, ready, name in COVER and i == 0) for i in range(3)]
                    runs_sorted = sorted(runs, key=lambda r: r['ready_ms'])
                    med = runs_sorted[1]
                    own = [r for r in med['rows'] if r['own']]
                    ext = [r for r in med['rows'] if not r['own']]
                    cov = next((r['cov'] for r in runs if r['cov']), None)
                    results[name] = {'group': group, 'url': url, 'requests': len(own), 'ext_requests': len(ext), 'raw': sum(r['raw'] for r in own), 'gz': sum(r['gz'] for r in own), 'ext_bytes': sum(r['raw'] for r in ext),
                                     'ready_ms': round(statistics.median(r['ready_ms'] for r in runs)), 'dcl_ms': round(statistics.median(r['dcl'] for r in runs)), 'load_ms': round(statistics.median(r['load_ms'] for r in runs)),
                                     'top': sorted(own, key=lambda r: -r['raw'])[:5], 'ext': ext, 'cov': cov}
                    print(f"{name:24} own {results[name]['requests']:>3} req {results[name]['raw'] / 1024:>8.0f} KB raw {results[name]['gz'] / 1024:>7.0f} KB gz | ext {results[name]['ext_requests']} req {results[name]['ext_bytes'] / 1024:>5.0f} KB | ready {results[name]['ready_ms']:>5} ms", flush=True)
            b.close()
    finally:
        srv.shutdown()
    if OUT:
        OUT.write_text(json.dumps(results, indent=1), encoding='utf8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
