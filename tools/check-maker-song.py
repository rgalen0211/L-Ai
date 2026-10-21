"""The song screens (tools/maker-song/) in real Chrome, LOCAL server only. No request leaves 127.0.0.1.

Part A, the practice build (?fixture): paste the words (the practice words), refuse a build with no music in plain words, choose music and a singing track, build; every word is a box on its line with its beat and
its voice; the summary says plainly what is said as it is, built from sounds, a gap; a gap can be left quiet; a built word shows its pieces; a flagged word says why; swap in another take and see the plan change;
hear a line (a tone per word in the practice build); keyboard use of the word boxes; save, reload and see the same song; every control has a name; the phone width; the film button.
Part B, the maker host: a tiny stand-in for the maker's local server (token on every call) serves the page's /api/song calls; track, guide, build, hear, save and render are checked against what the server saw.
Writes screenshots. Not part of the node suite (needs Chrome).

    python tools/check-maker-song.py [outdir]      (default D:/Ryagram-scratch/WEB/maker-song-shots)
"""
import http.server
import json
import socketserver
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / 'tools' / 'maker-song'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/maker-song-shots')
PORT = 8198
TOKEN = 'tok456'
STATE = {'plan': None, 'saved': [], 'renders': 0, 'builds': [], 'hears': [], 'tracks': 0, 'guides': 0, 'stored': None}
WAV = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00@\x1f\x00\x00@\x1f\x00\x00\x01\x00\x08\x00data\x00\x00\x00\x00'


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _api(self, method):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        tok = self.headers.get('X-Maker-Token') or (q.get('t') or [''])[0]
        if tok != TOKEN:
            return self._json(403, {'error': 'Open the address the maker printed when it started (it has the token in it).'})
        body = {}
        if method == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}')
        if u.path == '/api/song' and method == 'GET':
            return self._json(200, {'plan': STATE['stored']})
        if u.path == '/api/song' and method == 'POST':
            STATE['saved'].append(body['plan'])
            return self._json(200, {'saved': True})
        if u.path == '/api/song/track':
            STATE['tracks'] += 1
            return self._json(200, {'track': {'file_name': 'api-track.mp3', 'seconds': 40}})
        if u.path == '/api/song/guide':
            STATE['guides'] += 1
            return self._json(200, {'guide': {'file_name': 'api-singing.wav'}})
        if u.path == '/api/song/build':
            STATE['builds'].append(body)
            return self._json(200, {'plan': STATE['plan']})
        if u.path == '/api/song/hear':
            STATE['hears'].append(body)
            return self._json(200, {'url': '/api/song/audio?x=1'})
        if u.path == '/api/song/audio':
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(WAV)))
            self.end_headers()
            self.wfile.write(WAV)
            return None
        if u.path == '/api/song/render':
            STATE['renders'] += 1
            return self._json(200, {'message': 'The render has started.'})
        return self._json(404, {'error': 'Not found.'})

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self._api('GET')
        return super().do_GET()

    def do_POST(self):
        return self._api('POST')


ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w)
    ok = ok and bool(c)


def until(p, js, ms=8000):
    """Poll a page expression (the page's content policy forbids Playwright's string-eval wait_for_function)."""
    end = time.time() + ms / 1000
    while time.time() < end:
        if p.evaluate('() => ' + js):
            return True
        time.sleep(0.05)
    raise AssertionError('timed out waiting for: ' + js)


NAMES_JS = """() => [...document.querySelectorAll('button, input, select, textarea')].filter(e => e.offsetParent !== null).filter(e => {
  const lab = (e.labels && e.labels.length) || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.textContent || '').trim();
  return !lab; }).map(e => e.outerHTML.slice(0, 80))"""


def chip(p, n, i):
    return p.locator(f'button.chip[data-n="{n}"][data-i="{i}"]')


