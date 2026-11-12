"""The /ryagram/ waitlist form against a STAND-IN join_waitlist (BACKLOG WEB, CC1 09:32) in real Chrome, LOCAL server only, desktop and phone: the form posts to rpc/join_waitlist (never the table) with
p_email, p_reason and p_source; a new and a repeat address get the same words; a refusal shows the server's plain sentence and an odd error shows the page's own line; the reason field stops at 140 characters; no
request to the table; no console errors. Every call to the project's address is answered by the route here (the page's CSP allows only that host): nothing leaves the PC.   python tools/check-waitlist-join.py"""
import http.server, json, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


cfg = "window.ryagramConfig = { supabaseUrl: 'https://jxtkfishqfxuptwjzczz.supabase.co', supabaseKey: 'sb_publishable_stub' };"
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True))):
        print(name)
        for case, reply in (('new', (200, {'ok': True, 'message': 'x'})), ('repeat', (200, {'ok': True, 'message': 'x'})), ('refusal', (400, {'message': 'That does not look like an email address.'})), ('odd', (400, {'message': 'duplicate key value for a@b.c'}))):
            ctx = b.new_context(**opts); seen = []; errs = []
            ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
            ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=cfg))
            ctx.route('https://jxtkfishqfxuptwjzczz.supabase.co/**', lambda r, _q, rep=reply: (seen.append((r.request.method, r.request.url, r.request.post_data)), r.fulfill(status=rep[0], content_type='application/json', body=json.dumps(rep[1]))))
            p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e)))
            p.goto(f'http://127.0.0.1:{PORT}/ryagram/?utm_source=film_page&utm_campaign=r002', wait_until='load')
            p.fill('#wl-email', 'person@example.com'); p.fill('#wl-use', 'teacher ' + 'x' * 300)
            check(len(p.input_value('#wl-use')) == 140, f'{case}: the reason field stops at 140')
            p.click('#waitlist-form button[type=submit]'); p.wait_for_timeout(400)
            calls = [s for s in seen if 'record_visit' not in s[1]]
            check(len(calls) == 1 and calls[0][1].endswith('/rest/v1/rpc/join_waitlist') and not any('ryagram_waitlist' in s[1] for s in seen), f'{case}: one call, to join_waitlist, none to the table')
            body = json.loads(calls[0][2]) if calls else {}
            check(set(body) == {'p_email', 'p_reason', 'p_source'} and body.get('p_source', '').startswith('uselai.com/ryagram?utm_source=film_page') and len(body.get('p_reason') or '') == 140, f'{case}: the body has email, reason (140) and source')
            t = p.inner_text('#waitlist-status')
            if case in ('new', 'repeat'): check('on the list' in t and 'x' != t, f'{case}: the page\'s own success words')
            elif case == 'refusal': check('does not look like an email address' in t and p.is_visible('#wl-email'), f'{case}: the plain sentence shows and the form stays')
            else: check('couldn’t add you' in t and 'duplicate' not in t and 'a@b.c' not in t, f'{case}: an odd error shows the page\'s own line, no database words')
            check(not errs, f'{case}: no page errors')
            ctx.close()
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
