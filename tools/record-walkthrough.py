"""Records the Ryagram walkthrough video from the MOCK app (/app/?mock) and encodes it.

    python tools/record-walkthrough.py [--out DIR] [--film PATH_TO_FINISHED_FILM.mp4]

What it does, with no one touching the keyboard: starts a static server on this checkout, opens /app/?mock in Chrome at
an iPhone-sized viewport (390x844 at 2x), and plays a script: pick a topic, shape the film (theme, colours, canvas, years),
ask the AI editor, then render (contact sheet, preview, final) and watch the progress timer. It photographs the page as it
goes (so frames are sharp at 2x), writes short captions into the page itself, and ends on a short clip of a real finished
film. Output: walkthrough.mp4 (H.264, muted, faststart), walkthrough-poster.jpg, and the raw frame log.

The mock app is the real UI with a pretend worker and a pretend editor: the editor's reply here is scripted (the mock's own
reply says "mock editor") and applied to the story through the same function the real editor uses; the render speed is
accelerated. Needs: playwright (python), Chrome, ffmpeg on PATH.
"""
import argparse
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8130
W, H = 390, 844

CAPTION_JS = """
(() => {
  if (document.getElementById('rg-cap')) return;
  const css = document.createElement('style');
  css.textContent = `
    .mock-bar,.sources-panel,.uploads-panel,.share-panel,form:has(#story),.admin-links,.credit-balance,.form-intro+.version-list{display:none!important}
    #rg-cap{position:fixed;left:12px;right:12px;bottom:14px;z-index:99999;padding:12px 16px;border-radius:14px;background:rgba(20,20,26,.94);
      color:#f2f2ef;font:700 17px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;letter-spacing:-.01em;
      border:1px solid #3a3a44;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .25s;opacity:0;pointer-events:none}
    #rg-cap.on{opacity:1}
    #rg-tap{position:fixed;z-index:99998;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,138,61,.45);
      border:2px solid #ff8a3d;pointer-events:none;opacity:0;transform:scale(.4);transition:opacity .15s,transform .35s}
    #rg-tap.on{opacity:1;transform:scale(1)}
    html{scroll-behavior:smooth}`;
  document.head.append(css);
  const cap = document.createElement('div'); cap.id = 'rg-cap'; cap.setAttribute('aria-hidden', 'true'); document.body.append(cap);
  const tap = document.createElement('div'); tap.id = 'rg-tap'; document.body.append(tap);
  window.__caption = t => { cap.textContent = t || ''; cap.classList.toggle('on', !!t); };
  window.__tap = (x, y) => { tap.style.left = x + 'px'; tap.style.top = y + 'px'; tap.classList.add('on'); setTimeout(() => tap.classList.remove('on'), 380); };
})();
"""

# The scripted editor: applies the change through ryagramLook (the function the real editor's set_look uses) and answers in plain words.
EDITOR_JS = """
(() => {
  const c = window.ryagramMock.client;
  c.functions.invoke = async (name, { body }) => {
    const v = c.db.versions.find(x => x.id === body.version_id);
    const L = window.ryagramLook;
    const out = L.apply(v.story_spec, { title: { index: 0, headline: 'Where obesity is highest, and where fast food followed', subhead: '2014 to 2022, state by state' } });
    if (out.ok) { v.story_spec = out.story; }
    let s = c.db.ai_sessions.find(x => x.version_id === body.version_id);
    if (!s) { s = { id: c.newId(), version_id: body.version_id }; c.db.ai_sessions.push(s); }
    const reply = 'Done. I wrote the title card as you asked and kept your years and colours. Make a contact sheet to see it.';
    for (const [role, content] of [['user', body.message], ['assistant', reply]]) c.db.ai_messages.push({ id: c.newId(), session_id: s.id, role, content, created_at: c.now() });
    await new Promise(r => setTimeout(r, 1400));
    return { data: { reply, actions: [{ type: 'story_changed' }], escalated: false, tool_calls: 1 }, error: null };
  };
})();
"""