def find_chip(p, cls):
    # the first word box with this state class: returns (n, i)
    r = p.evaluate("cls => { const c = document.querySelector('button.chip.' + cls); return c ? [Number(c.dataset.n), Number(c.dataset.i)] : null; }", cls)
    return r


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{PORT}'
    external = []
    errs = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            try:
                def make_route():
                    def route(r):
                        if not r.request.url.startswith('http://127.0.0.1') and not r.request.url.startswith('data:'):
                            external.append(r.request.url)
                            return r.abort()
                        return r.continue_()
                    return route

                def new_page(ctx):
                    pg = ctx.new_page()
                    pg.on('pageerror', lambda e: errs.append(str(e)))
                    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '403' not in m.text else None)      # the wrong-token page is meant to get a 403
                    return pg

                ctx = b.new_context(viewport={'width': 1000, 'height': 1000})
                ctx.route('**/*', make_route())
                p = new_page(ctx)
                print('A. the practice build')
                p.goto(f'{base}/song.html?fixture', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                check(p.locator('#s-board').is_hidden(), 'the board is not there before a build')
                p.get_by_role('button', name='Build my song').click()
                check('Paste your words' in p.locator('#msg').inner_text(), 'a build with no words says so in plain words')
                p.get_by_role('button', name='Use the practice words').click()
                check('4 lines, 20 words' in p.locator('#count').inner_text(), 'the words are counted ("' + p.locator('#count').inner_text() + '")')
                p.get_by_role('button', name='Build my song').click()
                check('Choose your music first' in p.locator('#msg').inner_text(), 'a build with no music says so in plain words')
                p.get_by_role('button', name='Choose your music').click()
                p.wait_for_selector('text=my-song.mp3')
                p.get_by_role('button', name='Add a track of just the singing (optional)').click()
                p.wait_for_selector('text=my-guide-vocal.wav')
                p.get_by_role('button', name='Build my song').click()
                p.wait_for_selector('#s-board:not([hidden])', timeout=10000)
                check(p.locator('button.chip').count() == 20, 'every word is a box: 20 words in 4 lines')
                check(p.locator('section.line').count() == 4, 'one lane for each line')
                sumtxt = p.locator('#sum').inner_text()
                check('real voices' in sumtxt and 'built from sounds' in sumtxt and 'a gap' in sumtxt and 'voice changes' in sumtxt, 'the summary says plainly what was found')
                p.screenshot(path=str(OUT / 'song-1-board.png'), full_page=True)

                print('   a word, a gap, a built word, a flag')
                n, i = find_chip(p, 'st-whole')
                lab = chip(p, n, i).get_attribute('aria-label')
                check(lab.startswith(f'Line {n}, word {i + 1}:') and 'Beat 0:' in lab and ('Voice' in lab or 'Narrator' in lab) and 'Said as it is' in lab, 'a word box is named with its line, beat, voice and state')
                check('v-a' not in lab and 'v-b' not in lab, 'a voice is never shown as an id')
                gn, gi = find_chip(p, 'st-gap')
                chip(p, gn, gi).click()
                dt = p.locator('#detail').inner_text()
                check('Nobody in the videos you chose says this word' in dt and 'Leave this beat quiet' in dt, 'a gap says plainly why and offers to leave it quiet')
                p.get_by_role('button', name='Leave this beat quiet').click()
                check(chip(p, gn, gi).get_attribute('class').count('st-quiet') == 1 and 'left quiet' in p.locator('#sum').inner_text(), 'left quiet: the box and the summary change')
                check(p.evaluate("document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key") == f'chip-{gn}-{gi}', 'the focus stays on the box after a change')
                p.get_by_role('button', name='Put it back as a gap').click()
                check('st-gap' in chip(p, gn, gi).get_attribute('class'), 'put back as a gap')
                bn, bi = find_chip(p, 'st-syllables')
                chip(p, bn, bi).click()
                check('Built from sounds:' in p.locator('#detail').inner_text() and ' + ' in p.locator('#detail').inner_text(), 'a built word shows the sounds it was built from')
                fn, fi = p.evaluate("() => { const c = document.querySelector('button.chip.flag'); return [Number(c.dataset.n), Number(c.dataset.i)]; }")
                chip(p, fn, fi).click()
                check(p.locator('#flags li').count() >= 1, 'a flagged word says why: "' + p.locator('#flags li').first.inner_text() + '"')

                print('   swap another take')
                wn, wi = p.evaluate("() => { const l = window.ryagramSong.plan.lines; for (const x of l) for (let k = 0; k < x.words.length; k++) { const w = x.words[k]; if (w.status === 'whole' && w.alternatives.length >= 2) return [x.n, k]; } }")
                chip(p, wn, wi).click()
                before = p.evaluate(f"window.ryagramSong.plan.lines[{wn - 1}].words[{wi}]")
                alt = before['alternatives'][0]
                p.locator(f'[data-key="use-{alt["id"]}"]').click()
                after = p.evaluate(f"window.ryagramSong.plan.lines[{wn - 1}].words[{wi}]")
                check(after['file_name'] == alt['file_name'] and after['src_s'] == alt['src_s'] and after['beat_s'] == before['beat_s'], 'the other take is in, the beat has not moved')
                check(any(a['file_name'] == before['file_name'] and a['src_s'] == before['src_s'] for a in after['alternatives']), 'the take it replaced is offered to go back to')
                check(alt['file_name'] in p.locator('#detail').inner_text(), 'the detail now names the new take')

                print('   hear, keyboard, save')
                p.locator('[data-key="hear-line-1"]').click()
                p.wait_for_timeout(300)
                heard = p.evaluate('window.ryagramSong.state.heard')
                check(heard and heard[-1]['kind'] == 'line' and heard[-1]['n'] == 1 and heard[-1]['tones'] > 0, f'Hear this line plays a tone for each word with a voice ({heard[-1] if heard else None})')
                p.evaluate("window.ryagramSong.state.audio && window.ryagramSong.state.audio.close()")
                chip(p, 2, 0).focus()
                p.keyboard.press('Tab')
                p.keyboard.press('Enter')
                sel = p.evaluate('window.ryagramSong.state.sel')
                check(sel == {'n': 2, 'i': 1}, 'Tab then Enter chooses the next word box (keyboard only)')
                p.get_by_role('button', name='Save my song').click()
                until(p, "document.getElementById('save').textContent === 'Saved'")
                saved = p.evaluate('window.ryagramSong.saveText()')
                p.reload(wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                check(p.evaluate('window.ryagramSong.saveText()') == saved and p.locator('button.chip').count() == 20, 'reopened: the same song, the same bytes')
                check('C:\\\\' not in saved and '/Users/' not in saved, 'the saved plan holds no path')

                print('   names, the film, the phone')
                nameless = p.evaluate(NAMES_JS)
                check(not nameless, f'every button, box and menu has a name ({nameless[:2]})')
                p.evaluate("window.ryagramSong.host.render = () => new Promise(r => setTimeout(() => r({ message: 'The render has started.' }), 400))")
                p.get_by_role('button', name='Make the film').click()
                check(p.locator('#render').is_disabled(), 'while the film is made the button is off (a second press is refused)')
                until(p, "!document.getElementById('render').disabled")
                ctx.close()

                ctx = b.new_context(viewport={'width': 375, 'height': 812})
                ctx.route('**/*', make_route())
                p = new_page(ctx)
                p.goto(f'{base}/song.html?fixture', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                p.get_by_role('button', name='Use the practice words').click()
                p.get_by_role('button', name='Choose your music').click()
                p.wait_for_selector('text=my-song.mp3')
                p.get_by_role('button', name='Build my song').click()
                p.wait_for_selector('button.chip')
                w = p.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
                check(w[0] <= w[1], f'no sideways page scroll at 375 px ({w})')
                small = p.evaluate("[...document.querySelectorAll('button, select, textarea')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 43).map(e => e.outerHTML.slice(0, 60))")
                check(not small, f'every button is at least 44 px tall ({small[:2]})')
                p.screenshot(path=str(OUT / 'song-2-phone.png'), full_page=True)
                ctx.close()

                print('B. the maker host')
                ctx = b.new_context(viewport={'width': 1000, 'height': 1000})
                ctx.route('**/*', make_route())
                p = new_page(ctx)
                p.goto(f'{base}/song.html?fixture', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                p.get_by_role('button', name='Use the practice words').click()
                p.get_by_role('button', name='Choose your music').click()
                p.wait_for_selector('text=my-song.mp3')
                p.get_by_role('button', name='Build my song').click()
                p.wait_for_selector('#s-board:not([hidden])')
                STATE['plan'] = p.evaluate('window.ryagramSong.plan')
                p.close()
                p = new_page(ctx)
                p.goto(f'{base}/song.html?t=wrong', wait_until='load')
                p.wait_for_timeout(600)
                txt = p.locator('#top').inner_text()
                check('Open the address the maker printed' in txt and '403' not in txt and 'Traceback' not in txt, 'a wrong token gives a plain sentence')
                p.goto(f'{base}/song.html?t={TOKEN}', wait_until='load')
                p.wait_for_selector('html[data-ready="1"]', timeout=15000)
                check(p.locator('#s-board').is_hidden() and p.locator('#lyrics').count() == 1, 'with nothing saved, the page starts at the words')
                p.fill('#lyrics', 'one line of my own\nand a second one')
                p.get_by_role('button', name='Choose your music').click()
                p.wait_for_selector('text=api-track.mp3')
                p.get_by_role('button', name='Add a track of just the singing (optional)').click()
                p.wait_for_selector('text=api-singing.wav')
                p.get_by_role('button', name='Build my song').click()
                p.wait_for_selector('#s-board:not([hidden])', timeout=10000)
                bq = STATE['builds'][-1]
                check(bq['lines'] == ['one line of my own', 'and a second one'] and bq['track']['file_name'] == 'api-track.mp3' and bq['guide']['file_name'] == 'api-singing.wav', 'the maker received the lines, the track and the singing track by name')
                p.locator('[data-key="hear-line-1"]').click()
                until(p, "document.getElementById('player').src.includes('/api/song/audio')")
                check(STATE['hears'][-1] == {'kind': 'line', 'n': 1} and 't=tok456' in p.evaluate("document.getElementById('player').src"), 'Hear asks the maker, and plays what it returns')
                p.get_by_role('button', name='Save my song').click()
                until(p, "document.getElementById('save').textContent === 'Saved'")
                mine = p.evaluate('window.ryagramSong.saveText()')
                check(json.dumps(STATE['saved'][-1], sort_keys=True) == json.dumps(json.loads(mine), sort_keys=True), 'the maker received exactly the plan the page holds')
                p.get_by_role('button', name='Make the film').click()
                until(p, "document.getElementById('live').textContent.includes('render has started')")
                check(STATE['renders'] == 1, 'Make the film sent one request, after saving')
                ctx.close()
            finally:
                b.close()
    finally:
        srv.shutdown()
    check(not errs, f'no page errors or console errors ({errs[:2]})')
    check(not external, f'every request to another host was refused ({len(external)})')
    print('RESULT: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
