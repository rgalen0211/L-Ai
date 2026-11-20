"""The editor as a one-screen WORKBENCH (WEB 11-20, Ryan's 11:55 and 12:33 orders) in real Chrome, mock mode, LOCAL server only, a film API fixture (the engine's own bundle windows of a SYNTHETIC story), `liveEditor` ON.
ONE SCREEN: the page never scrolls at 1280x800, 1440x900 and 1024x768 (Pro, Simple, panels collapsed); panels collapse and resize (drag and keys); the timeline scrolls inside itself. RYAN'S FOUR FIXES:
(1) the title is THIS film's own, and every picture (preview, strip tiles, media list) is made from this film's own bundle (no remote or sample picture); (2) the preview fills the stage at its shape (no bars: the picture's box
covers the stage on the limiting axis); (3) a real scrub bar under the preview (filled, labelled, click and keys seek) and no floating dot; (4) Output is not on the stage: the Render dialog says the film's real format
(read-only) and offers no aspect, size or rate choice. FAULT=<name> serves one deliberately broken copy of a file so the check can be shown to FAIL (python tools/check-editor-workbench.py [shots-folder]).  Needs Chrome."""
import base64, http.server, json, os, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/head-1119b/shots-ds')
OUT.mkdir(parents=True, exist_ok=True)
FAULT = os.environ.get('FAULT', '')
FAULTS = {
    'demo-picture': ('assets/app-editor-wb.js', "const picture = h('div', { class: 'wb-picture' }, P.view);", "const picture = h('div', { class: 'wb-picture' }, P.view, h('img', { src: 'https://example.com/sample.jpg', alt: '' }));"),
    'letterbox': ('assets/app-editor-wb.js', "P.view.style.width = `${Math.floor(w)}px`; P.view.style.height = `${Math.floor(hh)}px`;", "P.view.style.width = `${Math.floor(w * .6)}px`; P.view.style.height = `${Math.floor(hh * .6)}px`;"),
    'no-fill': ('assets/app-editor-film.js', "range.style.setProperty('--p',", "range.style.setProperty('--q',"),
    'output-choices': ('assets/app-editor.js', "h('p', { class: 'meta' }, 'Shape and size (16:9 or 9:16, 1080p or 720p) are set when the film is made. Format changes are not available yet.')];", "h('p', { class: 'meta' }, 'Shape and size'), h('select', { 'aria-label': 'Shape' }, h('option', {}, '16:9'), h('option', {}, '9:16'))];"),
    'page-scroll': ('assets/ryagram-ds-editor.css', 'height:100vh;height:100dvh;overflow:hidden;display:flex;flex-direction:column}', 'height:auto;overflow:visible;display:flex;flex-direction:column}'),
    'title-sample': ('assets/app-editor.js', "title.textContent = t; title.dataset.film = '1';", "title.textContent = 'Obesity and fast food'; title.dataset.film = '1';"),
}


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), H)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
on_cfg = re.sub(r"\bliveEditor:\s*(?:false|'account')", 'liveEditor: true', base)
API = """
window.ryagramFilmApi = () => ({
  plan: async () => ({ fps: 30, frames: 120, seconds: 4, windows: [{ seconds: [0, 2], window: '0:2' }, { seconds: [2, 4], window: '2:4' }],
    timeline: { clips: [{ id: 't', kind: 'title', label: 'Opening title', start: 0, seconds: 1, drawn: false }, { id: 'main', kind: 'render', label: 'The film', start: 1, seconds: 4, drawn: true }],
      render_clip: 'main', render_start: 1, total_seconds: 5, total_frames: 150 } }),
  window: async (text, o) => {
    const [a, b] = text.split(':'); o.onProgress(0.5); await new Promise(r => setTimeout(r, 120));
    const data = window.__fixtures[a + '-' + b]; if (!data) throw new Error('that part of your film is not here');
    const bin = atob(data), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
});
"""
FIX = json.dumps({k: base64.b64encode((ROOT / f'tests/fixtures/film-bundle-synthetic-{k}.zip').read_bytes()).decode() for k in ('0-2', '2-4')})
ok = True


def check(c, w):
    global ok
    print(('  ok   ' if c else '  FAIL ') + w); ok = ok and bool(c)


