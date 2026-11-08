"""The map panel demo page (/map-panel-demo/, WEB 11-08) in real Chrome, LOCAL server only, `mapPanelDemo` ON in a local config copy, desktop (1100 px) and phone (390 px): switch off shows only the plain line; on shows the demo
banner, the panel with its six layers and the time slider; the default state is "not held" and fills in by itself after 3 s still (option A); option B shows a Load this area button; the three no-number states and the three
chat/service states each show their own words; a layer you set shows "you set this" and the reset restores the standard layers; the slider keeps focus while dragged and the forecast layer extends it and labels it Estimated;
the phone has a Layers sheet that opens and closes; every tap target is at least 44 px; no outside request except the page font; no sideways scroll; no console errors. Needs Chrome.   python tools/check-map-panel-demo.py"""
import http.server, re, socketserver, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)          # its own port: a fixed one can be bound twice at once on Windows
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r'mapPanelDemo:\s*false', 'mapPanelDemo: true', base)
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


STATUS = "document.querySelector('.status').hidden ? '' : document.querySelector('.status').innerText"
SIDEWAYS = "document.documentElement.scrollWidth > document.documentElement.clientWidth"
SMALL = """() => [...document.querySelectorAll('.mp button, .mp input, .mp select, .demo-controls select')].filter(e => e.offsetParent !== null).filter(e => { const r = e.getBoundingClientRect(); return (r.width < 44 || r.height < 44) && !(e.type === 'checkbox'); }).map(e => (e.getAttribute('aria-label') || e.id || e.textContent).trim().slice(0, 20))"""


def state(p, v):
    p.select_option('#mp-st', v); p.wait_for_timeout(80)
    return p.evaluate(STATUS)


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    errs, hosts = [], set()
    p = page(b, base, {'viewport': {'width': 1100, 'height': 900}}, errs, hosts)
    p.goto(f'http://127.0.0.1:{PORT}/map-panel-demo/'); p.wait_for_timeout(300)
    check(p.is_visible('#not-available') and not p.is_visible('.mp'), 'switch off: only the plain line, no panel')
    p.context.close()

    for name, opts, phone in (('desktop 1100', {'viewport': {'width': 1100, 'height': 900}}, False), ('phone 390', {'viewport': {'width': 390, 'height': 800}, 'is_mobile': True, 'has_touch': True}, True)):
        print(name)
        errs, hosts = [], set()
        p = page(b, on_cfg, opts, errs, hosts)
        p.goto(f'http://127.0.0.1:{PORT}/map-panel-demo/'); p.wait_for_timeout(300)
        check(p.is_visible('.mp') and not p.is_visible('#not-available'), 'switch on: the panel shows')
        check('invented' in p.inner_text('.banner').lower(), 'the demo banner says the data is invented')
        check(p.evaluate("document.querySelectorAll('.lrow').length") == 6, 'six layers listed')
        check(p.evaluate("!!document.querySelector('.mp.phone')") == phone, 'the phone layout is used only on a phone')
        s0 = p.evaluate(STATUS)
        check(s0.startswith('Not fetched yet') and 'by itself' in s0, 'default state: not held, fills in by itself (option A)')
        p.wait_for_timeout(3400)
        check(p.evaluate(STATUS) == '', 'after 3 s still the places fill in by themselves and the note goes')
        p.click('[data-zoom="1"]'); p.wait_for_timeout(100)
        check(p.evaluate(STATUS).startswith('Not fetched yet'), 'a zoom to a view not held shows the not-held note again')
        p.wait_for_timeout(3400)
        check(p.evaluate(STATUS) == '', 'and it fills in by itself again')
        p.select_option('#mp-fm', 'B'); p.select_option('#mp-st', 'loading'); p.wait_for_timeout(3400)
        check(p.evaluate(STATUS).startswith('Not fetched yet') and p.is_visible('[data-load]'), 'option B: the note stays and a Load this area button shows (no self-fill)')
        p.click('[data-load]'); p.wait_for_timeout(80)
        check(p.evaluate(STATUS) == '', 'pressing Load this area draws it')
        p.select_option('#mp-fm', 'A')
        s1, s3 = state(p, 'level'), state(p, 'nofig')
        check(s1.startswith('Not published at this level') and s3.startswith('Withheld, or no figure') and s1 != s3, 'not published and withheld are different words')
        check('not a zero' in s3, 'withheld says it is not a zero')
        check(state(p, 'blocked').startswith('This chat does not let the map load detail'), 'blocked state')
        check('Try again in 20 seconds' in state(p, 'slow'), 'slowing-down state names the seconds')
        check(state(p, 'newer').startswith('This map is newer than this panel'), 'newer-than-panel state')
        check(state(p, 'offline').startswith("Can't reach the map service"), 'unreachable state')
        state(p, 'drawn')
        # layers
        p.evaluate("window.scrollTo(0,0)")
        if phone:
            check(not p.is_visible('#lay'), 'phone: the layers sheet starts closed'); p.click('#mp-sheet'); p.wait_for_timeout(80)
            check(p.is_visible('#lay') and p.get_attribute('#mp-sheet', 'aria-expanded') == 'true', 'phone: the Layers button opens the sheet')
        p.check('#l-second'); p.wait_for_timeout(80)
        check('you set this' in p.inner_text('.lrow:nth-of-type(4)') and p.inner_text('[data-label]') == 'Calculated', 'a layer you set says so and the label becomes Calculated')
        p.click('[data-reset]'); p.wait_for_timeout(80)
        check(p.inner_text('[data-label]') == 'Observed' and 'you set this' not in p.inner_text('#lay'), 'reset restores the standard layers and the Observed label')
        check(p.is_disabled('#l-points'), 'the private points layer is locked')
        # time slider
        p.focus('#mp-yr'); p.keyboard.press('ArrowLeft'); p.wait_for_timeout(60)
        check(p.evaluate("document.activeElement.id") == 'mp-yr' and p.inner_text('.yr') == '2022', 'the slider keeps focus and moves one year')
        p.check('#l-fcast'); p.wait_for_timeout(80)
        check(p.get_attribute('#mp-yr', 'max') == '2029', 'the forecast layer extends the slider')
        p.fill('#mp-yr', '2026'); p.wait_for_timeout(80)
        check(p.inner_text('[data-label]') == 'Estimated' and p.get_attribute('#mp-yr', 'aria-valuetext') == '2026, estimated', 'a forecast year is labelled Estimated')
        check(p.evaluate("document.querySelector('.brk').style.left") != '', 'the break mark is placed')
        # sheet close on phone
        if phone:
            p.click('#mp-sheet'); p.wait_for_timeout(80)
            check(not p.is_visible('#lay'), 'phone: the Layers button closes the sheet again')
        check(not p.evaluate(SIDEWAYS), 'no sideways scroll')
        small = p.evaluate(SMALL); check(small == [], f'every tap target is at least 44 px {small}')
        check(not errs, f'no console errors {errs[:2]}')
        check(hosts <= {f'http://127.0.0.1:{PORT}', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'}, f'no outside request except the page font {sorted(hosts)}')
        p.context.close()
    b.close()
srv.shutdown()
print('ALL OK' if ok else 'FAILED'); raise SystemExit(0 if ok else 1)
