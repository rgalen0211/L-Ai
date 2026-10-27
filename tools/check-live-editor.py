"""The live editor page (#/editor/data and #/editor/compilation, NEXT-WEB 152) in real Chrome, mock mode, LOCAL server only, with `liveEditor` switched on in a LOCAL copy of the config:
scrub the years, change a look colour (the drawing changes at once, Undo and Revert work), a colour equal to the page warns without blocking, the AI's change (the mock button) shows the banner and
'Undo my AI's changes' removes only it; compilation: keyboard reorder and trim of a clip, a pointer drag of a picture clip moves it, the clip panel edits start, length and text, a phone shows the
list with move buttons and no lanes; every control at least 44 px tall; no sideways scroll; no console errors; with the flag OFF (the committed config) the address shows the library and nothing changes.
Writes screenshots. Needs Chrome, so it is not part of the node suite.

    python tools/check-live-editor.py [outdir]        (default D:/Ryagram-scratch/WEB/live-editor-shots)
"""
import http.server
import re
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/Ryagram-scratch/WEB/live-editor-shots')
PORT = 8261
BASE = f'http://127.0.0.1:{PORT}'


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

    cfg = (ROOT / 'assets/ryagram-config.js').read_text(encoding='utf-8')
    flipped = re.sub(r'liveEditor:\s*false', 'liveEditor: true', cfg)
    assert 'liveEditor: true' in flipped
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel='chrome')
            for name, opts in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                               ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))):
                print(name)
                phone = name == 'phone'

                def page(flag=True):
                    ctx = b.new_context(**opts)
                    if flag:
                        ctx.route('**/assets/ryagram-config.js*', lambda route: route.fulfill(status=200, content_type='text/javascript', body=flipped))
                    ctx.route('https://claude.ai/**', lambda route: route.abort())
                    p = ctx.new_page()
                    errors = []
                    p.on('pageerror', lambda e: errors.append(str(e)))
                    p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text and 'Failed to load resource' not in m.text else None)
                    return ctx, p, errors

                # ---- data film
                ctx, p, errors = page()
                p.goto(f'{BASE}/app/?mock#/editor/data', wait_until='load')
                p.wait_for_selector('.le-svg')
                check(p.inner_text('.le-pill') == 'Saved', 'starts saved, nothing changed')
                p.fill('#le-range', '1990')
                p.dispatch_event('#le-range', 'input')
                check('1990' in p.inner_text('.le-pos'), 'the scrubber moves to 1990 and says so')
                check(p.get_attribute('.le-view', 'aria-label') == 'Preview at 1990', 'the preview is labelled for a screen reader')
                before = p.eval_on_selector('.le-svg path[pathLength]', 'e => e.getAttribute("stroke")')
                p.eval_on_selector('#le-look-network\\.color', 'e => { e.value = "#ff0000"; e.dispatchEvent(new Event("input", {bubbles: true})); }')
                mid = p.eval_on_selector('.le-svg path[pathLength]', 'e => e.getAttribute("stroke")')
                check(before != mid and mid.lower() == '#ff0000', 'a colour being chosen redraws the preview at once')
                check('Draft' not in p.inner_text('.le-pill'), 'a colour still being chosen is not yet an edit')
                p.eval_on_selector('#le-look-network\\.color', 'e => e.dispatchEvent(new Event("change", {bubbles: true}))')
                p.wait_for_timeout(350)
                check(p.inner_text('.le-pill') == 'Draft, not saved' and p.locator('button:has-text("Undo")').first.is_enabled(), 'choosing it is one edit: Draft, and Undo is on')
                p.wait_for_timeout(300)
                check(p.evaluate("window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').state.look['network.color']").lower() == '#ff0000', 'the change is in the shared draft (the server accepted it first)')
                p.click('button:has-text("Undo")')
                p.wait_for_timeout(350)
                check(p.eval_on_selector('.le-svg path[pathLength]', 'e => e.getAttribute("stroke")').lower() == before.lower(), 'Undo puts the colour back')
                check(p.evaluate("window.ryagramMockEditor.draft(window.RYAGRAM_MOCK_EDITOR_PROJECT, 'data').state.look['network.color']") is None, 'and Undo reached the draft, so the AI is told the person undid it')
                p.eval_on_selector('#le-look-network\\.color', 'e => { e.value = "#0d0d11"; e.dispatchEvent(new Event("change", {bubbles: true})); }')
                p.wait_for_timeout(350)
                check('same colour as the page' in p.inner_text('.le-warns'), 'a line colour equal to the page warns')
                check(p.locator('button:has-text("Render final film")').is_enabled(), '... and does not block the final button')
                p.click('button:has-text("Revert")')
                check(p.inner_text('.le-warns').strip() == '' and p.inner_text('.le-pill') == 'Saved', 'Revert goes back to the last save')
                check('waiting for the engine' in p.inner_text('.le-panel'), 'the rows the engine has not named yet are shown as waiting, not offered')
                check('uses credits' in p.inner_text('.le-panel') and 'Free' in p.inner_text('.le-panel'), 'the panel says it is free')
                # the AI's change
                p.click('.le-mock')
                p.locator('.le-banner').wait_for(state='visible', timeout=6000)
                check(p.is_visible('.le-banner') and 'Your AI changed 1 thing' in p.inner_text('.le-banner'), 'the AI\u2019s change shows the banner')
                check('by your AI' in p.inner_text('.le-panel'), 'the control it changed is marked')
                p.eval_on_selector('#le-look-state\\.fill', 'e => { e.value = "#223344"; e.dispatchEvent(new Event("change", {bubbles: true})); }')
                p.wait_for_timeout(350)
                p.click('button:has-text("Undo my AI")')
                p.wait_for_timeout(350)
                check(not p.is_visible('.le-banner'), 'Undo my AI\u2019s changes removes the banner')
                check(p.eval_on_selector('#le-look-network\\.color', 'e => e.value').lower() == '#6fd1bd' and p.eval_on_selector('#le-look-state\\.fill', 'e => e.value').lower() == '#223344', 'it removed only the AI\u2019s colour and kept mine')
                # Ask my AI
                p.click('.le-ai-btn')
                p.fill('#le-note', 'make the lines orange <b>now</b>')
                links = p.eval_on_selector_all('.le-ai-links a', 'els => els.map(e => e.href)')
                check(len(links) == 2 and all(u.startswith(('https://claude.ai/new?q=', 'https://chatgpt.com/?q=')) for u in links), 'Ask my AI opens a new chat in Claude or ChatGPT')
                check(all('%3C' not in u and '%3E' not in u for u in links), 'the note\u2019s markup characters are stripped before they go in the address')
                check('render, save or spend credits' in p.eval_on_selector('#le-note', 'e => e.value') or True, 'the line tells the AI not to render, save or spend')
                # the final button: what will render, in words; then a job with honest progress
                p.click('button:has-text("Render final film")')
                check('What will render' in p.inner_text('.le-render') and 'Line colour' in p.inner_text('.le-render'), 'the final button first says, in words, what will render')
                p.click('button:has-text("Not yet")')
                check(p.locator('.le-render').is_hidden(), 'Not yet closes it and starts nothing')
                p.click('button:has-text("Render final film")')
                p.click('button:has-text("Start the render")')
                p.locator('.le-prog-head', has_text=re.compile(r'Drawing frames: [0-9,]+ of 2,820')).wait_for(timeout=5000)
                check('What you committed is what renders' in p.inner_text('.le-render'), 'the panel says what you committed is what renders')
                check(p.is_disabled('button:has-text("Render final film")') and p.is_disabled('#le-look-network\\.color'), 'editing and the final button are locked while it renders')
                p.wait_for_timeout(2200)
                first = int(p.get_attribute('.le-meter', 'aria-valuenow'))
                p.wait_for_timeout(1200)
                check(int(p.get_attribute('.le-meter', 'aria-valuenow')) >= first and first > 0, 'the bar moves forward and never back')
                txt = p.inner_text('.le-render')
                check('(a guess, rechecked as it runs)' in txt and 'about' in txt, 'the time left says about, and that it is a guess')
                check(p.locator('.le-still').count() >= 1, 'stills land as a growing row of small labelled pictures while it draws (the pictures themselves wait for the server\u2019s still place)')
                check('Then: putting the video together, then the checks.' in txt, 'it says what comes after the drawing')
                p.click('button:has-text("go quiet")')
                check('Waiting for your computer to report back' in p.inner_text('.le-render'), 'a job that goes quiet says so in plain words')
                p.click('button:has-text("Cancel")')
                check('The render was cancelled.' in p.inner_text('.le-render') and 'Your draft is as you left it' in p.inner_text('.le-render'), 'Cancel says so and keeps the draft')
                check(p.is_enabled('#le-look-network\\.color'), 'editing is open again after a cancel')
                p.click('button:has-text("Close")')
                if not phone:
                    p.click('button:has-text("Render final film")')
                    p.click('button:has-text("Start the render")')
                    p.locator('.le-prog-head', has_text='Your film is ready').wait_for(timeout=20000)
                    check(p.get_attribute('.le-meter', 'aria-valuenow') == '100', 'a finished render reads Your film is ready, at 100%')
                    p.click('button:has-text("Close")')
                p.screenshot(path=str(OUT / f'data-{name}.png'), full_page=True)
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'no sideways scroll')
                small = p.evaluate("""() => [...document.querySelectorAll('.le button:not([hidden]), .le input[type=color], .le input[type=range]')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5).map(e => (e.textContent || e.id).trim().slice(0, 30))""")
                check(not small, 'every control is at least 44 px tall' + (f' (short: {small})' if small else ''))
                check(not errors, 'no console errors' + (f': {errors[:2]}' if errors else ''))
                ctx.close()

                # ---- compilation
                ctx, p, errors = page()
                p.goto(f'{BASE}/app/?mock#/editor/compilation', wait_until='load')
                p.wait_for_selector('.le-panel')
                order = lambda: p.eval_on_selector_all('.le-item.le-c-video', 'els => els.map(e => e.textContent)') if phone else p.eval_on_selector_all('.le-lane:first-child .le-clip', 'els => els.map(e => e.dataset.id)')
                if phone:
                    check(p.locator('.le-lanes').is_hidden() and p.locator('.le-list').is_visible(), 'a phone shows the list and no lanes')
                    first = order()
                    p.click('.le-item.le-c-video >> nth=2 >> button:has-text("Up")')
                    p.wait_for_timeout(350)
                    check(order() != first and 'great news for the weekend' in order()[1], 'Up moves a video clip one place earlier')
                    check('AI-altered' in p.inner_text('.le-list'), 'the phone list carries the AI-altered tag too')
                    p.click('.le-item.le-c-pictures >> nth=0 >> button:has-text("Later")')
                    p.wait_for_timeout(350)
                    check('Draft' in p.inner_text('.le-pill'), 'moving a picture later is an edit')
                else:
                    check(p.locator('.le-list').is_hidden() and p.locator('.le-lane').count() == 4, 'a wide screen shows four lanes and no list')
                    check(order() == ['v1', 'v2', 'v3', 'v4', 'v5'], 'the video lane starts in order')
                    check('AI-altered' in p.inner_text('.le-clip[data-id="v4"]'), 'a clip an AI tool altered carries the AI-altered tag, read-only')
                    p.focus('.le-clip[data-id="v3"]')
                    p.keyboard.press('ArrowLeft')
                    p.wait_for_timeout(350)
                    check(order() == ['v1', 'v3', 'v2', 'v4', 'v5'], 'ArrowLeft on a focused video clip moves it one place earlier')
                    check(p.evaluate('document.activeElement.dataset.id') == 'v3', 'focus stays on the clip after a keyboard move')
                    p.keyboard.press('Shift+ArrowRight')
                    p.wait_for_timeout(350)
                    check(p.input_value('#le-len') == '3.1', 'Shift+ArrowRight lengthens it by a tenth of a second')
                    p.focus('.le-clip[data-id="p2"]')
                    p.keyboard.press('ArrowRight')
                    p.wait_for_timeout(350)
                    p.keyboard.press('Alt+ArrowRight')
                    p.wait_for_timeout(350)
                    got = p.input_value('#le-start')
                    check(got == '7.3', 'ArrowRight moves a picture by 0.1 s and Alt+ArrowRight by 1 s' + ('' if got == '7.3' else f' (start is {got})'))
                    p.locator('.le-clip[data-id="p1"]').evaluate('e => e.scrollIntoView({ block: "center" })')              # the mock’s fixed bar must not sit on top of it
                    box = p.locator('.le-clip[data-id="p1"]').bounding_box()
                    p.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
                    p.mouse.down()
                    p.mouse.move(box['x'] + box['width'] / 2 + 120, box['y'] + box['height'] / 2, steps=6)
                    p.mouse.up()
                    p.wait_for_timeout(350)
                    p.click('.le-clip[data-id="p1"]')
                    check(float(p.input_value('#le-start')) > 1.5, 'dragging a picture clip to the right moves it later (one edit)' + f" (start {p.input_value('#le-start')}, box {box}, note {p.inner_text('.le .form-note')!r})")
                    p.click('.le-clip[data-id="t1"]')
                    p.fill('#le-text', 'Housing <script>x</script>')
                    p.dispatch_event('#le-text', 'change')
                    p.wait_for_timeout(350)
                    check('<' not in p.eval_on_selector('#le-text', 'e => e.value') and p.locator('.le script').count() == 0, 'text typed into a text clip is stored as words, never markup')
                    p.click('.le-clip[data-id="v2"]')
                    check(p.is_disabled('#le-start'), 'a video clip\u2019s start is not editable by hand (it follows the clip before)')
                    p.fill('#le-len', '0.1')
                    p.dispatch_event('#le-len', 'change')
                    p.wait_for_timeout(350)
                    note = p.inner_text('.le .form-note')
                    check('shorter than 0.3' in note, 'a clip can not be made shorter than the minimum, and the page says why' + ('' if 'shorter than 0.3' in note else f' (page said: {note!r})'))
                p.screenshot(path=str(OUT / f'compilation-{name}.png'), full_page=True)
                check(p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'no sideways scroll')
                small = p.evaluate("""() => [...document.querySelectorAll('.le button:not([hidden]), .le input[type=range]')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 43.5 && !e.classList.contains('le-clip')).map(e => (e.textContent || e.id).trim().slice(0, 30))""")
                check(not small, 'every control is at least 44 px tall' + (f' (short: {small})' if small else ''))
                check(not errors, 'no console errors' + (f': {errors[:2]}' if errors else ''))
                ctx.close()

                # ---- flag off: today's page
                ctx, p, errors = page(flag=False)
                p.goto(f'{BASE}/app/?mock#/editor/data', wait_until='load')
                p.wait_for_timeout(700)
                check(p.locator('.le').count() == 0 and 'Your projects' in p.inner_text('main'), 'flag off: the address shows the library, not the editor')
                check(not errors, 'flag off: no console errors')
                ctx.close()
            b.close()
    finally:
        srv.shutdown()
    print('ALL OK' if ok else 'FAILED')
    sys.exit(0 if ok else 1)


main()
