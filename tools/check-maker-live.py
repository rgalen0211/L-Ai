"""The maker's standalone live editor (tools/maker-live/live.html) in real Chrome, LOCAL server only, desktop and phone: the page runs under its own strict policy (no inline anything,
nothing but its own address), reads its host from the address (?t=token&mode=&project=), keeps the token out of the address bar and sends it only as the X-Maker-Token header, talks to the
PC ONLY through POST /api/live/rpc with the five editor_* names (the PC is faked here by CONNECT's stand-in, tests/fake-editor-rpcs.js), applies a change only after the PC accepts it,
shows the AI's change from the draft, refuses the lanes the maker can not build, and never asks the website for anything.

    python tools/check-maker-live.py [outdir]        (default D:/Ryagram-scratch/WEB/maker-live-shots)
"""
import http.server
import json
import socketserver
import struct
import sys
import threading
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/maker-live-shots')
PORT = 8271
BASE = f'http://127.0.0.1:{PORT}'
PROJECT = '00000000-0000-4000-8000-0000000000a1'
TOKEN = 'T0KEN-for-this-test'
SUMMARY = {'duration': 12, 'lanes': ['video', 'text'], 'limits': {'text_chars': 20}, 'clips': [
    {'id': 'v1', 'track': 'video', 'start': 0, 'len': 2, 'label': 'great news everyone', 'source': 'a.mp4', 'source_start': 4, 'min_len': 0.3, 'max_len': 6},
    {'id': 'v2', 'track': 'video', 'start': 2, 'len': 2, 'label': 'we built a thing', 'source': 'a.mp4', 'source_start': 20, 'min_len': 0.3, 'max_len': 5, 'ai_altered': True},
    {'id': 'v3', 'track': 'video', 'start': 4, 'len': 3, 'label': 'for the weekend', 'source': 'b.mp4', 'source_start': 0, 'min_len': 0.3, 'max_len': 9},
    {'id': 'p1', 'track': 'pictures', 'start': 1.5, 'len': 2, 'label': 'house price', 'picture': 'img-1'},
    {'id': 't1', 'track': 'text', 'start': 0.2, 'len': 3.5, 'label': 'Title', 'text': 'Housing', 'style': 'caption', 'min_len': 0.5, 'max_len': 30},
    {'id': 'm1', 'track': 'music', 'start': 0, 'len': 12, 'label': 'music'}]}


def png(w, h, rgb):
    """a small solid PNG: the stand-in for the maker's frame answer"""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