def serve():
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(ROOT), **k)
    handler.log_message = lambda *a: None
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    class Server(socketserver.TCPServer):
        allow_reuse_address = True
    srv = Server(('127.0.0.1', PORT), lambda *a, **k: Quiet(*a, directory=str(ROOT), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Recorder:
    def __init__(self, page, frames_dir):
        self.page, self.dir, self.frames, self.t0, self.n = page, frames_dir, [], time.time(), 0

    def shoot(self):
        path = self.dir / f'f{self.n:05d}.jpg'
        self.page.screenshot(path=str(path), type='jpeg', quality=88)
        self.frames.append((time.time() - self.t0, path.name))
        self.n += 1

    def pace(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self.shoot()

    def caption(self, text):
        self.page.evaluate('t => window.__caption(t)', text)
        self.pace(0.35)

    def tap(self, locator):
        locator.scroll_into_view_if_needed()
        box = locator.bounding_box()
        self.page.evaluate('([x, y]) => window.__tap(x, y)', [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2])
        self.pace(0.35)
        locator.click()

    def type(self, locator, text, per_char=0.028):
        self.tap(locator)
        for ch in text:
            self.page.keyboard.type(ch)
            self.pace(per_char)

    def scroll_to(self, locator, block='center'):
        self.page.evaluate('(el) => el.scrollIntoView({behavior: "smooth", block: "%s"})' % block, locator.element_handle())
        self.pace(0.9)


def record(out: Path, film: Path | None):
    frames_dir = out / 'frames'
    shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True)
    srv = serve()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', args=['--force-color-profile=srgb'])
            ctx = browser.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=True, has_touch=True, bypass_csp=True,
                                      user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
            page = ctx.new_page()
            page.on('dialog', lambda d: d.accept())
            page.goto(f'http://127.0.0.1:{PORT}/app/?mock', wait_until='networkidle')
            page.evaluate(CAPTION_JS)
            page.evaluate(EDITOR_JS)
            r = Recorder(page, frames_dir)
            r.pace(0.8)

            # 1. Pick a topic ---------------------------------------------------------------------------------------------
            vid = page.evaluate('window.ryagramMock.client.db.versions[0].id')
            page.evaluate("id => { location.hash = '#/v/' + id }", vid)
            page.wait_for_selector('.template-picker summary')
            r.pace(0.5)
            r.caption('Pick a topic.')
            r.tap(page.locator('.template-picker summary'))
            r.pace(0.5)
            card = page.locator('label.template-card').filter(has=page.locator('strong:text-is("Map")')).filter(has_text='Obesity').first
            r.scroll_to(card, 'center')
            r.tap(card)
            r.pace(0.5)
            r.tap(page.locator('.template-form button[type=submit]'))
            r.pace(1.1)

            # 2. Shape the film -------------------------------------------------------------------------------------------
            r.caption('Shape it: theme, colours, canvas, years.')
            look = page.locator('.look-panel')
            r.scroll_to(look, 'start')
            r.tap(look.locator('summary'))
            r.pace(0.6)
            r.tap(look.locator('label.template-card').filter(has_text='High contrast'))
            r.pace(0.5)
            high = look.locator('.look-field').filter(has_text='Map colour for high values').locator('input[type=text]')
            r.scroll_to(high, 'center')
            high.fill('')
            r.type(high, '#ffb000')
            start = look.locator('.look-field').filter(has_text='First period').locator('input[type=text]').first
            r.scroll_to(start, 'center')
            start.fill('')
            r.type(start, '2014')
            endf = look.locator('.look-field').filter(has_text='Last period').locator('input[type=text]').first
            endf.fill('')
            r.type(endf, '2022')
            canvas = page.locator('#look-canvas')
            r.scroll_to(canvas, 'center')
            r.tap(canvas)
            canvas.select_option('vertical')
            r.pace(1.2)
            canvas.select_option('wide')
            r.pace(0.5)
            r.tap(look.locator('button[type=submit]'))
            r.pace(1.0)

            # 3. Ask the AI editor ----------------------------------------------------------------------------------------
            r.caption('Ask the editor in plain English.')
            chat = page.locator('#chat-input')
            r.scroll_to(chat, 'center')
            r.type(chat, 'Make the title say where obesity is highest, and where fast food followed')
            r.pace(0.3)
            r.tap(page.locator('.chat-panel button[type=submit]'))
            r.pace(2.6)

            # 4. Render --------------------------------------------------------------------------------------------------
            r.caption('Watch it render.')
            sheet = page.get_by_role('button', name='Make contact sheet')
            r.scroll_to(sheet, 'start')

            def run_job(button, label, fast=True, limit=40):
                r.tap(button)
                page.evaluate('fast => { window.__fast = setInterval(() => window.ryagramMock.worker.tick(), fast) }', 130 if fast else 520)
                t_end = time.time() + limit
                while time.time() < t_end:
                    r.pace(0.25)
                    if page.locator('.job .state.job-complete').count() >= label:
                        break
                page.evaluate('clearInterval(window.__fast)')
                r.pace(0.5)

            run_job(sheet, 1)
            run_job(page.get_by_role('button', name='Make preview'), 2)
            final = page.get_by_role('button', name='Render final film')
            r.scroll_to(final, 'start')
            run_job(final, 3, fast=False)

            # 5. Finished ------------------------------------------------------------------------------------------------
            r.caption('Your film is ready.')
            jobs_list = page.locator('.jobs-panel .job').first
            r.scroll_to(jobs_list, 'start')
            r.pace(1.6)
            page.evaluate('t => window.__caption(t)', '')
            r.pace(0.2)
            browser.close()
    finally:
        srv.shutdown()
    (out / 'frames.json').write_text(json.dumps(r.frames))
    return r.frames


def encode(out: Path, film: Path | None):
    frames = json.loads((out / 'frames.json').read_text())
    frames_dir = out / 'frames'
    lst = out / 'frames.txt'
    with open(lst, 'w') as f:
        for i, (t, name) in enumerate(frames):
            dur = (frames[i + 1][0] - t) if i + 1 < len(frames) else 0.5
            f.write(f"file '{(frames_dir / name).as_posix()}'\nduration {max(dur, 0.02):.3f}\n")
        f.write(f"file '{(frames_dir / frames[-1][1]).as_posix()}'\n")
    app = out / 'app.mp4'
    vf = 'fps=24,scale=540:-2:flags=lanczos,format=yuv420p'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-vf', vf, '-c:v', 'libx264', '-preset', 'slow',
                    '-crf', '27', '-movflags', '+faststart', '-an', str(app)], check=True)
    parts = [app]
    if film and film.exists():
        end = out / 'end.mp4'
        # A short clip of a real finished film, letterboxed on the Night page, with its own caption.
        filter_ = ("[0:v]fps=24,scale=540:-2:flags=lanczos[v];color=c=0x14141a:s=540x1170:r=24[bg];[bg][v]overlay=0:(H-h)/2-20:shortest=1,"
                   "drawbox=x=12:y=ih-92:w=iw-24:h=60:color=0x14141aF0:t=fill,"
                   "drawtext=text='A finished film.':fontcolor=0xf2f2ef:fontsize=26:x=(w-text_w)/2:y=h-76:fontfile='C\\:/Windows/Fonts/arialbd.ttf',format=yuv420p")
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '42', '-t', '4.5', '-i', str(film), '-filter_complex', filter_, '-c:v', 'libx264', '-preset', 'slow',
                        '-crf', '27', '-an', str(end)], check=True)
        parts.append(end)
    listing = out / 'parts.txt'
    listing.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts))
    final = out / 'walkthrough.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c:v', 'libx264', '-preset', 'slow', '-crf', '27',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(final)], check=True)
    return final


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'tools' / 'walkthrough-out'))
    ap.add_argument('--film', default=None)
    ap.add_argument('--encode-only', action='store_true')
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if not a.encode_only:
        record(out, None)
    f = encode(out, Path(a.film) if a.film else None)
    dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, text=True).stdout.strip()
    print('wrote', f, f.stat().st_size, 'bytes', dur, 's')
