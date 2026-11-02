"""The TV screen page for Guess the next line (/game-tv/, NEXT-WEB 203) in real Chrome, LOCAL server only, `gameTv` ON in a local config copy, desktop and phone (375 and 320 px): the whole recorded game
is walked with the keyboard and the button; BEFORE the guesses are locked the page holds neither the answer nor any typed guess; after the reveal it shows the answer, each player's marks with words (not colour alone)
and points, the running scores; the final screen names the winner (a tie shares first place); the timer locks the guesses on its own; no outside request; no sideways scroll; no console errors. Needs Chrome.
    python tools/check-game-tv.py"""
import http.server, json, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8323
S = json.loads((ROOT / 'tests/fixtures/game-night-sample.json').read_text(encoding='utf-8'))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'gameTv:\s*false', 'gameTv: true', base)
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def page(b, cfg, opts, errs, hosts):
    ctx = b.new_context(**opts)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q, c=cfg: r.fulfill(status=200, content_type='text/javascript', body=c))
    p = ctx.new_page()
    p.on('request', lambda rq: hosts.add(re.match(r'https?://[^/]+', rq.url).group(0)) if re.match(r'https?://', rq.url) else None)
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    return p


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, opts in (('desktop', dict(viewport={'width': 1200, 'height': 900})), ('phone375', dict(viewport={'width': 375, 'height': 812}, device_scale_factor=2, is_mobile=True, has_touch=True)),
                       ('phone320', dict(viewport={'width': 320, 'height': 700}, device_scale_factor=2, is_mobile=True, has_touch=True))):
        print(name)
        errs, hosts = [], set()
        p = page(b, on_cfg, opts, errs, hosts)
        p.goto(f'http://127.0.0.1:{PORT}/game-tv/', wait_until='load'); p.wait_for_selector('.tv-screen', timeout=20000)
        check('SAMPLE NIGHT' in p.inner_text('.tv-screen'), 'the sample banner shows')
        for i, r in enumerate(S['rounds']):
            ans, heard = r['reveal']['answer_text'], r['public']['heard_text']
            t = p.inner_text('.tv-screen')
            check(f'Round {i + 1} of 3' in t and heard in t and ans not in t and not any(g['text'] and g['text'] in t for g in r['guesses']), f'round {i + 1} question: the heard words show, the answer and every guess are NOT on the page')
            check(p.evaluate('document.activeElement.tagName') == 'H2', f'round {i + 1}: focus moves to the round heading')
            p.get_by_role('button', name='Lock the guesses').click(); p.wait_for_timeout(100)
            t = p.inner_text('.tv-screen')
            check(all((g['text'] in t) for g in r['guesses'] if g['text']) and ans not in t, f'round {i + 1} locked: the guesses show and the answer still does not')
            p.keyboard.press('ArrowRight'); p.wait_for_timeout(100)
            t = p.inner_text('.tv-screen')
            marks = p.locator('.tv-mark').all_inner_texts()
            sym_ok = all(re.match(r'^[\u2713\u2248\u2717] ', m) and re.search(r'\((right|nearly|missed)\)$', m) for m in marks)
            check(ans in t and sym_ok and len(marks) == 3 * len(ans.split()), f'round {i + 1} reveal: the answer, and every word marked with a symbol AND a word')
            pts = [int(x.strip('+')) for x in p.locator('.tv-pts').all_inner_texts()]
            check(pts == [g['result']['points'] for g in r['guesses']], f'round {i + 1}: each players points are the engines: {pts}')
            p.keyboard.press('ArrowRight'); p.wait_for_timeout(100)
        t = p.inner_text('.tv-screen')
        top = max(S['totals'].values()); winners = [k for k, v in S['totals'].items() if v == top]
        said = (' and '.join(winners) + ' share first place') if len(winners) > 1 else (winners[0] + ' wins')
        check('Final scores' in t and said in t, f'the final screen names the winner: {winners}')
        check(all(k in t and str(v) in t for k, v in S['totals'].items()), 'the final table has every total')
        check(p.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'no sideways scroll')
        check(hosts <= {f'http://127.0.0.1:{PORT}', 'https://fonts.googleapis.com'}, f'no outside request: {sorted(hosts)}')
        check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
        p.screenshot(path=str(Path('D:/Ryagram-scratch/WEB/temp') / f'game-tv-{name}.png'), full_page=True)
        p.get_by_role('button', name='Play the sample again').click(); p.wait_for_timeout(100)
        check('Round 1 of 3' in p.inner_text('.tv-screen'), 'the sample can be played again')
        p.context.close()
    print('timer and switch off')
    errs, hosts = [], set()
    p = page(b, on_cfg, dict(viewport={'width': 1200, 'height': 900}), errs, hosts)
    p.clock.install(); p.goto(f'http://127.0.0.1:{PORT}/game-tv/', wait_until='load'); p.wait_for_selector('.tv-timer')
    check('30 seconds left' in p.inner_text('.tv-timer'), 'the timer starts at 30 seconds')
    p.clock.run_for(5000); check('25 seconds left' in p.inner_text('.tv-timer'), 'it counts down')
    p.get_by_role('button', name='Pause the timer').click(); p.clock.run_for(5000); check('25 seconds left' in p.inner_text('.tv-timer'), 'it can be paused')
    p.get_by_role('button', name='Resume the timer').click(); p.clock.run_for(26000)
    check('the guesses are in' in p.inner_text('.tv-screen').lower(), 'when time is up the guesses lock by themselves')
    p.context.close()
    p = page(b, base, dict(viewport={'width': 1200, 'height': 900}), errs, hosts)
    p.goto(f'http://127.0.0.1:{PORT}/game-tv/', wait_until='load'); p.wait_for_timeout(500)
    check(p.inner_text('main').strip() == 'This page is not available yet.', 'with the switch off only the plain line shows')
    p.context.close(); b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