TEAL = (40, 160, 140)
RULES = json.loads((ROOT / 'tests/fixtures/text-rules-1280x720.json').read_text(encoding='utf-8'))


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
    ok = True

    def check(cond, what):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + what)
        ok = ok and bool(cond)

    fake_js = (ROOT / 'tests/fake-editor-rpcs.js').read_text(encoding='utf-8')
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                phone = name == 'phone'
                ctx = b.new_context(**opts)
                # the PC: a second, plain page that runs CONNECT's stand-in; the route answers the page's rpc from it
                pc = ctx.new_page()
                pc.set_content('<html><body>pc</body></html>')
                pc.add_script_tag(content=fake_js)
                pc.evaluate("([p, s]) => { window.pc = window.createEditorRpcs({}); window.pc.app.post(p, { mirror: true, aiVisible: true, summary: s }); }", [PROJECT, SUMMARY])
                calls, headers, other = [], [], []

                def on_rpc(route):
                    req = route.request
                    body = json.loads(req.post_data or '{}')
                    calls.append(body['name'])
                    headers.append(req.headers.get('x-maker-token'))
                    res = pc.evaluate("([n, a]) => window.pc.rpcs[n](a)", [body['name'], body['args']])
                    route.fulfill(status=200, content_type='application/json', body=json.dumps(res))
                ctx.route('**/api/live/rpc', on_rpc)
                renders, held = [], []

                def on_render(route):
                    renders.append((route.request.headers.get('x-maker-token'), route.request.post_data))
                    held.append(route)                                     # not answered yet: the film is still being built
                ctx.route('**/api/live/render', on_render)
                frames, rules_calls = [], []

                def on_frame(route):
                    frames.append((route.request.url, route.request.headers.get('x-maker-token')))
                    route.fulfill(status=200, content_type='image/png', body=png(320, 180, TEAL))

                def on_rules(route):
                    rules_calls.append(route.request.headers.get('x-maker-token'))
                    route.fulfill(status=200, content_type='application/json', body=json.dumps({'rules': RULES}))
                ctx.route('**/api/live/frame**', on_frame)
                ctx.route('**/api/live/text-rules', on_rules)
                p = ctx.new_page()
                errors = []
                p.on('pageerror', lambda e: errors.append(str(e)))
                p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
                p.on('request', lambda r: other.append(r.url) if not r.url.startswith(BASE) else None)
                p.goto(f'{BASE}/tools/maker-live/live.html?t={TOKEN}&mode=compilation&project={PROJECT}', wait_until='load')
                p.wait_for_selector('.le-panel')
                p.wait_for_timeout(700)
                check(TOKEN not in p.url and 't' not in dict(kv.split('=') for kv in p.url.split('?')[1].split('&')), 'the token is taken out of the address bar')
                check(p.inner_text('h1') == 'Edit your film', 'the page has its own plain title (no site shell, no mock title)')
                check(p.locator('header, nav, .brand').count() == 0 and 'All projects' not in p.inner_text('main'), 'no site shell: no header, no link back to the website\u2019s projects')
                check(calls and all(n in ('my_edit_ops_since', 'editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'editor_heartbeat') for n in calls), 'the page asked the PC only through the five editor names')
                check(set(headers) == {TOKEN}, 'every call carried the token as the X-Maker-Token header')
                # the preview is the film's own frame, with the text laid out by the film's rules
                p.wait_for_selector('canvas.le-canvas')
                p.wait_for_timeout(600)
                check(any('clip=v3' in u for u, _ in frames), 'the preview asked the maker for the frame of the clip under the playhead (v3 at 4.4 s)')
                check(frames and all(tk == TOKEN for _, tk in frames) and rules_calls == [TOKEN], 'frames and text rules were asked with the token header only')
                px = lambda x, y: p.evaluate('([x, y]) => Array.from(document.querySelector("canvas.le-canvas").getContext("2d").getImageData(x, y, 1, 1).data)', [x, y])
                c0 = px(320, 100)
                check(abs(c0[0] - TEAL[0]) < 6 and abs(c0[1] - TEAL[1]) < 6 and abs(c0[2] - TEAL[2]) < 6, 'the canvas shows the maker\u2019s frame (its picture, not a stand-in card)')
                p.evaluate("() => { const r = document.getElementById('le-range'); r.value = '10'; r.dispatchEvent(new Event('input', { bubbles: true })); }")
                p.wait_for_timeout(700)
                band = px(320, 330)
                check(abs(band[1] - TEAL[1]) > 30, 'at 1.0 s the caption text sits in the bottom band the film\u2019s rules give it (a dark box over the frame)')
                check(px(320, 100) == c0 and px(60, 200) == c0, 'and the rest of the frame is untouched')
                if phone:
                    check(p.locator('.le-lanes').is_hidden() and p.locator('.le-list').is_visible(), 'a phone shows the list and no lanes')
                    check('Picture:' not in p.inner_text('.le-list') and 'house price' not in p.inner_text('.le-list'), 'a lane the maker can not build is left out of the list')
                else:
                    check(p.locator('.le-lane').count() == 4, 'four lanes are drawn')
                    check(p.locator('.le-off').count() == 2 and 'Not available yet' in p.inner_text('.le-lanes'), 'the pictures and music lanes say Not available yet')
                    order = lambda: p.eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)')
                    check(order() == ['v1', 'v2', 'v3'], 'the clips come from the PC\u2019s track summary')
                    check('AI-altered' in p.inner_text('.le-clip[data-id="v2"]'), 'the PC\u2019s AI-altered marker shows on its clip')
                    n0 = len(calls)
                    p.focus('.le-clip[data-id="v3"]')
                    p.keyboard.press('ArrowLeft')
                    p.wait_for_timeout(500)
                    check(order() == ['v1', 'v3', 'v2'] and 'editor_apply_ops' in calls[n0:], 'a reorder goes to the PC first, and the screen follows its answer')
                    pend = pc.evaluate("window.pc.app.pending('%s').length" % PROJECT)
                    check(pend == 1, 'the PC holds it as a waiting change for its own applier')
                    # the AI's change, from the PC's draft
                    pc.evaluate("([p]) => window.pc.ai.apply(p, 'compilation', window.pc.draft(p, 'compilation').revision, [{ op: 'set_clip_text', id: 't1', text: 'By my AI' }], 'Claude')", [PROJECT])
                    p.locator('.le-banner').wait_for(state='visible', timeout=6000)
                    check('Your AI changed 1 thing' in p.inner_text('.le-banner'), 'the AI\u2019s change from the PC\u2019s draft shows with the banner')
                    p.click('.le-clip[data-id="t1"]')
                    check(p.input_value('#le-text') == 'By my AI', 'and its text is on the clip')
                    # the text cap comes from the summary's limits: the field itself stops at 20 letters
                    check(p.get_attribute('#le-text', 'maxlength') == '20', 'the text field stops at the PC’s limit of 20 letters')
                    # a stale revision: the AI gets in first, the page says so and the retry works
                    pc.evaluate("([p]) => window.pc.ai.apply(p, 'compilation', window.pc.draft(p, 'compilation').revision, [{ op: 'set_clip_text', id: 't1', text: 'AI again' }], 'Claude')", [PROJECT])
                    p.fill('#le-text', 'Mine')
                    p.dispatch_event('#le-text', 'change')
                    p.wait_for_timeout(600)
                    check(p.input_value('#le-text') in ('Mine', 'AI again') and ('Your AI changed this just now' in p.inner_text('.form-note') or p.input_value('#le-text') == 'Mine'), 'a change that races the AI is either accepted or brought up to date, never lost silently')
                # the final film is built by the maker itself: POST /api/live/render {}, the answer comes when it is made, nothing invented in between
                p.click('button:has-text("Build final film")')
                check('What will render' in p.inner_text('.le-render'), 'the final button first says in words what will be built')
                p.click('button:has-text("Start the render")')
                p.locator('.le-prog-head', has_text='Building your film on this computer.').wait_for(timeout=3000)
                body = p.inner_text('.le-render')
                check('Working for' in body and '%' not in body and 'left' not in body, 'while it builds the page says how long it has been working and never invents a percentage or a time left')
                check(p.is_disabled('button:has-text("Build final film")'), 'editing and the final button are locked while it builds')
                p.wait_for_timeout(1300)
                check('Working for 0:0' in p.inner_text('.le-render') and 'Working for 0:00' not in p.inner_text('.le-render'), 'the clock keeps counting while the maker builds')
                held[0].fulfill(status=200, content_type='application/json', body=json.dumps({'message': 'Built from your edit.', 'film': 'my film.mp4'}))
                p.locator('.le-prog-head', has_text='Your film is ready.').wait_for(timeout=8000)
                check('Built from your edit.' in p.inner_text('.le-render') and 'my film.mp4' in p.inner_text('.le-render'), 'the maker\u2019s answer is shown as plain words, with the file name')
                check(renders == [(TOKEN, '{}')], 'one POST to /api/live/render with an empty object and the token header')
                p.click('.le-render button:has-text("Close")')
                check(p.locator('.le-render').is_hidden() and p.is_enabled('button:has-text("Build final film")'), 'closing it opens editing again')
                p.screenshot(path=str(OUT / f'maker-live-{name}.png'), full_page=True)
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'no sideways scroll')
                check(not other, 'nothing was requested from outside the PC\u2019s own address' + (f': {other[:2]}' if other else ''))
                check(not [e for e in errors if 'Content Security Policy' in e or 'Refused' in e], 'no policy violations')
                check(not errors, 'no console errors' + (f': {errors[:2]}' if errors else ''))
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