def serve_fault(ctx):
    if not FAULT: return
    f, old, new = FAULTS[FAULT]
    src = (ROOT / f).read_text(encoding='utf-8').replace('\r\n', '\n')
    assert old in src, f'fault {FAULT}: text not found'
    body = src.replace(old, new)
    ctype = 'text/css' if f.endswith('.css') else 'text/javascript'
    ctx.route(re.compile(r'.*/' + re.escape(f.split('/')[-1]) + r'.*'), lambda r, _q: r.fulfill(status=200, content_type=ctype, body=body))


def open_editor(b, w, h_, errs):
    ctx = b.new_context(viewport={'width': w, 'height': h_}, color_scheme='dark')
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, _q: r.abort())
    ctx.route('**/assets/ryagram-config.js*', lambda r, _q: r.fulfill(status=200, content_type='text/javascript', body=on_cfg))
    ctx.add_init_script('window.__fixtures = ' + FIX + ';' + API)
    serve_fault(ctx)
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    p.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='load'); p.wait_for_selector('#np-title', timeout=20000)
    proj = p.evaluate("(() => { const q = window.ryagramMock.client.db.projects; const x = q[q.length - 1]; return { id: x.id, title: x.title }; })()")
    p.evaluate("pid => { window.ryagramMockLookBundle = undefined; location.hash = '#/editor/data/' + pid; }", proj['id'])
    p.wait_for_selector('.le-wb .wb', timeout=20000); p.wait_for_selector('.le-wb .wb-picture .le-film-view svg', timeout=25000); p.wait_for_timeout(1800)
    p.evaluate("document.querySelector('.mock-bar')&&document.querySelector('.mock-bar').remove()")
    return ctx, p, proj


def no_scroll(p, label):
    d = p.evaluate("({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, bh: document.body.scrollHeight })")
    check(d['sh'] <= d['ih'] + 1 and d['sw'] <= d['iw'] + 1, f'{label}: the page never scrolls (page {d["sh"]} of {d["ih"]} high, {d["sw"]} of {d["iw"]} wide)')


with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    errs = []
    print('1440x900, Simple (the default)')
    ctx, p, proj = open_editor(b, 1440, 900, errs)
    no_scroll(p, '1440x900 Simple')
    p.screenshot(path=str(OUT / 'after-editor-simple-1440.png'))
    grid = p.evaluate("(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return [Math.round(x.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)]; }; return { left: r('.wb-panel.left'), stage: r('.wb-panel.stage'), right: r('.wb-panel.right'), tl: r('.wb-panel.timeline') }; })()")
    check(all(grid.values()), 'the four panels are there: media and tracks, the stage, properties, the timeline')
    check(grid['tl'][1] > grid['stage'][1] + grid['stage'][3] - 4 and grid['left'][0] < grid['stage'][0] < grid['right'][0], 'the timeline runs along the bottom, media on the left, properties on the right')
    # (1) this film's own title and pictures
    h1 = p.inner_text('.wb-name h1').strip()
    check(h1 == proj['title'], f'(1) the page is named for THIS film ({h1!r} is {proj["title"]!r})')
    srcs = p.evaluate("[...document.querySelectorAll('.wb img')].map(i => i.getAttribute('src') || '')")
    check(len(srcs) >= 1 and all(s.startswith('data:image/svg+xml') for s in srcs), f'(1) every picture in the workbench is drawn from the film\'s own frames ({len(srcs)} pictures, all drawn by the film\'s drawer)')
    check(p.evaluate("!!document.querySelector('.wb-picture .le-film-view svg') && document.querySelector('.wb-picture .le-film-view svg').outerHTML.length > 2000"), '(1) the preview is the film\'s own drawing')
    check(p.locator('.wb-media .wb-frame').count() >= 1 and p.locator('.wb-tl .le-film-tile img').count() >= 1, '(1) the media list and the timeline strip show the film\'s frames')
    # (2) the preview fills the stage at its shape
    fitm = p.evaluate("(() => { const pic = document.querySelector('.wb-picture').getBoundingClientRect(), v = document.querySelector('.wb-picture .le-film-view').getBoundingClientRect(); return { cw: pic.width, ch: pic.height, w: v.width, h: v.height }; })()")
    margin = min(fitm['cw'] - fitm['w'], fitm['ch'] - fitm['h'])
    check(0 <= margin < 26 and fitm['w'] > 300, f'(2) the picture covers the stage on its limiting axis (margin {margin:.0f}px; picture {fitm["w"]:.0f}x{fitm["h"]:.0f} in {fitm["cw"]:.0f}x{fitm["ch"]:.0f})')
    sth = p.evaluate("document.querySelector('.wb-panel.stage').getBoundingClientRect().height")
    check(fitm['h'] >= 0.6 * sth, f'(2) the picture is at least 60% of the stage height ({fitm["h"]:.0f} of {sth:.0f}px)')
    check(p.evaluate("(() => { const e = document.querySelector('.wb-name h1'); return e.title === e.textContent && getComputedStyle(e).textOverflow === 'ellipsis' && parseFloat(getComputedStyle(e).fontSize) >= 22; })()"), 'the title is H1 size, ellipsis on overflow, the full title in its title attribute')
    check(p.evaluate("(() => { const k = document.querySelector('.le-keys'); return !!k && k.hidden && !!document.querySelector('.wb-keybtn'); })()"), 'the key sentence is behind a Keys button, not under the bar')
    check(p.evaluate("(() => { const t = [...document.querySelectorAll('.wb-tools > *')].map(e => e.textContent.trim().slice(0, 6)); return t[0].startsWith('Simple') && t[t.length - 1].startsWith('Render'); })()"), 'the toolbar reads Simple | Pro first and the one primary button last')
    ar = fitm['w'] / fitm['h']; art = float(p.evaluate("document.querySelector('.wb-picture .le-film-view').dataset.ratio"))
    check(abs(ar - art) < 0.03, f'(2) at the film\'s own shape ({ar:.3f} vs {art:.3f}): no stretching')
    black = p.evaluate("(() => { const c = getComputedStyle(document.querySelector('.wb-picture')).backgroundColor; return c; })()")
    check(black in ('rgba(0, 0, 0, 0)', 'transparent'), f'(2) no black bars: the stage\'s own surface shows around the picture ({black})')
    # (3) a real scrub bar
    sc = p.evaluate("(() => { const s = document.querySelector('.le-scrub-bar'), r = s.querySelector('input[type=range]'), pic = document.querySelector('.wb-picture').getBoundingClientRect(), rr = r.getBoundingClientRect(); return { below: rr.top >= pic.bottom - 2, w: rr.width, p: r.style.getPropertyValue('--p'), n: document.querySelectorAll('.wb-panel.stage input[type=range]').length, label: s.querySelector('.le-pos').textContent }; })()")
    check(sc['below'] and sc['w'] > 300 and sc['n'] == 1, f'(3) one scrub bar directly under the preview, full width ({sc["w"]:.0f}px)')
    check(bool(sc['p']) and '/' in sc['label'], f'(3) the played part is filled and the time is labelled ({sc["p"]}, {sc["label"]})')
    box = p.locator('.le-scrub-bar input[type=range]').bounding_box()
    before = p.inner_text('.le-scrub-bar .le-pos')
    p.mouse.click(box['x'] + box['width'] * 0.8, box['y'] + box['height'] / 2); p.wait_for_timeout(500)
    after = p.inner_text('.le-scrub-bar .le-pos')
    check(after != before, f'(3) a click on the bar seeks ({before} -> {after})')
    p.locator('.le-scrub-bar input[type=range]').focus(); p.keyboard.press('Home'); p.wait_for_timeout(300)
    check(p.inner_text('.le-scrub-bar .le-pos').startswith('0:01') or p.inner_text('.le-scrub-bar .le-pos').startswith('0:00'), '(3) Home goes to the start from the keyboard')
    p.screenshot(path=str(OUT / 'after-editor-simple-1440.png'))
    # (4) Output is not on the stage; the Render dialog says the real format
    check(p.locator('.wb-panel.stage').get_by_text(re.compile(r'^(16:9|9:16|1:1|720p|1080p|30 fps|60 fps)$')).count() == 0 and p.locator('.wb-panel.stage select, .wb-panel.stage input[type=radio]').count() == 0, '(4) no aspect, size or rate choices on the stage')
    p.locator('.wb-top button:has-text("Render final film")').click(); p.wait_for_timeout(500)
    rd = p.inner_text('.le-render')
    check('Format' in rd and 'Frame rate: 30' in rd and 'Length:' in rd, f'(4) the Render dialog says the film\'s real format ({rd[:120]!r})')
    check(p.locator('.le-render select, .le-render input[type=radio], .le-render [role=radio]').count() == 0 and 'not available yet' in rd, '(4) and offers no choice it cannot honour')
    p.screenshot(path=str(OUT / 'after-editor-render-1440.png'))
    p.locator('.le-render button:has-text("Not yet")').click(); p.wait_for_timeout(200)
    ctx.close()

    print('1440x900, Pro, then panels')
    ctx, p, proj = open_editor(b, 1440, 900, errs)
    p.locator('.le-pro-seg:has-text("Pro")').click(); p.wait_for_timeout(600)
    no_scroll(p, '1440x900 Pro')
    check(p.locator('.wb-tl .le-pro').is_visible() and p.locator('.wb-tab:has-text("History")').is_visible(), 'Pro shows its tools in the timeline panel and the History tab')
    p.screenshot(path=str(OUT / 'after-editor-pro-1440.png'))
    s0 = p.evaluate("document.querySelector('.wb-panel.stage').getBoundingClientRect().width")
    p.locator('.wb-panel.left [data-collapse]').click(); p.locator('.wb-panel.right [data-collapse]').click(); p.wait_for_timeout(400)
    s1 = p.evaluate("document.querySelector('.wb-panel.stage').getBoundingClientRect().width")
    check(s1 > s0 + 300, f'collapsing both side panels grows the stage ({s0:.0f} -> {s1:.0f})')
    no_scroll(p, '1440x900 collapsed')
    p.screenshot(path=str(OUT / 'after-editor-collapsed-1440.png'))
    p.locator('.wb-panel.left [data-collapse]').click(); p.locator('.wb-panel.right [data-collapse]').click(); p.wait_for_timeout(300)
    h0 = p.evaluate("document.querySelector('.wb-panel.stage').getBoundingClientRect().height")
    hd = p.locator('.wb-resize.bottom'); hb = hd.bounding_box()
    p.mouse.move(hb['x'] + 100, hb['y'] + 4); p.mouse.down(); p.mouse.move(hb['x'] + 100, hb['y'] - 80, steps=6); p.mouse.up(); p.wait_for_timeout(300)
    h1 = p.evaluate("document.querySelector('.wb-panel.stage').getBoundingClientRect().height")
    check(h1 < h0 - 40, f'dragging the timeline edge up shortens the stage ({h0:.0f} -> {h1:.0f})')
    w0 = p.evaluate("document.querySelector('.wb-panel.right').getBoundingClientRect().width")
    p.locator('.wb-resize.right').focus(); p.keyboard.press('Shift+ArrowLeft'); p.wait_for_timeout(300)
    w1 = p.evaluate("document.querySelector('.wb-panel.right').getBoundingClientRect().width")
    check(w1 > w0 + 20, f'the arrow keys on a handle resize a panel ({w0:.0f} -> {w1:.0f})')
    no_scroll(p, '1440x900 resized')
    tlscroll = p.evaluate("(() => { const b = document.querySelector('.wb-panel.timeline .body'); return { sh: b.scrollHeight, ch: b.clientHeight, sw: b.scrollWidth, cw: b.clientWidth, ov: getComputedStyle(b).overflow }; })()")
    check(tlscroll['ov'] in ('auto', 'scroll'), f'the timeline scrolls inside its own panel ({tlscroll})')
    ctx.close()

    for w, h_ in ((1280, 800), (1024, 768)):
        print(f'{w}x{h_}')
        ctx, p, proj = open_editor(b, w, h_, errs)
        no_scroll(p, f'{w}x{h_} Simple')
        p.locator('.le-pro-seg:has-text("Pro")').click(); p.wait_for_timeout(500)
        no_scroll(p, f'{w}x{h_} Pro')
        tools = p.evaluate("(() => { const t = document.querySelector('.wb-top').getBoundingClientRect(); return { h: t.height, sw: document.querySelector('.wb-top').scrollWidth, cw: document.querySelector('.wb-top').clientWidth }; })()")
        check(tools['h'] < (80 if w >= 1241 else 112) and tools['sw'] <= tools['cw'] + 1, f'{w}x{h_}: the top row is one line (two under 1241 px: the title keeps its room) and never sideways ({tools})')
        if w == 1024: p.screenshot(path=str(OUT / 'after-editor-1024.png'))
        ctx.close()

    print('phone 390')
    ctx, p, proj = open_editor(b, 390, 844, errs)
    d = p.evaluate("({ sw: document.documentElement.scrollWidth, iw: innerWidth })")
    check(d['sw'] <= d['iw'] + 1, f'phone: no sideways scroll ({d})')
    p.screenshot(path=str(OUT / 'after-editor-phone.png'), full_page=True)
    ctx.close()
    check(not errs, 'no console errors' + (f': {errs[:2]}' if errs else ''))
    b.close()
srv.shutdown(); srv.server_close()
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
